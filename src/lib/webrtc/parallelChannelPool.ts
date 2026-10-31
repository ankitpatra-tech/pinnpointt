/**
 * Parallel Multi-Channel DataChannel Pool for High-Throughput WebRTC Transfers.
 *
 * Maximizes local 5GHz Wi-Fi and high-bandwidth P2P throughput (targeting 30–80+ MB/s)
 * by striping file chunks across a pool of 4 negotiated binary data channels
 * (pinnpointt-data-0 to pinnpointt-data-3).
 *
 * Watermarks:
 *   - bufferedAmountLowThreshold = 524,288 (512 KB) per channel
 *   - max high-water mark = 2,097,152 (2 MB) per channel
 *   - Chunks are distributed round-robin across whichever channel has the lowest bufferedAmount.
 */

export const PARALLEL_CHANNELS_COUNT = 4;
export const DATA_CHANNEL_PREFIX = 'pinnpointt-data-';
export const BUFFERED_AMOUNT_LOW = 524_288; // 512 KB
export const BUFFERED_AMOUNT_HIGH = 2_097_152; // 2 MB

export type PoolMessageListener = (data: ArrayBuffer, channel: RTCDataChannel) => void;

export class ParallelChannelPool {
  private channels: RTCDataChannel[] = [];
  private roundRobinIndex = 0;
  private messageListeners = new Set<PoolMessageListener>();
  private drainWaiters = new Set<() => void>();
  private openWaiters = new Set<() => void>();
  private isDestroyed = false;

  constructor() {}

  /**
   * Initializes 4 negotiated data channels directly on an RTCPeerConnection.
   * Because `negotiated: true` with IDs 1..4 is used on both peers, SCTP binds
   * them symmetrically without requiring extra DCEP round-trips.
   */
  initNegotiated(pc: RTCPeerConnection): void {
    if (this.isDestroyed) return;

    for (let i = 0; i < PARALLEL_CHANNELS_COUNT; i++) {
      const label = `${DATA_CHANNEL_PREFIX}${i}`;
      // Check if already created or registered
      if (this.channels.some((c) => c.label === label)) {
        continue;
      }

      try {
        const dc = pc.createDataChannel(label, {
          negotiated: true,
          id: i + 1,
          ordered: true,
        });
        this.setupChannel(dc);
      } catch (err) {
        console.warn(`[ParallelChannelPool] Failed to create negotiated channel ${label}:`, err);
      }
    }
  }

  /**
   * Registers an externally-created or incoming in-band channel (e.g. from datachannel event).
   */
  registerChannel(channel: RTCDataChannel): void {
    if (this.isDestroyed) return;
    if (this.channels.some((c) => c === channel || c.label === channel.label)) {
      return;
    }
    this.setupChannel(channel);
  }

  private setupChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

    const onOpen = (): void => {
      this.notifyOpen();
    };

    const onClose = (): void => {
      this.removeChannel(dc);
    };

    const onError = (ev: Event): void => {
      const errEv = ev as RTCErrorEvent;
      console.warn(`[ParallelChannelPool] Channel ${dc.label} error:`, errEv.error || ev);
    };

