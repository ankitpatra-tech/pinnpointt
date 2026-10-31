/**
 * Zero-RAM Disk Streaming & Tiered Storage Writer for PinnPointt.
 *
 * Prevents multi-gigabyte files from accumulating as massive arrays of
 * ArrayBuffers / Blobs in browser RAM.
 *
 * Storage Tiers:
 *   Tier A (Desktop Chromium): Direct disk write via `window.showSaveFilePicker()`
 *   Tier B (Cross-Platform Modern: iOS Safari, Android Chrome, Firefox): Sequential
 *          OPFS (Origin Private File System) stream via `navigator.storage.getDirectory()`.
 *   Tier C (Legacy Fallback): In-memory chunk array.
 */

import { computeSHA256 } from '../crypto';

export interface FileMetadata {
  type: 'file-meta';
  name: string;
  size: number;
  totalChunks: number;
  sha256: string;
  isMetadataStripped?: boolean;
  isZeroTrace?: boolean;
}

/** Standard chunk payload size: 32,768 bytes total - 8 bytes header = 32,760 bytes */
export const CHUNK_PAYLOAD_SIZE = 32_768 - 8;

export interface DiskStreamResult {
  file: File | Blob;
  name: string;
  size: number;
  sha256: string;
  verified: boolean;
  isDirectDiskSave: boolean;
  cleanup?: () => Promise<void>;
}

