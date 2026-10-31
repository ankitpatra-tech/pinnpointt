/**
 * P2P Virtual Drive (Live Remote Mount) Protocol Handler.
 *
 * Enables selective on-demand file pull and byte-range slice previewing
 * over WebRTC RTCDataChannel without requiring a full push of gigabytes.
 */

export interface VfsFileEntry {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  lastModified: number;
}

export interface VfsManifestMessage {
  type: 'VFS_MANIFEST';
  files: VfsFileEntry[];
  driveName?: string;
}

export interface VfsUnmountMessage {
  type: 'VFS_UNMOUNT';
}

export interface VfsPullMessage {
  type: 'VFS_PULL';
  fileId: string;
}

export interface VfsSliceReqMessage {
  type: 'VFS_SLICE_REQ';
  requestId: string;
  fileId: string;
  offset: number;
  length: number;
}

export interface VfsSliceResMessage {
  type: 'VFS_SLICE_RES';
  requestId: string;
  fileId: string;
  offset: number;
  length: number;
  totalSize: number;
  mimeType: string;
  dataBase64: string;
}

export type VfsMessage =
  | VfsManifestMessage
  | VfsUnmountMessage
  | VfsPullMessage
  | VfsSliceReqMessage
  | VfsSliceResMessage;

export interface VfsSliceResult {
  fileId: string;
  offset: number;
  length: number;
  totalSize: number;
  mimeType: string;
  dataBase64: string;
  text?: string;
}

export interface VirtualDriveCallbacks {
  onRemoteManifestUpdated: (files: VfsFileEntry[]) => void;
  onRemoteUnmounted: () => void;
  onFilePullRequested: (file: File) => void;
  onNotice?: (text: string) => void;
}

/** Default slice window for on-demand preview (512 KB) */
export const DEFAULT_PREVIEW_SLICE_SIZE = 512 * 1024; // 512 KB

export class VirtualDriveManager {
  private localFiles = new Map<string, { entry: VfsFileEntry; file: File }>();
  private remoteFiles: VfsFileEntry[] = [];
  private pendingSliceRequests = new Map<
    string,
    {
      resolve: (res: VfsSliceResult) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly sendJSON: (data: object) => void,
    private readonly callbacks: VirtualDriveCallbacks,
  ) {}

  /**
   * Returns list of currently mounted local files.
   */
  getLocalEntries(): VfsFileEntry[] {
    return Array.from(this.localFiles.values()).map((v) => v.entry);
  }

  /**
   * Returns a local File instance by ID if mounted.
   */
  getLocalFile(fileId: string): File | undefined {
    return this.localFiles.get(fileId)?.file;
  }

  /**
   * Returns list of remote files mounted by peer.
   */
  getRemoteEntries(): VfsFileEntry[] {
    return [...this.remoteFiles];
  }

