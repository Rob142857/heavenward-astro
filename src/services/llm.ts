/**
 * Client-side LLM service using WebLLM.
 * Lazy-loads the model on first use; provides sky context narratives.
 * Falls back gracefully when WebGPU is unavailable or mobile GPU limits are hit.
 */

import type { SkyContext } from "../engine/nearby.js";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatOptions,
  InitProgressReport,
  MLCEngineConfig,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";

type WebLLMModule = typeof import("@mlc-ai/web-llm");
type LLMEngine = MLCEngineInterface;

interface ModelProfile {
  id: string;
  label: string;
  sizeMB: number;
  minDeviceMemoryGB: number;
  /** WebGPU adapter features this model's compiled library needs (e.g. "shader-f16"). */
  requiredFeatures?: string[];
  chatOpts?: ChatOptions;
  maxTokens: number;
  stream: boolean;
}

interface LLMDiagnostics {
  userAgent: string;
  deviceMemoryGB: number | null;
  maxStorageBufferBindingSize: number | null;
  gpuVendor: string | null;
  activeModelId: string | null;
  lastError: string | null;
}

// One model per tier instead of a five-chain device-detection maze. Both are
// Gemma builds that MLC has actually compiled a WebGPU library for — verified
// directly against mlc-ai/binary-mlc-llm-libs rather than assumed from the
// HuggingFace weights existing (Gemma 3 4B/12B weights exist there but have
// no browser-compatible build yet, so they're not usable options today).
const MOBILE_MODEL: ModelProfile = {
  id: "gemma3-1b-it-q4f16_1-MLC",
  label: "Gemma 3 1B",
  sizeMB: 711,
  minDeviceMemoryGB: 2,
  // WebLLM's own default config for this model sets context_window_size
  // while Gemma 3's native (sliding-window-attention) chat config also
  // carries a positive sliding_window_size — WebLLM refuses to start with
  // both set (WindowSizeConfigurationError). Explicitly disabling the
  // sliding window is the documented way to resolve the conflict.
  chatOpts: { context_window_size: 4096, sliding_window_size: -1 },
  maxTokens: 512,
  stream: true,
};

// Biggest Gemma with a confirmed-working WebGPU build today. Requires the
// shader-f16 adapter feature — checkGPUCapability() detects support and
// getModelCandidates() drops this tier entirely on adapters without it, so
// desktop always falls through to MOBILE_MODEL rather than a hard failure.
const DESKTOP_MODEL: ModelProfile = {
  id: "gemma-2-9b-it-q4f16_1-MLC",
  label: "Gemma 2 9B",
  sizeMB: 6400,
  minDeviceMemoryGB: 6,
  requiredFeatures: ["shader-f16"],
  maxTokens: 768,
  stream: true,
};

let shaderF16Supported = false;

let engine: LLMEngine | null = null;
let llmWorker: Worker | null = null;
let webllmModule: WebLLMModule | null = null;
let loading = false;
let loadError: string | null = null;
let activeModel: ModelProfile | null = null;
let activeModelIndex = 0;
let lastDiagnostics: LLMDiagnostics = {
  userAgent: navigator.userAgent,
  deviceMemoryGB: getDeviceMemoryGB(),
  maxStorageBufferBindingSize: null,
  gpuVendor: null,
  activeModelId: null,
  lastError: null,
};

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
}

