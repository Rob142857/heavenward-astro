/**
 * Client-side LLM service using WebLLM.
 * Lazy-loads the model on first use; provides sky context narratives.
 * Falls back gracefully when WebGPU is unavailable or mobile GPU limits are hit.
 */

import type { SkyContext } from "../engine/nearby.js";
import { t } from "../i18n/translations.js";
import {
  createLiteRTConversation,
  getActiveLiteRTModel,
  GEMMA4_E2B,
  isLiteRTLoaded,
  isLiteRTSupported,
  loadLiteRT,
  sendLiteRTMessage,
} from "./litert.js";
import type { LoadProgressFn } from "./litert.js";
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
  /** WebLLM's own vram_required_MB for this build. Checked against what the
   *  adapter actually reports so we never offer a device a model it has no
   *  chance of holding — see fitsDeviceBudget(). */
  vramMB: number;
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

// Every model here is one MLC has actually compiled a WebGPU library for —
// verified directly against mlc-ai/binary-mlc-llm-libs rather than assumed
// from HuggingFace weights existing (Gemma 3 4B/12B weights exist there but
// have no browser-compatible build yet, so they're not usable options today).
//
// Context windows are kept deliberately modest on mobile. The KV cache scales
// with the context window, and a phone's WebGPU runtime reports a hard
// maxStorageBufferBindingSize (1 GB on a Snapdragon/Adreno flagship) that the
// cache has to live inside alongside the weights. A 4096-token window on a 1B
// model was enough to destabilise the buffers on a Galaxy S25 Ultra in
// production ("could not keep the AI model's GPU buffers stable"), so mobile
// runs at 2048 and only desktop takes the full window.
const MOBILE_MODEL: ModelProfile = {
  id: "gemma3-1b-it-q4f16_1-MLC",
  label: "Gemma 3 1B",
  sizeMB: 711,
  vramMB: 711,
  minDeviceMemoryGB: 2,
  // Deliberately no requiredFeatures: despite being a q4f16 build, WebLLM's
  // own config declares no required_features for this model (unlike Gemma 2,
  // which does demand shader-f16). Adding a guess here would hide the best
  // model from phones that can actually run it.
  // WebLLM's own default config for this model sets context_window_size
  // while Gemma 3's native (sliding-window-attention) chat config also
  // carries a positive sliding_window_size — WebLLM refuses to start with
  // both set (WindowSizeConfigurationError). Explicitly disabling the
  // sliding window is the documented way to resolve the conflict.
  chatOpts: { context_window_size: 2048, sliding_window_size: -1 },
  maxTokens: 400,
  stream: true,
};

// Graceful degradation for phones that can't hold the preferred model steady.
// Two hard-won rules are encoded here:
//   1. Every entry must FIT — a Galaxy S25 Ultra reports a 1024 MB buffer, and
//      an earlier version of this chain offered it 1889 MB and 1060 MB models
//      as "fallbacks". They were larger than the model that had just failed
//      and could never have run; the phone burned a ~1.9 GB download to find
//      that out. fitsDeviceBudget() now filters against what the adapter
//      actually reports.
//   2. These are q4f32 builds on purpose: they don't need the shader-f16
//      feature and are numerically better behaved on the Adreno/Mali parts
//      where f16 kernels are the usual suspect in device-lost failures. That
//      makes them a genuinely different thing to try, not just a smaller one.
const MOBILE_FALLBACK_MODELS: ModelProfile[] = [
  {
    id: "TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC",
    label: "TinyLlama 1.1B",
    sizeMB: 840,
    vramMB: 840,
    minDeviceMemoryGB: 3,
    // 2048 is this build's own default. An earlier 1024 here was throttling
    // it below its real capacity and rejected a 1115-token grounded prompt
    // outright (ContextWindowSizeExceededError) — the prompt had outgrown a
    // budget that never needed to be that small.
    chatOpts: { context_window_size: 2048 },
    maxTokens: 280,
    stream: false,
  },
  {
    id: "SmolLM2-360M-Instruct-q4f32_1-MLC",
    label: "SmolLM2 360M",
    sizeMB: 580,
    vramMB: 580,
    minDeviceMemoryGB: 2,
    chatOpts: { context_window_size: 4096 },
    maxTokens: 240,
    stream: false,
  },
];

