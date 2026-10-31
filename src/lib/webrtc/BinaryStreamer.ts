/**
 * Zero-RAM Disk Streaming & High-Performance Chunked Binary File Transfer.
 *
 * Protocol:
 *   1. Sender transmits a JSON metadata message (string):
 *      { type: 'file-meta', name: string, size: number, totalChunks: number, sha256: string }
 *   2. Sender transmits N binary chunks, each prefixed with an 8-byte header:
 *        bytes 0–3  → chunk index   (uint32 big-endian)
 *        bytes 4–7  → total chunks  (uint32 big-endian)
 *        bytes 8+   → binary payload (<= 32 KB)
 *   3. Receiver streams incoming chunks sequentially into disk storage (Tier A: Direct FileSystemAccess,
 *      Tier B: Origin Private File System OPFS, Tier C: Memory fallback).
 *
 * Backpressure:
 *   - dataChannel.bufferedAmountLowThreshold = 65,536 (64 KB)
 *   - pause chunk reading when bufferedAmount > 262,144 (256 KB)
 */

import { computeSHA256 } from '../crypto';
import {
  createDiskWriter,
  type DiskWriter,
  type CreateWriterOptions,
} from './diskStreamer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Length of the binary header prepended to each chunk (chunk index + total chunks). */
export const HEADER_SIZE = 8;

/**
 * Size of each file chunk payload.
 * 32,760 bytes payload + 8 bytes header = exactly 32,768 bytes (32 KB total per frame).
 * Guaranteed to never exceed SCTP 64KB limits or trigger cross-browser packet drops.
 */
export const CHUNK_SIZE = 32_768 - HEADER_SIZE; // 32,760 bytes

/** High watermark: pause chunk reading when bufferedAmount > 262,144 (256 KB). */
export const BUFFERED_AMOUNT_HIGH = 262_144; // 256 KB

/** Low watermark: resume sending only after bufferedAmount drains to 65,536 (64 KB). */
export const BUFFERED_AMOUNT_LOW = 65_536; // 64 KB

/** Legacy compatibility alias */
export const BUFFERED_AMOUNT_THRESHOLD = BUFFERED_AMOUNT_HIGH;

/** Files larger than this threshold (32 MB) use streaming validation to avoid browser OOM. */
export const STREAM_VERIFY_THRESHOLD = 32 * 1024 * 1024; // 32 MB

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TransferProgress {
  bytesSent: number;
  bytesTotal: number;
  chunksComplete: number;
  chunksTotal: number;
  /** Instantaneous speed in bytes per second. */
  speedBps: number;
  /** Estimated time remaining in seconds. */
  etaSeconds: number;
}

export interface TransferResult {
  success: boolean;
  sha256: string;
  bytesTransferred: number;
}

export interface ReceivedFile {
  blob: Blob | File;
  name: string;
  size: number;
  sha256: string;
  verified: boolean;
  isDirectDiskSave?: boolean;
  isMetadataStripped?: boolean;
  isZeroTrace?: boolean;
  cleanup?: () => Promise<void>;
}

/** Options for sending a file over DataChannel */
export interface SendFileOptions {
  isMetadataStripped?: boolean;
  isZeroTrace?: boolean;
}

