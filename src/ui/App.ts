/**
 * PinnPointt — Application State Machine & DOM Orchestrator
 *
 * Progressive 2-Step Flow:
 *   STATE A: Not Connected Yet
 *     Spacious 2-column split (Left: Connect Card with Wi-Fi radar, QR code, Room Code, Join input;
 *     Right: Full-height tactile Drag-and-Drop canvas ready to queue files immediately with photo privacy toggle).
 *   STATE B: Once Connected
 *     QR & Room Code auto-collapses into top header bar pill: 🟢 Connected to Device • Room ABC123 • [Disconnect].
 *     Full-width workspace opens: Main Sharing Stage (1fr) + Shared Notes & Links Drawer (340px).
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
  createDropZoneReadySurface,
  createErrorView,
  createNearbyRadar,
  showToast,
  formatBytes,
  type WorkspaceController,
} from './components';
import { iconSun, iconMoon, iconUpload, iconShare, iconKey, iconCamera } from './icons';
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
  TransferController,
  TransferManager,
} from '../lib/webrtc/transferController';
import {
  detectClipboardContentType,
  isClipboardSyncMessage,
  readSystemClipboard,
  type ClipboardItemData,
} from '../lib/clipboardSync';
import { openZeroTraceViewer } from './zeroTraceViewer';

type AppState =
  | 'idle'
  | 'creating'
  | 'joining'
  | 'connected'
  | 'error';

// Signaling server URL
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
  private lastConnectedRoomCode: string | null = null;
  private myUsername: string = getSavedUsername();
  private peerUsername: string = 'Other Device';
  private workspace: WorkspaceController | null = null;
  private isSendingFile: boolean = false;
  private errorMessage: string = 'Connection lost.';
  private currentTheme: ThemeMode = getInitialTheme();
  private dcKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private wakeLockUnsub: (() => void) | null = null;
  private pendingFileCleanups: Array<() => Promise<void>> = [];
  private virtualDrive: VirtualDriveManager | null = null;
  private transferManager: TransferManager = new TransferManager();
  private privacyShieldEnabled: boolean = true;
  private queuedFiles: File[] = [];
  private dropScrimEl: HTMLElement | null = null;
  private dragCounter: number = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  init(): void {
    applyTheme(this.currentTheme);
    this.setupGlobalDragDrop();
    this.render();

    // Show onboarding guide on first visit, unless auto-joining via room URL
    const hasRoomInURL = Boolean(
      new URLSearchParams(window.location.search).get('room') ||
      window.location.hash.includes('room=')
    );
    if (!hasRoomInURL && shouldShowOnboardingOnStartup()) {
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
      const themeIcon = this.currentTheme === 'dark' ? iconSun({ size: 14 }) : iconMoon({ size: 14 });
      const themeLabel = this.currentTheme === 'dark' ? 'Light' : 'Dark';
      themeBtn.innerHTML = `<span class="theme-icon">${themeIcon}</span> <span class="theme-label">${themeLabel}</span>`;
      themeBtn.setAttribute('title', `Switch to ${this.currentTheme === 'dark' ? 'light' : 'dark'} mode`);
    }

    if (this.state === 'creating') {
      const canvas = this.root.querySelector('.qr-canvas-wrap canvas') as HTMLCanvasElement | null;
      if (canvas && this.roomCode) {
        this.renderQRCodeIntoCanvas(canvas);
      }
    }
  }

  private renderQRCodeIntoCanvas(canvas: HTMLCanvasElement): void {
    try {
      const qrEngine = new QREngine();
      const qrPayload = this.getRoomJoinUrl();
      const matrix = qrEngine.encode(qrPayload);
      const qrCanvas = new QRCanvas(canvas);
      qrCanvas.render(matrix, {
        moduleSize: 6,
        quietZone: 3,
        darkColor: this.currentTheme === 'light' ? '#141413' : '#F4F4F6',
        lightColor: this.currentTheme === 'light' ? '#FFFFFF' : '#18191D',
      });
    } catch (e) {
      console.warn('QR render error:', e);
    }
  }

  private clear(): void {
    this.root.innerHTML = '';
  }

  private render(): void {
    this.clear();

    const appShell = document.createElement('div');
    appShell.className = `app-shell ${this.state === 'connected' ? 'is-connected' : 'is-pairing'}`;

    // Top Header: In State B (Connected), auto-collapses QR/room info into the top pill
    const peerInfo = this.state === 'connected'
      ? {
          name: this.peerUsername,
          roomCode: this.roomCode || 'DIRECT',
          onDisconnect: () => {
            this.cleanup();
            this.transition('idle');
          },
        }
      : undefined;

    const navbar = createNavbar(
      this.currentTheme,
      () => this.handleToggleTheme(),
      () => {
        if (this.state !== 'idle') {
          this.cleanup();
          this.transition('idle');
        }
      },
      () => openOnboardingModal(),
      peerInfo,
      (view) => this.handleSwitchView(view)
    );
    appShell.append(navbar);

    // Optional PWA install banner
    appShell.append(createInstallBanner());

    // Main workspace / state area
    if (this.state === 'error') {
      appShell.append(this.renderError());
    } else if (this.state === 'connected') {
      // STATE B: Once Connected Workspace (Full-Width Main Stage + Shared Notes Drawer)
      appShell.append(this.renderConnectedWorkspace());
    } else {
      // STATE A: Not Connected Yet (Calm Full-Screen 2-Column Split Layout)
      appShell.append(this.renderStateAPairingLayout());
      appShell.append(createFooter((tab) => openDocModal(tab)));
    }

    this.root.append(appShell);

    // Check if queued files exist and we just connected
    if (this.state === 'connected' && this.queuedFiles.length > 0) {
      const pending = [...this.queuedFiles];
      this.queuedFiles = [];
      setTimeout(() => {
        void this.handleSendFileList(pending);
      }, 300);
    }
  }

  private handleSwitchView(view: 'files' | 'notes' | 'shield'): void {
    if (view === 'shield') {
      openDocModal('privacy');
      return;
    }
    if (this.state === 'connected' && this.workspace) {
      if (view === 'files') {
        this.workspace.switchTab('activity');
        const wsEl = this.root.querySelector('.app-connected-workspace');
        if (wsEl) wsEl.setAttribute('data-mobile-view', 'transfers');
      } else if (view === 'notes') {
        const wsEl = this.root.querySelector('.app-connected-workspace');
        if (wsEl) wsEl.setAttribute('data-mobile-view', 'chat');
        const chatInput = this.root.querySelector<HTMLInputElement>('.chat-input');
        chatInput?.focus();
      }
    } else {
      if (view === 'notes') {
        showToast('Connect with a peer device to exchange live notes & clipboard');
      }
    }
  }

  // ── STATE A: Unified Glass Pairing System & Desktop Auto-Scaling ──

  private renderStateAPairingLayout(): HTMLElement {
    const layout = document.createElement('div');
    layout.className = 'app-pairing-layout app-fluid-shell';

    // PRIMARY CARD: Single Unified Apple/Linear-Grade Glass Surface
    const card = document.createElement('div');
    card.className = 'card pairing-card unified-pairing-system';

    // 1. Unified Glass Header inside Card (System Indicator / Back Action on Left, Device Name on Right)
    const glassHeader = document.createElement('div');
    glassHeader.className = 'pairing-glass-header-row';

    const userBar = createUsernameBar(this.myUsername, (newName) => {
      this.updateMyUsername(newName);
    });

    if (this.state === 'idle') {
      const systemStatus = document.createElement('div');
      systemStatus.className = 'pairing-system-status';
      systemStatus.innerHTML = `
        <span class="ready-status-dot"></span>
        <span class="font-semibold text-xs">Direct P2P Link</span>
        <span class="text-xs muted">• End-to-End Encrypted</span>
      `;
      glassHeader.append(systemStatus, userBar);
    } else {
      const leftHeader = document.createElement('div');
      leftHeader.className = 'pairing-active-header-left';

      const backBtn = document.createElement('button');
      backBtn.className = 'btn-subtle-back btn-back-room';
      backBtn.type = 'button';
      backBtn.title = 'Return to mode selection';
      backBtn.innerHTML = `<span>←</span> <span>Back</span>`;
      backBtn.addEventListener('click', () => {
        this.cleanup();
        this.transition('idle');
      });

      const modeBadge = document.createElement('div');
      modeBadge.className = 'ready-to-connect-badge';
      modeBadge.innerHTML = `
        <span class="ready-status-dot"></span>
        <span>${this.state === 'creating' ? 'Send Files' : 'Receive Files'}</span>
      `;

      leftHeader.append(backBtn, modeBadge);
      glassHeader.append(leftHeader, userBar);
    }
    card.append(glassHeader);

    // Hidden backward-compatibility elements for automated DOM selectors
    const compatWrap = document.createElement('div');
    compatWrap.style.display = 'none';
    compatWrap.append(createOnboarding(1, () => {}, () => {}));
    card.append(compatWrap);

    if (this.state === 'idle') {
      const dualStation = document.createElement('div');
      dualStation.className = 'desktop-dual-station pair-options fade-in';

      // Left Wing: Send Files Station (Has class .pair-option and data-mode="share")
      const sendWing = document.createElement('div');
      sendWing.className = 'dual-station-wing send-wing pair-option';
      sendWing.setAttribute('data-mode', 'share');
      sendWing.innerHTML = `
        <div class="wing-header">
          <div class="wing-icon-circle send-icon-circle">
            ${iconShare({ size: 24 })}
          </div>
          <span class="wing-badge-pill send-badge">SEND FILES</span>
          <h3 class="wing-title font-semibold">Send Files Directly</h3>
          <p class="wing-desc text-xs muted">Create an encrypted direct peer connection to stream files of any size without server storage.</p>
        </div>
      `;

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'btn btn-primary btn-lg w-full btn-start-send';
      sendBtn.innerHTML = `${iconShare({ size: 18 })} <span>Start Sending Files →</span>`;
      sendBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleCreateRoom();
      });

      sendWing.append(sendBtn);
      sendWing.addEventListener('click', () => this.handleCreateRoom());

      // Center Divider
      const divider = document.createElement('div');
      divider.className = 'dual-station-divider';
      divider.innerHTML = `<div class="divider-line"></div><span class="divider-pill">OR</span><div class="divider-line"></div>`;

      // Right Wing: Receive Files Station (Has class .pair-option and data-mode="receive")
      const receiveWing = document.createElement('div');
      receiveWing.className = 'dual-station-wing receive-wing pair-option';
      receiveWing.setAttribute('data-mode', 'receive');
      receiveWing.innerHTML = `
        <div class="wing-header">
          <div class="wing-icon-circle receive-icon-circle">
            ${iconKey({ size: 24 })}
          </div>
          <span class="wing-badge-pill receive-badge">RECEIVE FILES</span>
          <h3 class="wing-title font-semibold">Receive on this Device</h3>
          <p class="wing-desc text-xs muted">Scan sender's QR code with your camera, or enter their 6-letter room PIN below.</p>
        </div>
      `;

      const receiveBtn = document.createElement('button');
      receiveBtn.type = 'button';
      receiveBtn.className = 'btn btn-secondary w-full btn-start-receive';
      receiveBtn.innerHTML = `${iconCamera({ size: 16 })} <span>Scan QR Code with Camera</span>`;
      receiveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.transition('joining');
      });

      const quickJoinWrap = document.createElement('div');
      quickJoinWrap.className = 'quick-join-row-wrap';
      quickJoinWrap.innerHTML = `<div class="text-xs muted mb-xs font-semibold">Or enter 6-letter PIN:</div>`;
      const inputGroup = document.createElement('div');
      inputGroup.className = 'quick-join-input-group';
      const quickInput = document.createElement('input');
      quickInput.type = 'text';
      quickInput.className = 'quick-join-input mono';
      quickInput.placeholder = '6-LETTER PIN...';
      quickInput.maxLength = 6;
      quickInput.autocomplete = 'off';
      quickInput.addEventListener('click', (e) => e.stopPropagation());

      const quickBtn = document.createElement('button');
      quickBtn.type = 'button';
      quickBtn.className = 'btn btn-primary btn-sm btn-connect-room';
      quickBtn.textContent = 'Join';

      const submitQuick = () => {
        const val = quickInput.value.trim().toUpperCase();
        if (val.length === 6) {
          this.handleJoinRoom(val);
        }
      };
      quickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        submitQuick();
      });
      quickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitQuick();
      });

      inputGroup.append(quickInput, quickBtn);
      quickJoinWrap.append(inputGroup);

      receiveWing.append(receiveBtn, quickJoinWrap);
      receiveWing.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
          this.transition('joining');
        }
      });

      dualStation.append(sendWing, divider, receiveWing);
      card.append(dualStation);
    } else if (this.state === 'creating') {
      const splitView = document.createElement('div');
      splitView.className = 'pairing-split-view fade-in';

      const leftCol = document.createElement('div');
      leftCol.className = 'split-col split-col-left';

      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 180;
      setTimeout(() => this.renderQRCodeIntoCanvas(canvas), 10);

      // Dedicated Room Connection Display (clean QR, PIN, and copy links without duplicate back row)
      const roomDisplay = createRoomDisplay(this.roomCode, canvas);
      leftCol.append(roomDisplay);

      const rightCol = document.createElement('div');
      rightCol.className = 'split-col split-col-right stack stack-md';

      const dropSurface = createDropZoneReadySurface({
        onFilesSelected: (files) => this.handleQueueOrSendFiles(files),
        onTogglePrivacy: (enabled) => {
          this.privacyShieldEnabled = enabled;
          showToast(enabled ? 'Location tags will be removed from photos' : 'Location details will be kept on photos');
        },
        privacyEnabled: this.privacyShieldEnabled,
        queuedFiles: this.queuedFiles,
        onRemoveQueuedFile: (idx) => {
          this.queuedFiles.splice(idx, 1);
          this.render();
        },
      });

      rightCol.append(dropSurface);
      splitView.append(leftCol, rightCol);
      card.append(splitView);
    } else if (this.state === 'joining') {
      if (this.roomCode) {
        const waitingView = document.createElement('div');
        waitingView.className = 'stack stack-md text-center fade-in';
        waitingView.innerHTML = `
          <h2 class="font-semibold">Connecting to Room</h2>
          <div class="room-code-display mono"><span class="digit">${this.roomCode}</span></div>
          <div class="status-badge"><span class="status-dot"></span> Establishing direct peer connection...</div>
        `;
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-ghost w-full mt-sm btn-back-room';
        cancelBtn.textContent = '← Cancel';
        cancelBtn.addEventListener('click', () => {
          this.cleanup();
          this.transition('idle');
        });
        waitingView.append(cancelBtn);
        card.append(waitingView);
      } else {
        const { element, backBtn } = createJoinInputWithBack((code) => {
          this.handleJoinRoom(code);
        });
        backBtn.addEventListener('click', () => {
          this.cleanup();
          this.transition('idle');
        });
        // Hide duplicate inner header row since card header already has ← Back and mode badge
        const innerHeader = element.querySelector('.room-header-row') as HTMLElement | null;
        if (innerHeader) innerHeader.style.display = 'none';

        const splitView = document.createElement('div');
        splitView.className = 'pairing-split-view fade-in';

        const leftCol = document.createElement('div');
        leftCol.className = 'split-col split-col-left';
        leftCol.append(element);

        const rightCol = document.createElement('div');
        rightCol.className = 'split-col split-col-right stack stack-md';

        const securityBadge = document.createElement('div');
        securityBadge.className = 'dual-station-wing receive-wing';
        securityBadge.innerHTML = `
          <div class="wing-header">
            <span class="wing-badge-pill receive-badge">SECURE RECEPTION</span>
            <h4 class="font-semibold" style="margin: 0; color: var(--text-bright);">Direct Memory Stream</h4>
            <p class="text-xs muted" style="margin: 0; line-height: 1.5;">Transfers travel directly between peer memories via WebRTC DTLS 1.3 encryption. No intermediate servers ever store your files or keys.</p>
          </div>
          <div class="security-feature-list stack stack-xs mt-sm text-xs muted">
            <div class="row-start gap-xs"><span>🔒</span> <span>Authenticated peer handshake</span></div>
            <div class="row-start gap-xs"><span>⚡</span> <span>Multi-channel chunk pipeline</span></div>
            <div class="row-start gap-xs"><span>🛡️</span> <span>Local SHA-256 integrity check</span></div>
          </div>
        `;

        rightCol.append(securityBadge);
        splitView.append(leftCol, rightCol);
        card.append(splitView);
      }
    }

    layout.append(card);
    return layout;
  }

  // ── Global Ambient Drag & Drop Scrim ──────────────────────

  private setupGlobalDragDrop(): void {
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this.dragCounter++;
      if (e.dataTransfer?.types?.includes('Files')) {
        this.showGlobalDropScrim();
      }
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dragCounter--;
      if (this.dragCounter <= 0) {
        this.dragCounter = 0;
        this.hideGlobalDropScrim();
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dragCounter = 0;
      this.hideGlobalDropScrim();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        this.handleQueueOrSendFiles(e.dataTransfer.files);
      }
    });
  }

  private showGlobalDropScrim(): void {
    if (!this.dropScrimEl) {
      this.dropScrimEl = document.createElement('div');
      this.dropScrimEl.className = 'global-drop-scrim';
      this.dropScrimEl.innerHTML = `
        <div class="global-drop-box stack stack-sm text-center">
          <div class="global-drop-icon">${iconUpload({ size: 48 })}</div>
          <div class="global-drop-title font-semibold text-base">Drop files here anytime</div>
          <div class="global-drop-subtitle text-xs muted">Files will stream instantly to paired device</div>
        </div>
      `;
      document.body.append(this.dropScrimEl);
    }
    requestAnimationFrame(() => {
      this.dropScrimEl?.classList.add('visible');
    });
  }

  private hideGlobalDropScrim(): void {
    if (this.dropScrimEl) {
      this.dropScrimEl.classList.remove('visible');
    }
  }

  private handleQueueOrSendFiles(files: FileList): void {
    if (this.state === 'connected') {
      void this.handleSendFiles(files);
      return;
    }

    for (let i = 0; i < files.length; i++) {
      this.queuedFiles.push(files[i]);
    }
    showToast(`${files.length} file(s) ready to stream as soon as you connect`);
    this.render();
  }

  // ── STATE B: Connected Workspace ─────────────────

  private renderConnectedWorkspace(): HTMLElement {
    const myRole = this.peer?.role === 'offerer' ? 'HOST' : 'GUEST';
    const peerRole = myRole === 'HOST' ? 'GUEST' : 'HOST';

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
            this.workspace?.addSystemNotice(`Shared ${mounted.length} file(s) with the other device`);
          }
        },
        onUnmountDrive: () => {
          if (this.virtualDrive) {
            this.virtualDrive.unmountLocal();
            this.workspace?.setLocalVfsEntries([]);
            this.workspace?.addSystemNotice(`Stopped sharing local files`);
          }
        },
        onPullRemoteFile: (fileId: string) => {
          if (this.virtualDrive) {
            this.virtualDrive.pullRemoteFile(fileId);
            this.workspace?.addSystemNotice(`Requesting file from other device...`);
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
                this.workspace?.addSystemNotice(`Requesting file "${entry.name}"...`);
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
      }
    );

    if (this.wakeLockUnsub) {
      this.wakeLockUnsub();
      this.wakeLockUnsub = null;
    }
    this.workspace.setWakeLockActive(wakeLock.isActive());
    this.wakeLockUnsub = wakeLock.onStateChange((active) => {
      this.workspace?.setWakeLockActive(active);
    });

    this.workspace.addSystemNotice('Direct peer-to-peer connection secured');
    return this.workspace.element;
  }

  private renderError(): HTMLElement {
    const errorWrapper = document.createElement('div');
    errorWrapper.className = 'app-error-view-container';

    const errorView = createErrorView(
      this.errorMessage,
      () => {
        this.cleanup();
        this.transition('idle');
      },
      this.lastConnectedRoomCode,
      (code) => {
        this.cleanup();
        void this.handleJoinRoom(code);
      }
    );
    errorWrapper.append(errorView);
    errorWrapper.append(createFooter((tab) => openDocModal(tab)));
    return errorWrapper;
  }

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
          if (this.state === 'connected') {
            this.lastConnectedRoomCode = this.roomCode || this.lastConnectedRoomCode;
            this.errorMessage = 'The direct peer-to-peer connection was interrupted or the other device left the room.';
            this.cleanup();
            this.transition('error');
          }
        },
        onError: (err: Error) => {
          if (this.state === 'connected') {
            console.warn('[App] Non-fatal signaling warning during active P2P session:', err);
            return;
          }
          this.lastConnectedRoomCode = this.roomCode || this.lastConnectedRoomCode;
          this.errorMessage = err.message || 'Direct connection failed.';
          this.cleanup();
          this.transition('error');
        },
      };

      this.peer = new PeerManager(SIGNAL_URL, events);
      this.roomCode = await this.peer.createRoom();
      this.lastConnectedRoomCode = this.roomCode;

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
      this.lastConnectedRoomCode = code;
      this.transition('joining');

      const events: PeerEvents = {
        onConnected: () => {
          if (this.state !== 'connected') {
            this.transition('connected');
          }
        },
        onDisconnected: () => {
          if (this.state === 'connected') {
            this.lastConnectedRoomCode = this.roomCode || this.lastConnectedRoomCode;
            this.errorMessage = 'The direct peer-to-peer connection was interrupted or the other device left the room.';
            this.cleanup();
            this.transition('error');
          }
        },
        onError: (err: Error) => {
          if (this.state === 'connected') {
            console.warn('[App] Non-fatal signaling warning during active P2P session:', err);
            return;
          }
          this.lastConnectedRoomCode = this.roomCode || this.lastConnectedRoomCode;
          this.errorMessage = err.message || 'Direct connection failed.';
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

    void wakeLock.acquire('webrtc');

    this.virtualDrive = new VirtualDriveManager(
      (data) => this.sendJSON(data),
      {
        onRemoteManifestUpdated: (files: VfsFileEntry[]) => {
          this.workspace?.setRemoteVfsEntries(files);
          this.workspace?.addSystemNotice(
            files.length > 0
              ? `${this.peerUsername} shared ${files.length} item(s)`
              : `${this.peerUsername} unmounted their shared files`
          );
        },
        onRemoteUnmounted: () => {
          this.workspace?.setRemoteVfsEntries([]);
          this.workspace?.addSystemNotice(`${this.peerUsername} unmounted their shared files`);
        },
        onFilePullRequested: (file: File) => {
          this.workspace?.addSystemNotice(`${this.peerUsername} requested "${file.name}"`);
          void this.handleSendSingleFile(file);
        },
        onNotice: (text: string) => {
          this.workspace?.addSystemNotice(text);
        },
      }
    );

    this.sendJSON({
      type: 'peer-intro',
      username: this.myUsername,
    });

    window.addEventListener('paste', this.handleGlobalPaste);
    channel.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;

      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;

        if (this.virtualDrive?.handleMessage(msg)) return;
        if (this.transferManager.handleControlMessage(msg)) return;
        if (isClipboardSyncMessage(msg)) {
          this.workspace?.addClipboardItem(msg.item, false);
          return;
        }

        if (msg.type === 'peer-intro') {
          const peerName = String(msg.username || 'Other Device');
          this.peerUsername = peerName;
          const myRole = this.peer?.role === 'offerer' ? 'HOST' : 'GUEST';
          const peerRole = myRole === 'HOST' ? 'GUEST' : 'HOST';
          this.workspace?.setPeerName(peerName, peerRole);
          this.workspace?.addSystemNotice(`${peerName} connected`);
          const headerPillName = document.querySelector('.peer-name');
          if (headerPillName) headerPillName.textContent = peerName;
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
          const newName = String(msg.username || 'Other Device');
          this.peerUsername = newName;
          const myRole = this.peer?.role === 'offerer' ? 'HOST' : 'GUEST';
          const peerRole = myRole === 'HOST' ? 'GUEST' : 'HOST';
          this.workspace?.setPeerName(newName, peerRole);
          this.workspace?.addSystemNotice(`${oldName} changed name to ${newName}`);
          const headerPillName = document.querySelector('.peer-name');
          if (headerPillName) headerPillName.textContent = newName;
        }
      } catch {}
    });

    if (this.dcKeepaliveTimer) clearInterval(this.dcKeepaliveTimer);
    this.dcKeepaliveTimer = setInterval(() => {
      if (this.isSendingFile) return;
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.sendJSON({ type: 'dc-ping' });
      }
    }, 15_000);

    this.listenForIncomingFiles(channel);
  }

  // ── Chat Messaging ───────────────────────────────

  private handleSendChatMessage(text: string): void {
    const timestamp = Date.now();

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
    if (this.state !== 'connected') return;

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

    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }

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

    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    this.sendJSON({
      type: 'clipboard-sync',
      item,
    });

    this.workspace?.addClipboardItem(item, true);
    showToast('Sent to connected device!');
  }

  // ── File Streaming & Transfers ───────────────────

  private async processFileToSend(rawFile: File): Promise<{
    file: File;
    isMetadataStripped: boolean;
    isZeroTrace: boolean;
  }> {
    let fileToSend = rawFile;
    let isMetadataStripped = false;
    let isZeroTrace = false;

    if (this.workspace?.getZeroTraceEnabled()) {
      isZeroTrace = true;
    } else {
      const zt = document.querySelector('#toggle-zero-trace') as HTMLInputElement | null;
      if (zt && zt.checked) isZeroTrace = true;
    }

    if (this.privacyShieldEnabled && isMetadataStrippable(rawFile)) {
      const stripResult = await stripImageMetadata(rawFile);
      if (stripResult.stripped) {
        fileToSend = stripResult.file;
        isMetadataStripped = true;
      }
    }

    return { file: fileToSend, isMetadataStripped, isZeroTrace };
  }

  private async handleSendFileList(files: File[]): Promise<void> {
    const fakeList = {
      length: files.length,
      item: (i: number) => files[i] || null,
      [Symbol.iterator]: function* () {
        for (const f of files) yield f;
      },
    } as unknown as FileList;
    for (let i = 0; i < files.length; i++) {
      Object.defineProperty(fakeList, i, { value: files[i], enumerable: true });
    }
    return this.handleSendFiles(fakeList);
  }

  private async handleSendFiles(files: FileList): Promise<void> {
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
        const fileId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${file.name}`;
        const totalChunks = Math.ceil(file.size / 65536) || 1;

        const controller = new TransferController(
          fileId,
          'sender',
          totalChunks,
          (msg) => this.sendJSON(msg),
        );
        this.transferManager.register(controller);

        const card = this.workspace?.addFileTransfer({
          fileId,
          fileName: file.name,
          fileSize: file.size,
          isMine: true,
          isMetadataStripped,
          isZeroTrace,
          onPause: () => controller.pause(true),
          onResume: () => controller.resume(true),
          onCancel: () => controller.cancel(true),
        });

        controller.onStateChange((state, details) => {
          if (state === 'paused_by_sender' || state === 'paused_by_receiver') {
            card?.setPaused?.(true, details?.by);
            this.workspace?.addSystemNotice(
              `Transfer paused by ${details?.by === 'sender' ? 'you' : this.peerUsername}`
            );
          } else if (state === 'transferring' || state === 'resuming') {
            card?.setPaused?.(false);
            this.workspace?.addSystemNotice(`Transfer resumed`);
          } else if (state === 'cancelled') {
            card?.setCancelled?.(details?.by === 'receiver' ? 'peer' : 'you');
            this.workspace?.addSystemNotice(
              `Transfer cancelled by ${details?.by === 'receiver' ? this.peerUsername : 'you'}`
            );
          }
        });

        try {
          const result = await sendFile(
            this.dataChannel,
            file,
            (progress: TransferProgress) => {
              card?.updateProgress(progress);
            },
            { isMetadataStripped, isZeroTrace, fileId, controller },
            this.peer?.getChannelPool(),
            controller,
          );
          card?.complete({
            sha256: result.sha256,
            isMetadataStripped,
            isZeroTrace,
          });
        } catch (err) {
          if (controller.isCancelled()) {
            card?.setCancelled?.('you');
          } else {
            card?.fail(err instanceof Error ? err.message : 'Send failed');
          }
        } finally {
          this.transferManager.remove(fileId);
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
    const fileId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${file.name}`;
    const totalChunks = Math.ceil(file.size / 65536) || 1;

    const controller = new TransferController(
      fileId,
      'sender',
      totalChunks,
      (msg) => this.sendJSON(msg),
    );
    this.transferManager.register(controller);

    const card = this.workspace?.addFileTransfer({
      fileId,
      fileName: file.name,
      fileSize: file.size,
      isMine: true,
      isMetadataStripped,
      isZeroTrace,
      onPause: () => controller.pause(true),
      onResume: () => controller.resume(true),
      onCancel: () => controller.cancel(true),
    });

    controller.onStateChange((state, details) => {
      if (state === 'paused_by_sender' || state === 'paused_by_receiver') {
        card?.setPaused?.(true, details?.by);
        this.workspace?.addSystemNotice(
          `Transfer paused by ${details?.by === 'sender' ? 'you' : this.peerUsername}`
        );
      } else if (state === 'transferring' || state === 'resuming') {
        card?.setPaused?.(false);
        this.workspace?.addSystemNotice(`Transfer resumed`);
      } else if (state === 'cancelled') {
        card?.setCancelled?.(details?.by === 'receiver' ? 'peer' : 'you');
        this.workspace?.addSystemNotice(
          `Transfer cancelled by ${details?.by === 'receiver' ? this.peerUsername : 'you'}`
        );
      }
    });

    void wakeLock.acquire('transfer');
    try {
      const result = await sendFile(
        this.dataChannel,
        file,
        (progress: TransferProgress) => {
          card?.updateProgress(progress);
        },
        { isMetadataStripped, isZeroTrace, fileId, controller },
        this.peer?.getChannelPool(),
        controller,
      );
      card?.complete({
        sha256: result.sha256,
        isMetadataStripped,
        isZeroTrace,
      });
    } catch (err) {
      if (controller.isCancelled()) {
        card?.setCancelled?.('you');
      } else {
        card?.fail(err instanceof Error ? err.message : 'Send failed');
      }
    } finally {
      this.transferManager.remove(fileId);
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
          if (meta.controller) {
            this.transferManager.register(meta.controller);
          }

          if (!card && this.workspace) {
            card = this.workspace.addFileTransfer({
              fileId: meta.fileId,
              fileName: meta.name,
              fileSize: meta.size,
              isMine: false,
              isMetadataStripped: meta.isMetadataStripped,
              isZeroTrace: meta.isZeroTrace,
              onPause: () => meta.controller?.pause(true),
              onResume: () => meta.controller?.resume(true),
              onCancel: () => meta.controller?.cancel(true),
            });

            meta.controller?.onStateChange((state, details) => {
              if (state === 'paused_by_sender' || state === 'paused_by_receiver') {
                card?.setPaused?.(true, details?.by);
                this.workspace?.addSystemNotice(
                  `Incoming file paused by ${details?.by === 'receiver' ? 'you' : this.peerUsername}`
                );
              } else if (state === 'transferring' || state === 'resuming') {
                card?.setPaused?.(false);
                this.workspace?.addSystemNotice(`Incoming file resumed`);
              } else if (state === 'cancelled') {
                card?.setCancelled?.(details?.by === 'sender' ? 'peer' : 'you');
                this.workspace?.addSystemNotice(
                  `Incoming file cancelled by ${details?.by === 'sender' ? this.peerUsername : 'you'}`
                );
              }
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
              onDownload: () => {
                downloadFile(received.blob, received.name);
                if (received.cleanup) {
                  setTimeout(() => {
                    void received.cleanup?.();
                  }, 2500);
                }
              },
            });
          }
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
    if (this.virtualDrive) {
      this.virtualDrive.cleanup();
      this.virtualDrive = null;
    }
    this.transferManager.clear();
  }
}