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
  /** ETag (preferred) or Last-Modified captured from the response, sent back
   *  as If-Range on a resume so a file HuggingFace replaced mid-download gets
   *  a fresh 200 instead of a 206 that splices old and new bytes together.
   *  Absent on records written before this field existed, or when the server
   *  sends neither header — treated as "no If-Range sent", identical to the
   *  original resume behaviour, so old partial downloads still resume. */
  validator?: string;
  /** True once the complete blob has been written and verified locally. */
  complete?: boolean;
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

/** True for the DOMException IndexedDB throws when a write exceeds the
 *  origin's storage quota. Modern browsers set .name; a couple of older
 *  engines only set the legacy numeric .code (22 = QUOTA_EXCEEDED_ERR). */
function isQuotaExceededError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22);
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

function parseContentRangeStart(header: string | null): number | null {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-\d+\/(?:\d+|\*)$/i.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  return Number.isSafeInteger(start) ? start : null;
}

function isCompleteMeta(meta: MetaRecord): boolean {
  if (meta.complete === true) return true;
  return (
    meta.totalBytes != null &&
    Number.isFinite(meta.totalBytes) &&
    meta.receivedBytes >= meta.totalBytes
  );
}

/**
 * Reads and validates the persisted chunks. A metadata record is not trusted
 * on its own: a browser may evict an individual chunk, or a previous write
 * may have been interrupted between the chunk and metadata transactions.
 * Returning undefined makes the caller discard the record and start safely.
 */
async function readCachedChunks(
  db: IDBDatabase,
  url: string,
  meta: MetaRecord,
): Promise<Blob[] | undefined> {
  if (
    !Number.isSafeInteger(meta.receivedBytes) ||
    meta.receivedBytes < 0 ||
    !Number.isSafeInteger(meta.chunkCount) ||
    meta.chunkCount < 0
  ) {
    return undefined;
  }

  const parts: Blob[] = [];
  let bytes = 0;
  for (let i = 0; i < meta.chunkCount; i++) {
    const part = await idbGet<Blob>(db, CHUNK_STORE, chunkKey(url, i));
    if (!(part instanceof Blob)) return undefined;
    bytes += part.size;
    if (!Number.isSafeInteger(bytes)) return undefined;
    parts.push(part);
  }

  if (bytes !== meta.receivedBytes) return undefined;
  if (meta.totalBytes != null && bytes > meta.totalBytes) return undefined;
  if (meta.complete === true && meta.totalBytes != null && bytes !== meta.totalBytes) {
    return undefined;
  }
  return parts;
}

async function deleteCachedDownload(
  db: IDBDatabase,
  url: string,
  meta?: MetaRecord,
): Promise<void> {
  const chunkCount = meta?.chunkCount ?? 0;
  for (let i = 0; i < chunkCount; i++) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      tx.objectStore(CHUNK_STORE).delete(chunkKey(url, i));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB delete aborted"));
    });
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB metadata delete failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB metadata delete aborted"));
  });
}

async function readMeta(db: IDBDatabase, url: string): Promise<MetaRecord | undefined> {
  return idbGet<MetaRecord>(db, META_STORE, url);
}

/** Drops every trace of a download when a cached artifact must be reset. */
export async function clearModelDownload(url: string): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const meta = await readMeta(db, url);
    await deleteCachedDownload(db, url, meta);
  } catch {
    // Best effort — a failure to tidy up must never block a fresh download.
  } finally {
    db?.close();
  }
}

/** How much of this model is already on disk, for UI that wants to say
 *  "resume" rather than "download" before the user commits. */