/** JSON shape of the metadata message sent before chunks. */
interface FileMetadata {
  type: 'file-meta';
  name: string;
  size: number;
  totalChunks: number;
  sha256: string;
  isMetadataStripped?: boolean;
  isZeroTrace?: boolean;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Sends a file over an RTCDataChannel using chunked binary transfer with strict backpressure.
 *
 * @param channel - An open, reliable RTCDataChannel.
 * @param file    - The File object to transmit.
 * @param onProgress - Optional progress callback.
 * @param options - Optional privacy shield / zero-trace options.
 * @returns A promise that resolves when the entire file has been sent.
 */
export async function sendFile(
  channel: RTCDataChannel,
  file: File,
  onProgress?: (progress: TransferProgress) => void,
  options?: SendFileOptions,
): Promise<TransferResult> {
  // 1. Calculate file integrity hash or token
  // For files <= 32MB: perform cryptographic SHA-256
  // For files > 32MB: use fast stream token to prevent freezing main thread or triggering OOM
  let sha256 = '';
  if (file.size <= STREAM_VERIFY_THRESHOLD) {
    try {
      const wholeBuffer = await file.arrayBuffer();
      sha256 = await computeSHA256(wholeBuffer);
    } catch {
      sha256 = `stream-${file.name}-${file.size}-${file.lastModified}`;
    }
  } else {
    sha256 = `stream-${file.name}-${file.size}-${file.lastModified}`;
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;

  // 2. Send metadata as a JSON string message.
  const meta: FileMetadata = {
    type: 'file-meta',
    name: file.name,
    size: file.size,
    totalChunks,
    sha256,
    isMetadataStripped: options?.isMetadataStripped,
    isZeroTrace: options?.isZeroTrace,
  };
  channel.send(JSON.stringify(meta));

  // 3. Set strict WebRTC backpressure threshold on data channel (64 KB)
  channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

  const startTime = performance.now();
  let bytesSent = 0;
  let lastProgressTime = 0;
  let lastYieldTime = performance.now();

  for (let i = 0; i < totalChunks; i++) {
    // Strict Backpressure: pause if bufferedAmount > 262,144 (256 KB)
    if (channel.bufferedAmount > BUFFERED_AMOUNT_HIGH) {
      await waitForBufferDrain(channel);
    }

    if (channel.readyState !== 'open') {
      throw new Error('DataChannel closed unexpectedly during file transfer');
    }

    const offset = i * CHUNK_SIZE;
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const sliceBlob = file.slice(offset, end);
    const sliceBuffer = await sliceBlob.arrayBuffer();

    // Build chunk: [header (8 bytes)] + [payload]
    const chunk = new ArrayBuffer(HEADER_SIZE + sliceBuffer.byteLength);
    const view = new DataView(chunk);
    view.setUint32(0, i, false);           // chunk index, big-endian
    view.setUint32(4, totalChunks, false);  // total chunks, big-endian

    // Copy slice payload after the 8-byte header
    new Uint8Array(chunk, HEADER_SIZE).set(new Uint8Array(sliceBuffer));

    channel.send(chunk);
    bytesSent += sliceBuffer.byteLength;

    const now = performance.now();

    // Report progress (throttled to at most once per 60ms or on final chunk to eliminate UI jitter)
    if (onProgress && (now - lastProgressTime >= 60 || i === totalChunks - 1)) {
      lastProgressTime = now;
      const elapsed = (now - startTime) / 1000;
      const speedBps = elapsed > 0 ? bytesSent / elapsed : 0;
      const remaining = file.size - bytesSent;
      const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;

      onProgress({
        bytesSent,
        bytesTotal: file.size,
        chunksComplete: i + 1,
        chunksTotal: totalChunks,
        speedBps,
        etaSeconds,
      });
    }

    // Cooperative yielding: yield to browser macrotask loop every 16 chunks or every 20ms
    if (i % 16 === 0 || now - lastYieldTime >= 20) {
      lastYieldTime = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { success: true, sha256, bytesTransferred: bytesSent };
}

/**
 * Waits until the channel's bufferedAmount drops to or below the low watermark (64 KB).
 * Uses both the native 'bufferedamountlow' event and a polling fallback.
 */
function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= BUFFERED_AMOUNT_LOW) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      if (timer) clearInterval(timer);
    };

    const onLow = (): void => {
      cleanup();
      resolve();
    };

    channel.addEventListener('bufferedamountlow', onLow);

    // Polling fallback checks low watermark (64 KB) with backoff
    timer = setInterval(() => {
      if (channel.readyState !== 'open') {
        cleanup();
        reject(new Error('DataChannel closed while waiting for buffer drain'));
      } else if (channel.bufferedAmount <= BUFFERED_AMOUNT_LOW) {
        cleanup();
        resolve();
      }
    }, 15);
  });
}

// ---------------------------------------------------------------------------
// Receiving (Tiered Zero-RAM Disk Streaming)
// ---------------------------------------------------------------------------

/**
 * Listens on an RTCDataChannel for an incoming file transfer and streams chunks
 * directly into disk storage (Tier A: Direct FileSystemAccess, Tier B: OPFS, Tier C: Memory).
 *
 * @param channel    - An open, reliable RTCDataChannel.
 * @param onProgress - Optional progress callback.
 * @param onMeta     - Optional callback invoked as soon as file metadata arrives.
 * @param options    - Optional storage writer preferences (e.g. direct save handle).
 * @returns A promise that resolves with the reassembled and verified file.
 */
