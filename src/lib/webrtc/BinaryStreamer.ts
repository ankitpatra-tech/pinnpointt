/**
 * Chunked binary file transfer over RTCDataChannel.
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
 * Backpressure is managed by monitoring `channel.bufferedAmount` and pausing
 * when it exceeds the configured threshold (1 MB) until `bufferedamountlow` fires.
 */

import { computeSHA256 } from '../crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Size of each file chunk payload (excluding the 8-byte header). */
export const CHUNK_SIZE = 32_768; // 32 KB

/** Backpressure threshold in bytes (1 MB). */
export const BUFFERED_AMOUNT_THRESHOLD = 1_048_576; // 1 MB

/** Length of the binary header prepended to each chunk. */
export const HEADER_SIZE = 8;

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
  // Read array buffer for SHA-256 calculation
  const wholeBuffer = await file.arrayBuffer();
  const sha256 = await computeSHA256(wholeBuffer);

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;

  // 1. Send metadata as a JSON string message.
  const meta: FileMetadata = {
    type: 'file-meta',
    name: file.name,
    size: file.size,
    totalChunks,
    sha256,
  };
  channel.send(JSON.stringify(meta));

  // 2. Send binary chunks with 8-byte header.
  const startTime = performance.now();
  let bytesSent = 0;

  channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_THRESHOLD / 2;

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * CHUNK_SIZE;
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const sliceBuffer = wholeBuffer.slice(offset, end);

    // Build chunk: [header (8 bytes)] + [payload]
    const chunk = new ArrayBuffer(HEADER_SIZE + sliceBuffer.byteLength);
    const view = new DataView(chunk);
    view.setUint32(0, i, false);           // chunk index, big-endian
    view.setUint32(4, totalChunks, false);  // total chunks, big-endian

    // Copy payload after header.
    new Uint8Array(chunk, HEADER_SIZE).set(new Uint8Array(sliceBuffer));

    // Backpressure: pause if buffered amount exceeds threshold
    if (channel.bufferedAmount >= BUFFERED_AMOUNT_THRESHOLD) {
      await waitForBufferDrain(channel);
    }

    channel.send(chunk);
    bytesSent += sliceBuffer.byteLength;

    // Report progress.
    if (onProgress) {
      const elapsed = (performance.now() - startTime) / 1000;
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
  }

  return { success: true, sha256, bytesTransferred: bytesSent };
}

/**
 * Returns a promise that resolves once the channel's buffered amount drops
 * below the threshold.
 */
function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount < BUFFERED_AMOUNT_THRESHOLD) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onLow = (): void => {
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', onLow);
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
 * @returns A promise that resolves with the reassembled and verified file.
 */
export function receiveFile(
  channel: RTCDataChannel,
  onProgress?: (progress: TransferProgress) => void,
): Promise<ReceivedFile> {
  return new Promise<ReceivedFile>((resolve, reject) => {
    let meta: FileMetadata | null = null;
    const chunks: Map<number, ArrayBuffer> = new Map();
    let bytesReceived = 0;
    const startTime = performance.now();

    const onMessage = async (event: MessageEvent): Promise<void> => {
      try {
        // --- Metadata (string message) ---
        if (typeof event.data === 'string') {
          const parsed = JSON.parse(event.data) as Record<string, unknown>;
          if (parsed.type === 'file-meta') {
            meta = parsed as unknown as FileMetadata;
          }
          return;
        }

        // --- Binary chunk ---
        if (!meta) {
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

        // Store the payload (everything after the header).
        const payload = buffer.slice(HEADER_SIZE);
        chunks.set(chunkIndex, payload);
        bytesReceived += payload.byteLength;

        // Report progress.
        if (onProgress) {
          const elapsed = (performance.now() - startTime) / 1000;
          const speedBps = elapsed > 0 ? bytesReceived / elapsed : 0;
          const remaining = meta.size - bytesReceived;
          const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;

          onProgress({
            bytesSent: bytesReceived,
            bytesTotal: meta.size,
            chunksComplete: chunks.size,
            chunksTotal: meta.totalChunks,
            speedBps,
            etaSeconds,
          });
        }

        // All chunks received — reassemble and verify integrity.
        if (chunks.size === meta.totalChunks) {
          channel.removeEventListener('message', onMessage);

          // Reassemble in order.
          const ordered: ArrayBuffer[] = [];
          for (let i = 0; i < meta.totalChunks; i++) {
            const part = chunks.get(i);
            if (!part) {
              reject(new Error(`Missing chunk ${i}`));
              return;
            }
            ordered.push(part);
          }

          const blob = new Blob(ordered);
          const assembled = await blob.arrayBuffer();
          const receivedHash = await computeSHA256(assembled);

          const verified = receivedHash === meta.sha256;
          if (!verified) {
            reject(
              new Error(
                `SHA-256 mismatch: expected ${meta.sha256}, got ${receivedHash}`,
              ),
            );
            return;
          }

          resolve({
            blob,
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