// Biggest Gemma with a confirmed-working WebGPU build today. Requires the
// shader-f16 adapter feature — checkGPUCapability() detects support and
// getModelCandidates() drops this tier entirely on adapters without it, so
// desktop always falls through to the smaller models rather than hard-failing.
const DESKTOP_MODEL: ModelProfile = {
  id: "gemma-2-9b-it-q4f16_1-MLC",
  label: "Gemma 2 9B",
  sizeMB: 6400,
  vramMB: 6422,
  minDeviceMemoryGB: 6,
  requiredFeatures: ["shader-f16"],
  chatOpts: { context_window_size: 4096 },
  maxTokens: 768,
  stream: true,
};

let shaderF16Supported = false;
/** What the adapter reported, in MB. Null until checkGPUCapability() runs. */
let gpuBufferBudgetMB: number | null = null;

let engine: LLMEngine | null = null;
let llmWorker: Worker | null = null;
let webllmModule: WebLLMModule | null = null;
let loading = false;
let loadError: string | null = null;
/** The load in flight, if any — late callers join it instead of being
 *  refused. See the matching comment in litert.ts: the old boolean bounce
 *  made "navigate away during load, come back, tap Load" show a permanent
 *  failure while the real load ran on invisibly. */
let loadInFlight: Promise<boolean> | null = null;
const loadListeners = new Set<LoadProgressFn>();

function broadcastLoad(
  text: string,
  pct: number,
  stage?: Parameters<LoadProgressFn>[2],
): void {
  for (const listener of loadListeners) listener(text, pct, stage);
}
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
 * Can this device plausibly hold the model? Compares against the adapter's
 * reported maxStorageBufferBindingSize. That limit is per-binding rather than
 * a total-VRAM cap, so it's a heuristic — but on the constrained mobile parts
 * that actually fail, the two track each other closely enough, and a model
 * needing ~2x the reported budget is never worth a multi-hundred-MB download
 * to discover. Desktop keeps a laxer multiplier because a discrete GPU with a
 * 2 GB binding limit genuinely does run much larger models by splitting them.
 */
function fitsDeviceBudget(model: ModelProfile): boolean {
  if (gpuBufferBudgetMB === null) return true; // not probed yet — don't pre-filter
  const multiplier = isMobile() ? 1 : 4;
  return model.vramMB <= gpuBufferBudgetMB * multiplier;
}

/** Does the adapter expose every feature this model's compiled library needs? */
function hasRequiredFeatures(model: ModelProfile): boolean {
  if (!model.requiredFeatures?.length) return true;
  return model.requiredFeatures.every((f) =>
    f === "shader-f16" ? shaderF16Supported : true,
  );
}

/**
 * Ordered load attempts for this device, best-quality first. loadLLM() and
 * fallBackToSmallerModel() walk this array in order, so a device that can't
 * hold one model steady degrades to the next instead of dead-ending.
 * Anything the device can't run — wrong features, or too big for its reported
 * buffer budget — is dropped BEFORE it costs the user a wasted download.
 */
