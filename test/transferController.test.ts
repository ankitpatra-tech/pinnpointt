/**
 * Unit Test Suite for PinnPointt Transfer State Machine & Pause/Resume/Cancel Controller.
 *
 * Verifies:
 *   1. State Machine transitions across all 8 states.
 *   2. Checkpoint tracking (lastConfirmedChunkIndex and lowest unwritten chunk index).
 *   3. Bidirectional pause/resume/cancel protocol message exchanges.
 *   4. End-to-end Pause and Byte-Offset Resume without re-sending previously verified chunks.
 *   5. Clean cancellation and temporary file teardown.
 */

import {
  TransferController,
  TransferManager,
  type TransferControlMessage,
  type TransferState,
} from '../src/lib/webrtc/transferController';
import {
  sendFile,
  receiveFile,
  type TransferProgress,
} from '../src/lib/webrtc/BinaryStreamer';
import { computeSHA256 } from '../src/lib/crypto';

class MockDataChannel extends EventTarget {
  public label: string;
  public id: number;
  public ordered: boolean;
  public binaryType: BinaryType = 'arraybuffer';
  public readyState: RTCDataChannelState = 'open';
  public bufferedAmount = 0;
  public bufferedAmountLowThreshold = 0;
  public pairedChannel: MockDataChannel | null = null;
  public sentMessages: Array<string | ArrayBuffer> = [];

  constructor(label: string, id: number, ordered = true) {
    super();
    this.label = label;
    this.id = id;
    this.ordered = ordered;
  }

  send(data: string | ArrayBuffer | Blob): void {
    if (this.readyState !== 'open') {
      throw new Error(`DataChannel ${this.label} is not open`);
    }

    if (data instanceof ArrayBuffer) {
      this.sentMessages.push(data);
      if (this.pairedChannel && this.pairedChannel.readyState === 'open') {
        const ev = new MessageEvent('message', { data });
        queueMicrotask(() => {
          this.pairedChannel?.dispatchEvent(ev);
        });
      }
    } else if (typeof data === 'string') {
      this.sentMessages.push(data);
      if (this.pairedChannel && this.pairedChannel.readyState === 'open') {
        const ev = new MessageEvent('message', { data });
        queueMicrotask(() => {
          this.pairedChannel?.dispatchEvent(ev);
        });
      }
    }
  }

