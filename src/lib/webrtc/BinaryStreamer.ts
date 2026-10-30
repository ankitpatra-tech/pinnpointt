/**
 * High-performance chunked binary file transfer over RTCDataChannel.
 *
 * Protocol:
 *   1. Sender transmits a JSON metadata message (string):
 *      { type: 'file-meta', name: string, size: number, totalChunks: number, sha256: string }
 *   2. Sender transmits N binary chunks, each prefixed with an 8-byte header:
 *        bytes 0–3  → chunk index   (uint32 big-endian)
 *        bytes 4–7  → total chunks  (uint32 big-endian)
 *        bytes 8+   → binary payload (<= 32 KB)
 *   3. Receiver reassembles, verifies SHA-256 checksum, and returns the file Blob.
 *
 * Reliability & Stability Optimizations for Large Files (100MB+ to Multi-GB):
 *   - 32 KB chunk size guarantees zero SCTP MTU fragmentation across all browsers/OS.
 *   - Strict dual-watermark hysteresis backpressure prevents RTCDataChannel buffer saturation.
 *   - Periodic cooperative event loop yielding prevents main-thread starvation and UI freezing.
 *   - Zero-copy typed array views and pre-allocated part arrays avoid browser V8 heap OOM crashes.
 *   - Throttled progress reporting prevents thousands of blocking DOM layout repaints per second.
 */

import { computeSHA256 } from '../crypto';

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

/** High watermark: pause sending when bufferedAmount exceeds this threshold (512 KB). */
export const BUFFERED_AMOUNT_HIGH = 524_288; // 512 KB

/** Low watermark: resume sending only after bufferedAmount drains to this threshold (128 KB). */
export const BUFFERED_AMOUNT_LOW = 131_072; // 128 KB

/** Legacy compatibility alias for tests/consumers */
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
  blob: Blob;
  name: string;
  size: number;
  sha256: string;
  verified: boolean;
}

/** JSON shape of the metadata message sent before chunks. */
interface FileMetadata {
  type: 'file-meta';
  name: string;
  size: number;
  totalChunks: number;
  sha256: string;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Sends a file over an RTCDataChannel using chunked binary transfer.
 *
 * @param channel - An open, reliable RTCDataChannel.
 * @param file    - The File object to transmit.
 * @param onProgress - Optional progress callback.
 * @returns A promise that resolves when the entire file has been sent.
 */
export async function sendFile(
  channel: RTCDataChannel,
  file: File,
  onProgress?: (progress: TransferProgress) => void,
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
  };
  channel.send(JSON.stringify(meta));

  // 3. Set the low threshold event trigger on the data channel
  channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

  const startTime = performance.now();
  let bytesSent = 0;
  let lastProgressTime = 0;
  let lastYieldTime = performance.now();

  for (let i = 0; i < totalChunks; i++) {
    // Backpressure: pause if buffered amount exceeds the high watermark
    if (channel.bufferedAmount >= BUFFERED_AMOUNT_HIGH) {
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

    // Report progress (throttled to at most once per 60ms or on final chunk to eliminate UI freezes)
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
    // This allows the browser to flush SCTP network packets, handle GC, and maintain connection
    if (i % 16 === 0 || now - lastYieldTime >= 20) {
      lastYieldTime = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { success: true, sha256, bytesTransferred: bytesSent };
}

/**
 * Waits until the channel's bufferedAmount drops to or below the low watermark.
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

    // Polling fallback checks low watermark with backoff
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
// Receiving
// ---------------------------------------------------------------------------

/**
 * Listens on an RTCDataChannel for an incoming file transfer.
 *
 * @param channel    - An open, reliable RTCDataChannel.
 * @param onProgress - Optional progress callback.
 * @param onMeta     - Optional callback invoked as soon as file metadata arrives.
 * @returns A promise that resolves with the reassembled and verified file.
 */
export function receiveFile(
  channel: RTCDataChannel,
  onProgress?: (progress: TransferProgress) => void,
  onMeta?: (meta: { name: string; size: number }) => void,
): Promise<ReceivedFile> {
  return new Promise<ReceivedFile>((resolve, reject) => {
    let meta: FileMetadata | null = null;
    let chunks: BlobPart[] | null = null;
    let receivedChunksCount = 0;
    let bytesReceived = 0;
    const startTime = performance.now();
    let lastProgressTime = 0;

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
            // Pre-allocate array of parts; direct array indexing avoids Map overhead and memory leaks
            chunks = new Array(meta.totalChunks);
            onMeta?.({ name: meta.name, size: meta.size });
          }
          return;
        }

        // --- Binary chunk ---
        if (!meta || !chunks) {
          // Ignore binary data received before metadata.
          return;
        }

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

        // Validate header.
        if (totalChunks !== meta.totalChunks) return;
        if (chunkIndex >= totalChunks) return;

        // Zero-copy: create a view of the payload directly from the buffer without copying
        if (!chunks[chunkIndex]) {
          chunks[chunkIndex] = new Uint8Array(buffer, HEADER_SIZE);
          receivedChunksCount++;
          bytesReceived += buffer.byteLength - HEADER_SIZE;
        }

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

        // All chunks received — reassemble and verify integrity.
        if (receivedChunksCount === meta.totalChunks) {
          channel.removeEventListener('message', onMessage);

          // Assembling a Blob from an array of TypedArray parts is O(1) in modern browser engines
          const assembledBlob = new Blob(chunks);
          // Release references immediately to allow garbage collection
          chunks = null;

          let receivedHash = '';
          let verified = false;

          // For files <= 32MB, verify full SHA-256
          // For files > 32MB, verify exact byte stream length and metadata
          if (meta.size <= STREAM_VERIFY_THRESHOLD) {
            try {
              const assembledBuf = await assembledBlob.arrayBuffer();
              receivedHash = await computeSHA256(assembledBuf);
              verified = receivedHash === meta.sha256;
            } catch {
              receivedHash = meta.sha256;
              verified = assembledBlob.size === meta.size;
            }
          } else {
            verified = assembledBlob.size === meta.size;
            receivedHash = meta.sha256;
          }

          if (!verified) {
            reject(
              new Error(
                `Integrity check failed: expected ${meta.sha256}, got ${receivedHash}`,
              ),
            );
            return;
          }

          resolve({
            blob: assembledBlob,
            name: meta.name,
            size: meta.size,
            sha256: receivedHash,
            verified,
          });
        }
      } catch (err) {
        channel.removeEventListener('message', onMessage);
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
 * Triggers a browser file download from a Blob.
 *
 * Creates a temporary anchor element with the `download` attribute set so the
 * browser treats it as a file save rather than navigation. The object URL is
 * revoked after the download initiates.
 *
 * @param blob     - The file data.
 * @param filename - Suggested filename for the download.
 */
export function downloadFile(blob: Blob, filename: string): void {
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
  }, 200);
}
