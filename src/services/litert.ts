/**
 * Gemma 4 via Google's LiteRT-LM runtime (@litert-lm/core).
 *
 * This is a second, preferred inference backend alongside WebLLM. It exists
 * because Gemma 4 cannot run under WebLLM at all: WebLLM needs an MLC-compiled
 * WebGPU shader library per model, and none has been published for Gemma 4
 * (mlc-ai/web-llm#810 is open and unresolved; MLC's compiler still rejects the
 * architecture). LiteRT-LM is Google's own runtime and ships purpose-built
 * web variants of Gemma 4, so it is the only route to that model in a browser.
 *
 * Trade-offs this backend accepts, deliberately:
 *  - The model is ~2 GB against Gemma 3 1B's 711 MB, so it is opt-in on
 *    mobile rather than default (see llm.ts) — a 2 GB download on cellular
 *    data must be a decision the user makes knowingly.
 *  - @litert-lm/core is an early preview (v0.15.x). Every entry point here is
 *    written to fail soft so that a preview-software fault degrades to the
 *    WebLLM chain instead of taking the feature down.
 *  - Its ~30 MB WASM runtime exceeds Cloudflare Pages' 25 MB per-file limit,
 *    so it is loaded from jsdelivr rather than served from our origin —
 *    @litert-lm/core@0.15.0 hardcodes DEFAULT_WASM_PATH to jsdelivr's CDN,
 *    not Google's. That makes an unmonitored third party a single point of
 *    failure: jsdelivr has documented regional blocking and outages, and a
 *    blip there silently downgrades every best-quality (Gemma 4) user back
 *    to the WebLLM fallback chain with no signal that jsdelivr was the cause.
 */

import type { Conversation, Engine, Message } from "@litert-lm/core";
import { downloadModel, getPartialBytes } from "./model-download.js";
import type { DownloadProgress } from "./model-download.js";
import { t } from "../i18n/translations.js";

/** Web-optimised Gemma 4 builds published by litert-community. Only these two
 *  are supported by the JS runtime today — general .litertlm support is still
 *  being worked on upstream, so this list is not arbitrary. */
export interface LiteRTModelProfile {
  id: string;
  label: string;
  sizeMB: number;
  url: string;
  maxNumTokens: number;
}

export const GEMMA4_E2B: LiteRTModelProfile = {
  id: "gemma-4-E2B-it-web",
  label: "Gemma 4 E2B",
  sizeMB: 2010,
  url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm",
  // Well under the 8192 the runtime allows: the KV cache still has to fit
  // beside 2 GB of weights, and the grounded prompt needs ~1000 tokens.
  maxNumTokens: 4096,
};

/** Which phase of a load the progress text describes. "compile" is the
 *  post-download Engine.create step — minutes of on-device work with no
 *  percentage available, so the UI must switch to an indeterminate bar
 *  instead of sitting at a dishonest 100%. "fallback" marks the WebLLM
 *  fallback chain: its downloads are WebLLM's own, not ours, so there is
 *  nothing here for the UI's "use smaller model" abort control to act on. */
export type LoadStage = "download" | "compile" | "fallback";

export type LoadProgressFn = (
  text: string,
  pct: number,
  stage?: LoadStage,
) => void;

let engine: Engine | null = null;
let activeProfile: LiteRTModelProfile | null = null;

/**
 * LiteRT keeps conversation history inside the WASM object.  Keep a small
 * amount of bookkeeping outside it so the public Conversation-shaped API can
 * remain unchanged while we periodically replace an overgrown conversation.
 * The map is keyed by the handle returned to llm.ts; callers do not need to
 * know that the active runtime conversation may be a newer instance.
 */
interface ConversationState {
  readonly root: Conversation;
  readonly systemPrompt: string;
  active: Conversation;
  generation: Promise<void> | null;
  compaction: Promise<void> | null;
}

const conversationStates = new Map<Conversation, ConversationState>();
const liveConversations = new Set<ConversationState>();

// Gemma 4 E2B is configured for a 4096-token runtime window. Keep room for a
// response and sampling overhead; the original grounded user turn is retained
// even when the follow-up transcript has to be shortened.
const MAX_CONTEXT_TOKENS = 3000;
const MAX_RETAINED_MESSAGES = 8;