function getDeviceMemoryGB(): number | null {
  return (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null;
}

/**
 * Ordered load attempts for this device. Desktop tries the big model first
 * and falls through to the mobile model on a resource error (existing retry
 * logic in loadLLM()/fallBackToSmallerModel() already walks this array in
 * order) or when the adapter lacks a feature DESKTOP_MODEL needs.
 */
function getModelCandidates(): ModelProfile[] {
  if (isMobile()) return [MOBILE_MODEL];
  return shaderF16Supported ? [DESKTOP_MODEL, MOBILE_MODEL] : [MOBILE_MODEL];
}

function getInitialModel(): ModelProfile {
  return getModelCandidates()[0];
}

/** The most lenient candidate for this device — what button visibility should
 *  gate on, since the chain already falls back to this if the bigger model
 *  fails. Gating on the biggest candidate's requirements would hide the
 *  entire feature for a weaker desktop GPU that could still run the small model. */
function getFallbackModel(): ModelProfile {
  const candidates = getModelCandidates();
  return candidates[candidates.length - 1];
}

export function getModelSizeMB(): number {
  return (activeModel ?? getInitialModel()).sizeMB;
}

export function getModelLabel(): string {
  return (activeModel ?? getInitialModel()).label;
}

export function getLLMDiagnostics(): LLMDiagnostics {
  return { ...lastDiagnostics, activeModelId: activeModel?.id ?? lastDiagnostics.activeModelId };
}

export function isWebGPUAvailable(): boolean {
  return "gpu" in navigator;
}

let capabilityResult: { ok: boolean; reason?: string } | null = null;

export async function checkGPUCapability(): Promise<{ ok: boolean; reason?: string }> {
  if (capabilityResult) return capabilityResult;

  if (!isWebGPUAvailable()) {
    capabilityResult = { ok: false, reason: "WebGPU is not supported in this browser." };
    return capabilityResult;
  }

  try {
    const gpu = (navigator as unknown as { gpu: { requestAdapter: () => Promise<GPUAdapter | null> } }).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      capabilityResult = { ok: false, reason: "No WebGPU adapter found. Your GPU may not be supported." };
      return capabilityResult;
    }

    // Must run before getModelCandidates()/getFallbackModel() below — they
    // read this flag to decide whether DESKTOP_MODEL is even in the running.
    shaderF16Supported = adapter.features?.has("shader-f16") ?? false;

    const fallbackModel = getFallbackModel();
    const deviceMemGB = getDeviceMemoryGB();
    if (deviceMemGB !== null && deviceMemGB < fallbackModel.minDeviceMemoryGB) {
      capabilityResult = {
        ok: false,
        reason: `This device reports ${deviceMemGB} GB RAM. ${fallbackModel.label} needs at least ${fallbackModel.minDeviceMemoryGB} GB.`,
      };
      return capabilityResult;
    }

    const maxBuffer = adapter.limits?.maxStorageBufferBindingSize ?? 0;
    lastDiagnostics = {
      ...lastDiagnostics,
      deviceMemoryGB: deviceMemGB,
      maxStorageBufferBindingSize: maxBuffer || null,
      gpuVendor: getAdapterLabel(adapter),
    };
    const minRequired = isMobile() ? 128 * 1024 * 1024 : 256 * 1024 * 1024;
    if (maxBuffer > 0 && maxBuffer < minRequired) {
      capabilityResult = {
        ok: false,
        reason: "This device's GPU does not support large enough buffers for local AI commentary.",
      };
      return capabilityResult;
    }

    capabilityResult = { ok: true };
  } catch {
    capabilityResult = { ok: false, reason: "Could not check GPU capability." };
  }

  return capabilityResult;
}

function getAdapterLabel(adapter: GPUAdapter): string | null {
  const info = (adapter as unknown as { info?: Record<string, unknown> }).info;
  if (!info) return null;
  const labelParts = [info.vendor, info.architecture, info.device, info.description]
    .filter((part): part is string => typeof part === "string" && part.length > 0);
  return labelParts.length ? labelParts.join(" / ") : null;
}

export function getLLMStatus(): "unavailable" | "not-loaded" | "loading" | "ready" | "error" {
  if (!isWebGPUAvailable()) return "unavailable";
  if (loadError) return "error";
  if (loading) return "loading";
  if (engine && activeModel) return "ready";
  return "not-loaded";
}

export function getLLMError(): string | null {
  return loadError;
}

async function importWebLLM(): Promise<WebLLMModule> {
  if (webllmModule) return webllmModule;
  webllmModule = await import("@mlc-ai/web-llm");
  return webllmModule;
}

async function unloadEngine(): Promise<void> {
  if (engine) {
    try {
      await engine.unload();
    } catch {
      // Best-effort cleanup before trying a smaller model.
    }
  }
  engine = null;
  activeModel = null;
  if (llmWorker) {
    llmWorker.terminate();
    llmWorker = null;
  }
}

function createLLMWorker(): Worker {
  const worker = new Worker(new URL("./webllm-worker.ts", import.meta.url), {
    type: "module",
    name: "heavenward-webllm",
  });
  worker.addEventListener("error", (event) => {
    lastDiagnostics = { ...lastDiagnostics, lastError: event.message || "WebLLM worker error" };
  });
  worker.addEventListener("messageerror", () => {
    lastDiagnostics = { ...lastDiagnostics, lastError: "WebLLM worker message error" };
  });
  return worker;
}

async function createEngine(
  webllm: WebLLMModule,
  model: ModelProfile,
  engineConfig: MLCEngineConfig,
): Promise<LLMEngine> {
  llmWorker = createLLMWorker();
  return webllm.CreateWebWorkerMLCEngine(llmWorker, model.id, engineConfig, model.chatOpts);
}

