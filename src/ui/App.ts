/**
 * Pinpoint — Application State Machine & DOM Orchestrator
 *
 * Single-Canvas UX:
 *   idle          → User sees username setting & pair selection (Create / Join)
 *   creating      → Room created, showing QR + code, waiting for peer
 *   joining       → User entering 6-digit code
 *   connected     → Connected Workspace: Real-Time Chat + Drag & Drop File Transfer Feed
 *   error         → Something went wrong
 */

import {
  createNavbar,
  createFooter,
  createUsernameBar,
  createOnboarding,
  createPairSelection,
  createRoomDisplay,
  createJoinInputWithBack,
  createConnectedWorkspace,
  createErrorView,
  type WorkspaceController,
} from './components';
import { openDocModal } from './legalModal';
import { openOnboardingModal, shouldShowOnboardingOnStartup } from './onboardingModal';
import { createInstallBanner } from '../lib/pwaInstaller';
import {
  getInitialTheme,
  applyTheme,
  toggleTheme,
  type ThemeMode,
} from './theme';
import { QREngine } from '../lib/qr/QREngine';
import { QRCanvas } from '../lib/qr/QRCanvas';
import { PeerManager, type PeerEvents } from '../lib/webrtc/PeerConnection';
import {
  sendFile,
  receiveFile,
  downloadFile,
  type TransferProgress,
  type ReceivedFile,
} from '../lib/webrtc/BinaryStreamer';
import { computeSHA256 } from '../lib/crypto';
import { getSavedUsername, saveUsername } from '../lib/username';

type AppState =
  | 'idle'
  | 'creating'
  | 'joining'
  | 'connected'
  | 'error';

