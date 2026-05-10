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

const DESKTOP_MODEL: ModelProfile = {
  id: "Phi-3.5-mini-instruct-q4f32_1-MLC",
  label: "Phi-3.5 Mini",
  sizeMB: 4000,
  minDeviceMemoryGB: 6,
  maxTokens: 512,
  stream: true,
};

const ANDROID_HIGH_MODELS: ModelProfile[] = [
  {
    id: "RedPajama-INCITE-Chat-3B-v1-q4f32_1-MLC-1k",
    label: "RedPajama 3B 1k",
    sizeMB: 2600,
    minDeviceMemoryGB: 6,
    chatOpts: { context_window_size: 1024, max_history_size: 1 },
    maxTokens: 220,
    stream: false,
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
    label: "Qwen2.5 1.5B",
    sizeMB: 1900,
    minDeviceMemoryGB: 6,
    chatOpts: { context_window_size: 1024, max_history_size: 1 },
    maxTokens: 240,
    stream: false,
  },
  {
    id: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
    label: "Qwen2.5 0.5B",
    sizeMB: 1100,
    minDeviceMemoryGB: 4,
    chatOpts: { context_window_size: 1024, max_history_size: 1 },
    maxTokens: 220,
    stream: false,
  },
  {
    id: "TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC-1k",
    label: "TinyLlama 1.1B",
    sizeMB: 800,
    minDeviceMemoryGB: 3,
    chatOpts: { context_window_size: 1024 },
    maxTokens: 180,
    stream: false,
  },
  {
    id: "SmolLM2-360M-Instruct-q4f32_1-MLC",
    label: "SmolLM2 360M",
    sizeMB: 580,
    minDeviceMemoryGB: 3,
    chatOpts: { context_window_size: 1024, max_history_size: 1 },
    maxTokens: 160,
    stream: false,
  },
];

const ANDROID_STANDARD_MODELS = ANDROID_HIGH_MODELS.slice(1);

const OTHER_MOBILE_MODELS: ModelProfile[] = [
  {
    id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 1B",
    sizeMB: 1100,
    minDeviceMemoryGB: 4,
    chatOpts: { context_window_size: 2048, max_history_size: 1 },
    maxTokens: 260,
    stream: false,
  },
  ...ANDROID_STANDARD_MODELS,
];

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

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
}

function getDeviceMemoryGB(): number | null {
  return (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null;
}

function getModelCandidates(): ModelProfile[] {
  if (!isMobile()) return [DESKTOP_MODEL];
  const memoryGB = getDeviceMemoryGB();
  if (isAndroid()) return memoryGB !== null && memoryGB >= 6 ? ANDROID_HIGH_MODELS : ANDROID_STANDARD_MODELS;
  return OTHER_MOBILE_MODELS;
}

function getInitialModel(): ModelProfile {
  return getModelCandidates()[0];
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

    const initialModel = getInitialModel();
    const deviceMemGB = getDeviceMemoryGB();
    if (deviceMemGB !== null && deviceMemGB < initialModel.minDeviceMemoryGB) {
      capabilityResult = {
        ok: false,
        reason: `This device reports ${deviceMemGB} GB RAM. ${initialModel.label} needs at least ${initialModel.minDeviceMemoryGB} GB.`,
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

const SYSTEM_PROMPT = `You are a friendly expert astronomer and stargazing guide embedded in a mobile astronomy app called Heavenward. You help users explore the night sky from their location.

Rules:
- Be concise but rich in detail. 2-3 short paragraphs max.
- Use conversational, enthusiastic tone, like a knowledgeable friend pointing things out.
- Include practical observing directions (compass, altitude, nearby bright stars as waypoints).
- Mention photography opportunities with specific tips (exposure time, filters, focal length).
- Reference nearby objects by name and note whether they are naked-eye, binocular, or telescope targets.
- If an object is historically or scientifically notable, include one fascinating fact.
- When mentioning a person (discoverer, astronomer, scientist), link their name to Wikipedia using HTML: <a href="https://en.wikipedia.org/wiki/Person_Name" target="_blank" rel="noopener">Person Name</a>. Replace spaces with underscores in URLs.
- When mentioning a notable astronomical object, catalog, or phenomenon for the first time, link it to Wikipedia the same way.
- Do NOT use markdown headers or bullet lists. Use flowing prose with HTML links where appropriate.`;

const SYSTEM_PROMPT_COMPACT = `You are a friendly stargazing guide in Heavenward. Write 2 short paragraphs about where to look, what nearby objects are interesting, whether binoculars or a telescope help, and one useful photography tip. Use plain text, no markdown.`;

function getSystemPrompt(): string {
  return isMobile() ? SYSTEM_PROMPT_COMPACT : SYSTEM_PROMPT;
}

export function buildPrompt(ctx: SkyContext): string {
  const nearbyLimit = isMobile() ? 4 : 8;
  const photoTips = isMobile()
    ? ctx.photographyTips.slice(0, 2).join(" ")
    : ctx.photographyTips.join(" ");
  const nearby = ctx.nearby
    .slice(0, nearbyLimit)
    .map(
      (n) =>
        `- ${n.name} (${n.type}, mag ${n.magnitude?.toFixed(1) ?? "?"}, ${n.separation.toFixed(1)} deg away, ${n.direction}, alt ${n.altitude.toFixed(0)} deg)`,
    )
    .join("\n");

  return `The user is looking at "${ctx.target.name}" in the constellation ${ctx.target.constellation ?? "unknown"}.

Current position: azimuth ${ctx.target.azimuth.toFixed(0)} deg (${ctx.target.compassShort}), altitude ${ctx.target.altitude.toFixed(0)} deg - ${ctx.target.altDescription}.

Nearby objects within about 20 deg:
${nearby || "(none found)"}

Photography tips available: ${photoTips}

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

export async function generateSkyNarrative(
  ctx: SkyContext,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!engine || !activeModel) throw new Error("LLM not loaded");

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: getSystemPrompt() },
    { role: "user", content: buildPrompt(ctx) },
  ];

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