async function createDirectEngine(
  webllm: WebLLMModule,
  model: ModelProfile,
  engineConfig: MLCEngineConfig,
): Promise<LLMEngine> {
  return webllm.CreateMLCEngine(model.id, engineConfig, model.chatOpts);
}

async function loadModel(
  model: ModelProfile,
  onProgress?: (text: string, pct: number) => void,
): Promise<void> {
  const webllm = await importWebLLM();
  await unloadEngine();

  onProgress?.(`Loading ${model.label}...`, 0);
  const engineConfig: MLCEngineConfig = {
    logLevel: isMobile() ? "DEBUG" : "INFO",
    initProgressCallback: (p: InitProgressReport) => {
      onProgress?.(p.text, p.progress);
    },
  };

  try {
    engine = await createEngine(webllm, model, engineConfig);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lastDiagnostics = { ...lastDiagnostics, activeModelId: model.id, lastError: msg };
    if (!/worker|module|import/i.test(msg)) throw err;
    onProgress?.(`Worker load failed for ${model.label}. Trying direct WebGPU load...`, 0);
    engine = await createDirectEngine(webllm, model, engineConfig);
  }
  activeModel = model;
  lastDiagnostics = { ...lastDiagnostics, activeModelId: model.id, lastError: null };

  if (engine.getMaxStorageBufferBindingSize || engine.getGPUVendor) {
    const [maxBuffer, gpuVendor] = await Promise.all([
      engine.getMaxStorageBufferBindingSize?.().catch(() => null) ?? Promise.resolve(null),
      engine.getGPUVendor?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    lastDiagnostics = {
      ...lastDiagnostics,
      maxStorageBufferBindingSize: maxBuffer,
      gpuVendor: gpuVendor || lastDiagnostics.gpuVendor,
    };
  }
}

export async function loadLLM(
  onProgress?: (text: string, pct: number) => void,
): Promise<boolean> {
  if (engine && activeModel) return true;
  if (!isWebGPUAvailable()) {
    loadError = "WebGPU not supported in this browser";
    return false;
  }
  if (loading) return false;

  loading = true;
  loadError = null;
  activeModelIndex = 0;

  try {
    const candidates = getModelCandidates();
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      try {
        activeModelIndex = index;
        await loadModel(candidate, onProgress);
        loading = false;
        return true;
      } catch (err: unknown) {
        await unloadEngine();
        const msg = err instanceof Error ? err.message : String(err);
        lastDiagnostics = { ...lastDiagnostics, activeModelId: candidate.id, lastError: msg };
        if (index === candidates.length - 1) throw err;
        onProgress?.(`${candidate.label} did not fit this GPU. Trying a smaller model...`, 0);
        if (!isResourceError(msg)) throw err;
      }
    }
  } catch (err: unknown) {
    loading = false;
    const msg = err instanceof Error ? err.message : String(err);
    lastDiagnostics = { ...lastDiagnostics, lastError: msg };
    loadError = friendlyLoadError(msg);
    return false;
  }

  loading = false;
  loadError = "Failed to load AI model";
  return false;
}

// One prompt for both tiers — mobile and desktop now share the same 4096-
// token context window, so there's no budget reason to run a stripped-down
// mobile variant anymore (the old SYSTEM_PROMPT_COMPACT is gone).
const SYSTEM_PROMPT = `You are a friendly expert astronomer and stargazing guide embedded in a mobile astronomy app called Heavenward. You help users explore the night sky from their location, and can continue the conversation if they ask follow-up questions.

For the first message in a conversation (the initial sky guide):
- Be concise but rich in detail. 2-3 short paragraphs max.
- Use a conversational, enthusiastic tone, like a knowledgeable friend pointing things out.
- Include practical observing directions (compass, altitude, nearby bright stars as waypoints).
- Mention photography opportunities with specific tips (exposure time, filters, focal length).
- Reference nearby objects by name and note whether they are naked-eye, binocular, or telescope targets.

For follow-up questions later in the conversation:
- Just answer what was asked, conversationally and concisely — you don't need to repeat the full sky-guide format above.

Rules that apply to every message:
- When mentioning a person (discoverer, astronomer, scientist), link their name to Wikipedia using HTML: <a href="https://en.wikipedia.org/wiki/Person_Name" target="_blank" rel="noopener">Person Name</a>. Replace spaces with underscores in URLs.
- When mentioning a notable astronomical object, catalog, or phenomenon for the first time, link it to Wikipedia the same way.
- Do NOT use markdown headers or bullet lists. Use flowing prose with HTML links where appropriate.
- The user prompt may include a "Known facts about this object" and/or a "Sourced mythology/history" section, each citing an exact source. Only use historical or mythological claims that appear there, and only when that section is actually present — if it says no sourced material is available, do not mention any myth, legend, or historical claim about that constellation, even if you think you know one. When you do share sourced mythology or history, keep it brief (a sentence or two) and natural, and you may mention which book/source it comes from if it fits the flow.
- Never write astrology content: no zodiac signs, horoscopes, "personality traits," or "what this means for you" framing. Constellations are physical patterns of stars and, where sourced, carry historical or mythological stories — nothing more.
- If no "Known facts" or sourced mythology/history is given for something, rely only on well-established, uncontroversial astronomy — don't invent discoverers, dates, or stories.`;

function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

// Both tiers now share a 4096-token context window (the old 1024-token
// mobile ceiling is gone), so the desktop/mobile split here is only about
// how much a 1B vs 9B model can stay coherent over, not a hard budget limit.
function buildTargetFacts(ctx: SkyContext): string {
  const facts: string[] = [];
  if (ctx.target.description) facts.push(ctx.target.description);
  if (ctx.target.morphology) facts.push(`Morphology: ${ctx.target.morphology}.`);
  if (ctx.target.discoverer) {
    const year = ctx.target.yearDiscovered ? ` in ${ctx.target.yearDiscovered}` : "";
    facts.push(`Discovered by ${ctx.target.discoverer}${year}.`);
  }
  if (ctx.target.notableFeatures?.length) {
    facts.push(`Notable: ${ctx.target.notableFeatures.join("; ")}.`);
  }
  if (ctx.target.subObjects?.length) {
    facts.push(`Contains/associated with: ${ctx.target.subObjects.join(", ")}.`);
  }
  if (ctx.target.imagingNotes) facts.push(ctx.target.imagingNotes);
  return facts.join(" ");
}

// Mythology/history are sourced datasets with deliberately partial coverage
// (see src/catalog/mythology.ts, history.ts) — most constellations have
// nothing here. Only ever pass along what's actually in the data; never let
// the model treat "no entry" as license to invent a myth or historical fact.
function buildMythHistorySection(ctx: SkyContext): string {
  const parts: string[] = [];
  const myth = ctx.target.mythology;
  if (myth) {
    parts.push(
      `Mythology (source: ${myth.source}, ${myth.sourceDetail}): ${myth.summary}`,
    );
  }
  for (const h of ctx.target.history) {
    parts.push(`Historical astronomy — ${h.topic} (source: ${h.source}): ${h.summary}`);
  }
  return parts.join("\n");
}

export function buildPrompt(ctx: SkyContext): string {
  const nearbyLimit = isMobile() ? 5 : 10;
  const nearby = ctx.nearby
    .slice(0, nearbyLimit)
    .map((n) => {
      const line = `${n.name} (${n.type}, mag ${n.magnitude?.toFixed(1) ?? "?"}, ${n.separation.toFixed(1)} deg away, ${n.direction}, alt ${n.altitude.toFixed(0)} deg)`;
      return n.brief ? `- ${line} — ${n.brief}` : `- ${line}`;
    })
    .join("\n");

  const sameConstellation = ctx.constellationObjects
    .slice(0, 4)
    .map((c) => c.name)
    .join(", ");

  const targetFacts = buildTargetFacts(ctx);
  const mythHistory = buildMythHistorySection(ctx);

  return `The user is looking at "${ctx.target.name}" in the constellation ${ctx.target.constellation ?? "unknown"}.

Current position: azimuth ${ctx.target.azimuth.toFixed(0)} deg (${ctx.target.compassShort}), altitude ${ctx.target.altitude.toFixed(0)} deg - ${ctx.target.altDescription}.
${ctx.lookingDescription ? `\n${ctx.lookingDescription}\n` : ""}
${targetFacts ? `Known facts about this object (ground your description in these, do not invent additional specifics):\n${targetFacts}\n` : ""}
${mythHistory ? `Sourced mythology/history for this constellation — you may share this, with attribution, but do not add mythology or historical claims beyond what's given here:\n${mythHistory}\n` : "No sourced mythology or historical-astronomy material is available for this constellation — do not invent any myth, legend, or historical claim about it.\n"}
Nearby objects within about 20 deg:
${nearby || "(none found)"}
${sameConstellation ? `\nAlso sharing this constellation: ${sameConstellation}.\n` : ""}
Photography tips available: ${ctx.photographyTips.join(" ")}

Generate a rich, concise sky guide for this region of sky. Describe where to look, what is interesting nearby, photography opportunities, and any fascinating facts. Reference the nearby objects naturally.`;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<ChatCompletionChunk> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function getResponseText(value: ChatCompletion): string {
  const first = value.choices[0];
  return first?.message?.content ?? "";
}

function isResourceError(msg: string): boolean {
  return /mapAsync|unmapped|mapping|lost|destroyed|oom|out of memory|allocation|insufficient memory|device lost/i.test(msg);
}

function isModelStateError(msg: string): boolean {
  return /model not loaded|reload\(model\)|specified model.*not found/i.test(msg);
}

function friendlyLoadError(msg: string): string {
  if (isResourceError(msg)) {
    return "This device could not allocate enough stable GPU memory for local AI commentary. Try closing other apps/tabs, or use a desktop browser.";
  }
  return msg || "Failed to load AI model";
}

async function fallBackToSmallerModel(onChunk: (text: string) => void): Promise<boolean> {
  const candidates = getModelCandidates();
  const nextIndex = activeModelIndex + 1;
  if (nextIndex >= candidates.length) return false;

  const nextModel = candidates[nextIndex];
  activeModelIndex = nextIndex;
  onChunk(`This phone's GPU rejected ${activeModel?.label ?? "the current model"}. Trying ${nextModel.label}...`);
  await loadModel(nextModel);
  return true;
}

async function completeOnce(
  messages: ChatCompletionMessageParam[],
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!engine || !activeModel) throw new Error("LLM not loaded");

  const request = {
    model: activeModel.id,
    messages,
    max_tokens: activeModel.maxTokens,
    temperature: 0.7,
  };
  const result = activeModel.stream
    ? await engine.chat.completions.create({ ...request, stream: true })
    : await engine.chat.completions.create({ ...request, stream: false });

  if (!activeModel.stream) {
    const text = isAsyncIterable(result) ? "" : getResponseText(result);
    if (text && !signal?.aborted) onChunk(text);
    return text;
  }

  if (!isAsyncIterable(result)) {
    const text = getResponseText(result);
    if (text && !signal?.aborted) onChunk(text);
    return text;
  }

  let full = "";
  for await (const chunk of result) {
    if (signal?.aborted) break;
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      full += delta;
      onChunk(full);
    }
  }
  return full;
}