export async function getPartialBytes(url: string): Promise<number> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const meta = await readMeta(db, url);
    return meta && !isCompleteMeta(meta) ? meta.receivedBytes : 0;
  } catch {
    return 0;
  } finally {
    db?.close();
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
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    let meta = await readMeta(db, url);
    let cachedChunks: Blob[] | undefined;

    if (meta) {
      cachedChunks = await readCachedChunks(db, url, meta);
      if (!cachedChunks) {
        await deleteCachedDownload(db, url, meta);
        meta = undefined;
      }
    }

    // A completed artifact is self-contained. Reassemble it directly from
    // IndexedDB and do not issue a validation request: returning to the app
    // must not trigger another multi-gigabyte HTTP transfer.
    if (meta && cachedChunks && isCompleteMeta(meta)) {
      const totalBytes = meta.totalBytes ?? meta.receivedBytes;
      onProgress({
        receivedBytes: meta.receivedBytes,
        totalBytes,
        fraction: totalBytes ? 1 : null,
        resumed: true,
      });
      return new Blob(cachedChunks);
    }

    let startByte = meta?.receivedBytes ?? 0;
    let resumed = startByte > 0;

    // A resume already has most of its budget on disk; only a fresh download
    // risks committing to a multi-gigabyte fetch the origin has no room to
    // land. storage.estimate() is itself an estimate, so this only fires on a
    // clear shortfall — never a close call — and it fires before any bytes
    // move rather than after gigabytes of wasted transfer.
    if (!resumed && expectedBytes) {
      const estimate =
        typeof navigator !== "undefined" ? await navigator.storage?.estimate?.() : undefined;
      if (
        estimate?.quota != null &&
        estimate?.usage != null &&
        estimate.quota - estimate.usage < expectedBytes
      ) {
        throw new DOMException("Not enough storage quota available for this download.", "QuotaExceededError");
      }
    }

    // Retry a stale/incompatible range once from byte zero. This handles
    // HTTP 416, malformed 206 Content-Range responses, and servers that
    // changed the object between an interrupted attempt and its resume.
    let resetAttempted = false;
    let res: Response;
    for (;;) {
      const headers: Record<string, string> = { Range: `bytes=${startByte}-` };
      if (startByte > 0 && meta?.validator) headers["If-Range"] = meta.validator;
      res = await fetch(url, { headers, signal });

      const rangeStart = parseContentRangeStart(res.headers.get("Content-Range"));
      const invalidRange =
        (res.status === 206 && rangeStart !== startByte) ||
        (res.status === 416 && startByte > 0);
      if (invalidRange && !resetAttempted) {
        await deleteCachedDownload(db, url, meta);
        meta = undefined;
        cachedChunks = undefined;
        startByte = 0;
        resumed = false;
        resetAttempted = true;
        continue;
      }
      break;
    }

    if (!res.ok && res.status !== 206) {
      throw new Error(`Model download failed: HTTP ${res.status}`);
    }

    // A server that ignores Range answers 200 with the whole file; discard
    // the partial chunks before appending the response so old and new bytes
    // can never be spliced together.
    const serverHonouredRange = res.status === 206;
    const effectiveStart = serverHonouredRange ? startByte : 0;
    if (!serverHonouredRange && startByte > 0) {
      await deleteCachedDownload(db, url, meta);
      meta = undefined;
      startByte = 0;
      resumed = false;
    }

    let totalBytes =
      parseContentRangeTotal(res.headers.get("Content-Range")) ??
      contentLengthTotal(res.headers.get("Content-Length"), effectiveStart) ??
      meta?.totalBytes ??
      expectedBytes ??
      null;

    // Captured so a later resume can pin its Range request to this exact file
    // version via If-Range above. ETag is preferred; Last-Modified is the
    // fallback for hosts that omit it.
    const validator =
      res.headers.get("ETag") ?? res.headers.get("Last-Modified") ?? meta?.validator ?? undefined;

    let received = effectiveStart;
    let chunkIndex = serverHonouredRange ? (meta?.chunkCount ?? 0) : 0;
    let buffered: BlobPart[] = [];
    let bufferedBytes = 0;

    const writeMeta = async (complete = false): Promise<void> => {
      const record: MetaRecord = {
        url,
        totalBytes,
        receivedBytes: received,
        chunkCount: chunkIndex,
        updatedAt: Date.now(),
        validator,
        complete,
      };
      await idbPut(db!, META_STORE, url, record);
    };

    const flush = async (): Promise<void> => {
      if (!bufferedBytes) return;
      try {
        await idbPut(db!, CHUNK_STORE, chunkKey(url, chunkIndex), new Blob(buffered));
      } catch (err) {
        if (isQuotaExceededError(err)) {
          console.warn(`[model-download] storage quota exceeded after ${received} bytes`);
        }
        throw err;
      }
      chunkIndex += 1;
      buffered = [];
      bufferedBytes = 0;
      await writeMeta();
    };

    const reader = res.body?.getReader();
    if (!reader) throw new Error("Model download failed: response has no body");

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
      // When the server supplied no size, stream completion is the first
      // trustworthy total. Set it before the final chunk metadata write so
      // even a later completion-bit write failure leaves a record that can be
      // recognised as complete on the next visit.
      if (totalBytes == null) totalBytes = received;
      await flush();
    } catch (err) {
      // Preserve any bytes already received in memory before rethrowing. This
      // applies to network failures as well as AbortError: a short final
      // buffer should not be lost merely because the reader failed before the
      // normal flush threshold.
      if (bufferedBytes) await flush();
      throw err;
    }
    if (received !== totalBytes) {
      throw new Error(`Model download incomplete: received ${received} of ${totalBytes} bytes`);
    }
    // If the final bytes exactly filled a flush boundary, flush() already
    // persisted the chunks but not the completion bit. Mark completion in a
    // separate metadata transaction so future visits can reconstruct locally.
    await writeMeta(true);
    onProgress({
      receivedBytes: received,
      totalBytes,
      fraction: totalBytes ? 1 : null,
      resumed,
    });

    // Reassemble. Blob parts are disk-backed in Chrome, so this does not pull
    // the whole model into an ArrayBuffer.
    const parts: Blob[] = [];
    for (let i = 0; i < chunkIndex; i++) {
      const part = await idbGet<Blob>(db, CHUNK_STORE, chunkKey(url, i));
      if (!(part instanceof Blob)) {
        await deleteCachedDownload(db, url, {
          url,
          totalBytes,
          receivedBytes: received,
          chunkCount: chunkIndex,
          updatedAt: Date.now(),
          validator,
        });
        throw new Error("Model download failed: cached chunk missing");
      }
      parts.push(part);
    }
    return new Blob(parts);
  } finally {
    db?.close();
  }
}
