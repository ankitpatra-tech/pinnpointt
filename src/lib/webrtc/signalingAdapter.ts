/**
 * Hybrid & Serverless Signaling Adapter for PinnPointt.
 *
 * Provides a clean abstraction layer for WebRTC signaling:
 * 1. Primary: Direct high-speed WebSocket relay.
 * 2. Fallback: 100% Serverless P2P signaling via Nostr relays using Trystero
 *    (derived deterministically from room code, e.g. `pinnpointt-v1-${roomCode}`).
 *
 * Automatically falls back to serverless mode if the WebSocket signaling server
 * does not respond within 2,500ms (preventing backend cold-start blockages).
 */

import { joinRoom } from 'trystero/nostr';

export type SignalingMode = 'websocket' | 'serverless';

export interface SignalingMessage {
  type: string;
  room?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  message?: string;
}

export interface SignalingAdapterEvents {
  onOpen?: () => void;
  onMessage?: (msg: SignalingMessage) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
  onFallback?: (reason: string, mode: SignalingMode) => void;
}

export interface SignalingAdapter {
  readonly mode: SignalingMode;
  connect(roomCode: string, isCreate: boolean): Promise<void>;
  send(msg: SignalingMessage): void;
  close(): void;
}

const APP_NAMESPACE = 'pinnpointt-v1';
const FALLBACK_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// 1. WebSocket Signaling Adapter
// ---------------------------------------------------------------------------

export class WebSocketSignalingAdapter implements SignalingAdapter {
  readonly mode: SignalingMode = 'websocket';
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosedManually = false;
  private activeRoomCode = '';
  private isCreateAction = false;

  constructor(
    private readonly url: string,
    private readonly events: SignalingAdapterEvents,
  ) {}

  connect(roomCode: string, isCreate: boolean): Promise<void> {
    this.isClosedManually = false;
    this.activeRoomCode = roomCode;
    this.isCreateAction = isCreate;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;

        const onOpen = () => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onError);

