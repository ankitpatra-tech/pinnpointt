/**
 * Zero-Overhead 12-Byte Binary Framing & Rolling Speed Estimator for PinnPointt.
 *
 * Framing Format:
 *   - Bytes 0–3:  Uint32 fileIdHash        (big-endian numeric hash of file identity)
 *   - Bytes 4–7:  Uint32 chunkIndex         (big-endian zero-based index of this chunk)
 *   - Bytes 8–11: Uint32 payloadByteLength  (big-endian byte length of payload)
 *   - Bytes 12+:  Raw binary payload (default 65,536 bytes / 64 KB)
 *
 * Guaranteed zero JSON or Base64 encoding overhead for high-speed local transfers.
 */

export const FAST_CHUNK_SIZE = 65_536; // 64 KB chunk size
export const BINARY_HEADER_SIZE = 12; // 12-byte binary header

export interface ParsedChunkFrame {
  fileIdHash: number;
  chunkIndex: number;
  payloadByteLength: number;
  payload: Uint8Array;
}

export interface SpeedEstimate {
  speedBps: number;
  etaSeconds: number;
}

/**
 * Computes a fast, deterministic 32-bit FNV-1a hash of a file identifier string.
 */
export function computeNumericFileIdHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Prepends a fixed 12-byte binary header to a chunk's ArrayBuffer.
 */
export function createChunkFrame(
  fileIdHash: number,
  chunkIndex: number,
  payload: ArrayBuffer | Uint8Array,
): ArrayBuffer {
  const payloadBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const totalLength = BINARY_HEADER_SIZE + payloadBytes.byteLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  view.setUint32(0, fileIdHash, false);           // Bytes 0–3: numeric fileIdHash
  view.setUint32(4, chunkIndex, false);           // Bytes 4–7: chunkIndex
  view.setUint32(8, payloadBytes.byteLength, false); // Bytes 8–11: payloadByteLength

  new Uint8Array(buffer, BINARY_HEADER_SIZE).set(payloadBytes);
  return buffer;
}

/**
 * Parses a 12-byte framed chunk ArrayBuffer into its constituent header fields and payload.
 * Returns null if the buffer is malformed or shorter than 12 bytes.
 */
export function parseChunkFrame(buffer: ArrayBuffer): ParsedChunkFrame | null {
  if (buffer.byteLength < BINARY_HEADER_SIZE) {
    return null;
  }

  const view = new DataView(buffer, 0, BINARY_HEADER_SIZE);
  const fileIdHash = view.getUint32(0, false);
  const chunkIndex = view.getUint32(4, false);
  const payloadByteLength = view.getUint32(8, false);

  if (buffer.byteLength < BINARY_HEADER_SIZE + payloadByteLength) {
    return null; // Truncated payload
  }

  const payload = new Uint8Array(buffer, BINARY_HEADER_SIZE, payloadByteLength);
  return {
    fileIdHash,
    chunkIndex,
    payloadByteLength,
    payload,
  };
}

/**
 * Rolling 1.5-second moving average speed and ETA estimator.
 * Eliminates numeric jitter and wild speed swings during high-throughput transfers.
 */
export class RollingSpeedEstimator {
  private readonly windowMs: number;
  private samples: Array<{ timestamp: number; bytes: number }> = [];

  constructor(windowMs = 1500) {
    this.windowMs = windowMs;
  }

  /**
   * Records newly transferred bytes at the given timestamp.
   */
  record(bytes: number, now = performance.now()): void {
    if (bytes <= 0) return;
    this.samples.push({ timestamp: now, bytes });
    this.pruneOldSamples(now);
  }

  private pruneOldSamples(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].timestamp < cutoff) {
      this.samples.shift();
    }
  }

  /**
   * Computes smoothed speed (bytes per second) and estimated time remaining (seconds).
   */
  getEstimate(bytesRemaining: number, now = performance.now()): SpeedEstimate {
    this.pruneOldSamples(now);

    if (this.samples.length === 0) {
      return { speedBps: 0, etaSeconds: 0 };
    }

    let totalBytesInWindow = 0;
    for (const sample of this.samples) {
      totalBytesInWindow += sample.bytes;
    }

    // Determine effective duration of the sample window
    const oldestTimestamp = this.samples[0].timestamp;
    const durationMs = Math.max(now - oldestTimestamp, 50); // Minimum 50ms baseline
    const durationSec = durationMs / 1000;

    const speedBps = durationSec > 0 ? totalBytesInWindow / durationSec : 0;
    const etaSeconds = speedBps > 0 && bytesRemaining > 0 ? Math.max(0, bytesRemaining / speedBps) : 0;

    return {
      speedBps,
      etaSeconds,
    };
  }

  /**
   * Resets all samples.
   */
  reset(): void {
    this.samples = [];
  }
}