/**
 * The load in flight, if any. Callers that arrive while a load is running
 * JOIN it (their progress callback is added to the set) instead of being
 * bounced. The old boolean-flag version returned false to the second caller,
 * which meant: navigate away mid-download, come back, tap Load — and the
 * button showed "could not load" forever while the real load kept running
 * invisibly underneath. That was the top user-reported failure.
 */
let inFlight: Promise<boolean> | null = null;
const progressListeners = new Set<LoadProgressFn>();

function broadcast(text: string, pct: number, stage?: LoadStage): void {
  for (const listener of progressListeners) listener(text, pct, stage);
}

export function getActiveLiteRTModel(): LiteRTModelProfile | null {
  return activeProfile;
}

export function isLiteRTLoaded(): boolean {
  return engine !== null;
}

/** Bytes of this model already on disk from an interrupted attempt, so the
 *  UI can offer "Resume" instead of implying a fresh 2 GB download. */
export function getGemma4PartialBytes(): Promise<number> {
  return getPartialBytes(GEMMA4_E2B.url);
}

/** WebGPU is required. The runtime advertises a CPU WASM fallback, but a 2 GB
 *  model on CPU is not a usable experience, so we don't offer it. */
export function isLiteRTSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Loads the LiteRT engine. Returns false rather than throwing on any failure
 * — callers treat a false as "use the WebLLM chain instead".
 */
export async function loadLiteRT(
  profile: LiteRTModelProfile,
  onProgress?: LoadProgressFn,
  signal?: AbortSignal,
): Promise<boolean> {
  if (engine && activeProfile?.id === profile.id) return true;
  if (!isLiteRTSupported()) return false;

  if (onProgress) progressListeners.add(onProgress);
  // Join a load already in flight rather than refusing. The joiner's abort
  // signal is deliberately ignored — the load belongs to whoever started it,
  // and a shared download must not die because a later page navigated away.
  if (inFlight) return inFlight;

  inFlight = runLoad(profile, signal);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
    progressListeners.clear();
  }
}

async function runLoad(
  profile: LiteRTModelProfile,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    // Fetch the weights ourselves rather than handing Engine.create a URL.
    // The runtime reports no progress at all, so a URL means two gigabytes
    // downloaded in silence behind a frozen bar — and nothing kept if the
    // user leaves partway through.
    const blob = await downloadModel(
      profile.url,
      (p) => {
        const pct = p.fraction ?? 0;
        broadcast(describeDownload(profile.label, p), pct, "download");
      },
      signal,
      profile.sizeMB * 1024 * 1024,
    );

    // Dynamic import keeps the runtime out of the main bundle for the large
    // majority of sessions that never open the AI guide.
    const { Engine } = await import("@litert-lm/core");

    // Engine.create compiles 2 GB of weights for this device's GPU and offers
    // no progress callback, so this stage runs for minutes. Left silent it
    // reads as a hang — "it said it loaded, then nothing" — so tick elapsed
    // time out loud until it returns.
    const compileStart = Date.now();
    broadcast(compileMessage(profile.label, 0), 1, "compile");
    const ticker = setInterval(() => {
      const secs = Math.round((Date.now() - compileStart) / 1000);
      broadcast(compileMessage(profile.label, secs), 1, "compile");
    }, 1000);

    try {
      engine = await Engine.create({
        model: blob,
        mainExecutorSettings: { maxNumTokens: profile.maxNumTokens },
      });
    } finally {
      clearInterval(ticker);
    }
    activeProfile = profile;
    return true;
  } catch (err: unknown) {
    // An abort is the user choosing to stop, not a fault — the partial
    // download stays on disk and resumes next time.
    if (err instanceof DOMException && err.name === "AbortError") {
      return false;
    }
    // err.name carries the real signal here (QuotaExceededError, a wasm
    // fetch failure, ...) that err.message alone often doesn't mention —
    // log it explicitly so CDN/storage faults are distinguishable from
    // model-fit failures in diagnostics.
    const name = err instanceof Error ? err.name : typeof err;
    console.warn(`[LiteRT] load failed (${name}), falling back`, err);
    await unloadLiteRT();
    return false;
  }
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

function compileMessage(label: string, secs: number): string {
  return t("llm.compiling", { label, seconds: secs });
}