          // Client heartbeat ping every 20s
          if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.send({ type: 'ping' });
            }
          }, 20_000);

          this.events.onOpen?.();
          this.send({ type: isCreate ? 'create' : 'join', room: roomCode });
          resolve();
        };

        const onError = (e: Event) => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onError);
          const err = new Error(`WebSocket connection to ${this.url} failed`);
          this.events.onError?.(err);
          reject(err);
        };

        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);

        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string) as SignalingMessage;
            if (msg.type !== 'pong') {
              this.events.onMessage?.(msg);
            }
          } catch {
            // ignore non-JSON messages
          }
        });

        ws.addEventListener('close', () => {
          if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
          }
          if (!this.isClosedManually) {
            this.events.onClose?.();
            // Automatically attempt reconnect after 1.5s if not manually closed
            if (!this.reconnectTimer) {
              this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                if (!this.isClosedManually && this.activeRoomCode) {
                  console.log(`[WebSocketSignaling] Auto-reconnecting to ${this.url}...`);
                  this.connect(this.activeRoomCode, this.isCreateAction).catch(() => {});
                }
              }, 1500);
            }
          }
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  send(msg: SignalingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.isClosedManually = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// 2. Serverless Nostr P2P Signaling Adapter
// ---------------------------------------------------------------------------

export class ServerlessSignalingAdapter implements SignalingAdapter {
  readonly mode: SignalingMode = 'serverless';
  private room: ReturnType<typeof joinRoom> | null = null;
  private action: any = null;
  private isClosedManually = false;
  private roomCode = '';
  private isCreate = false;
  private hasOffered = false;

  constructor(private readonly events: SignalingAdapterEvents) {}

  async connect(roomCode: string, isCreate: boolean): Promise<void> {
    this.isClosedManually = false;
    this.roomCode = roomCode.toUpperCase().trim();
    this.isCreate = isCreate;
    this.hasOffered = false;

    // Deterministic room identifier scoped to PinnPointt v1
    const deterministicRoomId = `${APP_NAMESPACE}-${this.roomCode}`;

    try {
      const room = joinRoom({ appId: APP_NAMESPACE }, deterministicRoomId);
      this.room = room;

      const action = room.makeAction('pinnpointt_signal', {
        onMessage: (data: unknown) => {
          if (!data || typeof data !== 'object') return;
          const msg = data as SignalingMessage;

          if (this.isCreate && msg.type === 'peer-announce') {
            if (!this.hasOffered) {
              this.hasOffered = true;
              this.events.onMessage?.({ type: 'peer-joined', room: this.roomCode });
            }
            return;
          }

          this.events.onMessage?.(msg);
        },
      });
      this.action = action;

      // Handle peer presence
      room.onPeerJoin = (peerId: string) => {
        console.log(`[ServerlessSignaling] Peer joined room via Nostr: ${peerId}`);
        if (this.isCreate && !this.hasOffered) {
          this.hasOffered = true;
          this.events.onMessage?.({ type: 'peer-joined', room: this.roomCode });
        }
      };

      room.onPeerLeave = (peerId: string) => {
        console.log(`[ServerlessSignaling] Peer left room via Nostr: ${peerId}`);
        this.hasOffered = false;
        this.events.onMessage?.({ type: 'peer-left' });
      };

      this.events.onOpen?.();

      if (this.isCreate) {
        // Creator gets immediate room-created signal
        setTimeout(() => {
          this.events.onMessage?.({ type: 'room-created', room: this.roomCode });
        }, 50);
      } else {
        // Answerer announces presence in room
        setTimeout(() => {
          this.send({ type: 'peer-announce', room: this.roomCode });
        }, 100);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.events.onError?.(error);
      throw error;
    }
  }

  send(msg: SignalingMessage): void {
    if (this.action && typeof this.action.send === 'function') {
      try {
        void this.action.send(msg);
      } catch (err) {
        console.warn('[ServerlessSignaling] send failed:', err);
      }
    }
  }

  close(): void {
    this.isClosedManually = true;
    if (this.room) {
      try {
        void this.room.leave();
      } catch {
        // ignore
      }
      this.room = null;
      this.action = null;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Hybrid Signaling Adapter (WebSocket Primary with 2500ms Serverless Fallback)
// ---------------------------------------------------------------------------

export class HybridSignalingAdapter implements SignalingAdapter {
  private activeAdapter: SignalingAdapter | null = null;
  private currentMode: SignalingMode = 'websocket';
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnected = false;
  private isClosed = false;

  constructor(
    private readonly primaryUrl: string,
    private readonly events: SignalingAdapterEvents,
    private readonly fallbackTimeoutMs: number = FALLBACK_TIMEOUT_MS,
  ) {}

  get mode(): SignalingMode {
    return this.currentMode;
  }

  async connect(roomCode: string, isCreate: boolean): Promise<void> {
    this.isClosed = false;
    this.hasConnected = false;

    return new Promise<void>((resolve, reject) => {
      let isResolved = false;

      const triggerFallback = (reason: string) => {
        if (this.hasConnected || this.isClosed || this.currentMode === 'serverless') return;

        console.warn(`[HybridSignaling] ${reason}. Activating 100% serverless P2P fallback.`);
        this.currentMode = 'serverless';

        if (this.activeAdapter) {
          try {
            this.activeAdapter.close();
          } catch {}
          this.activeAdapter = null;
        }

        const serverless = new ServerlessSignalingAdapter({
          onOpen: () => {
            if (!isResolved) {
              isResolved = true;
              resolve();
            }
            this.events.onOpen?.();
          },
          onMessage: (msg) => this.events.onMessage?.(msg),
          onError: (err) => this.events.onError?.(err),
          onClose: () => this.events.onClose?.(),
        });

        this.activeAdapter = serverless;
        this.events.onFallback?.(reason, 'serverless');

        serverless
          .connect(roomCode, isCreate)
          .then(() => {
            if (!isResolved) {
              isResolved = true;
              resolve();
            }
          })
          .catch((err) => {
            if (!isResolved) {
              isResolved = true;
              reject(err);
            }
          });
      };

      // Set fallback timer (2,500ms)
      this.fallbackTimer = setTimeout(() => {
        triggerFallback(`Primary WebSocket server unresponsive after ${this.fallbackTimeoutMs}ms`);
      }, this.fallbackTimeoutMs);

      // Attempt primary WebSocket connection
      const wsAdapter = new WebSocketSignalingAdapter(this.primaryUrl, {
        onOpen: () => {
          this.hasConnected = true;
          if (this.fallbackTimer) {
            clearTimeout(this.fallbackTimer);
            this.fallbackTimer = null;
          }
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
          this.events.onOpen?.();
        },
        onMessage: (msg) => {
          this.hasConnected = true;
          if (this.fallbackTimer) {
            clearTimeout(this.fallbackTimer);
            this.fallbackTimer = null;
          }
          this.events.onMessage?.(msg);
        },
        onError: (err) => {
          if (!this.hasConnected) {
            triggerFallback(`WebSocket connection failed (${err.message})`);
          } else {
            this.events.onError?.(err);
          }
        },
        onClose: () => {
          if (!this.hasConnected) {
            triggerFallback('WebSocket connection closed before establishing session');
          } else {
            this.events.onClose?.();
          }
        },
      });

      this.activeAdapter = wsAdapter;

      wsAdapter
        .connect(roomCode, isCreate)
        .then(() => {
          // connection initiated
        })
        .catch((err) => {
          triggerFallback(`WebSocket connect error: ${err.message}`);
        });
    });
  }

  send(msg: SignalingMessage): void {
    if (this.activeAdapter) {
      this.activeAdapter.send(msg);
    }
  }

  close(): void {
    this.isClosed = true;
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.activeAdapter) {
      try {
        this.activeAdapter.close();
      } catch {}
      this.activeAdapter = null;
    }
  }
}
