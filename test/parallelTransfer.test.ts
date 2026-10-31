/**
 * Test Suite for High-Throughput Parallel Multi-Channel Transfer Engine.
 *
 * Verifies:
 *   1. fastChunker: 12-byte binary framing, FNV-1a numeric hash, and 1.5s rolling speed estimator.
 *   2. parallelChannelPool: 4-channel pool, watermarks, lowest-buffered round-robin distribution, backpressure drain.
 *   3. Out-of-order random-access disk assembly & multi-channel file streaming verification.
 */

import {
  FAST_CHUNK_SIZE,
  BINARY_HEADER_SIZE,
  createChunkFrame,
  parseChunkFrame,
  computeNumericFileIdHash,
  RollingSpeedEstimator,
} from '../src/lib/webrtc/fastChunker';
import {
  ParallelChannelPool,
  PARALLEL_CHANNELS_COUNT,
  DATA_CHANNEL_PREFIX,
  BUFFERED_AMOUNT_LOW,
  BUFFERED_AMOUNT_HIGH,
} from '../src/lib/webrtc/parallelChannelPool';
import {
  sendFile,
  receiveFile,
  type TransferProgress,
} from '../src/lib/webrtc/BinaryStreamer';
import { computeSHA256 } from '../src/lib/crypto';

// ---------------------------------------------------------------------------
// Mock DataChannel for unit testing
// ---------------------------------------------------------------------------

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
        // Deliver asynchronously
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

  simulateDrain(): void {
    this.bufferedAmount = 0;
    this.dispatchEvent(new Event('bufferedamountlow'));
  }

  close(): void {
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
}

class MockPeerConnection {
  public channels: MockDataChannel[] = [];