    const onLow = (): void => {
      this.notifyDrain();
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.data instanceof ArrayBuffer) {
        this.dispatchMessage(event.data, dc);
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => {
          this.dispatchMessage(buf, dc);
        }).catch(() => {});
      }
    };

    dc.addEventListener('open', onOpen);
    dc.addEventListener('close', onClose);
    dc.addEventListener('error', onError);
    dc.addEventListener('bufferedamountlow', onLow);
    dc.addEventListener('message', onMessage);

    this.channels.push(dc);

    if (dc.readyState === 'open') {
      this.notifyOpen();
    }
  }

  private removeChannel(dc: RTCDataChannel): void {
    const idx = this.channels.indexOf(dc);
    if (idx !== -1) {
      this.channels.splice(idx, 1);
    }
  }

  private notifyDrain(): void {
    if (this.drainWaiters.size === 0) return;
    const waiters = Array.from(this.drainWaiters);
    this.drainWaiters.clear();
    for (const w of waiters) {
      w();
    }
  }

  private notifyOpen(): void {
    if (this.openWaiters.size === 0) return;
    const waiters = Array.from(this.openWaiters);
    this.openWaiters.clear();
    for (const w of waiters) {
      w();
    }
  }

  private dispatchMessage(data: ArrayBuffer, channel: RTCDataChannel): void {
    for (const listener of this.messageListeners) {
      try {
        listener(data, channel);
      } catch (err) {
        console.error('[ParallelChannelPool] Listener error:', err);
      }
    }
  }

  /**
   * Returns all channels in the pool that are currently open.
   */
  getOpenChannels(): RTCDataChannel[] {
    return this.channels.filter((c) => c.readyState === 'open');
  }

  /**
   * Total number of registered channels in any state.
   */
  get size(): number {
    return this.channels.length;
  }

  /**
   * Returns true if at least one channel in the pool is in 'open' state.
   */
  isReady(): boolean {
    return this.getOpenChannels().length > 0;
  }

  /**
   * Waits until at least `minChannels` (default 1) in the pool are in 'open' state.
   */
  async waitForReady(minChannels = 1, timeoutMs = 10_000): Promise<boolean> {
    const startTime = performance.now();
    while (!this.isDestroyed && performance.now() - startTime < timeoutMs) {
      if (this.getOpenChannels().length >= minChannels) {
        return true;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.openWaiters.add(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.getOpenChannels().length >= minChannels;
  }

  /**
   * Selects the optimal channel to transmit the next chunk.
   *
   * Distribution Algorithm:
   * 1. Check open channels whose bufferedAmount <= BUFFERED_AMOUNT_HIGH (2 MB).
   * 2. If all open channels are above the high watermark, wait for a drain event.
   * 3. Among eligible channels, select the one with the lowest bufferedAmount.
   * 4. When multiple channels share the lowest bufferedAmount (e.g. 0), distribute round-robin.
   */
  async getOptimalChannel(): Promise<RTCDataChannel> {
    while (!this.isDestroyed) {
      const open = this.getOpenChannels();
      if (open.length === 0) {
        const ready = await this.waitForReady(1, 1000);
        if (!ready) {
          throw new Error('No open data channels available in parallel pool');
        }
        continue;
      }

      // Filter to channels with available buffer capacity
      const eligible = open.filter((c) => c.bufferedAmount <= BUFFERED_AMOUNT_HIGH);

      if (eligible.length === 0) {
        // All channels saturated (> 2 MB) - pause and wait for drain
        await this.waitForDrain();
        continue;
      }

      // Find the minimum bufferedAmount among eligible channels
      let minBuffered = Infinity;
      for (const c of eligible) {
        if (c.bufferedAmount < minBuffered) {
          minBuffered = c.bufferedAmount;
        }
      }

      // Find all channels matching the lowest bufferedAmount
      const candidates = eligible.filter((c) => c.bufferedAmount === minBuffered);

      // Distribute round-robin among candidates with lowest bufferedAmount
      this.roundRobinIndex = (this.roundRobinIndex + 1) % candidates.length;
      return candidates[this.roundRobinIndex];
    }

    throw new Error('ParallelChannelPool was closed');
  }

  /**
   * Waits until at least one channel drops below BUFFERED_AMOUNT_LOW (512 KB).
   */
  waitForDrain(timeoutMs = 5000): Promise<void> {
    const open = this.getOpenChannels();
    // If any open channel is already <= BUFFERED_AMOUNT_LOW, proceed immediately
    if (open.some((c) => c.bufferedAmount <= BUFFERED_AMOUNT_LOW)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        this.drainWaiters.delete(onDrain);
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };

      const onDrain = () => {
        cleanup();
        resolve();
      };

      this.drainWaiters.add(onDrain);

      pollTimer = setInterval(() => {
        const currentOpen = this.getOpenChannels();
        if (currentOpen.length === 0 && this.channels.length > 0) {
          cleanup();
          reject(new Error('All channels in pool closed while waiting for buffer drain'));
          return;
        }
        if (currentOpen.some((c) => c.bufferedAmount <= BUFFERED_AMOUNT_LOW)) {
          cleanup();
          resolve();
        }
      }, 15);

      timeoutTimer = setTimeout(() => {
        cleanup();
        resolve(); // Continue on timeout to avoid permanent stall
      }, timeoutMs);
    });
  }

  /**
   * Registers a callback for incoming binary payloads received on ANY channel in the pool.
   * Returns an unsubscribe function.
   */
  onMessage(listener: PoolMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  /**
   * Closes all channels in the pool and removes listeners.
   */
  close(): void {
    this.isDestroyed = true;
    this.messageListeners.clear();
    this.drainWaiters.clear();
    this.openWaiters.clear();

    for (const dc of this.channels) {
      try {
        dc.close();
      } catch {}
    }
    this.channels = [];
  }
}
