/**
 * Resumable, progress-reporting download for large model files.
 *
 * Exists because @litert-lm/core offers no progress signal at all — its
 * LoadOptions is an empty interface, so `Engine.create({model: url})` fetches
 * two gigabytes in silence and the UI can only show a frozen bar. Its
 * EngineSettings does however accept a Blob, so we can do the fetching and
 * keep the reporting.
 *
 * The bigger reason is that a download this size must never be wasted. On a
 * phone, two gigabytes can easily span more than one sitting: the user
 * backgrounds the tab, loses signal, or simply gives up and comes back later.
 * Progress is therefore persisted to IndexedDB as it arrives and resumed with
 * an HTTP Range request, so leaving and returning costs only what is left
 * rather than starting again.
 *
 * Chunks are written straight to IndexedDB rather than accumulated in memory:
 * holding 2 GB of ArrayBuffer on a device with an 8 GB budget is how a tab
 * gets killed mid-download.
 */

const DB_NAME = "heavenward-models";
const DB_VERSION = 1;
const CHUNK_STORE = "chunks";
const META_STORE = "meta";

/** Persist about every 4 MB. Frequent enough that little is lost to an
 *  interruption, rare enough not to thrash storage on a slow connection. */
const FLUSH_BYTES = 4 * 1024 * 1024;

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
  /** 0–1, or null when the server gave no Content-Length. */
  fraction: number | null;
  /** True when some of this came from a previous, interrupted attempt. */
  resumed: boolean;
}

interface MetaRecord {
  url: string;
  totalBytes: number | null;
  receivedBytes: number;
  chunkCount: number;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        db.createObjectStore(CHUNK_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function chunkKey(url: string, index: number): string {
  return `${url}::${index}`;
}

/** "bytes 0-1023/2008432640" → 2008432640. The only reliable source of the
 *  true size here, since Content-Length is not CORS-exposed by the host. */
function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const total = Number(header.split("/")[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function contentLengthTotal(
  header: string | null,
  startByte: number,
): number | null {
  const len = Number(header ?? "0");
  return len > 0 ? startByte + len : null;
}

async function readMeta(db: IDBDatabase, url: string): Promise<MetaRecord | undefined> {
  return idbGet<MetaRecord>(db, META_STORE, url);
}

/** Drops every trace of a download — used on completion and on reset. */
export async function clearModelDownload(url: string): Promise<void> {
  try {
    const db = await openDb();
    const meta = await readMeta(db, url);
    if (meta) {
      for (let i = 0; i < meta.chunkCount; i++) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction(CHUNK_STORE, "readwrite");
          tx.objectStore(CHUNK_STORE).delete(chunkKey(url, i));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      }
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Best effort — a failure to tidy up must never block a fresh download.
  }
}

/** How much of this model is already on disk, for UI that wants to say
 *  "resume" rather than "download" before the user commits. */
export async function getPartialBytes(url: string): Promise<number> {
  try {
    const db = await openDb();
    const meta = await readMeta(db, url);
    db.close();
    return meta?.receivedBytes ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetches the model, resuming any earlier partial attempt, reporting progress
 * throughout. Resolves to a Blob suitable for EngineSettings.model.
 *
 * Aborting via `signal` is not a failure: whatever arrived stays on disk and
 * the next call continues from there.
 */
export async function downloadModel(
  url: string,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
  /**
   * Expected size in bytes, used when the server won't tell us. HuggingFace
   * does not expose Content-Length to browser JavaScript — only content-type,
   * etag and a couple of request ids are CORS-readable — so without this the
   * fraction is always null and the progress bar cannot move, which is the
   * original complaint. The declared model size is close enough to give an
   * honest bar.
   */
  expectedBytes?: number,
): Promise<Blob> {
  const db = await openDb();
  let meta = await readMeta(db, url);

  // A stale record whose chunks were evicted would resume from the wrong
  // offset and produce a corrupt file, so treat a missing first chunk as no
  // progress at all.
  if (meta && meta.chunkCount > 0) {
    const first = await idbGet<Blob>(db, CHUNK_STORE, chunkKey(url, 0));
    if (!first) meta = undefined;
  }

  const startByte = meta?.receivedBytes ?? 0;
  const resumed = startByte > 0;

  // Always request a range, even from zero. Content-Length is not exposed to
  // browser JS by HuggingFace, but Content-Range is — and it carries the total
  // after the slash ("bytes 0-/2008432640"), which is the only way to get an
  // exact size and therefore a truthful progress bar.
  const headers: HeadersInit = { Range: `bytes=${startByte}-` };

  const res = await fetch(url, { headers, signal });
  if (!res.ok && res.status !== 206) {
    db.close();
    throw new Error(`Model download failed: HTTP ${res.status}`);
  }

  // A server that ignores Range answers 200 with the whole file; honouring
  // that means discarding what we had rather than corrupting the result.
  const serverHonouredRange = res.status === 206;
  const effectiveStart = serverHonouredRange ? startByte : 0;
  if (!serverHonouredRange && startByte > 0) {
    await clearModelDownload(url);
    meta = undefined;
  }

  const totalBytes =
    parseContentRangeTotal(res.headers.get("Content-Range")) ??
    contentLengthTotal(res.headers.get("Content-Length"), effectiveStart) ??
    meta?.totalBytes ??
    expectedBytes ??
    null;

  let received = effectiveStart;
  let chunkIndex = serverHonouredRange ? (meta?.chunkCount ?? 0) : 0;
  let buffered: BlobPart[] = [];
  let bufferedBytes = 0;

  const flush = async (): Promise<void> => {
    if (!bufferedBytes) return;
    await idbPut(db, CHUNK_STORE, chunkKey(url, chunkIndex), new Blob(buffered));
    chunkIndex += 1;
    buffered = [];
    bufferedBytes = 0;
    const record: MetaRecord = {
      url,
      totalBytes,
      receivedBytes: received,
      chunkCount: chunkIndex,
      updatedAt: Date.now(),
    };
    await idbPut(db, META_STORE, url, record);
  };

  const reader = res.body?.getReader();
  if (!reader) {
    db.close();
    throw new Error("Model download failed: response has no body");
  }

  onProgress({
    receivedBytes: received,
    totalBytes,
    fraction: totalBytes ? received / totalBytes : null,
    resumed,
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bank the chunk BEFORE honouring an abort. Checking first would throw
      // away bytes that had already arrived over the network, which is
      // exactly the waste this whole module exists to prevent.
      buffered.push(value);
      bufferedBytes += value.byteLength;
      received += value.byteLength;
      if (signal?.aborted) {
        await flush(); // keep what arrived so the next attempt resumes
        throw new DOMException("Aborted", "AbortError");
      }
      if (bufferedBytes >= FLUSH_BYTES) await flush();
      onProgress({
        receivedBytes: received,
        totalBytes,
        fraction: totalBytes ? received / totalBytes : null,
        resumed,
      });
    }
    await flush();
  } catch (err) {
    db.close();
    throw err;
  }

  // Reassemble. Blob parts are disk-backed in Chrome, so this does not pull
  // the whole model into memory.
  const parts: Blob[] = [];
  for (let i = 0; i < chunkIndex; i++) {
    const part = await idbGet<Blob>(db, CHUNK_STORE, chunkKey(url, i));
    if (!part) {
      db.close();
      await clearModelDownload(url);
      throw new Error("Model download failed: cached chunk missing");
    }
    parts.push(part);
  }
  db.close();
  return new Blob(parts);
}