export function receiveFile(
  channel: RTCDataChannel,
  onProgress?: (progress: TransferProgress) => void,
  onMeta?: (meta: {
    name: string;
    size: number;
    isMetadataStripped?: boolean;
    isZeroTrace?: boolean;
  }) => void,
  options?: CreateWriterOptions,
): Promise<ReceivedFile> {
  return new Promise<ReceivedFile>((resolve, reject) => {
    let meta: FileMetadata | null = null;
    let writer: DiskWriter | null = null;
    let isFinalized = false;
    let receivedChunksCount = 0;
    let bytesReceived = 0;
    const startTime = performance.now();
    let lastProgressTime = 0;

    // Buffer chunks that arrive while writer is asynchronously initializing
    const pendingChunks: Array<{ chunkIndex: number; payload: Uint8Array }> = [];
    let isInitializingWriter = false;

    const processChunk = async (chunkIndex: number, payload: Uint8Array): Promise<void> => {
      if (!writer || !meta || isFinalized) return;

      await writer.writeChunk(chunkIndex, payload);
      receivedChunksCount++;
      bytesReceived += payload.byteLength;

      // Report progress (throttled to at most once per 60ms or on completion)
      const now = performance.now();
      if (onProgress && (now - lastProgressTime >= 60 || receivedChunksCount === meta.totalChunks)) {
        lastProgressTime = now;
        const elapsed = (now - startTime) / 1000;
        const speedBps = elapsed > 0 ? bytesReceived / elapsed : 0;
        const remaining = meta.size - bytesReceived;
        const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;

        onProgress({
          bytesSent: bytesReceived,
          bytesTotal: meta.size,
          chunksComplete: receivedChunksCount,
          chunksTotal: meta.totalChunks,
          speedBps,
          etaSeconds,
        });
      }

      // All chunks received — finalize tiered disk writer and verify
      if (receivedChunksCount === meta.totalChunks && !isFinalized) {
        isFinalized = true;
        channel.removeEventListener('message', onMessage);

        const result = await writer.finalize();

        if (!result.verified) {
          if (result.cleanup) {
            await result.cleanup().catch(() => {});
          }
          reject(
            new Error(
              `Integrity check failed: size or hash mismatch for ${meta.name} (expected ${meta.size}, got ${result.size})`,
            ),
          );
          return;
        }

        resolve({
          blob: result.file,
          name: result.name,
          size: result.size,
          sha256: result.sha256,
          verified: result.verified,
          isDirectDiskSave: meta.isZeroTrace ? false : result.isDirectDiskSave,
          isMetadataStripped: meta.isMetadataStripped,
          isZeroTrace: meta.isZeroTrace,
          cleanup: result.cleanup,
        });
      }
    };

    const flushPending = async (): Promise<void> => {
      while (pendingChunks.length > 0) {
        const next = pendingChunks.shift();
        if (next) {
          await processChunk(next.chunkIndex, next.payload);
        }
      }
    };

    const onMessage = async (event: MessageEvent): Promise<void> => {
      try {
        // --- Metadata (string message) ---
        if (typeof event.data === 'string') {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            return;
          }

          if (parsed.type === 'file-meta') {
            meta = parsed as unknown as FileMetadata;
            onMeta?.({
              name: meta.name,
              size: meta.size,
              isMetadataStripped: meta.isMetadataStripped,
              isZeroTrace: meta.isZeroTrace,
            });

            isInitializingWriter = true;
            try {
              const writerOptions: CreateWriterOptions = {
                ...options,
                forceMemory: meta.isZeroTrace ? true : options?.forceMemory,
              };
              writer = await createDiskWriter(meta, writerOptions);
            } finally {
              isInitializingWriter = false;
            }

            // Flush any chunks that arrived while writer was initializing
            await flushPending();
          }
          return;
        }

        // --- Binary chunk ---
        let buffer: ArrayBuffer;
        if (event.data instanceof ArrayBuffer) {
          buffer = event.data;
        } else if (event.data instanceof Blob) {
          buffer = await event.data.arrayBuffer();
        } else {
          return;
        }

        if (buffer.byteLength < HEADER_SIZE) return;

        const view = new DataView(buffer);
        const chunkIndex = view.getUint32(0, false);
        const totalChunks = view.getUint32(4, false);

        // Validate header against metadata if already present
        if (meta && totalChunks !== meta.totalChunks) return;
        if (meta && chunkIndex >= meta.totalChunks) return;

        const payload = new Uint8Array(buffer, HEADER_SIZE);

        if (!writer || isInitializingWriter) {
          // If metadata hasn't finished initializing writer, queue chunk safely
          pendingChunks.push({ chunkIndex, payload });
          return;
        }

        await processChunk(chunkIndex, payload);
      } catch (err) {
        channel.removeEventListener('message', onMessage);
        if (writer) {
          await writer.abort().catch(() => {});
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    channel.addEventListener('message', onMessage);
  });
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

/**
 * Triggers a browser file download from a Blob or OPFS File handle.
 *
 * Creates a temporary anchor element with the `download` attribute set so the
 * browser treats it as a file save rather than navigation. The object URL is
 * revoked after the download initiates.
 *
 * @param blob     - The file data.
 * @param filename - Suggested filename for the download.
 */
export function downloadFile(blob: Blob | File, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();

  // Clean up after a short delay to ensure the download starts.
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 250);
}
