/**
 * Zero-RAM Disk Streaming & High-Throughput Parallel WebRTC Binary File Transfer.
 *
 * Protocol:
 *   1. Sender transmits JSON metadata message (string):
 *      { type: 'file-meta', name, size, totalChunks, sha256, fileIdHash, chunkSize }
 *   2. Sender transmits 64 KB binary chunks across a 4-channel parallel pool
 *      (pinnpointt-data-0..3) with 12-byte binary framing:
 *        Bytes 0–3  → numeric fileIdHash       (uint32 big-endian)
 *        Bytes 4–7  → chunk index              (uint32 big-endian)
 *        Bytes 8–11 → payload byte length      (uint32 big-endian)
 *        Bytes 12+  → raw binary payload (<= 64 KB)
 *   3. Receiver streams chunks directly into disk storage via random-access offset writes:
 *      writable.write({ type: 'write', position: chunkIndex * 65536, data: payload })
 *      (Tier A: Direct FileSystemAccess, Tier B: OPFS, Tier C: Memory fallback).
 *
 * Backpressure:
 *   - Pool: 512 KB low / 2 MB high watermark per channel with lowest-buffered distribution.
 *   - Single channel fallback: 64 KB low / 256 KB high watermark.
 *   - Live speed gauge uses a rolling 1.5-second moving average for rock-steady MB/s & ETA.
 */

import { computeSHA256 } from '../crypto';
import {
  createDiskWriter,
  type DiskWriter,
  type CreateWriterOptions,
  type FileMetadata,
} from './diskStreamer';
import {
  FAST_CHUNK_SIZE,
  BINARY_HEADER_SIZE,
  createChunkFrame,
  parseChunkFrame,
  computeNumericFileIdHash,
  RollingSpeedEstimator,
} from './fastChunker';
import { ParallelChannelPool } from './parallelChannelPool';
import { TransferController } from './transferController';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Length of the binary header prepended to each chunk (12 bytes). */
export const HEADER_SIZE = BINARY_HEADER_SIZE;

/** Default chunk payload size (65,536 bytes / 64 KB). */
export const CHUNK_SIZE = FAST_CHUNK_SIZE;

/** Single channel fallback high watermark: pause when bufferedAmount > 256 KB. */
export const BUFFERED_AMOUNT_HIGH = 262_144; // 256 KB

/** Single channel fallback low watermark: resume when bufferedAmount <= 64 KB. */
export const BUFFERED_AMOUNT_LOW = 65_536; // 64 KB

/** Legacy compatibility alias */
export const BUFFERED_AMOUNT_THRESHOLD = BUFFERED_AMOUNT_HIGH;