  /**
   * Mounts a local FileList or File array into the Virtual Drive
   * and transmits the manifest to the remote peer.
   */
  mountLocalFiles(fileList: FileList | File[]): VfsFileEntry[] {
    this.localFiles.clear();

    const entries: VfsFileEntry[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      // Generate clean unique ID for this mount session
      const id = `vfs_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
      // Preserve folder hierarchy if selected via webkitdirectory
      const relativePath = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const mimeType = file.type || inferMimeType(file.name);

      const entry: VfsFileEntry = {
        id,
        name: file.name,
        relativePath,
        size: file.size,
        mimeType,
        lastModified: file.lastModified || Date.now(),
      };

      this.localFiles.set(id, { entry, file });
      entries.push(entry);
    }

    // Broadcast VFS_MANIFEST to remote peer
    const manifestMsg: VfsManifestMessage = {
      type: 'VFS_MANIFEST',
      files: entries,
    };
    this.sendJSON(manifestMsg);

    return entries;
  }

  /**
   * Unmounts all local files and informs remote peer.
   */
  unmountLocal(): void {
    if (this.localFiles.size === 0) return;
    this.localFiles.clear();

    const msg: VfsUnmountMessage = { type: 'VFS_UNMOUNT' };
    this.sendJSON(msg);
  }

  /**
   * Requests the remote peer to stream a specific mounted file.
   */
  pullRemoteFile(fileId: string): void {
    const pullMsg: VfsPullMessage = {
      type: 'VFS_PULL',
      fileId,
    };
    this.sendJSON(pullMsg);
  }

  /**
   * Requests a byte slice of a remote file for on-demand instant preview.
   */
  async requestSlice(
    fileId: string,
    offset = 0,
    length = DEFAULT_PREVIEW_SLICE_SIZE,
  ): Promise<VfsSliceResult> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return new Promise<VfsSliceResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSliceRequests.delete(requestId);
        reject(new Error(`Timeout waiting for preview byte slice (${fileId})`));
      }, 15_000);

      this.pendingSliceRequests.set(requestId, { resolve, reject, timer });

      const sliceReq: VfsSliceReqMessage = {
        type: 'VFS_SLICE_REQ',
        requestId,
        fileId,
        offset,
        length,
      };
      this.sendJSON(sliceReq);
    });
  }

  /**
   * Processes incoming DataChannel protocol JSON messages.
   * Returns true if the message was recognized and handled as a VFS message.
   */
  handleMessage(msg: Record<string, unknown>): boolean {
    const type = msg.type as string | undefined;
    if (!type || !type.startsWith('VFS_')) {
      return false;
    }

    switch (type) {
      case 'VFS_MANIFEST': {
        const files = (Array.isArray(msg.files) ? msg.files : []) as VfsFileEntry[];
        this.remoteFiles = files;
        this.callbacks.onRemoteManifestUpdated(files);
        return true;
      }

      case 'VFS_UNMOUNT': {
        this.remoteFiles = [];
        this.callbacks.onRemoteUnmounted();
        return true;
      }

      case 'VFS_PULL': {
        const fileId = String(msg.fileId || '');
        const local = this.localFiles.get(fileId);
        if (local) {
          this.callbacks.onFilePullRequested(local.file);
        } else {
          this.callbacks.onNotice?.(`Peer requested unmounted file ID: ${fileId}`);
        }
        return true;
      }

      case 'VFS_SLICE_REQ': {
        void this.handleSliceRequest(msg as unknown as VfsSliceReqMessage);
        return true;
      }

      case 'VFS_SLICE_RES': {
        this.handleSliceResponse(msg as unknown as VfsSliceResMessage);
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Handles an incoming slice request by reading from disk slice and replying.
   */
  private async handleSliceRequest(req: VfsSliceReqMessage): Promise<void> {
    const local = this.localFiles.get(req.fileId);
    if (!local) return;

    try {
      const file = local.file;
      const start = Math.max(0, req.offset || 0);
      const end = Math.min(file.size, start + (req.length || DEFAULT_PREVIEW_SLICE_SIZE));
      const sliceBlob = file.slice(start, end);
      const arrayBuffer = await sliceBlob.arrayBuffer();

      // Convert ArrayBuffer to base64
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const dataBase64 = btoa(binary);

      const res: VfsSliceResMessage = {
        type: 'VFS_SLICE_RES',
        requestId: req.requestId,
        fileId: req.fileId,
        offset: start,
        length: bytes.byteLength,
        totalSize: file.size,
        mimeType: local.entry.mimeType,
        dataBase64,
      };

      this.sendJSON(res);
    } catch (err) {
      console.warn('[VirtualDrive] Error slicing local file:', err);
    }
  }

  /**
   * Resolves a pending slice request when response arrives from peer.
   */
  private handleSliceResponse(res: VfsSliceResMessage): void {
    const pending = this.pendingSliceRequests.get(res.requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingSliceRequests.delete(res.requestId);

    let text: string | undefined;
    if (
      res.mimeType.startsWith('text/') ||
      res.mimeType.includes('json') ||
      res.mimeType.includes('javascript') ||
      res.mimeType.includes('typescript') ||
      res.mimeType.includes('markdown') ||
      res.mimeType.includes('csv') ||
      res.mimeType.includes('xml') ||
      res.mimeType.includes('svg')
    ) {
      try {
        text = atob(res.dataBase64);
      } catch {
        // Fallback
      }
    }

    pending.resolve({
      fileId: res.fileId,
      offset: res.offset,
      length: res.length,
      totalSize: res.totalSize,
      mimeType: res.mimeType,
      dataBase64: res.dataBase64,
      text,
    });
  }

  /**
   * Teardown & cleanup.
   */
  cleanup(): void {
    this.localFiles.clear();
    this.remoteFiles = [];
    for (const [, req] of this.pendingSliceRequests) {
      clearTimeout(req.timer);
      req.reject(new Error('VirtualDrive closed'));
    }
    this.pendingSliceRequests.clear();
  }
}

/**
 * Helper to infer MIME type from file extension if browser provides empty type.
 */
export function inferMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
    case 'log':
      return 'text/plain';
    case 'md':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    case 'js':
    case 'mjs':
      return 'text/javascript';
    case 'ts':
      return 'text/typescript';
    case 'html':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'zip':
    case 'tar':
    case 'gz':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Checks whether a given file is previewable via on-demand slice.
 */
export function isPreviewable(mimeType: string, fileName: string): boolean {
  if (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('text/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/') ||
    mimeType === 'application/pdf' ||
    mimeType.includes('json') ||
    mimeType.includes('csv') ||
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('markdown')
  ) {
    return true;
  }
  const ext = fileName.toLowerCase().split('.').pop() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt', 'md', 'json', 'csv', 'js', 'ts', 'html', 'css', 'pdf', 'mp3', 'wav', 'mp4', 'webm'].includes(ext);
}
