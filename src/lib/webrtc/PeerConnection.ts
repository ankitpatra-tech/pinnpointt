/**
 * WebRTC PeerConnection wrapper with WebSocket-based signaling.
 *
 * Manages the full lifecycle of a peer-to-peer connection:
 *   1. Connects to the signaling server via WebSocket
 *   2. Creates or joins a room
 *   3. Negotiates SDP offer/answer
 *   4. Exchanges ICE candidates
 *   5. Establishes a reliable RTCDataChannel
 */

import { generateRoomCode } from '../crypto';
import {
  type SignalingAdapter,
  type SignalingMessage,
  type SignalingMode,
  HybridSignalingAdapter,
} from './signalingAdapter';
import { ParallelChannelPool } from './parallelChannelPool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PeerRole = 'offerer' | 'answerer';

export interface PeerEvents {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const DATA_CHANNEL_LABEL = 'pinnpointt-transfer';

// ---------------------------------------------------------------------------
// PeerManager
// ---------------------------------------------------------------------------

export class PeerManager {
  private readonly signalingUrl: string;
  private roomCode: string = '';

  private adapter: SignalingAdapter | null = null;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  public readonly channelPool: ParallelChannelPool = new ParallelChannelPool();
  public role: PeerRole | null = null;

  private dataChannelCallback: ((channel: RTCDataChannel) => void) | null = null;
  private events: PeerEvents = {};

  /** Queues ICE candidates that arrive before the remote description is set. */
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private isClosedManually = false;
  private disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(signalingUrl: string, events?: PeerEvents, adapter?: SignalingAdapter) {
    this.signalingUrl = signalingUrl;
    if (events) {
      this.events = events;
    }
    if (adapter) {
      this.adapter = adapter;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Sets or updates event callbacks. */
  setEvents(events: PeerEvents): void {
    this.events = { ...this.events, ...events };
  }

  /** Gets active signaling mode ('websocket' or 'serverless'). */
  getSignalingMode(): SignalingMode | null {
    return this.adapter?.mode ?? null;
  }

  /** Register a handler for when the data channel is established. */
  onDataChannel(callback: (channel: RTCDataChannel) => void): void {
    this.dataChannelCallback = callback;
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      callback(this.dataChannel);
    }
  }

  /** Returns the active data channel, or null if not yet established. */
  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  /** Returns the parallel multi-channel pool for high-throughput binary transfers. */
  getChannelPool(): ParallelChannelPool {
    return this.channelPool;
  }

  /** Returns the current room code. */
  getRoomCode(): string {
    return this.roomCode;
  }

  /**
   * Creates a room on the signaling adapter.
   * The caller becomes the **offerer** — they will create the SDP offer once a
   * peer joins.
   */
  createRoom(code?: string): Promise<string> {
    this.role = 'offerer';
    this.roomCode = (code || generateRoomCode()).toUpperCase();
    this.isClosedManually = false;

    return new Promise<string>((resolve, reject) => {
      this.setupSignaling(true, resolve, reject);
    });
  }

  /**
   * Joins an existing room.
   * The caller becomes the **answerer** — they will receive the SDP offer and
   * respond with an answer.
   */
  joinRoom(code: string): Promise<void> {
    this.role = 'answerer';
    this.roomCode = code.toUpperCase().trim();
    this.isClosedManually = false;

    return new Promise<void>((resolve, reject) => {
      this.setupSignaling(false, () => resolve(), reject);
    });
  }

  /** Tear down the connection and all resources. */
  close(): void {
    this.isClosedManually = true;
    this.events = {}; // Detach event callbacks to prevent error transitions on intentional closure

    if (this.disconnectGraceTimer) {
      clearTimeout(this.disconnectGraceTimer);
      this.disconnectGraceTimer = null;
    }

    this.channelPool.close();

    this.dataChannel?.close();
    this.dataChannel = null;

    this.pc?.close();
    this.pc = null;

    if (this.adapter) {
      try {
        this.adapter.close();
      } catch {}
      this.adapter = null;
    }

    this.remoteDescriptionSet = false;
    this.pendingCandidates = [];
  }

  // -----------------------------------------------------------------------
  // Signaling
  // -----------------------------------------------------------------------

  private setupSignaling(
    isCreate: boolean,
    onRoomReady: (code: string) => void,
    onFail: (err: Error) => void,
  ): void {
    if (!this.adapter) {
      this.adapter = new HybridSignalingAdapter(this.signalingUrl, {
        onMessage: (msg: SignalingMessage) => {
          this.handleSignalingMessage(msg, onRoomReady, onFail);
        },
        onError: (err: Error) => {
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            console.log('[PeerConnection] Signaling error, but P2P WebRTC DataChannel is active.');
            return;
          }
          this.events.onError?.(err);
          onFail(err);
        },
        onClose: () => {
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            console.log('[PeerConnection] Signaling closed, but P2P WebRTC DataChannel is active.');
            return;
          }
          if (!this.isClosedManually) {
            this.events.onDisconnected?.();
          }
        },
        onFallback: (reason, mode) => {
          console.log(`[PeerConnection] Hybrid signaling fallback: ${reason} (mode: ${mode})`);
        },
      });
    }

    this.adapter
      .connect(this.roomCode, isCreate)
      .catch((err) => {
        onFail(err instanceof Error ? err : new Error(String(err)));
      });
  }