function describeDownload(label: string, p: DownloadProgress): string {
  if (!p.totalBytes) {
    return t("llm.downloadProgress", { label, mb: formatMB(p.receivedBytes) });
  }
  const pct = Math.round((p.fraction ?? 0) * 100);
  const params = {
    label,
    mb: formatMB(p.receivedBytes),
    totalMb: formatMB(p.totalBytes),
    pct,
  };
  return p.resumed
    ? t("llm.downloadProgressPctResumed", params)
    : t("llm.downloadProgressPct", params);
}

export async function unloadLiteRT(): Promise<void> {
  const conversations = [...liveConversations];
  liveConversations.clear();

  // Stop generation before destroying its WASM conversation. LiteRT has no
  // abort signal on sendMessageStreaming(), so cancel() is the only runtime
  // level interruption available to us.
  for (const state of conversations) {
    try {
      state.active.cancel();
    } catch {
      // Best effort: the engine may already be in teardown.
    }
  }
  for (const state of conversations) {
    try {
      if (state.generation) await state.generation;
    } catch {
      // The caller's generation promise owns the useful error handling.
    }
    try {
      await state.active.delete();
    } catch {
      // Best-effort teardown — a failure here must not block a fallback load.
    }
    conversationStates.delete(state.root);
  }

  const current = engine;
  engine = null;
  activeProfile = null;
  if (current) {
    try {
      await current.delete();
    } catch {
      // Best-effort teardown — a failure here must not block a fallback load.
    }
  }
}

/**
 * Opens a conversation seeded with the system prompt. LiteRT keeps the turn
 * history inside the Conversation object, so unlike the WebLLM path there is
 * no message array for us to accumulate or trim by hand.
 */
export async function createLiteRTConversation(
  systemPrompt: string,
): Promise<Conversation | null> {
  if (!engine) return null;
  try {
    const conversation = await engine.createConversation({
      preface: { messages: [{ role: "system", content: systemPrompt }] },
    });
    const state: ConversationState = {
      root: conversation,
      systemPrompt,
      active: conversation,
      generation: null,
      compaction: null,
    };
    conversationStates.set(conversation, state);
    liveConversations.add(state);
    return conversation;
  } catch (err: unknown) {
    console.warn("[LiteRT] createConversation failed", err);
    return null;
  }
}

/**
 * Streams one turn, invoking onChunk with the accumulated text so callers can
 * render progressively. Breaking out of the stream cancels generation, which
 * is how an aborted navigation stops work already in flight.
 */
export async function sendLiteRTMessage(
  conversation: Conversation,
  message: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw abortError();

  const state = conversationStates.get(conversation);
  if (state?.generation) {
    throw new Error("Conversation is busy. A generation is already in progress.");
  }

  if (state) await compactConversationIfNeeded(state, message, signal);
  if (signal?.aborted) throw abortError();
  if (state?.generation) {
    throw new Error("Conversation is busy. A generation is already in progress.");
  }

  const active = state?.active ?? conversation;
  const generation = streamLiteRTMessage(active, message, onChunk, signal);
  if (!state) return generation;

  state.generation = generation.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await generation;
  } finally {
    state.generation = null;
  }
}

/**
 * LiteRT's streaming method has no AbortSignal parameter. Registering the
 * listener before calling it closes the small race where navigation aborts
 * between our initial check and generation start. Breaking the async iterator
 * also invokes ReadableStream.cancel(), while Conversation.cancel() asks the
 * WASM runtime to stop its current decode immediately.
 */