function getModelCandidates(): ModelProfile[] {
  const all = isMobile()
    ? [MOBILE_MODEL, ...MOBILE_FALLBACK_MODELS]
    : [DESKTOP_MODEL, MOBILE_MODEL, ...MOBILE_FALLBACK_MODELS];

  const viable = all.filter(
    (m) => hasRequiredFeatures(m) && fitsDeviceBudget(m),
  );

  // Never return nothing: if the probe rules everything out, keep the
  // smallest candidate so the user gets a real attempt and a real error
  // rather than a silently missing feature.
  if (viable.length === 0) {
    return [
      all.reduce((min, m) => (m.vramMB < min.vramMB ? m : min), all[0]),
    ];
  }
  return viable;
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

// These drive the activation button's copy, so they must describe whichever
// engine will actually run — including before load, when the user's quality
// preference is all we have to go on.
function pendingLiteRTModel(): typeof GEMMA4_E2B | null {
  const active = getActiveLiteRTModel();
  if (active) return active;
  if (getAIQuality() === "best" && isLiteRTSupported()) return GEMMA4_E2B;
  return null;
}

export function getModelSizeMB(): number {
  return pendingLiteRTModel()?.sizeMB ?? (activeModel ?? getInitialModel()).sizeMB;
}

export function getModelLabel(): string {
  return pendingLiteRTModel()?.label ?? (activeModel ?? getInitialModel()).label;
}

export function getLLMDiagnostics(): LLMDiagnostics {
  return {
    ...lastDiagnostics,
    activeModelId:
      getActiveLiteRTModel()?.id ??
      activeModel?.id ??
      lastDiagnostics.activeModelId,
  };
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

    // These two probes must land before any getModelCandidates() call below —
    // the candidate list is filtered on both, so reading them late would let
    // a model the device can't run reach the top of the chain.
    shaderF16Supported = adapter.features?.has("shader-f16") ?? false;
    const maxBuffer = adapter.limits?.maxStorageBufferBindingSize ?? 0;
    gpuBufferBudgetMB = maxBuffer > 0 ? maxBuffer / (1024 * 1024) : null;

    const deviceMemGB = getDeviceMemoryGB();
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

    // Gate on the most forgiving candidate that survived filtering, not the
    // most demanding — the chain falls back to it anyway, so judging by the
    // big model would hide the feature from devices that could run a small one.
    const fallbackModel = getFallbackModel();
    if (deviceMemGB !== null && deviceMemGB < fallbackModel.minDeviceMemoryGB) {
      capabilityResult = {
        ok: false,
        reason: `This device reports ${deviceMemGB} GB RAM. ${fallbackModel.label} needs at least ${fallbackModel.minDeviceMemoryGB} GB.`,
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
  if (isLiteRTLoaded()) return "ready";
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

const AI_QUALITY_KEY = "heavenward-ai-quality";

/** "best" is Gemma 4 via LiteRT (~2 GB); "standard" is Gemma 3 1B (711 MB). */
export type AIQuality = "standard" | "best";

interface NetworkInformation {
  type?: string;
  saveData?: boolean;
}

/**
 * Would a 2 GB download plausibly cost this user money? Deliberately
 * pessimistic: guessing "wifi" wrongly spends someone's data allowance, while
 * guessing "cellular" wrongly only means a smaller model they can override in
 * Settings. Those costs are not symmetric, so anything we can't confirm is
 * treated as metered. iOS exposes no Network Information API at all, so it
 * lands here and defaults to Standard.
 */
function isMeteredConnection(): boolean {
  const conn = (navigator as unknown as { connection?: NetworkInformation })
    .connection;
  if (!conn) return true;
  if (conn.saveData) return true;
  if (typeof conn.type === "string") return conn.type === "cellular";
  return true;
}

/** The quality to use when the user hasn't chosen one. */
function defaultAIQuality(): AIQuality {
  if (!isLiteRTSupported()) return "standard";
  if (!isMobile()) return "best"; // desktop: bandwidth is rarely metered
  return isMeteredConnection() ? "standard" : "best";
}

/**
 * An explicit choice always wins and is the only thing persisted. The
 * connection-derived default is recomputed every call rather than written to
 * storage, so a phone that was on cellular once isn't pinned to Standard
 * forever — the same mistake that pinned a device's language.
 */
export function getAIQuality(): AIQuality {
  const stored = localStorage.getItem(AI_QUALITY_KEY);
  if (stored === "best" || stored === "standard") return stored;
  return defaultAIQuality();
}

/** True when the current quality came from the connection heuristic rather
 *  than from the user, so the UI can say so instead of implying they chose. */
export function isAIQualityAutomatic(): boolean {
  const stored = localStorage.getItem(AI_QUALITY_KEY);
  return stored !== "best" && stored !== "standard";
}

export function setAIQuality(quality: AIQuality): void {
  localStorage.setItem(AI_QUALITY_KEY, quality);
}

export function isGemma4Available(): boolean {
  return isLiteRTSupported();
}

export async function loadLLM(
  onProgress?: LoadProgressFn,
  signal?: AbortSignal,
): Promise<boolean> {
  if (isLiteRTLoaded()) return true;
  if (engine && activeModel) return true;
  if (!isWebGPUAvailable()) {
    loadError = "WebGPU not supported in this browser";
    return false;
  }

  if (onProgress) loadListeners.add(onProgress);
  // Join a load already running — the second caller sees the same progress
  // stream and the same outcome. Their signal is ignored on purpose: the load
  // belongs to whoever started it.
  if (loadInFlight) return loadInFlight;

  loadInFlight = runLoadChain(signal);
  try {
    return await loadInFlight;
  } finally {
    loadInFlight = null;
    loadListeners.clear();
  }
}

async function runLoadChain(signal?: AbortSignal): Promise<boolean> {
  loading = true;

  // Gemma 4 first when the user has asked for it. A failure here is not fatal
  // — it falls through to the WebLLM chain below, which is the whole reason
  // that chain is kept while LiteRT is still an early preview.
  if (getAIQuality() === "best" && isLiteRTSupported()) {
    loadError = null;
    const ok = await loadLiteRT(GEMMA4_E2B, broadcastLoad, signal);
    if (ok) {
      loading = false;
      return true;
    }
    // An abort means the user asked for the smaller model mid-download; their
    // partial Gemma 4 download is kept, so falling through to the small model
    // costs them nothing later.
    broadcastLoad(t("llm.didNotFitTryingSmaller", { label: GEMMA4_E2B.label }), 0);
  }

  loadError = null;
  activeModelIndex = 0;

  try {
    const candidates = getModelCandidates();
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      try {
        activeModelIndex = index;
        await loadModel(candidate, broadcastLoad);
        loading = false;
        return true;
      } catch (err: unknown) {
        await unloadEngine();
        const msg = err instanceof Error ? err.message : String(err);
        lastDiagnostics = { ...lastDiagnostics, activeModelId: candidate.id, lastError: msg };
        if (index === candidates.length - 1) throw err;
        broadcastLoad(t("llm.didNotFitTryingSmaller", { label: candidate.label }), 0);
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

For the first message in a conversation (the initial sky guide), write 3 short paragraphs in a conversational, knowledgeable-friend tone:
- Open wide, then narrow: start from the night itself — the date, season and moon stated in the message, and what kind of observing night that makes from the user's hemisphere — then bring the view down to the target: where to look (compass, altitude, nearby bright stars as waypoints) and what makes it worth looking at.
- Weave in the human layer wherever the sourced sections provide it: who watched this region of sky, in which era, and what they used it for — name the culture and period. When several cultures are given, lead with the one closest to the user's part of the world, and let the timespan show (a text from 1000 BCE and a practice alive today are both wonders).
- Close with the practical: nearby objects by name (naked-eye, binocular, or telescope), one concrete photography tip (exposure, filter, focal length), and a final short sentence inviting the user to pull on any thread — the myth, the history, the physics, or the photograph.

For follow-up questions later in the conversation:
- Just answer what was asked, conversationally and concisely — you don't need to repeat the full sky-guide format above.
- Follow-ups are where depth lives: when the user asks about a story, culture, or historical practice from the sourced sections, unpack it properly — the era, the source text, what it tells us about the people who looked up. Stay within the sourced material for claims, but explain and connect it fully.

Rules that apply to every message:
- When mentioning a person (discoverer, astronomer, scientist), link their name to Wikipedia using HTML: <a href="https://en.wikipedia.org/wiki/Person_Name" target="_blank" rel="noopener">Person Name</a>. Replace spaces with underscores in URLs.
- When mentioning a notable astronomical object, catalog, or phenomenon for the first time, link it to Wikipedia the same way.
- Do NOT use markdown headers or bullet lists. Use flowing prose with HTML links where appropriate.
- The user prompt may include a "Known facts about this object" and/or a "Sourced mythology, history and namesakes" section, each citing an exact source. Only use historical, mythological or naming claims that appear there, and only when that section is actually present — if it says no sourced material is available, do not mention any myth, legend, historical claim, or namesake, even if you think you know one. When you do share sourced material, keep it brief (a sentence or two) and natural, and you may mention which book/source it comes from if it fits the flow.
- Namesake entries are ships, rockets, telescopes and the like that took the object's name. They are a delight to mention — an aside like "there is a neutrino telescope on the Mediterranean seabed named after this star" earns its place. Use them only as given: never guess that something is named after a star because the names happen to match.
- You may note that a constellation is one of the twelve zodiac constellations, and when the sourced sections cover it, tell the mythology behind its figure or the documented history of the zodiac as an ancient calendar system. What is banned is astrology-as-belief: no horoscopes, no predictions, no personality or character claims from star signs, no "what this means for you." The line is simple — the stories and the history are welcome; the fortune-telling is not.
- If no "Known facts" or sourced mythology/history is given for something, rely only on well-established, uncontroversial astronomy — don't invent discoverers, dates, or stories.
- The user's latitude and hemisphere are stated at the top of their message. Every claim about what is or isn't visible must follow from THAT latitude. Most astronomy writing assumes a northern viewpoint; do not carry that assumption over. A southern observer genuinely cannot see Polaris and genuinely can see Crux year-round, and telling them otherwise about their own sky is the worst mistake you can make here. If you are not certain whether something is visible from their latitude, say so rather than guessing.`;

// The full prompt costs ~694 tokens — a third of a 2048-token window. On the
// small fallback models that is budget stolen directly from the grounding
// facts, which is backwards: the instructions are what we can afford to
// shorten, the sourced facts are the whole reason the output is trustworthy.
// Every non-negotiable guardrail (don't invent, no astrology, stay grounded)
// survives here; only the stylistic guidance is cut.
const SYSTEM_PROMPT_COMPACT = `You are a friendly expert astronomer guiding someone looking at tonight's sky. Write 2 short paragraphs of flowing prose — where to look, what is worth seeing nearby, and one photography tip. No markdown, no bullet lists, no headings.

Ground everything in the facts given in the user message. If a "Sourced mythology, history and namesakes" section is present you may share it briefly and name its source; if the message says no sourced material is available, do not mention any myth, legend, historical claim, or namesake at all. Never invent discoverers, dates, or stories. Zodiac-constellation mythology from the sourced section is fine; astrology is not — no horoscopes, predictions, or personality readings.

The user's latitude and hemisphere are stated at the top of their message. Judge what is visible from THAT latitude, never from a default northern viewpoint — a southern observer cannot see Polaris and can see Crux all year.`;

/** Small-context models get the compact instructions so the grounding facts
 *  keep their share of the window. 4096 is the threshold because that is what
 *  the roomy models (Gemma 3 1B, Gemma 2 9B) actually run at. */
function getSystemPrompt(): string {
  const contextWindow = activeModel?.chatOpts?.context_window_size;
  if (contextWindow && contextWindow < 4096) return SYSTEM_PROMPT_COMPACT;
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
function buildMythHistorySection(ctx: SkyContext, namesakeLimit: number): string {
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
  // Unlike myth/history (one entry each at most), a bright star can carry four
  // namesakes at ~100 tokens apiece — enough to crowd out the target's own
  // facts on a 2048-token model. Cap the count rather than let the section
  // grow unbounded; the model only needs one good aside, not a catalogue.
  for (const n of ctx.target.namesakes.slice(0, namesakeLimit)) {
    const hedge = n.confidence === "widely-reported" ? ", widely reported" : "";
    parts.push(`Named after this star — ${n.thing} (source: ${n.source}${hedge}): ${n.summary}`);
  }
  return parts.join("\n");
}

/** Rough token estimate. English prose runs ~4 chars/token; 3.5 is
 *  deliberately pessimistic so the guard errs toward trimming. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * How many tokens the user turn may occupy on the active model, leaving room
 * for the system prompt, the reply, and a little slack. Returns null when no
 * model is loaded yet (nothing to budget against).
 */
function promptTokenBudget(): number | null {
  if (!activeModel) return null;
  const contextWindow = activeModel.chatOpts?.context_window_size;
  if (!contextWindow || contextWindow <= 0) return null;
  const reserved =
    estimateTokens(getSystemPrompt()) + activeModel.maxTokens + 128;
  return Math.max(256, contextWindow - reserved);
}

export function buildPrompt(ctx: SkyContext): string {
  const budget = promptTokenBudget();

  // Nearby objects are the cheapest thing to give up — they're supporting
  // colour, whereas the target's own facts and sourced mythology are the
  // whole point of grounding. On a tight budget, trim this list first.
  let nearbyLimit = isMobile() ? 5 : 10;
  if (budget !== null && budget < 700) nearbyLimit = 3;

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
  const mythHistory = buildMythHistorySection(
    ctx,
    budget !== null && budget < 700 ? 1 : 2,
  );

  const prompt = assemblePrompt(
    ctx,
    nearby,
    sameConstellation,
    targetFacts,
    mythHistory,
  );
  if (budget === null || estimateTokens(prompt) <= budget) return prompt;

  // Still over after the cheap trim. Drop supporting sections in increasing
  // order of value — nearby list, then constellation neighbours, then photo
  // tips — but never the target's facts or the sourced mythology, which are
  // the reason the model can say anything true at all. A model too small to
  // hold even that is better off with a short prompt than a rejected one.
  const trimmedNearby = ctx.nearby
    .slice(0, 2)
    .map((n) => `- ${n.name} (${n.type}, ${n.separation.toFixed(1)} deg ${n.direction})`)
    .join("\n");
  return assemblePrompt(ctx, trimmedNearby, "", targetFacts, mythHistory, true);
}

function assemblePrompt(
  ctx: SkyContext,
  nearby: string,
  sameConstellation: string,
  targetFacts: string,
  mythHistory: string,
  omitPhotoTips = false,
): string {
  const photoTips =
    omitPhotoTips || !ctx.photographyTips.length
      ? ""
      : `Photography tips available: ${ctx.photographyTips.join(" ")}\n`;

  const obs = ctx.observer;
  const observerLine = `The user is at latitude ${obs.latitude.toFixed(1)}°, in the ${obs.hemisphere} hemisphere. From here, anything with declination beyond ${obs.circumpolarBelowDec.toFixed(0)}° never sets, and anything beyond ${obs.neverRisesAboveDec.toFixed(0)}° never rises. Reason about what they can see from THIS latitude, not from a default northern viewpoint.`;

  const night = ctx.night;
  const moonPct = Math.round(night.moonIllumination * 100);
  const nightLine = `Tonight is ${night.date} — ${night.season} in the user's hemisphere. The Moon is a ${night.moonPhaseName.toLowerCase()}, ${moonPct}% illuminated${moonPct >= 60 ? " (bright moonlight will wash out faint objects tonight)" : moonPct <= 20 ? " (a dark sky — good conditions for faint objects)" : ""}.`;

  return `${observerLine}

${nightLine}

The user is looking at "${ctx.target.name}" in the constellation ${ctx.target.constellation ?? "unknown"}.

Current position: azimuth ${ctx.target.azimuth.toFixed(0)} deg (${ctx.target.compassShort}), altitude ${ctx.target.altitude.toFixed(0)} deg - ${ctx.target.altDescription}.
${ctx.lookingDescription ? `\n${ctx.lookingDescription}\n` : ""}
${targetFacts ? `Known facts about this object (ground your description in these, do not invent additional specifics):\n${targetFacts}\n` : ""}
${mythHistory ? `Sourced mythology, history and namesakes — you may share this, with attribution, but do not add mythological, historical or naming claims beyond what's given here:\n${mythHistory}\n` : "No sourced mythology, historical-astronomy or namesake material is available here — do not invent any myth, legend, historical claim, or story about something being named after this object.\n"}
Nearby objects within about 20 deg:
${nearby || "(none found)"}
${sameConstellation ? `\nAlso sharing this constellation: ${sameConstellation}.\n` : ""}
${photoTips}
Generate a rich, concise sky guide for this region of sky: open from tonight's conditions and season, come down to where to look, weave in the sourced human history of this part of the sky, and finish with what else is nearby, a photography opportunity, and an invitation to go deeper. Reference the nearby objects naturally.`;
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
  onChunk(
    t("llm.tryingSmallerModel", {
      previous: activeModel?.label ?? "",
      next: nextModel.label,
    }),
  );
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

  // One attempt per candidate, plus one: a failure consumes an attempt AND
  // steps down a model, so a shorter loop would strand the smallest models
  // in the chain permanently unreachable.
  const maxAttempts = getModelCandidates().length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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

/**
 * A running sky-guide conversation, independent of which backend produced it.
 * The two engines keep history very differently — WebLLM needs the full
 * message array resent every turn, LiteRT holds it inside its own Conversation
 * object — so the UI is given this handle rather than either representation.
 */
export interface SkyConversation {
  /** The opening narrative, already streamed to onChunk during start. */
  readonly opening: string;
  /** Asks a follow-up, streaming the answer. Resolves to the full text. */
  ask(
    question: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

function createWebLLMConversation(
  initial: ChatCompletionMessageParam[],
  opening: string,
): SkyConversation {
  let history: ChatCompletionMessageParam[] = [
    ...initial,
    { role: "assistant", content: opening },
  ];
  return {
    opening,
    async ask(question, onChunk, signal) {
      const messages = trimHistory([
        ...history,
        { role: "user", content: question },
      ]);
      const text = await completeWithRetry(messages, onChunk, signal);
      history = [...messages, { role: "assistant", content: text }];
      return text;
    },
  };
}

/**
 * Opens a sky-guide conversation, streaming the opening narrative as it
 * generates. Uses whichever backend is loaded: Gemma 4 via LiteRT when the
 * user has opted into it, otherwise the WebLLM chain.
 */
export async function startSkyConversation(
  ctx: SkyContext,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<SkyConversation> {
  const prompt = buildPrompt(ctx);

  if (isLiteRTLoaded()) {
    const conversation = await createLiteRTConversation(getSystemPrompt());
    if (conversation) {
      const opening = await sendLiteRTMessage(
        conversation,
        prompt,
        onChunk,
        signal,
      );
      return {
        opening,
        ask: (question, chunkCb, sig) =>
          sendLiteRTMessage(conversation, question, chunkCb, sig),
      };
    }
    // Conversation creation failed on a loaded engine — fall through to
    // WebLLM rather than leaving the user with nothing.
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: getSystemPrompt() },
    { role: "user", content: prompt },
  ];
  const opening = await completeWithRetry(messages, onChunk, signal);
  return createWebLLMConversation(messages, opening);
}