// Signaling server URL (supports local dev, E2E test runner, and production cloud hosts)
const getSignalUrl = (): string => {
  const env = (import.meta as unknown as { env?: { VITE_SIGNALING_URL?: string; VITE_SIGNAL_URL?: string } }).env;
  const envUrl = env?.VITE_SIGNALING_URL || env?.VITE_SIGNAL_URL;
  if (envUrl) {
    return envUrl;
  }
  const isLocal =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    !window.location.hostname;
  if (isLocal) {
    const port = window.location.port === '5174' ? '8789' : '8787';
    return `ws://127.0.0.1:${port}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

const SIGNAL_URL = getSignalUrl();

export class App {
  private root: HTMLElement;
  private state: AppState = 'idle';
  private peer: PeerManager | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private roomCode: string = '';
  private myUsername: string = getSavedUsername();
  private peerUsername: string = 'Peer';
  private workspace: WorkspaceController | null = null;
  private isSendingFile: boolean = false;
  private isPreviewMode: boolean = false;
  private errorMessage: string = 'Connection lost.';
  private currentTheme: ThemeMode = getInitialTheme();
  private dcKeepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  init(): void {
    applyTheme(this.currentTheme);
    this.render();

    // Show onboarding guide on first visit
    if (shouldShowOnboardingOnStartup()) {
      setTimeout(() => openOnboardingModal(), 350);
    }
  }

  public joinWithCode(code: string): void {
    this.handleJoinRoom(code);
  }

  private handleToggleTheme(): void {
    this.currentTheme = toggleTheme();
    const themeBtn = this.root.querySelector('.btn-theme-toggle');
    if (themeBtn) {
      const icon = this.currentTheme === 'dark' ? '☀️' : '🌙';
      const label = this.currentTheme === 'dark' ? 'Light' : 'Dark';
      themeBtn.innerHTML = `<span class="theme-icon">${icon}</span> <span class="theme-label">${label}</span>`;
      themeBtn.setAttribute('title', `Switch to ${this.currentTheme === 'dark' ? 'light' : 'dark'} mode`);
    }

    // If currently displaying QR code, update canvas palette
    if (this.state === 'creating') {
      const canvas = this.root.querySelector('canvas');
      if (canvas) {
        try {
          const qrEngine = new QREngine();
          const qrPayload = `ROOM:${this.roomCode}`;
          const matrix = qrEngine.encode(qrPayload);
          const qrCanvas = new QRCanvas(canvas);
          qrCanvas.render(matrix, {
            moduleSize: 7,
            quietZone: 4,
            darkColor: this.currentTheme === 'light' ? '#18181B' : '#EDEDED',
            lightColor: this.currentTheme === 'light' ? '#FFFFFF' : '#121214',
          });
        } catch (e) {
          console.warn('QR update error:', e);
        }
      }
    }
  }

  private clear(): void {
    this.root.innerHTML = '';
  }

  private render(): void {
    this.clear();

    const container = document.createElement('div');
    container.className = `container ${this.state === 'connected' ? 'expanded' : ''}`;

    // Status label for top navigation bar
    let statusLabel = 'Direct P2P';
    if (this.isPreviewMode) {
      statusLabel = 'Demo Mode';
    } else if (this.state === 'connected') {
      statusLabel = 'Connected';
    } else if (this.state === 'creating') {
      statusLabel = 'Pairing';
    } else if (this.state === 'joining') {
      statusLabel = 'Connecting';
    }

    // Top desktop & mobile navigation bar with Light/Dark toggle & Guide
    const navbar = createNavbar(
      this.currentTheme,
      () => this.handleToggleTheme(),
      statusLabel,
      () => {
        if (this.state !== 'idle') {
          this.cleanup();
          this.transition('idle');
        }
      },
      () => openOnboardingModal()
    );
    container.append(navbar);

    // Prompt installing PWA on mobile / desktop browsers
    container.append(createInstallBanner());

    // Operator username identity card (on idle, creating, joining)
    if (['idle', 'creating', 'joining'].includes(this.state)) {
      container.append(
        createUsernameBar(this.myUsername, (newName) => {
          this.updateMyUsername(newName);
        })
      );
    }

    // Friendly 3-step micro-onboarding guide (Interactive navigation + full tour modal)
    if (['idle', 'creating', 'joining'].includes(this.state)) {
      const activeStep = this.state === 'idle' ? 1 : 2;
      container.append(
        createOnboarding(
          activeStep,
          (step) => {
            if (step === 1) {
              const focusAndPulse = () => {
                const input = document.querySelector('.identity-input') as HTMLInputElement | null;
                input?.focus();
                input?.select();
                const card = document.querySelector('.identity-card') as HTMLElement | null;
                card?.classList.add('identity-pulse');
                setTimeout(() => card?.classList.remove('identity-pulse'), 1400);
              };

              if (this.state !== 'idle') {
                this.cleanup();
                this.transition('idle');
                setTimeout(focusAndPulse, 50);
              } else {
                focusAndPulse();
              }
            } else if (step === 2) {
              if (this.state === 'idle') {
                const pairCard = document.querySelector('.pair-options') as HTMLElement | null;
                pairCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else if (this.state === 'joining') {
                this.handleCreateRoom();
              } else if (this.state === 'creating') {
                this.cleanup();
                this.transition('joining');
              }
            } else if (step === 3) {
              this.startPreviewMode();
            }
          },
          () => openOnboardingModal()
        )
      );
    }

    // Main interaction card
    const card = document.createElement('div');
    card.className = 'card stack stack-lg';
    card.append(this.renderState());
    container.append(card);

    // Attribution footer (Developed by Ankit Patra for the community ❤️, Policies & Changelog)
    container.append(createFooter((tab) => openDocModal(tab)));

    this.root.append(container);
  }

  private renderState(): HTMLElement {
    switch (this.state) {
      case 'idle':
        return this.renderIdle();
      case 'creating':
        return this.renderCreating();
      case 'joining':
        return this.renderJoining();
      case 'connected':
        return this.renderConnectedWorkspace();
      case 'error':
        return this.renderError();
    }
  }

  // ── Idle ──────────────────────────────────────────

  private renderIdle(): HTMLElement {
    return createPairSelection({
      onCreateRoom: () => this.handleCreateRoom(),
      onJoinRoom: () => this.transition('joining'),
      onPreviewWorkspace: () => this.startPreviewMode(),
    });
  }

  private startPreviewMode(): void {
    this.isPreviewMode = true;
    this.peerUsername = 'Kandinsky (Simulated)';
    this.transition('connected');

    setTimeout(() => {
      this.workspace?.addChatMessage({
        sender: this.peerUsername,
        text: `Hello ${this.myUsername}! Welcome to PinnPointt. Send a message to test live chat, or attach and drop files below to preview secure, direct streaming with instant verification.`,
        timestamp: Date.now(),
        isMine: false,
      });
    }, 150);
  }

  // ── Creating ─────────────────────────────────────

  private renderCreating(): HTMLElement {
    const canvas = document.createElement('canvas');

    try {
      const qrEngine = new QREngine();
      const qrPayload = `ROOM:${this.roomCode}`;
      const matrix = qrEngine.encode(qrPayload);
      const qrCanvas = new QRCanvas(canvas);
      qrCanvas.render(matrix, {
        moduleSize: 7,
        quietZone: 4,
        darkColor: this.currentTheme === 'light' ? '#18181B' : '#EDEDED',
        lightColor: this.currentTheme === 'light' ? '#FFFFFF' : '#121214',
      });
    } catch (e) {
      console.warn('QR render error:', e);
    }

    return createRoomDisplay(this.roomCode, canvas, () => {
      this.cleanup();
      this.transition('idle');
    });
  }

  // ── Joining ──────────────────────────────────────

  private renderJoining(): HTMLElement {
    if (this.roomCode) {
      const container = document.createElement('div');
      container.className = 'stack stack-md text-center fade-in';

      const label = document.createElement('h2');
      label.textContent = 'Connecting to Room';

      const codeDisplay = document.createElement('div');
      codeDisplay.className = 'room-code-display';
      for (const ch of this.roomCode) {
        const digit = document.createElement('span');
        digit.className = 'digit';
        digit.textContent = ch;
        codeDisplay.append(digit);
      }

      const status = document.createElement('div');
      status.className = 'status-badge mt-md';
      status.style.margin = '12px auto 0';
      status.innerHTML = `<span class="status-dot"></span> Negotiating direct device connection...`;

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-ghost w-full mt-sm';
      cancelBtn.textContent = '← Cancel';
      cancelBtn.addEventListener('click', () => {
        this.cleanup();
        this.transition('idle');
      });

      container.append(label, codeDisplay, status, cancelBtn);
      return container;
    }

    const { element, backBtn } = createJoinInputWithBack((code: string) => {
      this.handleJoinRoom(code);
    });
    backBtn.addEventListener('click', () => {
      this.cleanup();
      this.transition('idle');
    });
    return element;
  }

  // ── Connected Workspace (Chat + File Sharing Feed) ─

  private renderConnectedWorkspace(): HTMLElement {
    const myRole = this.isPreviewMode ? 'YOU' : (this.peer?.role === 'offerer' ? 'HOST' : 'GUEST');
    const peerRole = this.isPreviewMode ? 'SIMULATED' : (myRole === 'HOST' ? 'GUEST' : 'HOST');

    this.workspace = createConnectedWorkspace(
      this.peerUsername,
      peerRole,
      {
        onSendMessage: (text: string) => this.handleSendChatMessage(text),
        onFilesSelected: (files: FileList) => this.handleSendFiles(files),
        onDisconnect: () => {
          this.cleanup();
          this.transition('idle');
        },
      },
      this.isPreviewMode
    );

    this.workspace.addSystemNotice(
      this.isPreviewMode
        ? 'Interactive demo active — Simulated peer ready'
        : 'Direct device-to-device connection secured'
    );
    return this.workspace.element;
  }

  // ── Error ────────────────────────────────────────

  private renderError(): HTMLElement {
    return createErrorView(this.errorMessage, () => {
      this.cleanup();
      this.transition('idle');
    });
  }

  // ── State Transitions ────────────────────────────

  private transition(newState: AppState): void {
    this.state = newState;
    this.render();
  }

  // ── WebRTC & DataChannel Setup ───────────────────

  private async handleCreateRoom(): Promise<void> {
    try {
      const events: PeerEvents = {
        onConnected: () => {
          this.transition('connected');
        },
        onDisconnected: () => {
          this.errorMessage = 'Peer disconnected.';
          this.cleanup();
          this.transition('error');
        },
        onError: (err: Error) => {
          this.errorMessage = err.message || 'Connection failed.';
          this.cleanup();
          this.transition('error');
        },
      };

      this.peer = new PeerManager(SIGNAL_URL, events);
      this.roomCode = await this.peer.createRoom();

      this.peer.onDataChannel((channel: RTCDataChannel) => {
        this.attachDataChannel(channel);
      });

      this.transition('creating');
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : 'Failed to create room.';
      this.transition('error');
    }
  }

  private async handleJoinRoom(code: string): Promise<void> {
    try {
      this.roomCode = code;
      this.transition('joining');

      const events: PeerEvents = {
        onConnected: () => {
          this.transition('connected');
        },
        onDisconnected: () => {
          this.errorMessage = 'Peer disconnected.';
          this.cleanup();
          this.transition('error');
        },
        onError: (err: Error) => {
          this.errorMessage = err.message || 'Connection failed.';
          this.cleanup();
          this.transition('error');
        },
      };

      this.peer = new PeerManager(SIGNAL_URL, events);
      this.peer.onDataChannel((channel: RTCDataChannel) => {
        this.attachDataChannel(channel);
      });

      await this.peer.joinRoom(code);
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : 'Failed to join room.';
      this.cleanup();
      this.transition('error');
    }
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    this.transition('connected');

    // 1. Send peer introduction with our username
    this.sendJSON({
      type: 'peer-intro',
      username: this.myUsername,
    });

    // 2. Attach chat and protocol message listener
    channel.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return; // Binary messages handled by stream receiver

      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;

        if (msg.type === 'peer-intro') {
          const peerName = String(msg.username || 'Peer');
          this.peerUsername = peerName;
          const myRole = this.peer?.role === 'offerer' ? 'HOST' : 'GUEST';
          const peerRole = myRole === 'HOST' ? 'GUEST' : 'HOST';
          this.workspace?.setPeerName(peerName, peerRole);
          this.workspace?.addSystemNotice(`${peerName} joined the room`);
        } else if (msg.type === 'dc-ping') {
          this.sendJSON({ type: 'dc-pong' });
          return;
        } else if (msg.type === 'dc-pong') {
          return;
        } else if (msg.type === 'chat-msg') {
          this.workspace?.addChatMessage({
            sender: String(msg.sender || this.peerUsername),
            text: String(msg.text || ''),
            timestamp: Number(msg.timestamp || Date.now()),
            isMine: false,
          });
        } else if (msg.type === 'username-update') {
          const oldName = this.peerUsername;
          const newName = String(msg.username || 'Peer');
          this.peerUsername = newName;
          const myRole = this.peer?.role === 'offerer' ? 'HOST' : 'GUEST';
          const peerRole = myRole === 'HOST' ? 'GUEST' : 'HOST';
          this.workspace?.setPeerName(newName, peerRole);
          this.workspace?.addSystemNotice(`${oldName} changed name to ${newName}`);
        }
      } catch {
        // Non-JSON string message
      }
    });

    // 3. Start DataChannel keepalive ping (every 15s) to keep NAT tables active through cellular & router firewalls
    if (this.dcKeepaliveTimer) clearInterval(this.dcKeepaliveTimer);
    this.dcKeepaliveTimer = setInterval(() => {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.sendJSON({ type: 'dc-ping' });
      }
    }, 15_000);

    // 4. Start persistent receiver loop for binary file transfers
    this.listenForIncomingFiles(channel);
  }

  // ── Chat Messaging ───────────────────────────────

  private handleSendChatMessage(text: string): void {
    const timestamp = Date.now();

    if (this.isPreviewMode) {
      this.workspace?.addChatMessage({
        sender: this.myUsername,
        text,
        timestamp,
        isMine: true,
      });

      // Friendly simulated peer replies
      setTimeout(() => {
        const responses = [
          `Received your message: "${text}". Direct device link is active and fast!`,
          `Connection is clear and private. You can attach or drop files of any size to test live streaming.`,
          `Message delivered in real time. All transfers stream directly with zero cloud storage.`,
        ];
        const reply = responses[Math.floor(Math.random() * responses.length)];
        this.workspace?.addChatMessage({
          sender: this.peerUsername,
          text: reply,
          timestamp: Date.now(),
          isMine: false,
        });
      }, 500);
      return;
    }

    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    const payload = {
      type: 'chat-msg',
      id: Math.random().toString(36).slice(2),
      sender: this.myUsername,
      text,
      timestamp,
    };

    this.sendJSON(payload);

    this.workspace?.addChatMessage({
      sender: this.myUsername,
      text,
      timestamp,
      isMine: true,
    });
  }

  public updateMyUsername(newName: string): void {
    this.myUsername = saveUsername(newName);
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.sendJSON({
        type: 'username-update',
        username: this.myUsername,
      });
    }
  }

  // ── File Streaming & Transfers ───────────────────

  private async handleSendFiles(files: FileList): Promise<void> {
    if (this.isPreviewMode) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const card = this.workspace?.addFileTransfer({
          fileName: file.name,
          fileSize: file.size,
          isMine: true,
        });

        // Read and compute real SHA-256
        const buf = await file.arrayBuffer();
        const sha256 = await computeSHA256(buf);

        // Smooth streaming progress preview
        const totalSteps = 8;
        for (let s = 1; s <= totalSteps; s++) {
          await new Promise((r) => setTimeout(r, 80));
          const sent = Math.round((file.size * s) / totalSteps);
          card?.updateProgress({
            bytesSent: sent,
            bytesTotal: file.size,
            chunksComplete: s * 10,
            chunksTotal: totalSteps * 10,
            speedBps: file.size / 0.6,
            etaSeconds: (totalSteps - s) * 0.08,
          });
        }

        card?.complete({
          sha256,
          onDownload: () => downloadFile(new Blob([buf]), file.name),
        });
      }
      return;
    }

    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
    if (this.isSendingFile) {
      alert('Another file transfer is already in progress.');
      return;
    }

    this.isSendingFile = true;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const card = this.workspace?.addFileTransfer({
          fileName: file.name,
          fileSize: file.size,
          isMine: true,
        });

        try {
          const result = await sendFile(this.dataChannel, file, (progress: TransferProgress) => {
            card?.updateProgress(progress);
          });
          card?.complete({ sha256: result.sha256 });
        } catch (err) {
          card?.fail(err instanceof Error ? err.message : 'Send failed');
        }
      }
    } finally {
      this.isSendingFile = false;
    }
  }

  private listenForIncomingFiles(channel: RTCDataChannel): void {
    const listenNext = () => {
      if (channel.readyState !== 'open') return;

      let card: ReturnType<NonNullable<typeof this.workspace>['addFileTransfer']> | null = null;

      receiveFile(channel, (progress: TransferProgress) => {
        if (!card && this.workspace) {
          card = this.workspace.addFileTransfer({
            fileName: 'Receiving file...',
            fileSize: progress.bytesTotal,
            isMine: false,
          });
        }
        card?.updateProgress(progress);
      })
        .then((received: ReceivedFile) => {
          if (!card && this.workspace) {
            card = this.workspace.addFileTransfer({
              fileName: received.name,
              fileSize: received.size,
              isMine: false,
            });
          }
          card?.complete({
            sha256: received.sha256,
            onDownload: () => downloadFile(received.blob, received.name),
          });
          // Immediately listen for the next file
          listenNext();
        })
        .catch((err) => {
          console.warn('File transfer completed or interrupted:', err);
          card?.fail(err instanceof Error ? err.message : 'Receive failed');
          if (channel.readyState === 'open') {
            listenNext();
          }
        });
    };

    listenNext();
  }

  private sendJSON(data: object): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    }
  }

  // ── Cleanup ──────────────────────────────────────

  private cleanup(): void {
    if (this.dcKeepaliveTimer) {
      clearInterval(this.dcKeepaliveTimer);
      this.dcKeepaliveTimer = null;
    }
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }
    this.dataChannel = null;
    this.workspace = null;
    this.roomCode = '';
    this.isSendingFile = false;
    this.isPreviewMode = false;
  }
}