async function streamLiteRTMessage(
  conversation: Conversation,
  message: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let full = "";
  let stream: ReadableStream<Message> | null = null;
  const cancel = (): void => {
    try {
      conversation.cancel();
    } catch {
      // Cancellation is best effort; the iterator close below still runs.
    }
  };

  if (signal?.aborted) throw abortError();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    // Check once more after installing the listener. This prevents a signal
    // firing in the gap above from allowing a new generation to begin.
    if (signal?.aborted) {
      cancel();
      throw abortError();
    }

    stream = conversation.sendMessageStreaming(message);
    if (signal?.aborted) cancel();

    for await (const chunk of stream) {
      if (signal?.aborted) {
        cancel();
        break;
      }
      full += extractText(chunk.content);
      if (!signal?.aborted) onChunk(full);
    }
    return full;
  } catch (err: unknown) {
    // LiteRT may report cancellation as a stream error, depending on whether
    // the WASM decode had yielded a chunk yet. Abort is still a successful
    // user cancellation from this layer's perspective.
    if (signal?.aborted) return full;
    throw err;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function abortError(): DOMException {
  return new DOMException("Generation aborted", "AbortError");
}

/**
 * Bound the history held by LiteRT. The runtime exposes both token counting
 * and history inspection, and permits a new conversation to be seeded with a
 * preface, so we can preserve the system prompt, original grounded turn and
 * the most recent follow-ups without allowing the WASM KV cache to grow
 * forever.
 */
async function compactConversationIfNeeded(
  state: ConversationState,
  incomingMessage: string,
  signal?: AbortSignal,
): Promise<void> {
  if (state.compaction) return state.compaction;

  const task = compactConversation(state, incomingMessage, signal);
  state.compaction = task;
  try {
    await task;
  } finally {
    state.compaction = null;
  }
}

async function compactConversation(
  state: ConversationState,
  incomingMessage: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError();

  let history: Message[];
  let tokenCount: number;
  try {
    [history, tokenCount] = await Promise.all([
      state.active.getHistory(),
      state.active.getTokenCount(),
    ]);
  } catch (err: unknown) {
    // History inspection is a lifecycle aid, not a reason to lose a usable
    // conversation if a preview runtime cannot provide it on one device.
    console.warn("[LiteRT] could not inspect conversation history", err);
    return;
  }

  const turns = history.filter((item) => item.role !== "system");
  const incomingTokens = Math.ceil(incomingMessage.length / 3.5) + 16;
  if (
    tokenCount + incomingTokens <= MAX_CONTEXT_TOKENS &&
    turns.length <= MAX_RETAINED_MESSAGES
  ) {
    return;
  }

  const firstUserIndex = turns.findIndex((item) => item.role === "user");
  if (firstUserIndex < 0) return;
  const firstAssistantIndex = turns.findIndex(
    (item, index) => index > firstUserIndex && isAssistantMessage(item),
  );
  const groundedTurnEnd =
    firstAssistantIndex >= 0 ? firstAssistantIndex + 1 : firstUserIndex + 1;
  const grounded = turns.slice(firstUserIndex, groundedTurnEnd);
  let recent = turns.slice(-MAX_RETAINED_MESSAGES);
  if (recent.length && recent[0] === grounded[grounded.length - 1]) {
    recent = recent.slice(1);
  }

  // Try the largest safe turn-limited transcript first, then shorten it if
  // the runtime's actual tokenizer says it still exceeds our budget.
  while (true) {
    if (signal?.aborted) throw abortError();
    const replacement = await createConversationFromHistory(
      state.systemPrompt,
      [...grounded, ...recent],
    );
    if (!replacement) return;

    let replacementTokens = Number.POSITIVE_INFINITY;
    try {
      replacementTokens = await replacement.getTokenCount();
    } catch {
      // If token inspection is unavailable, the explicit turn cap still
      // bounds the conversation, so use the replacement.
    }

    if (
      replacementTokens + incomingTokens <= MAX_CONTEXT_TOKENS ||
      recent.length === 0
    ) {
      const old = state.active;
      state.active = replacement;
      try {
        await old.delete();
      } catch {
        console.warn("[LiteRT] old conversation could not be deleted");
      }
      return;
    }

    try {
      await replacement.delete();
    } catch {
      console.warn("[LiteRT] temporary conversation could not be deleted");
    }
    recent = recent.slice(1);
  }
}

// LiteRT examples use model-facing responses as either "assistant" or
// "model" depending on the model/template. Treat both as a completed reply
// so the original grounded exchange survives compaction.
function isAssistantMessage(message: Message): boolean {
  return message.role === "assistant" || message.role === "model";
}

async function createConversationFromHistory(
  systemPrompt: string,
  turns: Message[],
): Promise<Conversation | null> {
  if (!engine) return null;
  try {
    return await engine.createConversation({
      preface: {
        messages: [
          { role: "system", content: systemPrompt },
          ...turns,
        ],
      },
    });
  } catch (err: unknown) {
    console.warn("[LiteRT] conversation rebuild failed", err);
    return null;
  }
}

/** A message's content may be a bare string or an array of typed parts, and
 *  may be absent entirely on a chunk that carries no text — the README only
 *  shows the array form, so this normalises all three rather than trusting it. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (typeof part === "string") {
      out += part;
    } else if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      out += part.text;
    }
  }
  return out;
}
