/**
 * Transfer State Machine & Pause/Resume/Cancel Controller for PinnPointt.
 *
 * States:
 *   - queued: Transfer created and waiting in queue
 *   - transferring: Active transmission of chunks over DataChannel
 *   - paused_by_sender: Sender paused reading further slices
 *   - paused_by_receiver: Receiver paused transmission
 *   - resuming: Resume synchronization handshake in progress
 *   - completed: All chunks received, verified on disk, and finalized
 *   - cancelled: Transfer explicitly stopped and partial disk temp deleted
 *   - interrupted: Transport/connection dropped mid-flight
 *
 * Checkpoint & Resume:
 *   - Receiver tracks writtenChunkIndices (Set<number>) and lastConfirmedChunkIndex
 *   - On Resume, receiver sends TRANSFER_RESUME_SYNC with the exact lowest unwritten chunk index
 *   - Sender immediately resumes reading from nextChunkIndex * CHUNK_SIZE without re-sending
 *     previously verified bytes.
 */

export type TransferState =
  | 'queued'
  | 'transferring'
  | 'paused_by_sender'
  | 'paused_by_receiver'
  | 'resuming'
  | 'completed'
  | 'cancelled'
  | 'interrupted';

export type TransferRole = 'sender' | 'receiver';

export interface TransferPauseMessage {
  type: 'TRANSFER_PAUSE';
  fileId: string;
  pausedBy: 'sender' | 'receiver';
}

export interface TransferResumeReqMessage {
  type: 'TRANSFER_RESUME_REQ';
  fileId: string;
  requestedBy: 'sender' | 'receiver';
}

export interface TransferResumeSyncMessage {
  type: 'TRANSFER_RESUME_SYNC';
  fileId: string;
  nextChunkIndex: number;
}

export interface TransferCancelMessage {
  type: 'TRANSFER_CANCEL';
  fileId: string;
  cancelledBy: 'sender' | 'receiver';
}

export type TransferControlMessage =
  | TransferPauseMessage
  | TransferResumeReqMessage
  | TransferResumeSyncMessage
  | TransferCancelMessage;

export function isTransferControlMessage(msg: unknown): msg is TransferControlMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === 'string' &&
    typeof m.fileId === 'string' &&
    (m.type === 'TRANSFER_PAUSE' ||
      m.type === 'TRANSFER_RESUME_REQ' ||
      m.type === 'TRANSFER_RESUME_SYNC' ||
      m.type === 'TRANSFER_CANCEL')
  );
}

export type StateChangeCallback = (
  state: TransferState,
  details?: { by?: 'sender' | 'receiver'; reason?: string },
) => void;

export class TransferController {
  public readonly fileId: string;
  public readonly role: TransferRole;
  public totalChunks: number;

  private state: TransferState = 'queued';
  private writtenChunks = new Set<number>();
  private lastConfirmedChunkIndex = -1;
  private nextResumeChunkIndex = 0;

  private resumeWaiters: Array<() => void> = [];
  private stateListeners = new Set<StateChangeCallback>();
  private sendControlMessage: ((msg: TransferControlMessage) => void) | null = null;

  constructor(
    fileId: string,
    role: TransferRole,
    totalChunks: number = 0,
    sendControl?: (msg: TransferControlMessage) => void,
  ) {
    this.fileId = fileId;
    this.role = role;
    this.totalChunks = totalChunks;
    if (sendControl) {
      this.sendControlMessage = sendControl;
    }
  }

  setSendControl(fn: (msg: TransferControlMessage) => void): void {
    this.sendControlMessage = fn;
  }

  getState(): TransferState {
    return this.state;
  }

  isPaused(): boolean {
    return this.state === 'paused_by_sender' || this.state === 'paused_by_receiver';
  }

  isCancelled(): boolean {
    return this.state === 'cancelled';
  }

  isCompleted(): boolean {
    return this.state === 'completed';
  }

  start(): void {
    if (this.state === 'queued') {
      this.transition('transferring');
    }
  }

  /**
   * Records a chunk written to disk on the receiver side.
   * Updates contiguous lastConfirmedChunkIndex.
   */
  markChunkWritten(chunkIndex: number): void {
    this.writtenChunks.add(chunkIndex);
    while (this.writtenChunks.has(this.lastConfirmedChunkIndex + 1)) {
      this.lastConfirmedChunkIndex++;
    }
  }

