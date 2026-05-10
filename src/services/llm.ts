/**
 * Client-side LLM service using WebLLM.
 * Lazy-loads the model on first use; provides sky context narratives.
 * Falls back gracefully when WebGPU is unavailable.
 */

import type { SkyContext } from "../engine/nearby.js";

// ── Types ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMEngine {
  chat: {
    completions: {
      create: (opts: {
        messages: ChatMessage[];
        max_tokens?: number;
        temperature?: number;
        stream: true;
      }) => AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>;
    };
  };
  reload: (model: string, chatOpts?: Record<string, unknown>) => Promise<void>;
  setInitProgressCallback: (cb: (p: { text: string; progress: number }) => void) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-unknown — CDN module shape
interface WebLLMModule {
  MLCEngine: new () => LLMEngine;
  CreateMLCEngine: (
    model: string,
    opts: { initProgressCallback: (p: { text: string; progress: number }) => void },
  ) => Promise<LLMEngine>;
}

// ── State ──────────────────────────────────────────────────────────

let engine: LLMEngine | null = null;
let loading = false;
let loadError: string | null = null;

// Same model everywhere — modern phones should handle it
const MODEL_ID = "Phi-3.5-mini-instruct-q4f32_1-MLC";
const MODEL_VRAM_MB = 5500; // approximate VRAM needed

/** Approximate download size for UI display */
export function getModelSizeMB(): number {
  return 4000;
}

// ── Capability check ──────────────────────────────────────────────

export function isWebGPUAvailable(): boolean {
  return "gpu" in navigator;
}

export function getLLMStatus(): "unavailable" | "not-loaded" | "loading" | "ready" | "error" {
  if (!isWebGPUAvailable()) return "unavailable";
  if (loadError) return "error";
  if (loading) return "loading";
  if (engine) return "ready";
  return "not-loaded";
}

export function getLLMError(): string | null {
  return loadError;
}

// ── Load model ────────────────────────────────────────────────────

export async function loadLLM(
  onProgress?: (text: string, pct: number) => void,
): Promise<boolean> {
  if (engine) return true;
  if (!isWebGPUAvailable()) {
    loadError = "WebGPU not supported in this browser";
    return false;
  }
  if (loading) return false;

  loading = true;
  loadError = null;

  try {
    // Verify WebGPU adapter is actually obtainable
    const gpu = (navigator as unknown as { gpu: { requestAdapter: (opts?: Record<string, unknown>) => Promise<GPUAdapter | null> } }).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No WebGPU adapter available — GPU may not be supported");
    }

    // Check device memory as a rough capability gate
    const deviceMemGB = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (deviceMemGB !== undefined && deviceMemGB < 4) {
      throw new Error(
        `This device reports ${deviceMemGB} GB RAM — the AI model needs at least 6 GB. Your device may not be able to run it.`,
      );
    }

    // Check max buffer size — must support large GPU buffers for KV cache
    const maxBuffer = adapter.limits?.maxStorageBufferBindingSize ?? 0;
    const minRequired = 256 * 1024 * 1024; // 256 MB minimum buffer
    if (maxBuffer > 0 && maxBuffer < minRequired) {
      throw new Error(
        "This device's GPU doesn't support large enough buffers for the AI model. A more powerful device is needed.",
      );
    }

    // Dynamic ESM import from CDN — Vite passes through, TS declaration below
    const webllm = await import(
      // @ts-ignore — remote CDN module, typed manually
      /* @vite-ignore */ "https://esm.run/@mlc-ai/web-llm"
    ) as WebLLMModule;

    // Use explicit MLCEngine + reload pattern instead of CreateMLCEngine
    // CreateMLCEngine can silently fail to register the model on some mobile browsers
    const eng = new webllm.MLCEngine();
    eng.setInitProgressCallback((p: { text: string; progress: number }) => {
      onProgress?.(p.text, p.progress);
    });
    await eng.reload(MODEL_ID);
    engine = eng;

    loading = false;
    return true;
  } catch (err: unknown) {
    loading = false;
    const msg = err instanceof Error ? err.message : String(err);
    // Detect OOM / device lost — common on mobile
    if (/lost|destroyed|oom|out of memory|allocation/i.test(msg)) {
      loadError = "Not enough GPU memory — try closing other tabs or apps";
    } else {
      loadError = msg || "Failed to load AI model";
    }
    return false;
  }
}

// ── Generate sky narrative ────────────────────────────────────────

const SYSTEM_PROMPT = `You are a friendly expert astronomer and stargazing guide embedded in a mobile astronomy app called Heavenward. You help users explore the night sky from their location.

Rules:
- Be concise but rich in detail. 2-3 short paragraphs max.
- Use conversational, enthusiastic tone — like a knowledgeable friend pointing things out.
- Include practical observing directions (compass, altitude, nearby bright stars as waypoints).
- Mention photography opportunities with specific tips (exposure time, filters, focal length).
- Reference nearby objects by name and note whether they're naked-eye, binocular, or telescope targets.
- If an object is historically or scientifically notable, include one fascinating fact.
- When mentioning a person (discoverer, astronomer, scientist), link their name to Wikipedia using HTML: <a href="https://en.wikipedia.org/wiki/Person_Name" target="_blank" rel="noopener">Person Name</a>. Replace spaces with underscores in URLs.
- When mentioning a notable astronomical object, catalog, or phenomenon for the first time, link it to Wikipedia the same way.
- Do NOT use markdown headers or bullet lists — use flowing prose with HTML links where appropriate.`;

export function buildPrompt(ctx: SkyContext): string {
  const nearby = ctx.nearby
    .slice(0, 8)
    .map(
      (n) =>
        `- ${n.name} (${n.type}, mag ${n.magnitude?.toFixed(1) ?? "?"}, ${n.separation.toFixed(1)}° away, ${n.direction}, alt ${n.altitude.toFixed(0)}°)`,
    )
    .join("\n");

  return `The user is looking at "${ctx.target.name}" in the constellation ${ctx.target.constellation ?? "unknown"}.

Current position: azimuth ${ctx.target.azimuth.toFixed(0)}° (${ctx.target.compassShort}), altitude ${ctx.target.altitude.toFixed(0)}° — ${ctx.target.altDescription}.

Nearby objects within ~20°:
${nearby || "(none found)"}

Photography tips available: ${ctx.photographyTips.join(" ")}

Generate a rich, concise sky guide for this region of sky. Describe where to look, what's interesting nearby, photography opportunities, and any fascinating facts. Reference the nearby objects naturally.`;
}

export async function generateSkyNarrative(
  ctx: SkyContext,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!engine) throw new Error("LLM not loaded");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildPrompt(ctx) },
  ];

  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let full = "";
      const stream = await engine.chat.completions.create({
        messages,
        max_tokens: 512,
        temperature: 0.7,
        stream: true,
      });

      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(full);
        }
      }
      return full;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        /mapAsync|unmapped|mapping/i.test(msg) ||
        /model not loaded|reload\(model\)/i.test(msg);
      if (isRetryable && attempt < maxRetries) {
        // Model state lost or GPUBuffer race — reload model then retry
        if (/model not loaded|reload\(model\)/i.test(msg) && engine) {
          try { await engine.reload(MODEL_ID); } catch { /* best effort */ }
        }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  // Unreachable but satisfies TS
  throw new Error("Generation failed after retries");
}