/** Files larger than 32 MB use streaming validation to avoid browser OOM. */
export const STREAM_VERIFY_THRESHOLD = 32 * 1024 * 1024; // 32 MB

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TransferProgress {
  bytesSent: number;
  bytesTotal: number;
  chunksComplete: number;
  chunksTotal: number;
  /** Instantaneous / smoothed speed in bytes per second. */
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
  fileId?: string;
  isMetadataStripped?: boolean;
  isZeroTrace?: boolean;
  controller?: TransferController;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Sends a file over WebRTC using chunked 64 KB binary transfer with parallel pool striping
 * and strict backpressure.
 *
 * @param channel    - Primary reliable RTCDataChannel for control/metadata.
 * @param file       - The File object to transmit.
 * @param onProgress - Optional progress callback.
 * @param options    - Optional privacy shield / zero-trace options.
 * @param pool       - Optional parallel multi-channel pool for 30-80+ MB/s throughput.
 * @returns A promise that resolves when the entire file has been transmitted.
 */
export async function sendFile(
  channel: RTCDataChannel,
  file: File,
  onProgress?: (progress: TransferProgress) => void,
  options?: SendFileOptions,
  pool?: ParallelChannelPool,
  existingController?: TransferController,
): Promise<TransferResult> {
  // 1. Calculate file integrity token / hash
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

  const fileIdHash = computeNumericFileIdHash(`${file.name}:${file.size}:${file.lastModified}`);
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
  const fileId = options?.fileId || options?.controller?.fileId || `tx-${fileIdHash}-${file.name}`;

  const controller =
    existingController ||
    options?.controller ||
    new TransferController(fileId, 'sender', totalChunks, (msg) => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(msg));
      }
    });

  // 2. Transmit metadata as a JSON string message on primary channel
  const meta: FileMetadata = {
    type: 'file-meta',
    fileId,
    name: file.name,
    size: file.size,
    totalChunks,
    sha256,
    fileIdHash,
    chunkSize: CHUNK_SIZE,
    isMetadataStripped: options?.isMetadataStripped,
    isZeroTrace: options?.isZeroTrace,
  };
  channel.send(JSON.stringify(meta));

  // Determine whether to use 4-channel parallel pool or single channel fallback
  const usePool = Boolean(pool && pool.isReady());
  if (!usePool) {
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;
  }

  controller.start();
  const speedEstimator = new RollingSpeedEstimator(1500);
  let bytesSent = 0;
  let lastProgressTime = 0;
  let lastYieldTime = performance.now();

  for (let i = 0; i < totalChunks; i++) {
    // 1. Check for cancellation
    if (controller.isCancelled()) {
      throw new Error('Transfer cancelled');
    }

    // 2. Check for pause & wait for resume
    if (controller.isPaused()) {
      await controller.waitForResume();
      if (controller.isCancelled()) {
        throw new Error('Transfer cancelled');
      }

      // Resume from synced lowest unwritten chunk index on receiver
      const resumeIndex = controller.getNextResumeChunkIndex();
      if (resumeIndex > i && resumeIndex < totalChunks) {
        i = resumeIndex;
        bytesSent = i * CHUNK_SIZE;
      }
    }

    let targetChannel: RTCDataChannel;

    if (usePool && pool) {
      targetChannel = await pool.getOptimalChannel();
    } else {
      if (channel.bufferedAmount > BUFFERED_AMOUNT_HIGH) {
        await waitForBufferDrain(channel);
      }
      if (channel.readyState !== 'open') {
        throw new Error('DataChannel closed unexpectedly during file transfer');
      }
      targetChannel = channel;
    }

    const offset = i * CHUNK_SIZE;
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const sliceBlob = file.slice(offset, end);
    const sliceBuffer = await sliceBlob.arrayBuffer();

    // 12-byte zero-overhead binary framing:
    // [0..3: fileIdHash] [4..7: chunkIndex] [8..11: payloadByteLength] [12..: payload]
    const chunk = createChunkFrame(fileIdHash, i, sliceBuffer);

    targetChannel.send(chunk);
    bytesSent += sliceBuffer.byteLength;

    const now = performance.now();
    speedEstimator.record(sliceBuffer.byteLength, now);

    // Report progress (throttled to at most once per 60ms or on final chunk)
    if (onProgress && (now - lastProgressTime >= 60 || i === totalChunks - 1)) {
      lastProgressTime = now;
      const remaining = file.size - bytesSent;
      const { speedBps, etaSeconds } = speedEstimator.getEstimate(remaining, now);

      onProgress({
        bytesSent,
        bytesTotal: file.size,
        chunksComplete: i + 1,
        chunksTotal: totalChunks,
        speedBps,
        etaSeconds,
      });
    }

    // Cooperative yielding to browser macrotask loop every 16 chunks or 20ms
    if (i % 16 === 0 || now - lastYieldTime >= 20) {
      lastYieldTime = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  controller.complete();
  return { success: true, sha256, bytesTransferred: bytesSent };
}

/**
 * Waits until single channel bufferedAmount drops below 64 KB.
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
// Receiving (Tiered Zero-RAM Random-Access Streaming)
// ---------------------------------------------------------------------------

/**
 * Listens on WebRTC channels for an incoming file transfer and streams chunks
 * directly into disk storage via random-access byte offset writes.
 *
 * @param channel    - Primary reliable RTCDataChannel for control/metadata.
 * @param onProgress - Optional progress callback.
 * @param onMeta     - Optional callback invoked when metadata arrives.
 * @param options    - Optional storage writer preferences (direct handle / force memory).
 * @param pool       - Optional parallel multi-channel pool for receiving chunks concurrently.
 * @returns A promise that resolves with the reassembled and verified file.
 */
export function receiveFile(
  channel: RTCDataChannel,
  onProgress?: (progress: TransferProgress) => void,
  onMeta?: (meta: {
    fileId: string;
    name: string;
    size: number;
    isMetadataStripped?: boolean;
    isZeroTrace?: boolean;
    controller?: TransferController;
  }) => void,
  options?: CreateWriterOptions,
  pool?: ParallelChannelPool,
  existingController?: TransferController,
): Promise<ReceivedFile> {
  return new Promise<ReceivedFile>((resolve, reject) => {
    let meta: FileMetadata | null = null;
    let writer: DiskWriter | null = null;
    let isFinalized = false;
    let controller: TransferController | null = existingController || null;
    const receivedChunkIndices = new Set<number>();
    let bytesReceived = 0;
    const speedEstimator = new RollingSpeedEstimator(1500);
    let lastProgressTime = 0;

    // Buffer chunks that arrive while writer is asynchronously initializing
    const pendingChunks: Array<{ chunkIndex: number; payload: Uint8Array }> = [];
    let isInitializingWriter = false;

    let unsubPool: (() => void) | null = null;

    const cleanupListeners = () => {
      channel.removeEventListener('message', onMessage);
      if (unsubPool) {
        unsubPool();
        unsubPool = null;
      }
    };

    const processChunk = async (chunkIndex: number, payload: Uint8Array): Promise<void> => {
      if (!writer || !meta || isFinalized) return;
      if (receivedChunkIndices.has(chunkIndex)) return; // Deduplicate

      // Direct random-access offset write into disk stream: position = chunkIndex * 65536
      await writer.writeChunk(chunkIndex, payload, meta.chunkSize || FAST_CHUNK_SIZE);
      receivedChunkIndices.add(chunkIndex);
      controller?.markChunkWritten(chunkIndex);
      bytesReceived += payload.byteLength;

      const now = performance.now();
      speedEstimator.record(payload.byteLength, now);

      // Report progress (throttled to at most once per 60ms or on completion)
      if (onProgress && (now - lastProgressTime >= 60 || receivedChunkIndices.size === meta.totalChunks)) {
        lastProgressTime = now;
        const remaining = meta.size - bytesReceived;
        const { speedBps, etaSeconds } = speedEstimator.getEstimate(remaining, now);

        onProgress({
          bytesSent: bytesReceived,
          bytesTotal: meta.size,
          chunksComplete: receivedChunkIndices.size,
          chunksTotal: meta.totalChunks,
          speedBps,
          etaSeconds,
        });
      }

      // All chunks received across all parallel channels — finalize disk writer
      if (receivedChunkIndices.size === meta.totalChunks && !isFinalized) {
        isFinalized = true;
        controller?.complete();
        cleanupListeners();

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

    const handleBinaryBuffer = async (buffer: ArrayBuffer): Promise<void> => {
      try {
        // 1. Try zero-overhead 12-byte header parsing
        const parsed = parseChunkFrame(buffer);
        if (parsed) {
          const { fileIdHash, chunkIndex, payload } = parsed;

          if (meta && meta.fileIdHash !== undefined && meta.fileIdHash !== fileIdHash) {
            return; // Ignore chunks belonging to a different file
          }
          if (meta && chunkIndex >= meta.totalChunks) {
            return;
          }

          if (!writer || isInitializingWriter) {
            pendingChunks.push({ chunkIndex, payload });
            return;
          }

          await processChunk(chunkIndex, payload);
          return;
        }

        // 2. Backward compatibility fallback for legacy 8-byte header
        if (buffer.byteLength >= 8) {
          const view = new DataView(buffer);
          const chunkIndex = view.getUint32(0, false);
          const totalChunks = view.getUint32(4, false);

          if (meta && totalChunks !== meta.totalChunks) return;
          if (meta && chunkIndex >= meta.totalChunks) return;

          const payload = new Uint8Array(buffer, 8);

          if (!writer || isInitializingWriter) {
            pendingChunks.push({ chunkIndex, payload });
            return;
          }

          await processChunk(chunkIndex, payload);
        }
      } catch (err) {
        cleanupListeners();
        if (writer) {
          await writer.abort().catch(() => {});
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    // If parallel channel pool is supplied, listen for binary chunks across all pool channels
    if (pool) {
      unsubPool = pool.onMessage((buf) => {
        void handleBinaryBuffer(buf);
      });
    }

    const onMessage = async (event: MessageEvent): Promise<void> => {
      try {
        // --- Metadata (JSON string on control channel) ---
        if (typeof event.data === 'string') {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            return;
          }

          if (parsed.type === 'file-meta') {
            meta = parsed as unknown as FileMetadata;
            const fileId = meta.fileId || `tx-${meta.fileIdHash || 0}-${meta.name}`;

            if (!controller) {
              controller = new TransferController(fileId, 'receiver', meta.totalChunks, (msg) => {
                if (channel.readyState === 'open') {
                  channel.send(JSON.stringify(msg));
                }
              });
            }
            controller.start();

            controller.onStateChange(async (state) => {
              if (state === 'cancelled') {
                cleanupListeners();
                if (writer) {
                  await writer.abort().catch(() => {});
                }
                reject(new Error('Transfer cancelled'));
              }
            });

            onMeta?.({
              fileId,
              name: meta.name,
              size: meta.size,
              isMetadataStripped: meta.isMetadataStripped,
              isZeroTrace: meta.isZeroTrace,
              controller,
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

            // Flush any chunks received during asynchronous writer setup
            await flushPending();
          }
          return;
        }

        // --- Binary chunk arriving on primary channel ---
        let buffer: ArrayBuffer;
        if (event.data instanceof ArrayBuffer) {
          buffer = event.data;
        } else if (event.data instanceof Blob) {
          buffer = await event.data.arrayBuffer();
        } else {
          return;
        }

        await handleBinaryBuffer(buffer);
      } catch (err) {
        cleanupListeners();
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
 */
export function downloadFile(blob: Blob | File, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 250);
}