  private handleSignalingMessage(
    msg: SignalingMessage,
    onRoomReady: (code: string) => void,
    onFail: (err: Error) => void,
  ): void {
    switch (msg.type) {
      case 'room-created':
        onRoomReady(msg.room ?? this.roomCode);
        break;

      case 'peer-joined':
        // A peer joined. If we are the offerer, start the WebRTC handshake.
        if (this.role === 'offerer') {
          this.startAsOfferer().catch((e) => {
            const err = e instanceof Error ? e : new Error(String(e));
            this.events.onError?.(err);
            onFail(err);
          });
        }
        break;

      case 'offer':
        if (this.role === 'answerer' && msg.sdp) {
          this.handleOffer(msg.sdp, onRoomReady).catch((e) => {
            const err = e instanceof Error ? e : new Error(String(e));
            this.events.onError?.(err);
            onFail(err);
          });
        }
        break;

      case 'answer':
        if (this.role === 'offerer' && msg.sdp) {
          this.handleAnswer(msg.sdp).catch((e) => {
            const err = e instanceof Error ? e : new Error(String(e));
            this.events.onError?.(err);
          });
        }
        break;

      case 'ice-candidate':
        if (msg.candidate) {
          this.addIceCandidate(msg.candidate);
        }
        break;

      case 'peer-left':
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          console.log('[PeerConnection] Signaling peer-left received, but P2P WebRTC DataChannel is still active.');
          return;
        }
        this.events.onDisconnected?.();
        break;

      case 'pong':
        // Heartbeat acknowledged by signaling relay
        break;

      case 'error': {
        const err = new Error(msg.message ?? 'Signaling error');
        this.events.onError?.(err);
        onFail(err);
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // WebRTC negotiation
  // -----------------------------------------------------------------------

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 2,
    });

    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.send({ type: 'ice-candidate', candidate: event.candidate.toJSON() });
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      switch (pc.connectionState) {
        case 'connected':
          if (this.disconnectGraceTimer) {
            clearTimeout(this.disconnectGraceTimer);
            this.disconnectGraceTimer = null;
          }
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.events.onConnected?.();
          }
          break;
        case 'disconnected':
          // Disconnected is transient in WebRTC during heavy bandwidth saturation or ICE re-checks.
          // Give ICE 5 seconds to re-verify or reconnect before triggering onDisconnected.
          if (!this.disconnectGraceTimer) {
            this.disconnectGraceTimer = setTimeout(() => {
              this.disconnectGraceTimer = null;
              if (this.pc && this.pc.connectionState === 'disconnected') {
                console.log('[PeerConnection] Connection remained disconnected after grace period');
                this.events.onDisconnected?.();
              }
            }, 5000);
          }
          break;
        case 'failed':
        case 'closed':
          if (this.disconnectGraceTimer) {
            clearTimeout(this.disconnectGraceTimer);
            this.disconnectGraceTimer = null;
          }
          this.events.onDisconnected?.();
          break;
      }
    });

    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed') {
        this.events.onError?.(new Error('ICE connection failed'));
      }
    });

    // Initialize 4 negotiated binary data channels (pinnpointt-data-0..3)
    this.channelPool.initNegotiated(pc);

    // Also register any incoming data channel that matches the parallel pool prefix
    pc.addEventListener('datachannel', (event) => {
      if (event.channel.label.startsWith('pinnpointt-data-')) {
        this.channelPool.registerChannel(event.channel);
      }
    });

    this.pc = pc;
    return pc;
  }

  /** Offerer: create data channel → create offer → send via signaling. */
  private async startAsOfferer(): Promise<void> {
    const pc = this.createPeerConnection();

    // Create the data channel (reliable, ordered).
    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.setupDataChannel(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.send({ type: 'offer', sdp: pc.localDescription!.sdp });
  }

  /** Answerer: receive offer → set remote desc → create answer → send. */
  private async handleOffer(
    sdp: string,
    onReady: (code: string) => void,
  ): Promise<void> {
    const pc = this.createPeerConnection();

    // Listen for the primary data channel the offerer created.
    pc.addEventListener('datachannel', (event) => {
      if (event.channel.label === DATA_CHANNEL_LABEL) {
        this.setupDataChannel(event.channel);
        onReady(this.roomCode);
      }
    });

    await pc.setRemoteDescription({ type: 'offer', sdp });
    this.remoteDescriptionSet = true;

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.flushPendingCandidates();

    this.send({ type: 'answer', sdp: pc.localDescription!.sdp });
  }

  /** Offerer: receive the answer and set it as remote description. */
  private async handleAnswer(sdp: string): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    this.remoteDescriptionSet = true;
    this.flushPendingCandidates();
  }

  // -----------------------------------------------------------------------
  // ICE candidates
  // -----------------------------------------------------------------------

  private addIceCandidate(candidate: RTCIceCandidateInit): void {
    if (!this.pc || !this.remoteDescriptionSet || (this.role === 'answerer' && !this.pc.localDescription)) {
      this.pendingCandidates.push(candidate);
      return;
    }
    this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {
      // Non-fatal — candidate may arrive for an already-completed negotiation.
    });
  }

  private flushPendingCandidates(): void {
    for (const c of this.pendingCandidates) {
      this.pc?.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    this.pendingCandidates = [];
  }

  // -----------------------------------------------------------------------
  // Data channel
  // -----------------------------------------------------------------------

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';

    dc.addEventListener('open', () => {
      this.dataChannel = dc;
      this.events.onConnected?.();
      this.dataChannelCallback?.(dc);
    });

    dc.addEventListener('close', () => {
      console.log('[PeerConnection] RTCDataChannel closed');
      this.dataChannel = null;
      if (!this.isClosedManually) {
        this.events.onDisconnected?.();
      }
    });

    dc.addEventListener('error', (event) => {
      const errorEvent = event as RTCErrorEvent;
      this.events.onError?.(
        errorEvent.error instanceof Error
          ? errorEvent.error
          : new Error('Data channel error'),
      );
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private send(msg: SignalingMessage): void {
    if (this.adapter) {
      this.adapter.send(msg);
    }
  }
}
