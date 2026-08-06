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
 *    so it is loaded from Google's CDN rather than served from our origin.
 */

import type { Conversation, Engine } from "@litert-lm/core";
import { downloadModel, getPartialBytes } from "./model-download.js";
import type { DownloadProgress } from "./model-download.js";

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

let engine: Engine | null = null;
let activeProfile: LiteRTModelProfile | null = null;
let loading = false;

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
  onProgress?: (text: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  if (engine && activeProfile?.id === profile.id) return true;
  if (loading) return false;
  if (!isLiteRTSupported()) return false;

  loading = true;
  try {
    // Fetch the weights ourselves rather than handing Engine.create a URL.
    // The runtime reports no progress at all, so a URL means two gigabytes
    // downloaded in silence behind a frozen bar — and nothing kept if the
    // user leaves partway through.
    const blob = await downloadModel(
      profile.url,
      (p) => {
        const pct = p.fraction ?? 0;
        onProgress?.(describeDownload(profile.label, p), pct);
      },
      signal,
      profile.sizeMB * 1024 * 1024,
    );

    onProgress?.(`${profile.label}: preparing…`, 1);
    // Dynamic import keeps the runtime out of the main bundle for the large
    // majority of sessions that never open the AI guide.
    const { Engine } = await import("@litert-lm/core");
    engine = await Engine.create({
      model: blob,
      mainExecutorSettings: { maxNumTokens: profile.maxNumTokens },
    });
    activeProfile = profile;
    loading = false;
    return true;
  } catch (err: unknown) {
    // An abort is the user choosing to stop, not a fault — the partial
    // download stays on disk and resumes next time.
    if (err instanceof DOMException && err.name === "AbortError") {
      loading = false;
      return false;
    }
    console.warn("[LiteRT] load failed, falling back", err);
    await unloadLiteRT();
    loading = false;
    return false;
  }
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

function describeDownload(label: string, p: DownloadProgress): string {
  if (!p.totalBytes) {
    return `${label}: ${formatMB(p.receivedBytes)} MB downloaded…`;
  }
  const pct = Math.round((p.fraction ?? 0) * 100);
  const resumedNote = p.resumed ? " (resumed)" : "";
  return `${label}: ${formatMB(p.receivedBytes)} / ${formatMB(p.totalBytes)} MB — ${pct}%${resumedNote}`;
}

export async function unloadLiteRT(): Promise<void> {
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
    return await engine.createConversation({
      preface: { messages: [{ role: "system", content: systemPrompt }] },
    });
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
  let full = "";
  const stream = conversation.sendMessageStreaming(message);
  for await (const chunk of stream) {
    if (signal?.aborted) {
      conversation.cancel();
      break;
    }
    full += extractText(chunk.content);
    onChunk(full);
  }
  return full;
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