async function completeWithRetry(
  messages: ChatCompletionMessageParam[],
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!engine || !activeModel) throw new Error("LLM not loaded");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await completeOnce(messages, onChunk, signal);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastDiagnostics = { ...lastDiagnostics, lastError: msg };
      if ((isResourceError(msg) || isModelStateError(msg)) && await fallBackToSmallerModel(onChunk)) {
        continue;
      }
      if (isResourceError(msg)) {
        throw new Error("This device's WebGPU runtime could not keep the AI model's GPU buffers stable. Try closing other apps/tabs, or use a desktop browser for AI commentary.");
      }
      throw err;
    }
  }

  throw new Error("Generation failed after trying smaller models.");
}

// Once a real back-and-forth grows past this many exchanges, older follow-up
// turns are dropped to stay inside the model's context window — the system
// prompt and the original grounding-rich turn are always kept, since that's
// where the catalog/mythology/history facts live.
const MAX_RETAINED_EXCHANGES = 4;

function trimHistory(
  messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
  // [system, grounding user turn, first assistant reply, ...follow-up pairs]
  if (messages.length <= 3) return messages;
  const head = messages.slice(0, 3);
  const tail = messages.slice(3);
  const maxTail = MAX_RETAINED_EXCHANGES * 2;
  return tail.length > maxTail ? [...head, ...tail.slice(-maxTail)] : messages;
}

/** Starts a new sky-guide conversation for the given context. Returns the
 *  full message history (system + grounding turn + first reply) so the
 *  caller can persist it and pass it to continueSkyConversation() for
 *  follow-up questions. */
export async function generateSkyNarrative(
  ctx: SkyContext,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatCompletionMessageParam[]> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: getSystemPrompt() },
    { role: "user", content: buildPrompt(ctx) },
  ];
  const text = await completeWithRetry(messages, onChunk, signal);
  return [...messages, { role: "assistant", content: text }];
}

/** Continues an existing conversation (from generateSkyNarrative or a prior
 *  call to this function) with a user follow-up question. Returns the
 *  updated message history for the caller to persist. */
export async function continueSkyConversation(
  history: ChatCompletionMessageParam[],
  question: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatCompletionMessageParam[]> {
  const messages = trimHistory([
    ...history,
    { role: "user", content: question },
  ]);
  const text = await completeWithRetry(messages, onChunk, signal);
  return [...messages, { role: "assistant", content: text }];
}