  /**
   * Returns the exact lowest unwritten chunk index on disk.
   */
  getNextUnwrittenChunkIndex(): number {
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.writtenChunks.has(i)) {
        return i;
      }
    }
    return this.totalChunks;
  }

  getLastConfirmedChunkIndex(): number {
    return this.lastConfirmedChunkIndex;
  }

  getWrittenChunksCount(): number {
    return this.writtenChunks.size;
  }

  getNextResumeChunkIndex(): number {
    return this.nextResumeChunkIndex;
  }

  setNextResumeChunkIndex(index: number): void {
    this.nextResumeChunkIndex = index;
  }

  /**
   * Halts reading/sending further chunks while keeping disk handles intact.
   */
  pause(bySelf = true, remoteBy?: 'sender' | 'receiver'): void {
    if (this.isPaused() || this.isCancelled() || this.isCompleted()) return;

    const pausedBy: 'sender' | 'receiver' = bySelf
      ? this.role
      : (remoteBy || (this.role === 'sender' ? 'receiver' : 'sender'));

    const newState: TransferState =
      pausedBy === 'sender' ? 'paused_by_sender' : 'paused_by_receiver';

    this.transition(newState, { by: pausedBy });

    if (bySelf && this.sendControlMessage) {
      this.sendControlMessage({
        type: 'TRANSFER_PAUSE',
        fileId: this.fileId,
        pausedBy,
      });
    }
  }

  /**
   * Triggers byte-offset resume synchronization.
   */
  resume(bySelf = true): void {
    if (!this.isPaused() && this.state !== 'resuming') return;

    if (bySelf) {
      if (this.role === 'receiver') {
        const nextChunkIndex = this.getNextUnwrittenChunkIndex();
        this.nextResumeChunkIndex = nextChunkIndex;
        this.transition('transferring');
        this.unblockWaiters();
        if (this.sendControlMessage) {
          this.sendControlMessage({
            type: 'TRANSFER_RESUME_SYNC',
            fileId: this.fileId,
            nextChunkIndex,
          });
        }
      } else {
        // Sender requested resume: request sync from receiver
        this.transition('resuming');
        if (this.sendControlMessage) {
          this.sendControlMessage({
            type: 'TRANSFER_RESUME_REQ',
            fileId: this.fileId,
            requestedBy: 'sender',
          });
        }
      }
    }
  }

  handleResumeReq(): void {
    if (this.role === 'receiver') {
      const nextChunkIndex = this.getNextUnwrittenChunkIndex();
      this.nextResumeChunkIndex = nextChunkIndex;
      this.transition('transferring');
      this.unblockWaiters();
      if (this.sendControlMessage) {
        this.sendControlMessage({
          type: 'TRANSFER_RESUME_SYNC',
          fileId: this.fileId,
          nextChunkIndex,
        });
      }
    }
  }

  handleResumeSync(nextChunkIndex: number): void {
    this.nextResumeChunkIndex = nextChunkIndex;
    this.transition('transferring');
    this.unblockWaiters();
  }

  cancel(bySelf = true): void {
    if (this.isCancelled() || this.isCompleted()) return;

    const cancelledBy = bySelf
      ? this.role
      : (this.role === 'sender' ? 'receiver' : 'sender');

    this.transition('cancelled', { by: cancelledBy });
    this.unblockWaiters();

    if (bySelf && this.sendControlMessage) {
      this.sendControlMessage({
        type: 'TRANSFER_CANCEL',
        fileId: this.fileId,
        cancelledBy: this.role,
      });
    }
  }

  complete(): void {
    if (this.isCancelled()) return;
    this.transition('completed');
    this.unblockWaiters();
  }

  interrupt(reason?: string): void {
    if (this.isCancelled() || this.isCompleted()) return;
    this.transition('interrupted', { reason });
    this.unblockWaiters();
  }

  /**
   * Blocks execution while the transfer is paused until resumed or cancelled.
   */
  waitForResume(): Promise<void> {
    if (!this.isPaused() && this.state !== 'resuming') {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.resumeWaiters.push(resolve);
    });
  }

  private unblockWaiters(): void {
    const waiters = [...this.resumeWaiters];
    this.resumeWaiters = [];
    for (const w of waiters) {
      try {
        w();
      } catch {}
    }
  }

  onStateChange(cb: StateChangeCallback): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  private transition(
    newState: TransferState,
    details?: { by?: 'sender' | 'receiver'; reason?: string },
  ): void {
    this.state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(newState, details);
      } catch (err) {
        console.error('[TransferController] Listener error:', err);
      }
    }
  }
}

/**
 * Global manager for active transfers in the current peer connection session.
 */
export class TransferManager {
  private controllers = new Map<string, TransferController>();

  register(controller: TransferController): void {
    this.controllers.set(controller.fileId, controller);
  }

  get(fileId: string): TransferController | undefined {
    return this.controllers.get(fileId);
  }

  remove(fileId: string): void {
    this.controllers.delete(fileId);
  }

  handleControlMessage(msg: Record<string, unknown>): boolean {
    if (!isTransferControlMessage(msg)) return false;
    const controller = this.controllers.get(msg.fileId);
    if (!controller) return false;

    switch (msg.type) {
      case 'TRANSFER_PAUSE':
        controller.pause(false, msg.pausedBy);
        return true;
      case 'TRANSFER_RESUME_REQ':
        controller.handleResumeReq();
        return true;
      case 'TRANSFER_RESUME_SYNC':
        controller.handleResumeSync(msg.nextChunkIndex);
        return true;
      case 'TRANSFER_CANCEL':
        controller.cancel(false);
        return true;
      default:
        return false;
    }
  }

  clear(): void {
    for (const ctrl of this.controllers.values()) {
      ctrl.cancel(false);
    }
    this.controllers.clear();
  }
}
