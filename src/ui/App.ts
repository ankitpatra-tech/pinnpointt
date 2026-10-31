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
import { wakeLock } from '../lib/wakeLock';
import {
  VirtualDriveManager,
  type VfsFileEntry,
} from '../lib/webrtc/virtualDrive';
import { openVfsPreviewModal } from './vfsPreviewModal';
import {
  stripImageMetadata,
  isMetadataStrippable,
} from '../lib/privacyShield';
import {
  detectClipboardContentType,
  isClipboardSyncMessage,
  readSystemClipboard,
  type ClipboardItemData,
} from '../lib/clipboardSync';
import { openZeroTraceViewer } from './zeroTraceViewer';
import { showToast } from './components';

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
  private wakeLockUnsub: (() => void) | null = null;
  private pendingFileCleanups: Array<() => Promise<void>> = [];
  private virtualDrive: VirtualDriveManager | null = null;

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

  private getRoomJoinUrl(): string {
    const origin = window.location.origin || 'http://localhost:5173';
    return `${origin}/app?room=${this.roomCode}`;
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
          const qrPayload = this.getRoomJoinUrl();
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
    void wakeLock.acquire('webrtc');
    this.transition('connected');

    setTimeout(() => {
      this.workspace?.addChatMessage({
        sender: this.peerUsername,
        text: `Hello ${this.myUsername}! Welcome to PinnPointt. Send a message to test live chat, or click the "Virtual Drive" tab above to explore remote files and test on-demand slice previews.`,
        timestamp: Date.now(),
        isMine: false,
      });

      // Populate sample remote drive files in demo mode
      this.workspace?.setRemoteVfsEntries([
        {
          id: 'demo_f1',
          name: 'project_architecture.md',
          relativePath: 'docs/project_architecture.md',
          size: 4096,
          mimeType: 'text/markdown',
          lastModified: Date.now() - 3600000,
        },
        {
          id: 'demo_f2',
          name: 'pinnpointt_brand_spec.svg',
          relativePath: 'assets/pinnpointt_brand_spec.svg',
          size: 16384,
          mimeType: 'image/svg+xml',
          lastModified: Date.now() - 7200000,
        },
        {
          id: 'demo_f3',
          name: 'performance_benchmarks.csv',
          relativePath: 'reports/performance_benchmarks.csv',
          size: 102400,
          mimeType: 'text/csv',
          lastModified: Date.now() - 10800000,
        },
      ]);
    }, 150);
  }

  // ── Creating ─────────────────────────────────────

  private renderCreating(): HTMLElement {
    const canvas = document.createElement('canvas');

    try {
      const qrEngine = new QREngine();
      const qrPayload = this.getRoomJoinUrl();
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
        onMountFiles: (files: FileList | File[]) => {
          if (this.virtualDrive) {
            const mounted = this.virtualDrive.mountLocalFiles(files);
            this.workspace?.setLocalVfsEntries(mounted);
            this.workspace?.addSystemNotice(`Mounted ${mounted.length} file(s) to Virtual Drive for peer`);
          } else if (this.isPreviewMode) {
            const entries: VfsFileEntry[] = [];
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              entries.push({
                id: `demo_${i}`,
                name: file.name,
                relativePath: (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name,
                size: file.size,
                mimeType: file.type || 'application/octet-stream',
                lastModified: file.lastModified || Date.now(),
              });
            }
            this.workspace?.setLocalVfsEntries(entries);
            this.workspace?.addSystemNotice(`Demo: Mounted ${entries.length} file(s) to Virtual Drive`);
          }
        },
        onUnmountDrive: () => {
          if (this.virtualDrive) {
            this.virtualDrive.unmountLocal();
            this.workspace?.setLocalVfsEntries([]);
            this.workspace?.addSystemNotice(`Unmounted local Virtual Drive`);
          } else if (this.isPreviewMode) {
            this.workspace?.setLocalVfsEntries([]);
            this.workspace?.addSystemNotice(`Demo: Unmounted Virtual Drive`);
          }
        },
        onPullRemoteFile: (fileId: string) => {
          if (this.virtualDrive) {
            this.virtualDrive.pullRemoteFile(fileId);
            this.workspace?.addSystemNotice(`Requesting remote peer to stream file...`);
            this.workspace?.switchTab('activity');
          } else if (this.isPreviewMode) {
            this.workspace?.addSystemNotice(`Demo: Pulled remote file (${fileId})`);
            this.workspace?.switchTab('activity');
          }
        },
        onPreviewRemoteFile: (entry: VfsFileEntry) => {
          if (this.virtualDrive) {
            const slicePromise = this.virtualDrive.requestSlice(entry.id, 0, 512 * 1024);
            openVfsPreviewModal({
              entry,
              slicePromise,
              onPullFile: (id) => {
                this.virtualDrive?.pullRemoteFile(id);
                this.workspace?.addSystemNotice(`Requesting remote peer to stream file "${entry.name}"...`);
                this.workspace?.switchTab('activity');
              },
            });
          } else if (this.isPreviewMode) {
            const sampleText = `# PinnPointt Virtual Drive Preview\n\nLive on-demand byte slice streamed directly from peer memory with ZERO local disk allocation.\n\nFile Name: ${entry.name}\nPath:      ${entry.relativePath}\nMIME:      ${entry.mimeType}\nSize:      ${entry.size} bytes\n`;
            const mockSlice = Promise.resolve({
              fileId: entry.id,
              offset: 0,
              length: Math.min(entry.size, 1024),
              totalSize: entry.size,
              mimeType: entry.mimeType,
              dataBase64: btoa(sampleText),
              text: sampleText,
            });
            openVfsPreviewModal({
              entry,
              slicePromise: mockSlice,
              onPullFile: () => {
                this.workspace?.addSystemNotice(`Demo: Requested pull of file "${entry.name}"`);
                this.workspace?.switchTab('activity');
              },
            });
          }
        },
        onSendClipboard: () => {
          void this.handleSendClipboard();
        },
        onDisconnect: () => {
          this.cleanup();
          this.transition('idle');
        },
      },
      this.isPreviewMode
    );

    if (this.wakeLockUnsub) {
      this.wakeLockUnsub();
      this.wakeLockUnsub = null;
    }
    this.workspace.setWakeLockActive(wakeLock.isActive());
    this.wakeLockUnsub = wakeLock.onStateChange((active) => {
      this.workspace?.setWakeLockActive(active);
    });

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
          if (this.state !== 'connected') {
            this.transition('connected');
          }
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
          if (this.state !== 'connected') {
            this.transition('connected');
          }
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

    // Keep screen awake while direct peer connection is active
    void wakeLock.acquire('webrtc');

    // Initialize Virtual Drive Manager for on-demand pull and byte-slice previews
    this.virtualDrive = new VirtualDriveManager(
      (data) => this.sendJSON(data),
      {
        onRemoteManifestUpdated: (files: VfsFileEntry[]) => {
          this.workspace?.setRemoteVfsEntries(files);
          this.workspace?.addSystemNotice(
            files.length > 0
              ? `${this.peerUsername} mounted ${files.length} item(s) in Virtual Drive`
              : `${this.peerUsername} unmounted their Virtual Drive`
          );
        },
        onRemoteUnmounted: () => {
          this.workspace?.setRemoteVfsEntries([]);
          this.workspace?.addSystemNotice(`${this.peerUsername} unmounted their Virtual Drive`);
        },
        onFilePullRequested: (file: File) => {
          this.workspace?.addSystemNotice(`${this.peerUsername} requested on-demand pull of "${file.name}"`);
          void this.handleSendSingleFile(file);
        },
        onNotice: (text: string) => {
          this.workspace?.addSystemNotice(text);
        },
      }
    );

    // 1. Send peer introduction with our username
    this.sendJSON({
      type: 'peer-intro',
      username: this.myUsername,
    });

    // 2. Attach chat and protocol message listener
    window.addEventListener('paste', this.handleGlobalPaste);
    channel.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return; // Binary messages handled by stream receiver

      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;

        // Route Virtual Drive (Live Remote Mount) messages
        if (this.virtualDrive?.handleMessage(msg)) {
          return;
        }

        // Route Instant Universal Clipboard messages
        if (isClipboardSyncMessage(msg)) {
          this.workspace?.addClipboardItem(msg.item, false);
          return;
        }

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
      if (this.isSendingFile) return;
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

  // ── Universal Clipboard Sync ──────────────────────

  private handleGlobalPaste = (e: ClipboardEvent): void => {
    if (this.state !== 'connected' && !this.isPreviewMode) return;

    // Check for clipboard files (e.g. screenshot image pasted)
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            this.workspace?.addSystemNotice(`Pasted image from clipboard (${file.type})`);
            void this.handleSendSingleFile(file);
            return;
          }
        }
      }
    }

    // Check if user is typing in an active text input or textarea
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      // Allow normal typing / paste inside text inputs
      return;
    }

    // User pressed Ctrl+V / Cmd+V in the room outside of an input: sync text
    const text = e.clipboardData?.getData('text') || '';
    if (text.trim()) {
      e.preventDefault();
      this.dispatchClipboardSync(text);
    }
  };

  private async handleSendClipboard(): Promise<void> {
    try {
      const data = await readSystemClipboard();
      if (!data) {
        showToast('Clipboard is empty or access was denied');
        return;
      }

      if (data.file) {
        this.workspace?.addSystemNotice(`Sending clipboard image (${data.file.name})`);
        void this.handleSendSingleFile(data.file);
        return;
      }

      if (data.content) {
        this.dispatchClipboardSync(data.content, data.type);
      }
    } catch (err) {
      console.warn('[Clipboard] Failed to read clipboard:', err);
      showToast('Could not access device clipboard');
    }
  }

  private dispatchClipboardSync(text: string, overrideType?: 'text' | 'url' | 'code' | 'image'): void {
    const type = overrideType || detectClipboardContentType(text);
    const item: ClipboardItemData = {
      id: Math.random().toString(36).slice(2),
      type,
      content: text,
      timestamp: Date.now(),
      sender: this.myUsername,
    };

    if (this.isPreviewMode) {
      this.workspace?.addClipboardItem(item, true);
      showToast('Copied to live scratchpad');
      return;
    }

    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    this.sendJSON({
      type: 'clipboard-sync',
      item,
    });

    this.workspace?.addClipboardItem(item, true);
    showToast('Clipboard synced to peer!');
  }

  // ── File Streaming & Transfers ───────────────────

  private async processFileToSend(rawFile: File): Promise<{
    file: File;
    isMetadataStripped: boolean;
    isZeroTrace: boolean;
  }> {
    const privacyEnabled = this.workspace?.getPrivacyShieldEnabled() ?? true;
    const zeroTraceEnabled = this.workspace?.getZeroTraceEnabled() ?? false;

    let fileToSend = rawFile;
    let isMetadataStripped = false;
    let isZeroTrace = false;

    if (privacyEnabled && isMetadataStrippable(rawFile)) {
      const stripResult = await stripImageMetadata(rawFile);
      if (stripResult.stripped) {
        fileToSend = stripResult.file;
        isMetadataStripped = true;
      }
    }

    if (zeroTraceEnabled && (rawFile.type.startsWith('image/') || isMetadataStrippable(rawFile))) {
      isZeroTrace = true;
    }

    return { file: fileToSend, isMetadataStripped, isZeroTrace };
  }

  private async handleSendFiles(files: FileList): Promise<void> {
    if (this.isPreviewMode) {
      void wakeLock.acquire('transfer');
      try {
        for (let i = 0; i < files.length; i++) {
          const rawFile = files[i];
          const { file, isMetadataStripped, isZeroTrace } = await this.processFileToSend(rawFile);

          const card = this.workspace?.addFileTransfer({
            fileName: file.name,
            fileSize: file.size,
            isMine: true,
            isMetadataStripped,
            isZeroTrace,
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

          if (isZeroTrace) {
            card?.complete({
              sha256,
              isZeroTrace: true,
              isMetadataStripped,
              onZeroTraceView: () => {
                void openZeroTraceViewer({
                  blob: new Blob([buf], { type: file.type }),
                  fileName: file.name,
                });
              },
            });
          } else {
            card?.complete({
              sha256,
              isMetadataStripped,
              onDownload: () => downloadFile(new Blob([buf], { type: file.type }), file.name),
            });
          }
        }
      } finally {
        void wakeLock.release('transfer');
      }
      return;
    }

    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
    if (this.isSendingFile) {
      alert('Another file transfer is already in progress.');
      return;
    }

    this.isSendingFile = true;
    void wakeLock.acquire('transfer');

    try {
      for (let i = 0; i < files.length; i++) {
        const rawFile = files[i];
        const { file, isMetadataStripped, isZeroTrace } = await this.processFileToSend(rawFile);

        const card = this.workspace?.addFileTransfer({
          fileName: file.name,
          fileSize: file.size,
          isMine: true,
          isMetadataStripped,
          isZeroTrace,
        });

        try {
          const result = await sendFile(
            this.dataChannel,
            file,
            (progress: TransferProgress) => {
              card?.updateProgress(progress);
            },
            { isMetadataStripped, isZeroTrace },
            this.peer?.getChannelPool(),
          );
          card?.complete({
            sha256: result.sha256,
            isMetadataStripped,
            isZeroTrace,
          });
        } catch (err) {
          card?.fail(err instanceof Error ? err.message : 'Send failed');
        }
      }
    } finally {
      this.isSendingFile = false;
      void wakeLock.release('transfer');
    }
  }

  private async handleSendSingleFile(rawFile: File): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    const { file, isMetadataStripped, isZeroTrace } = await this.processFileToSend(rawFile);

    const card = this.workspace?.addFileTransfer({
      fileName: file.name,
      fileSize: file.size,
      isMine: true,
      isMetadataStripped,
      isZeroTrace,
    });

    void wakeLock.acquire('transfer');
    try {
      const result = await sendFile(
        this.dataChannel,
        file,
        (progress: TransferProgress) => {
          card?.updateProgress(progress);
        },
        { isMetadataStripped, isZeroTrace },
        this.peer?.getChannelPool(),
      );
      card?.complete({
        sha256: result.sha256,
        isMetadataStripped,
        isZeroTrace,
      });
    } catch (err) {
      card?.fail(err instanceof Error ? err.message : 'Send failed');
    } finally {
      void wakeLock.release('transfer');
    }
  }

  private listenForIncomingFiles(channel: RTCDataChannel): void {
    const listenNext = () => {
      if (channel.readyState !== 'open') return;

      let card: ReturnType<NonNullable<typeof this.workspace>['addFileTransfer']> | null = null;

      receiveFile(
        channel,
        (progress: TransferProgress) => {
          if (!card && this.workspace) {
            card = this.workspace.addFileTransfer({
              fileName: 'Receiving file...',
              fileSize: progress.bytesTotal,
              isMine: false,
            });
          }
          card?.updateProgress(progress);
        },
        (meta) => {
          void wakeLock.acquire('transfer');
          if (!card && this.workspace) {
            card = this.workspace.addFileTransfer({
              fileName: meta.name,
              fileSize: meta.size,
              isMine: false,
              isMetadataStripped: meta.isMetadataStripped,
              isZeroTrace: meta.isZeroTrace,
            });
          }
        },
        undefined,
        this.peer?.getChannelPool(),
      )
        .then((received: ReceivedFile) => {
          void wakeLock.release('transfer');
          if (!card && this.workspace) {
            card = this.workspace.addFileTransfer({
              fileName: received.name,
              fileSize: received.size,
              isMine: false,
              isMetadataStripped: received.isMetadataStripped,
              isZeroTrace: received.isZeroTrace,
            });
          }

          if (received.cleanup) {
            this.pendingFileCleanups.push(received.cleanup);
          }

          if (received.isZeroTrace) {
            card?.complete({
              sha256: received.sha256,
              isZeroTrace: true,
              isMetadataStripped: received.isMetadataStripped,
              onZeroTraceView: () => {
                void openZeroTraceViewer({
                  blob: received.blob,
                  fileName: received.name,
                  onClose: () => {
                    if (received.cleanup) {
                      void received.cleanup();
                    }
                  },
                });
              },
            });
          } else {
            card?.complete({
              sha256: received.sha256,
              isDirectDiskSave: received.isDirectDiskSave,
              isMetadataStripped: received.isMetadataStripped,
              onDownload: received.isDirectDiskSave
                ? undefined
                : () => {
                    downloadFile(received.blob, received.name);
                    if (received.cleanup) {
                      setTimeout(() => {
                        void received.cleanup?.();
                      }, 2500);
                    }
                  },
            });
          }
          // Immediately listen for the next file
          listenNext();
        })
        .catch((err) => {
          void wakeLock.release('transfer');
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
    window.removeEventListener('paste', this.handleGlobalPaste);

    if (this.wakeLockUnsub) {
      this.wakeLockUnsub();
      this.wakeLockUnsub = null;
    }
    void wakeLock.releaseAll();

    while (this.pendingFileCleanups.length > 0) {
      const fn = this.pendingFileCleanups.pop();
      if (fn) void fn().catch(() => {});
    }

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
    if (this.virtualDrive) {
      this.virtualDrive.cleanup();
      this.virtualDrive = null;
    }
  }
}