export interface DiskWriter {
  readonly tierName: 'Direct Disk' | 'OPFS' | 'Memory';
  writeChunk(chunkIndex: number, data: Uint8Array): Promise<void>;
  finalize(): Promise<DiskStreamResult>;
  abort(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Tier A: Direct Disk Writer (FileSystemAccess API showSaveFilePicker)
// ---------------------------------------------------------------------------

class DirectDiskWriter implements DiskWriter {
  readonly tierName = 'Direct Disk';
  private writable: FileSystemWritableFileStream | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private bytesWritten = 0;

  constructor(
    private readonly handle: FileSystemFileHandle,
    private readonly meta: FileMetadata,
  ) {}

  async init(): Promise<void> {
    this.writable = await this.handle.createWritable({ keepExistingData: false });
  }

  async writeChunk(chunkIndex: number, data: Uint8Array): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.writable) {
        throw new Error('DirectDiskWriter is not initialized');
      }
      await this.writable.write({
        type: 'write',
        position: chunkIndex * CHUNK_PAYLOAD_SIZE,
        data: data as unknown as BufferSource,
      });
      this.bytesWritten += data.byteLength;
    });
    return this.writeQueue;
  }

  async finalize(): Promise<DiskStreamResult> {
    await this.writeQueue;

    if (this.writable) {
      await this.writable.close();
      this.writable = null;
    }

    const file = await this.handle.getFile();
    let verified = this.bytesWritten === this.meta.size;
    let computedHash = this.meta.sha256;

    if (this.meta.size <= 32 * 1024 * 1024 && verified) {
      try {
        const buf = await file.arrayBuffer();
        computedHash = await computeSHA256(buf);
        verified = computedHash === this.meta.sha256;
      } catch {
        verified = this.bytesWritten === this.meta.size;
      }
    }

    return {
      file,
      name: this.meta.name,
      size: this.bytesWritten,
      sha256: computedHash,
      verified,
      isDirectDiskSave: true,
    };
  }

  async abort(): Promise<void> {
    await this.writeQueue.catch(() => {});
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {
        // Ignored
      }
      this.writable = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Tier B: OPFS Writer (Origin Private File System)
// ---------------------------------------------------------------------------

class OPFSWriter implements DiskWriter {
  readonly tierName = 'OPFS';
  private root: FileSystemDirectoryHandle | null = null;
  private fileHandle: FileSystemFileHandle | null = null;
  private writable: FileSystemWritableFileStream | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private tempName = '';
  private bytesWritten = 0;

  constructor(private readonly meta: FileMetadata) {}

  async init(): Promise<void> {
    if (typeof navigator === 'undefined' || !('storage' in navigator) || typeof navigator.storage.getDirectory !== 'function') {
      throw new Error('OPFS is not supported in this environment');
    }

    this.root = await navigator.storage.getDirectory();
    this.tempName = `pinnpoint_stream_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`;
    this.fileHandle = await this.root.getFileHandle(this.tempName, { create: true });
    this.writable = await this.fileHandle.createWritable({ keepExistingData: false });
  }

  async writeChunk(chunkIndex: number, data: Uint8Array): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.writable) {
        throw new Error('OPFSWriter is not initialized');
      }
      await this.writable.write({
        type: 'write',
        position: chunkIndex * CHUNK_PAYLOAD_SIZE,
        data: data as unknown as BufferSource,
      });
      this.bytesWritten += data.byteLength;
    });
    return this.writeQueue;
  }

  async finalize(): Promise<DiskStreamResult> {
    await this.writeQueue;

    if (this.writable) {
      await this.writable.close();
      this.writable = null;
    }

    if (!this.fileHandle || !this.root) {
      throw new Error('OPFS file handle lost');
    }

    const file = await this.fileHandle.getFile();
    let verified = file.size === this.meta.size;
    let computedHash = this.meta.sha256;

    if (this.meta.size <= 32 * 1024 * 1024 && verified) {
      try {
        const buf = await file.arrayBuffer();
        computedHash = await computeSHA256(buf);
        verified = computedHash === this.meta.sha256;
      } catch {
        verified = file.size === this.meta.size;
      }
    }

    const rootDir = this.root;
    const tempFile = this.tempName;

    return {
      file,
      name: this.meta.name,
      size: file.size,
      sha256: computedHash,
      verified,
      isDirectDiskSave: false,
      cleanup: async () => {
        try {
          await rootDir.removeEntry(tempFile);
        } catch {
          // Non-fatal if already removed
        }
      },
    };
  }

  async abort(): Promise<void> {
    await this.writeQueue.catch(() => {});
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {
        // Ignored
      }
      this.writable = null;
    }
    if (this.root && this.tempName) {
      try {
        await this.root.removeEntry(this.tempName);
      } catch {
        // Ignored
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tier C: In-Memory / BlobPart Chunk Fallback
// ---------------------------------------------------------------------------

class MemoryWriter implements DiskWriter {
  readonly tierName = 'Memory';
  private chunks: BlobPart[] | null = null;
  private bytesWritten = 0;

  constructor(private readonly meta: FileMetadata) {
    this.chunks = new Array(meta.totalChunks);
  }

  async writeChunk(chunkIndex: number, data: Uint8Array): Promise<void> {
    if (!this.chunks) throw new Error('MemoryWriter aborted');
    this.chunks[chunkIndex] = data as unknown as BlobPart;
    this.bytesWritten += data.byteLength;
  }

  async finalize(): Promise<DiskStreamResult> {
    if (!this.chunks) throw new Error('MemoryWriter aborted');
    const blob = new Blob(this.chunks);
    this.chunks = null; // free memory

    let verified = blob.size === this.meta.size;
    let computedHash = this.meta.sha256;

    if (this.meta.size <= 32 * 1024 * 1024) {
      try {
        const buf = await blob.arrayBuffer();
        computedHash = await computeSHA256(buf);
        verified = computedHash === this.meta.sha256;
      } catch {
        verified = blob.size === this.meta.size;
      }
    }

    return {
      file: blob,
      name: this.meta.name,
      size: blob.size,
      sha256: computedHash,
      verified,
      isDirectDiskSave: false,
    };
  }

  async abort(): Promise<void> {
    this.chunks = null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateWriterOptions {
  /** Optional pre-acquired file handle from window.showSaveFilePicker() */
  directFileHandle?: FileSystemFileHandle | null;
  /** Force in-memory writing (used for unit tests or restricted environments) */
  forceMemory?: boolean;
}

/**
 * Creates the most efficient available storage writer for the platform.
 */
export async function createDiskWriter(
  meta: FileMetadata,
  options?: CreateWriterOptions,
): Promise<DiskWriter> {
  if (options?.forceMemory) {
    return new MemoryWriter(meta);
  }

  // Tier A: Pre-acquired direct disk handle (Chromium)
  if (options?.directFileHandle) {
    try {
      const direct = new DirectDiskWriter(options.directFileHandle, meta);
      await direct.init();
      return direct;
    } catch (err) {
      console.warn('[DiskStreamer] DirectDiskWriter init failed, falling back to OPFS:', err);
    }
  }

  // Tier B: Origin Private File System (iOS Safari, Android Chrome, Firefox, Chrome)
  if (typeof navigator !== 'undefined' && 'storage' in navigator && typeof navigator.storage.getDirectory === 'function') {
    try {
      const opfs = new OPFSWriter(meta);
      await opfs.init();
      return opfs;
    } catch (err) {
      console.warn('[DiskStreamer] OPFSWriter init failed, falling back to memory:', err);
    }
  }

  // Tier C: In-memory fallback
  return new MemoryWriter(meta);
}