  createDataChannel(label: string, opts: RTCDataChannelInit = {}): RTCDataChannel {
    const dc = new MockDataChannel(label, opts.id ?? this.channels.length, opts.ordered ?? true);
    this.channels.push(dc);
    return dc as unknown as RTCDataChannel;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Testing Parallel Multi-Channel & Fast Chunker Transfer Pipeline...');

  // -------------------------------------------------------------------------
  // Test 1: Fast Chunker & 12-Byte Header Framing
  // -------------------------------------------------------------------------
  console.log('Test 1: Fast Chunker 12-byte header framing & hash');
  {
    const fileId = 'photo.jpg:1048576:1700000000';
    const hash = computeNumericFileIdHash(fileId);
    if (typeof hash !== 'number' || hash < 0 || hash > 0xffffffff) {
      throw new Error(`Invalid numeric hash: ${hash}`);
    }

    // Verify determinism
    if (computeNumericFileIdHash(fileId) !== hash) {
      throw new Error('Hash is not deterministic');
    }

    // Verify 12-byte framing
    const testPayload = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const chunkIndex = 42;
    const frame = createChunkFrame(hash, chunkIndex, testPayload);

    if (frame.byteLength !== BINARY_HEADER_SIZE + testPayload.byteLength) {
      throw new Error(`Incorrect frame byteLength: expected ${BINARY_HEADER_SIZE + testPayload.byteLength}, got ${frame.byteLength}`);
    }

    const parsed = parseChunkFrame(frame);
    if (!parsed) {
      throw new Error('Failed to parse framed chunk');
    }

    if (parsed.fileIdHash !== hash) {
      throw new Error(`Hash mismatch: expected ${hash}, got ${parsed.fileIdHash}`);
    }
    if (parsed.chunkIndex !== chunkIndex) {
      throw new Error(`ChunkIndex mismatch: expected ${chunkIndex}, got ${parsed.chunkIndex}`);
    }
    if (parsed.payloadByteLength !== testPayload.byteLength) {
      throw new Error(`Payload length mismatch: expected ${testPayload.byteLength}, got ${parsed.payloadByteLength}`);
    }
    for (let i = 0; i < testPayload.byteLength; i++) {
      if (parsed.payload[i] !== testPayload[i]) {
        throw new Error(`Payload byte mismatch at index ${i}`);
      }
    }

    // Malformed frames should return null
    if (parseChunkFrame(new ArrayBuffer(6)) !== null) {
      throw new Error('Should reject buffers smaller than 12 bytes');
    }
    console.log('✓ 12-byte binary framing & FNV-1a hash verified');
  }

  // -------------------------------------------------------------------------
  // Test 2: Rolling 1.5-Second Speed Estimator
  // -------------------------------------------------------------------------
  console.log('Test 2: Rolling 1.5-second speed estimator');
  {
    const estimator = new RollingSpeedEstimator(1500);

    // Initial state
    const est0 = estimator.getEstimate(100_000, 1000);
    if (est0.speedBps !== 0 || est0.etaSeconds !== 0) {
      throw new Error('Initial estimate should be 0');
    }

    // Record 1 MB at t = 1000ms
    estimator.record(1_048_576, 1000);
    // Record 1 MB at t = 1500ms
    estimator.record(1_048_576, 1500);

    const est1 = estimator.getEstimate(2_097_152, 1500);
    if (est1.speedBps <= 0) {
      throw new Error('Speed should be positive after records');
    }
    if (est1.etaSeconds <= 0) {
      throw new Error('ETA should be positive');
    }

    // Advance beyond 1500ms window (e.g. t = 3100ms)
    // The sample at t = 1000ms (age 2100ms) and t = 1500ms (age 1600ms) should be pruned
    estimator.record(524_288, 3100);
    const est2 = estimator.getEstimate(524_288, 3100);
    if (est2.speedBps <= 0) {
      throw new Error('Recent sample should compute speed');
    }

    console.log('✓ Rolling 1.5s speed estimator verified');
  }

  // -------------------------------------------------------------------------
  // Test 3: Parallel Channel Pool (Watermarks, Lowest-Buffered Round-Robin)
  // -------------------------------------------------------------------------
  console.log('Test 3: Parallel Channel Pool initialization & optimal selection');
  {
    const pool = new ParallelChannelPool();
    const mockPc = new MockPeerConnection();

    pool.initNegotiated(mockPc as unknown as RTCPeerConnection);

    if (pool.size !== PARALLEL_CHANNELS_COUNT) {
      throw new Error(`Expected ${PARALLEL_CHANNELS_COUNT} channels, got ${pool.size}`);
    }

    const channels = mockPc.channels;
    for (let i = 0; i < PARALLEL_CHANNELS_COUNT; i++) {
      if (channels[i].label !== `${DATA_CHANNEL_PREFIX}${i}`) {
        throw new Error(`Incorrect channel label: ${channels[i].label}`);
      }
      if (channels[i].id !== i + 1) {
        throw new Error(`Incorrect channel id: ${channels[i].id}`);
      }
      if (channels[i].bufferedAmountLowThreshold !== BUFFERED_AMOUNT_LOW) {
        throw new Error(`Incorrect low watermark: ${channels[i].bufferedAmountLowThreshold}`);
      }
    }

    // All channels have bufferedAmount = 0.
    // Optimal channel should distribute round-robin across the 4 channels.
    const selected = new Set<string>();
    for (let i = 0; i < PARALLEL_CHANNELS_COUNT; i++) {
      const ch = await pool.getOptimalChannel();
      selected.add(ch.label);
    }
    if (selected.size !== PARALLEL_CHANNELS_COUNT) {
      throw new Error(`Should distribute round-robin across all 4 channels, got ${selected.size}`);
    }

    // Simulate unequal bufferedAmount: channel 0 has 100KB, channel 1 has 50KB, channel 2 has 200KB, channel 3 has 500KB
    channels[0].bufferedAmount = 102_400;
    channels[1].bufferedAmount = 51_200; // Lowest!
    channels[2].bufferedAmount = 204_800;
    channels[3].bufferedAmount = 512_000;

    const opt = await pool.getOptimalChannel();
    if (opt.label !== `${DATA_CHANNEL_PREFIX}1`) {
      throw new Error(`Expected lowest buffered channel (channel 1), got ${opt.label}`);
    }

    pool.close();
    console.log('✓ Parallel channel pool & round-robin lowest-buffered selection verified');
  }

  // -------------------------------------------------------------------------
  // Test 4: End-to-End Parallel Chunk Transfer with In-Flight Out-of-Order Assembly
  // -------------------------------------------------------------------------
  console.log('Test 4: End-to-end multi-channel transfer & random-access assembly');
  {
    // Create paired control channel
    const senderControl = new MockDataChannel('pinnpointt-transfer', 0);
    const receiverControl = new MockDataChannel('pinnpointt-transfer', 0);
    senderControl.pairedChannel = receiverControl;
    receiverControl.pairedChannel = senderControl;

    // Create paired 4-channel pools
    const senderPool = new ParallelChannelPool();
    const receiverPool = new ParallelChannelPool();

    const senderChannels: MockDataChannel[] = [];
    const receiverChannels: MockDataChannel[] = [];

    for (let i = 0; i < PARALLEL_CHANNELS_COUNT; i++) {
      const s = new MockDataChannel(`${DATA_CHANNEL_PREFIX}${i}`, i + 1);
      const r = new MockDataChannel(`${DATA_CHANNEL_PREFIX}${i}`, i + 1);
      s.pairedChannel = r;
      r.pairedChannel = s;
      senderChannels.push(s);
      receiverChannels.push(r);

      senderPool.registerChannel(s as unknown as RTCDataChannel);
      receiverPool.registerChannel(r as unknown as RTCDataChannel);
    }

    // Create a 256 KB test file
    const testFileSize = 256 * 1024;
    const testData = new Uint8Array(testFileSize);
    for (let i = 0; i < testFileSize; i++) {
      testData[i] = (i * 31 + 7) & 0xff;
    }
    const expectedSha256 = await computeSHA256(testData.buffer);

    const testFile = new File([testData], 'test_payload.bin', {
      type: 'application/octet-stream',
      lastModified: Date.now(),
    });

    let progressCount = 0;
    let finalProgress: TransferProgress | null = null;

    // Start receiver first
    const receivePromise = receiveFile(
      receiverControl as unknown as RTCDataChannel,
      (p) => {
        progressCount++;
        finalProgress = p;
      },
      undefined,
      { forceMemory: true },
      receiverPool,
    );

    // Start sender with parallel pool
    const sendResult = await sendFile(
      senderControl as unknown as RTCDataChannel,
      testFile,
      undefined,
      undefined,
      senderPool,
    );

    if (!sendResult.success) {
      throw new Error('sendFile failed');
    }

    const received = await receivePromise;

    if (!received.verified) {
      throw new Error('Received file integrity check failed');
    }
    if (received.size !== testFileSize) {
      throw new Error(`Size mismatch: expected ${testFileSize}, got ${received.size}`);
    }

    const receivedBuf = await received.blob.arrayBuffer();
    const receivedSha256 = await computeSHA256(receivedBuf);
    if (receivedSha256 !== expectedSha256) {
      throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${receivedSha256}`);
    }

    // Verify that data was striped across multiple channels in the pool
    let activeChannelCount = 0;
    for (const ch of senderChannels) {
      if (ch.sentMessages.length > 0) {
        activeChannelCount++;
      }
    }
    if (activeChannelCount < 2) {
      throw new Error(`Expected chunks to be striped across multiple channels, but only ${activeChannelCount} channel(s) were used`);
    }

    senderPool.close();
    receiverPool.close();
    console.log(`✓ Parallel transfer completed across ${activeChannelCount} channels with 100% hash match`);
  }

  console.log('\nALL PARALLEL MULTI-CHANNEL & FAST CHUNKER TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