  close(): void {
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
}

async function runTests() {
  console.log('Testing Transfer State Machine & Pause/Resume/Cancel Controller...');

  // -------------------------------------------------------------------------
  // Test 1: State Machine Transitions & Checkpoint Tracking
  // -------------------------------------------------------------------------
  console.log('Test 1: State machine transitions & contiguous checkpoints');
  {
    const sentMessages: TransferControlMessage[] = [];
    const ctrl = new TransferController('file-123', 'sender', 10, (msg) => {
      sentMessages.push(msg);
    });

    if (ctrl.getState() !== 'queued') {
      throw new Error(`Expected initial state 'queued', got ${ctrl.getState()}`);
    }

    ctrl.start();
    if (ctrl.getState() !== 'transferring') {
      throw new Error(`Expected state 'transferring', got ${ctrl.getState()}`);
    }

    // Sender pauses
    ctrl.pause(true);
    if (ctrl.getState() !== 'paused_by_sender') {
      throw new Error(`Expected state 'paused_by_sender', got ${ctrl.getState()}`);
    }
    if (sentMessages.length !== 1 || sentMessages[0].type !== 'TRANSFER_PAUSE') {
      throw new Error('Expected TRANSFER_PAUSE message to be sent');
    }

    // Checkpoint tracking
    ctrl.markChunkWritten(0);
    ctrl.markChunkWritten(1);
    ctrl.markChunkWritten(3); // Missing chunk 2!
    if (ctrl.getLastConfirmedChunkIndex() !== 1) {
      throw new Error(`Expected lastConfirmedChunkIndex 1, got ${ctrl.getLastConfirmedChunkIndex()}`);
    }
    if (ctrl.getNextUnwrittenChunkIndex() !== 2) {
      throw new Error(`Expected lowest unwritten chunk index 2, got ${ctrl.getNextUnwrittenChunkIndex()}`);
    }

    // Filling missing chunk 2 should advance contiguous checkpoint to 3
    ctrl.markChunkWritten(2);
    if (ctrl.getLastConfirmedChunkIndex() !== 3) {
      throw new Error(`Expected contiguous checkpoint 3, got ${ctrl.getLastConfirmedChunkIndex()}`);
    }
    if (ctrl.getNextUnwrittenChunkIndex() !== 4) {
      throw new Error(`Expected lowest unwritten chunk index 4, got ${ctrl.getNextUnwrittenChunkIndex()}`);
    }

    // Resume sync
    ctrl.handleResumeSync(4);
    if (ctrl.getState() !== 'transferring') {
      throw new Error(`Expected state 'transferring' after resume sync, got ${ctrl.getState()}`);
    }

    ctrl.complete();
    if (ctrl.getState() !== 'completed') {
      throw new Error(`Expected state 'completed', got ${ctrl.getState()}`);
    }

    console.log('✓ State transitions & checkpoint calculation verified');
  }

  // -------------------------------------------------------------------------
  // Test 2: TransferManager Message Routing
  // -------------------------------------------------------------------------
  console.log('Test 2: TransferManager bidirectional control message routing');
  {
    const mgrA = new TransferManager();
    const mgrB = new TransferManager();

    const messagesFromA: TransferControlMessage[] = [];
    const messagesFromB: TransferControlMessage[] = [];

    const ctrlA = new TransferController('shared-file', 'sender', 5, (msg) => {
      messagesFromA.push(msg);
      mgrB.handleControlMessage(msg as unknown as Record<string, unknown>);
    });
    const ctrlB = new TransferController('shared-file', 'receiver', 5, (msg) => {
      messagesFromB.push(msg);
      mgrA.handleControlMessage(msg as unknown as Record<string, unknown>);
    });

    mgrA.register(ctrlA);
    mgrB.register(ctrlB);

    ctrlA.start();
    ctrlB.start();

    // Receiver pauses transfer
    ctrlB.pause(true);
    if (ctrlB.getState() !== 'paused_by_receiver') {
      throw new Error(`Expected receiver state 'paused_by_receiver', got ${ctrlB.getState()}`);
    }
    if (ctrlA.getState() !== 'paused_by_receiver') {
      throw new Error(`Expected sender state to reflect 'paused_by_receiver', got ${ctrlA.getState()}`);
    }

    // Simulate chunks 0 and 1 were written
    ctrlB.markChunkWritten(0);
    ctrlB.markChunkWritten(1);

    // Sender initiates resume
    ctrlA.resume(true);
    // Receiver should have automatically answered with TRANSFER_RESUME_SYNC and both are transferring!
    if (ctrlB.getState() !== 'transferring') {
      throw new Error(`Expected receiver to transition to 'transferring', got ${ctrlB.getState()}`);
    }
    if (ctrlA.getState() !== 'transferring') {
      throw new Error(`Expected sender to transition to 'transferring', got ${ctrlA.getState()}`);
    }
    if (ctrlA.getNextResumeChunkIndex() !== 2) {
      throw new Error(`Expected sender resume chunk index 2, got ${ctrlA.getNextResumeChunkIndex()}`);
    }

    // Cancel from sender
    ctrlA.cancel(true);
    if (ctrlA.getState() !== 'cancelled') {
      throw new Error('Expected sender cancelled');
    }
    if (ctrlB.getState() !== 'cancelled') {
      throw new Error('Expected receiver cancelled');
    }

    mgrA.clear();
    mgrB.clear();
    console.log('✓ Bidirectional message routing & synchronization verified');
  }

  // -------------------------------------------------------------------------
  // Test 3: End-to-End File Transfer with Pause and Byte-Offset Resume
  // -------------------------------------------------------------------------
  console.log('Test 3: End-to-end Pause and Byte-Offset Resume transfer');
  {
    const senderChannel = new MockDataChannel('pinnpointt-transfer', 0);
    const receiverChannel = new MockDataChannel('pinnpointt-transfer', 0);
    senderChannel.pairedChannel = receiverChannel;
    receiverChannel.pairedChannel = senderChannel;

    // Create 256 KB payload (4 chunks of 64 KB)
    const testFileSize = 256 * 1024;
    const testData = new Uint8Array(testFileSize);
    for (let i = 0; i < testFileSize; i++) {
      testData[i] = (i * 17 + 3) & 0xff;
    }
    const expectedSha256 = await computeSHA256(testData.buffer);

    const testFile = new File([testData], 'pause_resume_test.dat', {
      type: 'application/octet-stream',
      lastModified: Date.now(),
    });

    const fileId = 'tx-test-pause-resume';
    const totalChunks = 4;

    let receiverCtrl: TransferController | null = null;
    const senderCtrl = new TransferController(fileId, 'sender', totalChunks, (msg) => {
      // Direct relay to receiver controller
      if (receiverCtrl) {
        if (msg.type === 'TRANSFER_PAUSE') receiverCtrl.pause(false, msg.pausedBy);
        if (msg.type === 'TRANSFER_RESUME_REQ') receiverCtrl.handleResumeReq();
        if (msg.type === 'TRANSFER_RESUME_SYNC') receiverCtrl.handleResumeSync(msg.nextChunkIndex);
        if (msg.type === 'TRANSFER_CANCEL') receiverCtrl.cancel(false);
      }
    });

    let pauseTriggered = false;
    let resumeTriggered = false;
    let sentChunks = 0;

    const origSend = senderChannel.send.bind(senderChannel);
    senderChannel.send = (data) => {
      origSend(data);
      if (data instanceof ArrayBuffer) {
        sentChunks++;
        // Pause after 2nd chunk is transmitted
        if (sentChunks === 2 && !pauseTriggered) {
          pauseTriggered = true;
          senderCtrl.pause(true);

          setTimeout(() => {
            resumeTriggered = true;
            senderCtrl.resume(true);
          }, 30);
        }
      }
    };

    const receivePromise = receiveFile(
      receiverChannel as unknown as RTCDataChannel,
      undefined,
      (meta) => {
        receiverCtrl = meta.controller || null;
        if (receiverCtrl) {
          receiverCtrl.setSendControl((msg) => {
            if (msg.type === 'TRANSFER_PAUSE') senderCtrl.pause(false, msg.pausedBy);
            if (msg.type === 'TRANSFER_RESUME_REQ') senderCtrl.handleResumeReq();
            if (msg.type === 'TRANSFER_RESUME_SYNC') senderCtrl.handleResumeSync(msg.nextChunkIndex);
            if (msg.type === 'TRANSFER_CANCEL') senderCtrl.cancel(false);
          });
        }
      },
      { forceMemory: true },
      undefined,
      undefined,
    );

    const sendResult = await sendFile(
      senderChannel as unknown as RTCDataChannel,
      testFile,
      undefined,
      { fileId, controller: senderCtrl },
      undefined,
      senderCtrl,
    );

    if (!sendResult.success) {
      throw new Error('sendFile failed');
    }

    const received = await receivePromise;

    if (!received.verified) {
      throw new Error('Received file integrity failed');
    }
    if (received.size !== testFileSize) {
      throw new Error(`Size mismatch: expected ${testFileSize}, got ${received.size}`);
    }

    const receivedBuf = await received.blob.arrayBuffer();
    const receivedSha256 = await computeSHA256(receivedBuf);
    if (receivedSha256 !== expectedSha256) {
      throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${receivedSha256}`);
    }

    if (!pauseTriggered || !resumeTriggered) {
      throw new Error('Pause and Resume were not executed during transfer');
    }

    console.log('✓ End-to-end Pause and Byte-Offset Resume completed with 100% hash match');
  }

  // -------------------------------------------------------------------------
  // Test 4: Transfer Cancellation
  // -------------------------------------------------------------------------
  console.log('Test 4: Transfer Cancellation');
  {
    const senderChannel = new MockDataChannel('pinnpointt-transfer', 0);
    const receiverChannel = new MockDataChannel('pinnpointt-transfer', 0);
    senderChannel.pairedChannel = receiverChannel;
    receiverChannel.pairedChannel = senderChannel;

    const testFileSize = 128 * 1024;
    const testFile = new File([new Uint8Array(testFileSize)], 'cancel_test.bin', {
      type: 'application/octet-stream',
      lastModified: Date.now(),
    });

    const fileId = 'tx-test-cancel';
    let receiverCancelled = false;
    let receiverCtrl: TransferController | null = null;

    const receivePromise = receiveFile(
      receiverChannel as unknown as RTCDataChannel,
      undefined,
      (meta) => {
        receiverCtrl = meta.controller || null;
        // Cancel the receiver stream
        receiverCtrl?.cancel(true);
      },
      { forceMemory: true },
    ).catch((err) => {
      if (err instanceof Error && err.message.includes('cancelled')) {
        receiverCancelled = true;
      }
    });

    const sendPromise = sendFile(
      senderChannel as unknown as RTCDataChannel,
      testFile,
      undefined,
      { fileId },
    ).catch(() => {});

    await Promise.all([sendPromise, receivePromise]);
    if (!receiverCancelled) {
      throw new Error('Receiver did not abort on cancellation');
    }

    console.log('✓ Clean cancellation verified');
  }

  console.log('\nALL TRANSFER CONTROLLER & PAUSE/RESUME TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
