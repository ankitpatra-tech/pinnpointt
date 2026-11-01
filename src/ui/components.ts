/**
 * PinnPointt — Swiss Architectural DOM Component System
 * Clean Daylight Default + Refined Slate Mode, Zero Orange, Zero Emojis.
 */

import type { TransferProgress } from '../lib/webrtc/BinaryStreamer';
import type { ThemeMode } from './theme';
import { openDocModal, type DocTab } from './legalModal';
import { inspectFileSafety } from '../lib/safety';
import { type VfsFileEntry, isPreviewable } from '../lib/webrtc/virtualDrive';
import { copyTextToClipboard, type ClipboardItemData } from '../lib/clipboardSync';
import {
  iconLogo,
  iconSun,
  iconMoon,
  iconWifi,
  iconLock,
  iconShield,
  iconCheck,
  iconX,
  iconPause,
  iconPlay,
  iconCopy,
  iconPaperclip,
  iconSend,
  iconTerminal,
  iconDownload,
  iconEye,
  iconFolder,
  iconFileText,
  iconFile,
  iconAlertTriangle,
  iconAlertCircle,
  iconHelpCircle,
  iconArrowRight,
  iconHardDrive,
  iconZap,
  iconUsers,
  iconActivity,
  iconShare,
} from './icons';

// ─── DOM Helper ─────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Utilitarian, accessible toast feedback for clipboard copies and state actions.
 */
export function showToast(message: string, durationMs = 2400): void {
  const existing = document.querySelector('.pinnpointt-toast');
  if (existing) existing.remove();

  const toast = el('div', {
    className: 'pinnpointt-toast mono text-xs',
    textContent: message,
  });
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  if (bps === 0) return '0 B/s';
  const val = bytesToFormatted(bps);
  return `${val}/s`;
}

function bytesToFormatted(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(1)} ${units[i]}`;
}

export function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ─── Top Mode Bar (1-to-1, Broadcast, Virtual Drive) ──

export type AppWorkspaceMode = 'direct' | 'broadcast' | 'drive';

export function createModeBar(
  activeMode: AppWorkspaceMode,
  onSelect: (mode: AppWorkspaceMode) => void
): HTMLElement {
  const bar = el('div', { className: 'workspace-mode-bar' });
  const modes: { id: AppWorkspaceMode; label: string; icon: string }[] = [
    { id: 'direct', label: '1-to-1 Direct', icon: iconActivity({ size: 14 }) },
    { id: 'broadcast', label: 'Broadcast Room (1-to-Many)', icon: iconUsers({ size: 14 }) },
    { id: 'drive', label: 'Virtual Drive', icon: iconHardDrive({ size: 14 }) },
  ];

  modes.forEach(({ id, label, icon }) => {
    const btn = el('button', {
      type: 'button',
      className: `mode-tab-btn ${activeMode === id ? 'active' : ''}`,
    });
    btn.innerHTML = `${icon} <span>${label}</span>`;
    btn.addEventListener('click', () => onSelect(id));
    bar.append(btn);
  });

  return bar;
}

// ─── Nearby Wi-Fi Radar Banner ───────────────────────

export function createNearbyRadar(
  deviceCount: number = 1,
  onPair?: () => void
): HTMLElement {
  const banner = el('div', { className: 'wifi-radar-banner fade-in' });
  banner.innerHTML = `
    <div class="radar-pulse-dot"></div>
    ${iconWifi({ size: 14, className: 'radar-wifi-icon' })}
    <span class="radar-text"><strong class="tabular-nums">${deviceCount} device</strong> discovered on your Wi-Fi • Tap to pair instantly</span>
  `;

  if (onPair) {
    banner.style.cursor = 'pointer';
    banner.addEventListener('click', onPair);
  }

  return banner;
}

// ─── Desktop & Mobile Navigation Bar ────────────────

export function createNavbar(
  theme: ThemeMode,
  onToggleTheme: () => void,
  statusLabel: string = 'Direct P2P',
  onBrandClick?: () => void,
  onOpenGuide?: () => void
): HTMLElement {
  const nav = el('nav', { className: 'app-navbar' });

  const brand = el('div', { className: 'nav-brand' });
  const logo = el('div', { className: 'nav-logo' });
  logo.innerHTML = iconLogo(20);
  const titleWrap = el('div', { className: 'nav-title-wrap' });
  const title = el('span', { className: 'nav-title', textContent: 'PinnPointt' });
  const badge = el('span', { className: 'nav-badge mono text-xs', textContent: statusLabel });
  titleWrap.append(title, badge);
  brand.append(logo, titleWrap);

  if (onBrandClick) {
    brand.addEventListener('click', onBrandClick);
  }

  const actions = el('div', { className: 'nav-actions' });

  if (onOpenGuide) {
    const guideBtn = el('button', {
      className: 'btn-nav-guide mono text-xs',
      type: 'button',
      title: 'How to use PinnPointt (Step-by-step guide)',
    });
    guideBtn.innerHTML = `${iconHelpCircle({ size: 13 })} <span>Guide</span>`;
    guideBtn.addEventListener('click', onOpenGuide);
    actions.append(guideBtn);
  }

  const aboutLink = el('a', {
    className: 'nav-website-link mono text-xs',
    href: '/',
    textContent: 'Specs & Roadmap ↗',
    title: 'Why PinnPointt, Features, PWA Install & Open Source Roadmap',
  });

  const themeBtn = el('button', {
    className: 'btn-theme-toggle',
    type: 'button',
    title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`,
  });

  const themeIcon = theme === 'dark' ? iconSun({ size: 13 }) : iconMoon({ size: 13 });
  const themeLabel = theme === 'dark' ? 'Light' : 'Dark';
  themeBtn.innerHTML = `<span class="theme-icon">${themeIcon}</span> <span class="theme-label">${themeLabel}</span>`;
  themeBtn.addEventListener('click', onToggleTheme);

  actions.append(aboutLink, themeBtn);
  nav.append(brand, actions);
  return nav;
}

// ─── PWA Install Banner ─────────────────────────────

import { promptPWAInstall, onInstallAvailabilityChange, isStandalone, isIOS } from '../lib/pwaInstaller';

export function createInstallBanner(): HTMLElement {
  const banner = el('div', { className: 'install-banner' });
  banner.style.display = 'none';

  const left = el('div', { className: 'install-banner-left' });
  const icon = el('span', { className: 'install-icon' });
  icon.innerHTML = iconDownload({ size: 15 });
  const textWrap = el('div');
  const title = el('div', { className: 'install-title', textContent: 'Install PinnPointt App' });
  const desc = el('div', { className: 'install-desc', textContent: 'Launch full-screen from your desktop dock or home screen.' });
  textWrap.append(title, desc);
  left.append(icon, textWrap);

  const actions = el('div', { className: 'install-actions' });
  const installBtn = el('button', {
    className: 'btn btn-primary btn-sm btn-install-app trigger-pwa-install',
    type: 'button',
    textContent: 'Install',
  });
  const dismissBtn = el('button', {
    className: 'btn btn-ghost btn-sm',
    type: 'button',
    textContent: 'Not Now',
  });

  actions.append(installBtn, dismissBtn);
  banner.append(left, actions);

  const DISMISS_KEY = 'pinnpointt_install_dismissed';
  const isDismissed = localStorage.getItem(DISMISS_KEY) === '1';

  if (!isStandalone() && !isDismissed) {
    onInstallAvailabilityChange((canInstall) => {
      if (canInstall || isIOS()) {
        banner.style.display = 'flex';
      }
    });
  }

  installBtn.addEventListener('click', async () => {
    const outcome = await promptPWAInstall();
    if (outcome === 'accepted') {
      banner.style.display = 'none';
    } else if (outcome === 'ios') {
      alert(
        'To install on iPhone/iPad:\n' +
        '1. Tap the Share button in Safari (box with upward arrow).\n' +
        '2. Scroll down and tap "Add to Home Screen".'
      );
    }
  });

  dismissBtn.addEventListener('click', () => {
    banner.style.display = 'none';
    localStorage.setItem(DISMISS_KEY, '1');
  });

  return banner;
}

// ─── Footer ─────────────────────────────────────────

export function createFooter(onOpenDocModal?: (tab: DocTab) => void): HTMLElement {
  const footer = el('footer', { className: 'app-footer' });

  const credit = el('div', { className: 'footer-credit' });
  credit.innerHTML = `Developed by <span>Ankit Patra</span> for the community`;

  const linksRow = el('div', { className: 'footer-links' });

  const siteLink = el('a', {
    className: 'footer-link',
    href: '/',
    textContent: 'Home & Roadmap',
    title: 'Why PinnPointt, Features & Open Source Roadmap',
  });
  linksRow.append(siteLink);

  const initialSep = el('span', { className: 'footer-sep', textContent: '•' });
  linksRow.append(initialSep);

  const docLinks: { id: DocTab; label: string }[] = [
    { id: 'privacy', label: 'Privacy Policy' },
    { id: 'fair-usage', label: 'Fair Usage' },
    { id: 'disclaimer', label: 'Disclaimer' },
    { id: 'changelog', label: 'Changelog' },
  ];

  docLinks.forEach(({ id, label }) => {
    const btn = el('button', {
      className: 'footer-link',
      type: 'button',
      textContent: label,
      title: `View ${label}`,
    });
    btn.addEventListener('click', () => {
      if (onOpenDocModal) onOpenDocModal(id);
      else openDocModal(id);
    });
    linksRow.append(btn);

    const sep = el('span', { className: 'footer-sep', textContent: '•' });
    linksRow.append(sep);
  });

  const contactBtn = el('button', {
    className: 'footer-link',
    type: 'button',
    textContent: 'Contact',
    title: 'Send a message directly from PinnPointt',
  });
  contactBtn.addEventListener('click', () => {
    if (onOpenDocModal) onOpenDocModal('contact');
    else openDocModal('contact');
  });
  linksRow.append(contactBtn);

  const meta = el('div', { className: 'footer-meta' });
  const subtitle = el('span', {
    className: 'footer-subtitle',
    textContent: 'Direct device-to-device transfers • Zero cloud storage • 100% private',
  });
  const version = el('span', {
    className: 'footer-version mono tabular-nums',
    textContent: 'v0.0.57-beta',
    title: 'PinnPointt Version 0.0.57 Beta',
  });
  meta.append(subtitle, version);

  footer.append(credit, linksRow, meta);
  return footer;
}

// ─── Username & Identity Card ───────────────────────

import { generateDefaultUsername } from '../lib/username';

function getMonogram(name: string): string {
  const parts = name.split(/[-_ ]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || 'OP';
}

export function createUsernameBar(
  username: string,
  onUpdate: (newName: string) => void
): HTMLElement {
  const card = el('div', { className: 'identity-card' });

  const headerRow = el('div', { className: 'identity-card-header' });
  const tag = el('div', { className: 'identity-tag mono text-xs', textContent: 'OPERATOR IDENTITY' });
  headerRow.append(tag);

  const bodyRow = el('div', { className: 'identity-body' });
  const avatar = el('div', { className: 'avatar-monogram mono', textContent: getMonogram(username) });

  const inputWrap = el('div', { className: 'identity-input-wrap' });
  const input = el('input', {
    className: 'identity-input username-input',
    type: 'text',
    value: username,
    placeholder: 'Enter your name...',
    maxlength: '24',
    title: 'Click to edit your display name',
  }) as HTMLInputElement;

  const randBtn = el('button', {
    className: 'btn-randomize mono',
    type: 'button',
    title: 'Generate random name',
    textContent: '↻',
  });

  randBtn.addEventListener('click', () => {
    const generated = generateDefaultUsername();
    input.value = generated;
    avatar.textContent = getMonogram(generated);
    onUpdate(generated);
  });

  input.addEventListener('input', () => {
    avatar.textContent = getMonogram(input.value.trim() || 'OP');
  });

  input.addEventListener('change', () => {
    const clean = input.value.trim();
    if (clean) onUpdate(clean);
  });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      input.blur();
    }
  });

  inputWrap.append(input, randBtn);
  bodyRow.append(avatar, inputWrap);

  const hint = el('div', {
    className: 'identity-hint text-xs muted',
    textContent: 'Your operator moniker for this transfer session. Shared securely with your connected peer.',
  });

  card.append(headerRow, bodyRow, hint);
  return card;
}

// ─── Simple Quick-Start Guide (Clickable Navigation) ─

export function createOnboarding(
  activeStep: number,
  onSelectStep?: (step: 1 | 2 | 3) => void,
  onOpenTour?: () => void
): HTMLElement {
  const wrap = el('div', { className: 'onboarding' });

  const headerRow = el('div', { className: 'onboarding-header' });
  const titleSpan = el('span', { className: 'mono text-xs font-semibold', textContent: 'QUICK START (CLICK STEP TO NAVIGATE)' });
  const controls = el('div', { className: 'onboarding-controls' });

  if (onOpenTour) {
    const tourBtn = el('button', {
      className: 'onboarding-guide-btn mono text-xs',
      type: 'button',
      title: 'Open step-by-step onboarding walkthrough',
    });
    tourBtn.innerHTML = `${iconHelpCircle({ size: 12 })} <span>Tour Guide</span>`;
    tourBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onOpenTour();
    });
    controls.append(tourBtn);
  }

  const toggleBtn = el('button', {
    className: 'onboarding-toggle mono text-xs',
    type: 'button',
    textContent: 'collapse',
  });
  controls.append(toggleBtn);
  headerRow.append(titleSpan, controls);

  const steps = el('div', { className: 'onboarding-steps' });

  const stepData = [
    {
      num: 1 as const,
      title: '1. Set Your Name',
      desc: 'Choose your display name',
    },
    {
      num: 2 as const,
      title: '2. Pair Devices',
      desc: 'Tap to choose Create or Join',
    },
    {
      num: 3 as const,
      title: '3. Chat & Transfer',
      desc: 'Tap to try interactive demo',
    },
  ];

  stepData.forEach(({ num, title, desc }) => {
    const isActive = num === activeStep;
    const stepAttrs: Record<string, string> = {
      className: `onboarding-step ${isActive ? 'active' : ''} ${onSelectStep ? 'clickable' : ''}`,
      title: `Navigate to: ${title}`,
    };
    if (onSelectStep) {
      stepAttrs.role = 'button';
      stepAttrs.tabindex = '0';
    }
    const step = el('div', stepAttrs);
    const badge = el('div', {
      className: `step-badge mono ${isActive ? 'active' : ''}`,
      textContent: String(num),
    });
    const content = el('div', { className: 'step-content' });
    const titleEl = el('div', { className: 'step-title font-semibold', textContent: title });
    const descEl = el('div', { className: 'step-desc text-xs muted', textContent: desc });
    content.append(titleEl, descEl);
    step.append(badge, content);

    if (onSelectStep) {
      step.addEventListener('click', () => onSelectStep(num));
      step.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectStep(num);
        }
      });
    }

    steps.append(step);
  });

  wrap.append(headerRow, steps);

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.toggle('collapsed');
    toggleBtn.textContent = wrap.classList.contains('collapsed') ? 'expand' : 'collapse';
  });

  headerRow.addEventListener('click', () => {
    wrap.classList.toggle('collapsed');
    toggleBtn.textContent = wrap.classList.contains('collapsed') ? 'expand' : 'collapse';
  });

  return wrap;
}

// ─── Pair Selection ─────────────────────────────────

export interface PairCallbacks {
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onPreviewWorkspace?: () => void;
}

export function createPairSelection(callbacks: PairCallbacks): HTMLElement {
  const container = el('div', { className: 'stack stack-md' });

  const options = el('div', { className: 'pair-options' });

  const createOpt = el('div', { className: 'pair-option' });
  createOpt.innerHTML = `
    <span class="pair-option-icon">${iconShare({ size: 18 })}</span>
    <span class="pair-option-label">Create a Room</span>
    <span class="pair-option-desc">Get a QR code &amp; 6-letter room code to connect another device</span>
  `;
  createOpt.addEventListener('click', callbacks.onCreateRoom);

  const joinOpt = el('div', { className: 'pair-option' });
  joinOpt.innerHTML = `
    <span class="pair-option-icon">${iconTerminal({ size: 18 })}</span>
    <span class="pair-option-label">Join with Code</span>
    <span class="pair-option-desc">Enter the 6-character room code displayed on your peer device</span>
  `;
  joinOpt.addEventListener('click', callbacks.onJoinRoom);

  options.append(createOpt, joinOpt);
  container.append(options);

  if (callbacks.onPreviewWorkspace) {
    const previewBtn = el('button', {
      className: 'btn-preview',
      type: 'button',
      title: 'Preview the chat window, drag & drop, and transfers in demo mode',
    });
    previewBtn.innerHTML = `${iconPlay({ size: 14 })} <span>Try Interactive Demo (Chat &amp; File Sharing)</span>`;
    previewBtn.addEventListener('click', callbacks.onPreviewWorkspace);
    container.append(previewBtn);
  }

  // Capability highlights strip
  const highlights = el('div', { className: 'landing-highlights' });
  highlights.innerHTML = `
    <div class="landing-highlight-item" title="Mount files or folders as a remote drive with instant byte-slice preview">
      <span class="highlight-icon">${iconHardDrive({ size: 16 })}</span>
      <div class="highlight-text">
        <span class="highlight-title">P2P Virtual Drive</span>
        <span class="highlight-sub">Browse &amp; preview remote folders</span>
      </div>
    </div>
    <div class="landing-highlight-item" title="Losslessly strip EXIF &amp; GPS metadata in-memory before sending">
      <span class="highlight-icon">${iconShield({ size: 16 })}</span>
      <div class="highlight-text">
        <span class="highlight-title">In-Flight Privacy Shield</span>
        <span class="highlight-sub">Auto EXIF &amp; GPS stripping</span>
      </div>
    </div>
    <div class="landing-highlight-item" title="Stream multi-GB files directly to OPFS / disk with active screen wake lock">
      <span class="highlight-icon">${iconZap({ size: 16 })}</span>
      <div class="highlight-text">
        <span class="highlight-title">Zero-RAM Disk Streaming</span>
        <span class="highlight-sub">OPFS multi-GB &amp; Screen Awake</span>
      </div>
    </div>
    <div class="landing-highlight-item" title="Ephemeral in-memory canvas viewing &amp; real-time clipboard sync">
      <span class="highlight-icon">${iconLock({ size: 16 })}</span>
      <div class="highlight-text">
        <span class="highlight-title">Zero-Trace &amp; Clipboard</span>
        <span class="highlight-sub">Memory canvas &amp; live sync</span>
      </div>
    </div>
  `;
  container.append(highlights);

  return container;
}

// ─── Room Display (QR + Code) ───────────────────────

export function createRoomDisplay(
  roomCode: string,
  canvasElement: HTMLCanvasElement,
  onBack?: () => void
): HTMLElement {
  const container = el('div', { className: 'stack stack-md text-center fade-in' });

  if (onBack) {
    const headerRow = el('div', { className: 'room-header-row' });
    const backBtn = el('button', {
      className: 'btn btn-sm btn-ghost btn-back-room',
      type: 'button',
      textContent: '← Back to Options',
      title: 'Return to pairing setup',
    });
    backBtn.addEventListener('click', onBack);

    const titleBadge = el('span', { className: 'status-badge mono text-xs' });
    titleBadge.innerHTML = `<span class="status-dot connected"></span> ROOM READY`;
    headerRow.append(backBtn, titleBadge);
    container.append(headerRow);
  }

  const qrWrap = el('div', { className: 'qr-container' });
  const canvasWrap = el('div', { className: 'qr-canvas-wrap' });
  canvasWrap.append(canvasElement);

  const qrHint = el('div', {
    className: 'qr-instruction text-xs muted',
    textContent: 'Scan with smartphone camera or QR reader to pair instantly',
  });

  const isLocalHost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );

  qrWrap.append(canvasWrap, qrHint);

  if (isLocalHost) {
    const localTip = el('div', {
      className: 'qr-local-tip mono text-xs muted',
      textContent: 'Tip: To scan from another phone/device, connect over your local Wi-Fi IP or production URL.',
    });
    qrWrap.append(localTip);
  }

  const sep = el('div', { className: 'separator' });
  sep.innerHTML = '<span class="mono text-xs">or enter this code on the other device</span>';

  const codeDisplay = el('div', { className: 'room-code-display mono' });
  for (const ch of roomCode) {
    const digit = el('span', { className: 'digit tabular-nums', textContent: ch });
    codeDisplay.append(digit);
  }

  const status = el('div', { className: 'status-badge mt-md mono text-xs' });
  status.style.margin = '12px auto 0';
  status.innerHTML = `<span class="status-dot"></span> Waiting for peer (code expires in 10m)`;

  const linkRow = el('div', { className: 'room-actions-row' });

  const copyLinkBtn = el('button', {
    className: 'btn btn-secondary btn-sm',
    type: 'button',
    title: 'Copies the deep-link URL to your clipboard',
  });
  copyLinkBtn.innerHTML = `${iconCopy({ size: 14 })} <span>Copy Invite Link</span>`;
  copyLinkBtn.addEventListener('click', () => {
    const url = `${window.location.origin}/app?room=${roomCode}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        copyLinkBtn.innerHTML = `${iconCheck({ size: 14 })} <span>Link Copied</span>`;
        setTimeout(() => {
          copyLinkBtn.innerHTML = `${iconCopy({ size: 14 })} <span>Copy Invite Link</span>`;
        }, 2500);
      }).catch(() => {
        prompt('Copy invite link:', url);
      });
    } else {
      prompt('Copy invite link:', url);
    }
  });

  const peerTabBtn = el('button', {
    className: 'btn-peer-tab btn btn-ghost btn-sm mono text-xs',
    type: 'button',
    textContent: '↗ Open Peer in New Tab',
    title: 'Opens a second window that auto-joins this room to test device-to-device transfer',
  });
  peerTabBtn.addEventListener('click', () => {
    window.open(`${window.location.origin}/app?room=${roomCode}`, '_blank');
  });

  linkRow.append(copyLinkBtn, peerTabBtn);
  container.append(qrWrap, sep, codeDisplay, status, linkRow);

  if (onBack) {
    const bottomBackBtn = el('button', {
      className: 'btn btn-secondary w-full mt-sm btn-back-room',
      type: 'button',
      textContent: '← Back to Pairing Options',
      title: 'Cancel this room and return to pairing options',
    });
    bottomBackBtn.addEventListener('click', onBack);
    container.append(bottomBackBtn);
  }

  return container;
}

// ─── Join Room Input ────────────────────────────────

export interface JoinInputResult {
  element: HTMLElement;
  backBtn: HTMLButtonElement;
}

export function createJoinInputWithBack(onSubmit: (code: string) => void): JoinInputResult {
  const container = el('div', { className: 'stack stack-md text-center fade-in' });

  const label = el('h2', { className: 'font-semibold', textContent: 'Enter Room Code' });

  const inputRow = el('div', { className: 'room-code-input' });
  const inputs: HTMLInputElement[] = [];

  for (let i = 0; i < 6; i++) {
    const input = el('input', {
      type: 'text',
      maxlength: '1',
      autocomplete: 'off',
      autocapitalize: 'characters',
      className: 'mono tabular-nums',
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
      if (input.value && i < 5) {
        inputs[i + 1].focus();
      }
    });
    input.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
      const text = (e.clipboardData?.getData('text') || '')
        .toUpperCase()
        .replace(/[^A-Z2-9]/g, '')
        .slice(0, 6);
      if (text) {
        for (let idx = 0; idx < text.length; idx++) {
          inputs[idx].value = text[idx];
        }
        if (text.length === 6) {
          inputs[5].blur();
          onSubmit(text);
        } else if (text.length < 6) {
          inputs[text.length].focus();
        }
      }
    });
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        inputs[i - 1].focus();
      }
      if (e.key === 'Enter') {
        const code = inputs.map((inp) => inp.value).join('');
        if (code.length === 6) onSubmit(code);
      }
    });
    inputs.push(input);
    inputRow.append(input);
  }

  const submitBtn = el('button', { className: 'btn btn-primary w-full mt-md btn-connect-room', textContent: 'Connect' });
  submitBtn.addEventListener('click', () => {
    const code = inputs.map((inp) => inp.value).join('');
    if (code.length === 6) onSubmit(code);
  });

  const backBtn = el('button', { className: 'btn btn-ghost w-full', textContent: '← Back' }) as HTMLButtonElement;

  container.append(label, inputRow, submitBtn, backBtn);
  return { element: container, backBtn };
}

// ─── Unified Connected Workspace (Chat + File Sharing) ──

export interface WorkspaceCallbacks {
  onSendMessage: (text: string) => void;
  onFilesSelected: (files: FileList) => void;
  onMountFiles?: (files: FileList | File[]) => void;
  onUnmountDrive?: () => void;
  onPullRemoteFile?: (fileId: string) => void;
  onPreviewRemoteFile?: (file: VfsFileEntry) => void;
  onSendClipboard?: () => void;
  onDisconnect: () => void;
}

export interface FileCardController {
  updateProgress: (p: TransferProgress) => void;
  setMetadataStripped?: (stripped: boolean) => void;
  setZeroTrace?: (zeroTrace: boolean) => void;
  setPaused?: (isPaused: boolean, pausedBy?: 'you' | 'peer' | 'sender' | 'receiver') => void;
  setCancelled?: (cancelledBy?: 'you' | 'peer') => void;
  complete: (info: {
    sha256: string;
    onDownload?: () => void;
    isDirectDiskSave?: boolean;
    isMetadataStripped?: boolean;
    isZeroTrace?: boolean;
    onZeroTraceView?: () => void;
  }) => void;
  fail: (err: string) => void;
}

export interface WorkspaceController {
  element: HTMLElement;
  setPeerName: (name: string, role: string) => void;
  setWakeLockActive: (active: boolean) => void;
  addSystemNotice: (text: string) => void;
  addChatMessage: (msg: { sender: string; text: string; timestamp: number; isMine: boolean }) => void;
  addClipboardItem: (item: ClipboardItemData, isMine: boolean) => void;
  addFileTransfer: (opts: {
    fileId?: string;
    fileName: string;
    fileSize: number;
    isMine: boolean;
    isMetadataStripped?: boolean;
    isZeroTrace?: boolean;
    onPause?: () => void;
    onResume?: () => void;
    onCancel?: () => void;
  }) => FileCardController;
  getPrivacyShieldEnabled: () => boolean;
  getZeroTraceEnabled: () => boolean;
  setLocalVfsEntries: (entries: VfsFileEntry[]) => void;
  setRemoteVfsEntries: (entries: VfsFileEntry[]) => void;
  switchTab: (tab: 'activity' | 'drive') => void;
}

function inferShortType(mime: string, name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'IMAGE';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'VIDEO';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'AUDIO';
  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF';
  if (mime.includes('markdown') || ext === 'md') return 'MD';
  if (mime.includes('json') || ext === 'json') return 'JSON';
  if (mime.includes('csv') || ext === 'csv') return 'CSV';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'c', 'cpp', 'html', 'css'].includes(ext)) return ext.toUpperCase();
  if (mime.startsWith('text/') || ext === 'txt') return 'TEXT';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'ARCHIVE';
  return ext ? ext.toUpperCase() : 'FILE';
}

function renderLocalVfsView(
  container: HTMLElement,
  entries: VfsFileEntry[],
  onUnmount?: () => void,
): void {
  container.innerHTML = '';

  if (entries.length === 0) {
    const hint = el('div', {
      className: 'vfs-local-empty mono text-xs muted',
      textContent: 'No local files mounted. Use "Mount Files" or "Mount Folder" to share a virtual drive with your peer.',
    });
    container.append(hint);
    return;
  }

  const totalBytes = entries.reduce((acc, f) => acc + f.size, 0);

  const card = el('div', { className: 'vfs-local-card' });

  const head = el('div', { className: 'row-between mb-xs' });
  const badge = el('div', { className: 'vfs-local-badge mono text-xs' });
  badge.innerHTML = `<span class="vfs-local-dot"></span> <span class="tabular-nums font-semibold">${entries.length} items live mounted (${formatBytes(totalBytes)})</span>`;

  const unmountBtn = el('button', {
    type: 'button',
    className: 'btn btn-ghost btn-xs',
    textContent: 'Unmount All',
  });
  unmountBtn.addEventListener('click', () => onUnmount?.());
  head.append(badge, unmountBtn);

  const note = el('div', {
    className: 'text-xs muted',
    textContent: 'Live remote mount active. Remote peer can explore folders, preview slices, or pull items on demand.',
  });

  card.append(head, note);
  container.append(card);
}

function renderRemoteVfsView(
  container: HTMLElement,
  entries: VfsFileEntry[],
  peerName: string,
  onPreview?: (f: VfsFileEntry) => void,
  onPull?: (fileId: string) => void,
): void {
  container.innerHTML = '';

  if (entries.length === 0) {
    const empty = el('div', { className: 'vfs-empty-card' });
    empty.innerHTML = `
      <div class="vfs-empty-icon">${iconHardDrive({ size: 24 })}</div>
      <div class="vfs-empty-title font-semibold">No Remote Drive Mounted</div>
      <div class="vfs-empty-desc text-xs muted">When ${peerName} mounts files or folders in Virtual Drive mode, you can explore them and selectively preview or pull items here.</div>
    `;
    container.append(empty);
    return;
  }

  const totalBytes = entries.reduce((acc, f) => acc + f.size, 0);

  const sectionHead = el('div', { className: 'row-between vfs-section-head' });
  const title = el('div', { className: 'vfs-section-title font-semibold text-sm', textContent: `Remote Mounted Files (from ${peerName})` });
  const stats = el('div', { className: 'mono text-xs muted tabular-nums', textContent: `${entries.length} items • ${formatBytes(totalBytes)}` });
  sectionHead.append(title, stats);

  const tableWrap = el('div', { className: 'vfs-table-wrap' });
  const table = el('table', { className: 'vfs-table' });

  const thead = el('thead');
  thead.innerHTML = `
    <tr>
      <th>File / Relative Path</th>
      <th>Type</th>
      <th>Size</th>
      <th style="text-align: right;">Action</th>
    </tr>
  `;

  const tbody = el('tbody');

  for (const f of entries) {
    const tr = el('tr');

    const tdName = el('td');
    const nameEl = el('div', { className: 'vfs-table-filename font-semibold', textContent: f.name });
    const pathEl = el('div', { className: 'vfs-table-path mono text-xs muted', textContent: f.relativePath });
    tdName.append(nameEl, pathEl);

    const tdType = el('td');
    const typeBadge = el('span', { className: 'vfs-type-tag mono text-xs', textContent: inferShortType(f.mimeType, f.name) });
    tdType.append(typeBadge);

    const tdSize = el('td', { className: 'mono text-xs tabular-nums', textContent: formatBytes(f.size) });

    const tdAction = el('td', { className: 'vfs-action-cell', style: 'text-align: right;' });
    if (isPreviewable(f.mimeType, f.name)) {
      const prevBtn = el('button', {
        type: 'button',
        className: 'btn btn-secondary btn-xs vfs-btn-preview mr-xs',
        textContent: 'Preview',
      });
      prevBtn.style.marginRight = '6px';
      prevBtn.addEventListener('click', () => onPreview?.(f));
      tdAction.append(prevBtn);
    }

    const pullBtn = el('button', {
      type: 'button',
      className: 'btn btn-primary btn-xs vfs-btn-pull',
      textContent: 'Pull File',
    });
    pullBtn.addEventListener('click', () => onPull?.(f.id));
    tdAction.append(pullBtn);

    tr.append(tdName, tdType, tdSize, tdAction);
    tbody.append(tr);
  }

  table.append(thead, tbody);
  tableWrap.append(table);
  container.append(sectionHead, tableWrap);
}

export function createConnectedWorkspace(
  initialPeerName: string,
  initialRole: string,
  callbacks: WorkspaceCallbacks,
  isPreview: boolean = false
): WorkspaceController {
  const container = el('div', { className: 'stack stack-md fade-in' });

  if (isPreview) {
    const banner = el('div', { className: 'preview-banner' });
    const bannerTxt = el('span', { className: 'mono text-xs' });
    bannerTxt.innerHTML = `${iconActivity({ size: 13 })} <span>PREVIEW MODE — Interacting with simulated peer</span>`;
    const exitBtn = el('button', { type: 'button', className: 'mono text-xs', textContent: 'Exit Preview' });
    exitBtn.addEventListener('click', callbacks.onDisconnect);
    banner.append(bannerTxt, exitBtn);
    container.append(banner);
  }

  // 1. Header with Peer Badge, E2EE Indicator & Disconnect
  const header = el('div', { className: 'workspace-header' });

  const peerBadge = el('div', { className: 'workspace-peer-badge' });
  const statusDot = el('span', { className: 'status-dot connected' });
  const peerText = el('span', {}, 'Connected with ');
  const peerNameEl = el('span', { className: 'peer-name font-semibold', textContent: initialPeerName });
  const roleEl = el('span', { className: 'text-xs mono muted', textContent: `(${initialRole})` });
  peerBadge.append(statusDot, peerText, peerNameEl, roleEl);

  const e2eBadge = el('div', {
    className: 'workspace-e2e-badge mono text-xs',
    title: 'Direct peer-to-peer connection encrypted with WebRTC DTLS (TLS 1.3/AES-GCM). Zero server storage.',
  });
  e2eBadge.innerHTML = `<span class="e2e-lock">${iconLock({ size: 12 })}</span> <span class="e2e-text">E2E Encrypted</span>`;

  const wakeLockBadge = el('div', {
    className: 'workspace-wakelock-badge mono text-xs',
    title: 'Screen WakeLock Active — Display sleep prevented during transfer',
  });
  wakeLockBadge.style.display = 'none';
  wakeLockBadge.innerHTML = `<span class="wakelock-dot"></span> <span class="wakelock-text">Screen Awake Active</span>`;

  const disconnectBtn = el('button', { className: 'btn btn-ghost btn-sm mono text-xs', textContent: 'Disconnect' });
  disconnectBtn.style.padding = '4px 10px';
  disconnectBtn.addEventListener('click', callbacks.onDisconnect);

  header.append(peerBadge, e2eBadge, wakeLockBadge, disconnectBtn);

  // 2. Workspace Navigation Tabs
  const tabRow = el('div', { className: 'workspace-tab-row' });
  const activityTabBtn = el('button', {
    type: 'button',
    className: 'workspace-tab-btn active',
    textContent: 'Activity & Feed',
  });
  const driveTabBtn = el('button', {
    type: 'button',
    className: 'workspace-tab-btn',
  });
  const driveTabTitle = el('span', {}, 'Virtual Drive ');
  const driveTabBadge = el('span', { className: 'vfs-tab-badge tabular-nums mono' });
  driveTabBadge.style.display = 'none';
  driveTabBtn.append(driveTabTitle, driveTabBadge);
  tabRow.append(activityTabBtn, driveTabBtn);

  // Panels
  const activityPanel = el('div', { className: 'workspace-panel activity-panel' });
  const drivePanel = el('div', { className: 'workspace-panel drive-panel stack stack-md' });
  drivePanel.style.display = 'none';

  function switchTab(tab: 'activity' | 'drive') {
    if (tab === 'activity') {
      activityTabBtn.classList.add('active');
      driveTabBtn.classList.remove('active');
      activityPanel.style.display = 'block';
      drivePanel.style.display = 'none';
    } else {
      driveTabBtn.classList.add('active');
      activityTabBtn.classList.remove('active');
      activityPanel.style.display = 'none';
      drivePanel.style.display = 'block';
    }
  }

  activityTabBtn.addEventListener('click', () => switchTab('activity'));
  driveTabBtn.addEventListener('click', () => switchTab('drive'));

  // 3. Chat & File Activity Feed
  const feed = el('div', { className: 'chat-feed' });

  let isMountMode = false;
  const handleIncomingFiles = (files: FileList) => {
    if (isMountMode) {
      callbacks.onMountFiles?.(files);
      switchTab('drive');
    } else {
      callbacks.onFilesSelected(files);
    }
  };

  feed.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    feed.classList.add('dragover');
  });
  feed.addEventListener('dragleave', () => {
    feed.classList.remove('dragover');
  });
  feed.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    feed.classList.remove('dragover');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleIncomingFiles(e.dataTransfer.files);
    }
  });

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });
  };

  // 4. Input Row
  const inputRow = el('div', { className: 'chat-input-row' });

  const fileInput = el('input', {
    type: 'file',
    multiple: '',
    className: 'file-hidden-input',
  }) as HTMLInputElement;

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleIncomingFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  const attachBtn = el('button', {
    className: 'btn-attach',
    type: 'button',
    title: 'Attach file (or drag & drop anywhere)',
  });
  attachBtn.innerHTML = `${iconPaperclip({ size: 14 })} <span class="attach-label">File</span>`;
  attachBtn.addEventListener('click', () => fileInput.click());

  const modeBtn = el('button', {
    type: 'button',
    className: 'btn-mode-toggle push-active',
    title: 'Mode: Push Immediately. Click to toggle Mount as Virtual Drive.',
  });
  modeBtn.innerHTML = `${iconZap({ size: 13 })} <span class="mode-label">Push</span>`;
  modeBtn.addEventListener('click', () => {
    isMountMode = !isMountMode;
    if (isMountMode) {
      modeBtn.className = 'btn-mode-toggle mount-active';
      modeBtn.innerHTML = `${iconHardDrive({ size: 13 })} <span class="mode-label">Mount</span>`;
      modeBtn.title = 'Mode: Mount as Virtual Drive. Click to toggle Push Immediately.';
    } else {
      modeBtn.className = 'btn-mode-toggle push-active';
      modeBtn.innerHTML = `${iconZap({ size: 13 })} <span class="mode-label">Push</span>`;
      modeBtn.title = 'Mode: Push Immediately. Click to toggle Mount as Virtual Drive.';
    }
  });

  const textInput = el('input', {
    type: 'text',
    className: 'chat-input',
    placeholder: 'Type an end-to-end encrypted message or drop files...',
    autocomplete: 'off',
    title: 'End-to-End Encrypted via WebRTC DTLS',
  }) as HTMLInputElement;

  const sendBtn = el('button', {
    className: 'btn btn-primary chat-send-btn',
    textContent: 'Send',
    type: 'button',
  });

  const handleSend = () => {
    const text = textInput.value.trim();
    if (!text) return;
    callbacks.onSendMessage(text);
    textInput.value = '';
    textInput.focus();
  };

  sendBtn.addEventListener('click', handleSend);
  textInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });

  // Tools bar
  const toolsBar = el('div', { className: 'workspace-tools-bar row-between' });

  const clipboardBtn = el('button', {
    type: 'button',
    className: 'btn-clipboard-sync mono text-xs',
    title: 'Send device clipboard content to peer (or press Ctrl+V / Cmd+V anywhere)',
  });
  clipboardBtn.innerHTML = `${iconCopy({ size: 13 })} <span class="tools-btn-label">Send Clipboard</span>`;
  clipboardBtn.addEventListener('click', () => {
    callbacks.onSendClipboard?.();
  });

  const toolsHint = el('span', {
    className: 'tools-hint mono text-xs muted',
    textContent: 'Ctrl+V anywhere to sync clipboard',
  });

  const toolsLeft = el('div', { className: 'tools-left' });
  toolsLeft.append(clipboardBtn, toolsHint);

  const togglesWrap = el('div', { className: 'sender-toggles' });

  const privacyCheckbox = el('input', {
    type: 'checkbox',
    id: 'toggle-privacy-shield',
    className: 'toggle-checkbox',
  }) as HTMLInputElement;
  privacyCheckbox.checked = true;

  const privacyLabel = el('label', {
    className: 'toggle-control',
    title: 'In-Flight Privacy Shield: losslessly strip EXIF/GPS, camera serials, and timestamps from images before transmission',
  });
  const privacyText = el('span', { className: 'toggle-label mono text-xs' });
  privacyText.innerHTML = `${iconShield({ size: 12 })} <span>Strip EXIF</span>`;
  privacyLabel.append(privacyCheckbox, privacyText);

  const zeroTraceCheckbox = el('input', {
    type: 'checkbox',
    id: 'toggle-zero-trace',
    className: 'toggle-checkbox',
  }) as HTMLInputElement;

  const zeroTraceLabel = el('label', {
    className: 'toggle-control',
    title: 'Zero-Trace View Only: receiver views image in ephemeral canvas memory with download disabled',
  });
  const zeroTraceText = el('span', { className: 'toggle-label mono text-xs' });
  zeroTraceText.innerHTML = `${iconLock({ size: 12 })} <span>Zero-Trace</span>`;
  zeroTraceLabel.append(zeroTraceCheckbox, zeroTraceText);

  togglesWrap.append(privacyLabel, zeroTraceLabel);
  toolsBar.append(toolsLeft, togglesWrap);

  inputRow.append(fileInput, attachBtn, modeBtn, textInput, sendBtn);
  activityPanel.append(feed, toolsBar, inputRow);

  // Virtual Drive Panel Layout
  const driveTopBar = el('div', { className: 'vfs-top-bar row-between' });
  const driveBarLeft = el('div');
  const driveBarTitle = el('div', { className: 'vfs-top-title font-semibold text-sm', textContent: 'Virtual Drive / Live Remote Mount' });
  const driveBarSub = el('div', { className: 'text-xs muted', textContent: 'Mount local files or folders for peer browsing, slice previews, and on-demand pull.' });
  driveBarLeft.append(driveBarTitle, driveBarSub);

  const vfsFileInput = el('input', {
    type: 'file',
    multiple: '',
    style: 'display: none;',
  }) as HTMLInputElement;

  const vfsFolderInput = el('input', {
    type: 'file',
    multiple: '',
    style: 'display: none;',
  }) as HTMLInputElement;
  vfsFolderInput.setAttribute('webkitdirectory', '');
  vfsFolderInput.setAttribute('directory', '');

  vfsFileInput.addEventListener('change', () => {
    if (vfsFileInput.files && vfsFileInput.files.length > 0) {
      callbacks.onMountFiles?.(vfsFileInput.files);
      vfsFileInput.value = '';
    }
  });

  vfsFolderInput.addEventListener('change', () => {
    if (vfsFolderInput.files && vfsFolderInput.files.length > 0) {
      callbacks.onMountFiles?.(vfsFolderInput.files);
      vfsFolderInput.value = '';
    }
  });

  const mountActions = el('div', { className: 'vfs-mount-actions' });
  const mountFilesBtn = el('button', {
    type: 'button',
    className: 'btn btn-secondary btn-sm',
  });
  mountFilesBtn.innerHTML = `${iconFile({ size: 13 })} <span>Mount Files</span>`;
  mountFilesBtn.addEventListener('click', () => vfsFileInput.click());

  const mountFolderBtn = el('button', {
    type: 'button',
    className: 'btn btn-secondary btn-sm',
  });
  mountFolderBtn.innerHTML = `${iconFolder({ size: 13 })} <span>Mount Folder</span>`;
  mountFolderBtn.addEventListener('click', () => vfsFolderInput.click());

  mountActions.append(vfsFileInput, vfsFolderInput, mountFilesBtn, mountFolderBtn);
  driveTopBar.append(driveBarLeft, mountActions);

  const localVfsContainer = el('div', { className: 'vfs-local-container' });
  const remoteVfsContainer = el('div', { className: 'vfs-remote-container' });

  drivePanel.append(driveTopBar, localVfsContainer, remoteVfsContainer);
  container.append(header, tabRow, activityPanel, drivePanel);

  let localVfsList: VfsFileEntry[] = [];
  let remoteVfsList: VfsFileEntry[] = [];
  let currentPeerName = initialPeerName;

  function updateLocalView() {
    renderLocalVfsView(localVfsContainer, localVfsList, callbacks.onUnmountDrive);
  }

  function updateRemoteView() {
    renderRemoteVfsView(
      remoteVfsContainer,
      remoteVfsList,
      currentPeerName,
      callbacks.onPreviewRemoteFile,
      callbacks.onPullRemoteFile,
    );
    if (remoteVfsList.length > 0) {
      driveTabBadge.textContent = String(remoteVfsList.length);
      driveTabBadge.style.display = 'inline-flex';
    } else {
      driveTabBadge.style.display = 'none';
    }
  }

  updateLocalView();
  updateRemoteView();

  return {
    element: container,
    setPeerName(name: string, role: string) {
      currentPeerName = name;
      peerNameEl.textContent = name;
      roleEl.textContent = `(${role})`;
      updateRemoteView();
    },
    setWakeLockActive(active: boolean) {
      wakeLockBadge.style.display = active ? 'inline-flex' : 'none';
    },
    setLocalVfsEntries(entries: VfsFileEntry[]) {
      localVfsList = entries;
      updateLocalView();
    },
    setRemoteVfsEntries(entries: VfsFileEntry[]) {
      remoteVfsList = entries;
      updateRemoteView();
    },
    switchTab(tab: 'activity' | 'drive') {
      switchTab(tab);
    },
    addSystemNotice(text: string) {
      const notice = el('div', { className: 'system-notice mono text-xs', textContent: text });
      feed.append(notice);
      scrollToBottom();
    },
    addChatMessage(msg: { sender: string; text: string; timestamp: number; isMine: boolean }) {
      const row = el('div', { className: `chat-msg ${msg.isMine ? 'mine' : 'peer'}` });

      const meta = el('div', { className: 'chat-meta' });
      const sender = el('span', { className: 'chat-sender font-semibold', textContent: msg.sender });
      const time = el('span', { className: 'chat-time mono text-xs muted tabular-nums', textContent: formatTime(msg.timestamp) });
      meta.append(sender, time);

      const bubble = el('div', { className: 'chat-bubble', textContent: msg.text });
      row.append(meta, bubble);

      feed.append(row);
      scrollToBottom();
    },
    getPrivacyShieldEnabled() {
      return privacyCheckbox.checked;
    },
    getZeroTraceEnabled() {
      return zeroTraceCheckbox.checked;
    },
    addClipboardItem(item: ClipboardItemData, isMine: boolean) {
      const row = el('div', { className: `chat-msg ${isMine ? 'mine' : 'peer'}` });

      const meta = el('div', { className: 'chat-meta' });
      const sender = el('span', { className: 'chat-sender font-semibold', textContent: item.sender });
      const time = el('span', { className: 'chat-time mono text-xs muted tabular-nums', textContent: formatTime(item.timestamp) });
      meta.append(sender, time);

      const card = el('div', { className: 'clipboard-sync-card' });

      const head = el('div', { className: 'clipboard-card-head row-between' });
      const typeBadge = el('span', {
        className: `clipboard-type-badge ${item.type} mono text-xs`,
      });
      const typeIcon = item.type === 'code' ? iconTerminal({ size: 12 }) : item.type === 'url' ? iconShare({ size: 12 }) : iconFileText({ size: 12 });
      typeBadge.innerHTML = `${typeIcon} <span>${item.type.toUpperCase()}</span>`;
      head.append(typeBadge);

      const content = el('div', {
        className: 'clipboard-card-content mono text-xs',
        textContent: item.content,
      });

      const actions = el('div', { className: 'clipboard-card-actions' });
      const copyBtn = el('button', {
        type: 'button',
        className: 'btn btn-secondary btn-sm btn-copy-clipboard',
      });
      copyBtn.innerHTML = `${iconCopy({ size: 13 })} <span>Copy to Clipboard</span>`;
      copyBtn.addEventListener('click', async () => {
        const ok = await copyTextToClipboard(item.content);
        if (ok) {
          showToast('Copied to clipboard!');
        } else {
          showToast('Failed to copy to clipboard.');
        }
      });

      actions.append(copyBtn);
      card.append(head, content, actions);
      row.append(meta, card);

      feed.append(row);
      scrollToBottom();
    },
    addFileTransfer(opts: {
      fileId?: string;
      fileName: string;
      fileSize: number;
      isMine: boolean;
      isMetadataStripped?: boolean;
      isZeroTrace?: boolean;
      onPause?: () => void;
      onResume?: () => void;
      onCancel?: () => void;
    }): FileCardController {
      let isMetadataStripped = !!opts.isMetadataStripped;
      let isZeroTrace = !!opts.isZeroTrace;

      const row = el('div', { className: `chat-msg ${opts.isMine ? 'mine' : 'peer'}` });
      const card = el('div', { className: 'feed-file' });

      const head = el('div', { className: 'feed-file-head' });
      const icon = el('div', { className: 'feed-file-icon' });
      icon.innerHTML = iconFileText({ size: 18 });
      const info = el('div', { className: 'feed-file-info' });
      const name = el('div', { className: 'feed-file-name font-semibold', textContent: opts.fileName });
      const size = el('div', { className: 'feed-file-size tabular-nums mono text-xs muted', textContent: formatBytes(opts.fileSize) });
      info.append(name, size);

      const initialSafety = inspectFileSafety(opts.fileName, opts.fileSize);
      if (initialSafety.riskLevel !== 'safe') {
        const badge = el('span', {
          className: `safety-badge ${initialSafety.riskLevel} mono text-xs`,
          textContent: initialSafety.badgeLabel,
          title: initialSafety.reason,
        });
        info.append(badge);
      }

      const privacyBadge = el('span', {
        className: 'safety-badge safe file-badge-privacy-shield mono text-xs',
        title: 'GPS, EXIF, and camera serial numbers were removed in-memory before transmission.',
      });
      privacyBadge.innerHTML = `${iconShield({ size: 11 })} <span>Metadata Stripped</span>`;
      privacyBadge.style.display = isMetadataStripped ? 'inline-flex' : 'none';

      const zeroTraceBadge = el('span', {
        className: 'safety-badge warning file-badge-zero-trace mono text-xs',
        title: 'Ephemeral canvas view mode. Download disabled and auto-wiped on close.',
      });
      zeroTraceBadge.innerHTML = `${iconLock({ size: 11 })} <span>Zero-Trace</span>`;
      zeroTraceBadge.style.display = isZeroTrace ? 'inline-flex' : 'none';

      info.append(privacyBadge, zeroTraceBadge);
      head.append(icon, info);

      // Progress bar and parallel lanes
      const progWrap = el('div', { className: 'feed-file-progress' });

      // 4-Channel Parallel Visualizer Deck
      const lanesWrap = el('div', { className: 'parallel-lanes-bar', title: '4-Channel Parallel WebRTC Transfer Pipeline' });
      const laneFills: HTMLElement[] = [];
      for (let ch = 0; ch < 4; ch++) {
        const lane = el('div', { className: `channel-lane lane-${ch}` });
        const laneTag = el('span', { className: 'lane-tag mono tabular-nums', textContent: `CH-${ch}` });
        const laneTrack = el('div', { className: 'lane-meter' });
        const laneFill = el('div', { className: 'lane-fill' });
        laneFills.push(laneFill);
        laneTrack.append(laneFill);
        lane.append(laneTag, laneTrack);
        lanesWrap.append(lane);
      }

      const track = el('div', { className: 'feed-file-track' });
      const fill = el('div', { className: 'feed-file-fill' });
      track.append(fill);

      const stats = el('div', { className: 'feed-file-stats tabular-nums mono text-xs' });
      const speedEl = el('span', { className: 'tabular-nums', textContent: '0 B/s' });
      const percentEl = el('span', { className: 'tabular-nums font-semibold', textContent: '0%' });
      const etaEl = el('span', { className: 'tabular-nums', textContent: '--' });
      const topologyEl = el('span', { className: 'topology-badge direct', textContent: 'Direct LAN P2P' });
      stats.append(speedEl, percentEl, etaEl, topologyEl);

      const controls = el('div', { className: 'feed-file-controls' });
      const statusBadge = el('span', { className: 'feed-file-status-badge mono text-xs' });
      statusBadge.style.display = 'none';

      const btnPause = el('button', {
        type: 'button',
        className: 'btn-file-control btn-control-pause mono text-xs',
        title: 'Pause file transfer',
      });
      btnPause.innerHTML = `${iconPause({ size: 12 })} <span>Pause</span>`;

      const btnResume = el('button', {
        type: 'button',
        className: 'btn-file-control btn-control-resume mono text-xs',
        title: 'Resume file transfer',
      });
      btnResume.innerHTML = `${iconPlay({ size: 12 })} <span>Resume</span>`;
      btnResume.style.display = 'none';

      const btnCancel = el('button', {
        type: 'button',
        className: 'btn-file-control btn-control-cancel mono text-xs',
        title: 'Cancel file transfer',
      });
      btnCancel.innerHTML = `${iconX({ size: 12 })} <span>Cancel</span>`;

      btnPause.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onPause?.();
      });

      btnResume.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onResume?.();
      });

      btnCancel.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onCancel?.();
      });

      controls.append(statusBadge, btnPause, btnResume, btnCancel);
      progWrap.append(lanesWrap, track, stats, controls);
      card.append(head, progWrap);
      row.append(card);

      feed.append(row);
      scrollToBottom();

      return {
        updateProgress(p: TransferProgress) {
          const pct = p.bytesTotal > 0 ? (p.bytesSent / p.bytesTotal) * 100 : 0;
          fill.style.width = `${pct}%`;
          percentEl.textContent = `${Math.round(pct)}%`;
          speedEl.textContent = formatSpeed(p.speedBps);
          etaEl.textContent = formatETA(p.etaSeconds);

          // Update multi-lane activity bars proportionally
          laneFills.forEach((lf, idx) => {
            const lanePct = Math.min(100, Math.max(0, pct + ((idx % 2 === 0 ? 1 : -1) * (pct > 0 && pct < 100 ? 6 : 0))));
            lf.style.width = `${lanePct}%`;
          });
        },
        setMetadataStripped(stripped: boolean) {
          isMetadataStripped = stripped;
          privacyBadge.style.display = stripped ? 'inline-flex' : 'none';
        },
        setZeroTrace(zt: boolean) {
          isZeroTrace = zt;
          zeroTraceBadge.style.display = zt ? 'inline-flex' : 'none';
        },
        setPaused(isPaused: boolean, pausedBy?: 'you' | 'peer' | 'sender' | 'receiver') {
          if (isPaused) {
            btnPause.style.display = 'none';
            btnResume.style.display = 'inline-flex';
            statusBadge.style.display = 'inline-flex';
            statusBadge.className = 'feed-file-status-badge paused mono text-xs';
            const isYou =
              pausedBy === 'you' ||
              (opts.isMine && pausedBy === 'sender') ||
              (!opts.isMine && pausedBy === 'receiver');
            statusBadge.textContent = isYou ? 'Paused by you' : 'Paused by peer';
            speedEl.textContent = 'Paused';
            etaEl.textContent = 'Paused';
          } else {
            btnPause.style.display = 'inline-flex';
            btnResume.style.display = 'none';
            statusBadge.style.display = 'none';
            statusBadge.className = 'feed-file-status-badge';
          }
        },
        setCancelled(cancelledBy?: 'you' | 'peer') {
          progWrap.remove();
          const cancelRow = el('div', { className: 'feed-file-done' });
          const cancelBadge = el('div', {
            className: 'text-xs mono',
            style: 'color: var(--muted); display: flex; align-items: center; gap: 4px;',
          });
          const who = cancelledBy === 'peer' ? 'peer' : 'you';
          cancelBadge.innerHTML = `${iconX({ size: 12 })} <span>Transfer cancelled by ${who}</span>`;
          cancelRow.append(cancelBadge);
          card.append(cancelRow);
          scrollToBottom();
        },
        complete(info: {
          sha256: string;
          onDownload?: () => void;
          isDirectDiskSave?: boolean;
          isMetadataStripped?: boolean;
          isZeroTrace?: boolean;
          onZeroTraceView?: () => void;
        }) {
          progWrap.remove();

          if (info.isMetadataStripped) {
            isMetadataStripped = true;
            privacyBadge.style.display = 'inline-flex';
          }
          if (info.isZeroTrace) {
            isZeroTrace = true;
            zeroTraceBadge.style.display = 'inline-flex';
          }

          const doneRow = el('div', { className: 'feed-file-done' });
          const safety = inspectFileSafety(opts.fileName, opts.fileSize, info.sha256);

          if (safety.isBlockedHash) {
            const blocked = el('div', { className: 'feed-file-threat danger mono text-xs' });
            blocked.innerHTML = `${iconAlertCircle({ size: 13 })} <span>Blocked Threat</span>`;
            blocked.title = `SHA-256: ${info.sha256} matches a known malicious signature. Quarantined.`;
            doneRow.append(blocked);
          } else {
            const verified = el('div', { className: 'feed-file-verified mono text-xs' });
            verified.innerHTML = `${iconCheck({ size: 13 })} <span>${safety.riskLevel === 'warning' ? 'Verified (Quarantined)' : 'Verified Safe'}</span>`;
            verified.title = `SHA-256: ${info.sha256}`;
            doneRow.append(verified);

            if (isZeroTrace || info.isZeroTrace) {
              if (info.onZeroTraceView) {
                const viewBtn = el('button', {
                  type: 'button',
                  className: 'btn btn-primary btn-sm btn-zero-trace-view mono text-xs',
                });
                viewBtn.innerHTML = `${iconEye({ size: 12 })} <span>View (Zero-Trace)</span>`;
                viewBtn.style.padding = '4px 10px';
                viewBtn.addEventListener('click', info.onZeroTraceView);
                doneRow.append(viewBtn);
              }
            } else if (info.isDirectDiskSave) {
              const savedBadge = el('div', {
                className: 'feed-file-disk-saved mono text-xs',
                title: 'File streamed directly to selected disk folder without RAM usage',
              });
              savedBadge.innerHTML = `${iconCheck({ size: 12 })} <span>Saved to Disk</span>`;
              doneRow.append(savedBadge);
            } else if (safety.riskLevel === 'warning') {
              const warningBadge = el('div', { className: 'feed-file-threat warning mono text-xs' });
              warningBadge.innerHTML = `${iconAlertTriangle({ size: 13 })} <span>Executable</span>`;
              warningBadge.title = `SHA-256: ${info.sha256}. High-risk executable binary. Verify sender.`;
              doneRow.append(warningBadge);

              if (info.onDownload) {
                const dlBtn = el('button', {
                  className: 'btn btn-secondary btn-sm mono text-xs',
                  textContent: 'Save File',
                  title: 'Exercise caution before executing downloaded software binaries',
                });
                dlBtn.style.padding = '4px 10px';
                dlBtn.addEventListener('click', info.onDownload);
                doneRow.append(dlBtn);
              }
            } else {
              if (info.onDownload) {
                const dlBtn = el('button', {
                  className: 'btn btn-primary btn-sm mono text-xs',
                  textContent: 'Download',
                });
                dlBtn.style.padding = '4px 10px';
                dlBtn.addEventListener('click', info.onDownload);
                doneRow.append(dlBtn);
              }
            }
          }

          card.append(doneRow);
          scrollToBottom();
        },
        fail(err: string) {
          progWrap.remove();
          const errEl = el('div', {
            className: 'text-xs mono',
            textContent: `Failed: ${err}`,
          });
          errEl.style.color = 'var(--danger)';
          card.append(errEl);
          scrollToBottom();
        },
      };
    },
  };
}

// ─── Legacy Drop Zone View (for backward compatibility) ──

export interface DropZoneCallbacks {
  onFilesSelected: (files: FileList) => void;
}

export function createConnectedView(peerRole: string, callbacks: DropZoneCallbacks): HTMLElement {
  const container = el('div', { className: 'stack stack-md fade-in' });

  const statusRow = el('div', { className: 'row-between mb-sm' });
  const badge = el('div', { className: 'status-badge mono text-xs' });
  badge.innerHTML = `<span class="status-dot connected"></span> peer connected`;
  const roleLabel = el('span', { className: 'text-xs mono muted', textContent: peerRole });
  statusRow.append(badge, roleLabel);

  const dropZone = el('div', { className: 'drop-zone' });
  dropZone.innerHTML = `
    <span class="drop-zone-icon">${iconDownload({ size: 24 })}</span>
    <div class="drop-zone-text font-semibold">Drop files here</div>
    <div class="drop-zone-hint text-xs muted">or click to browse — any file size, direct stream</div>
  `;

  const fileInput = el('input', { type: 'file', multiple: '' }) as HTMLInputElement;
  dropZone.append(fileInput);

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      callbacks.onFilesSelected(fileInput.files);
    }
  });

  dropZone.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      callbacks.onFilesSelected(e.dataTransfer.files);
    }
  });

  container.append(statusRow, dropZone);
  return container;
}

// ─── File Staged ────────────────────────────────────

export function createFileCard(
  fileName: string,
  fileSize: number,
  onRemove: () => void,
  onSend: () => void
): HTMLElement {
  const container = el('div', { className: 'stack stack-md fade-in' });

  const card = el('div', { className: 'file-card' });
  const icon = el('div', { className: 'file-icon' });
  icon.innerHTML = iconFileText({ size: 18 });
  const info = el('div', { className: 'file-info' });
  const name = el('div', { className: 'file-name font-semibold', textContent: fileName });
  const size = el('div', { className: 'file-size mono text-xs tabular-nums muted', textContent: formatBytes(fileSize) });
  info.append(name, size);

  const safety = inspectFileSafety(fileName, fileSize);
  if (safety.riskLevel !== 'safe') {
    const badge = el('span', {
      className: `safety-badge ${safety.riskLevel} mono text-xs`,
      textContent: safety.badgeLabel,
      title: safety.reason,
    });
    info.append(badge);
  }

  const removeBtn = el('button', { className: 'file-remove', title: 'Remove file' });
  removeBtn.innerHTML = iconX({ size: 14 });
  removeBtn.addEventListener('click', onRemove);

  card.append(icon, info, removeBtn);

  if (safety.riskLevel === 'danger') {
    const warningNotice = el('div', {
      className: 'threat-notice danger mono text-xs',
      textContent: `Blocked: ${safety.reason}`,
    });
    container.append(card, warningNotice);
  } else if (safety.riskLevel === 'warning') {
    const warningNotice = el('div', {
      className: 'threat-notice warning mono text-xs',
      textContent: `Security Warning: ${safety.reason}`,
    });
    const sendBtn = el('button', { className: 'btn btn-primary w-full', textContent: 'Confirm & Send Binary' });
    sendBtn.addEventListener('click', onSend);
    container.append(card, warningNotice, sendBtn);
  } else {
    const sendBtn = el('button', { className: 'btn btn-primary w-full', textContent: 'Send File' });
    sendBtn.addEventListener('click', onSend);
    container.append(card, sendBtn);
  }

  return container;
}

// ─── Transfer Progress ──────────────────────────────

export interface TransferUI {
  element: HTMLElement;
  update: (progress: { percent: number; speed: string; eta: string; transferred: string }) => void;
}

export function createTransferView(fileName: string, direction: 'sending' | 'receiving'): TransferUI {
  const container = el('div', { className: 'transfer-panel fade-in' });

  const header = el('div', { className: 'row-between mb-sm' });
  const statusBadge = el('div', { className: 'status-badge mono text-xs' });
  statusBadge.innerHTML = `<span class="status-dot transferring"></span> ${direction}`;
  const fileLabel = el('span', { className: 'text-sm mono font-semibold', textContent: fileName });
  header.append(statusBadge, fileLabel);

  const track = el('div', { className: 'progress-bar-track' });
  const fill = el('div', { className: 'progress-bar-fill' });
  track.append(fill);

  const metrics = el('div', { className: 'transfer-metrics' });

  const speedMetric = el('div', { className: 'metric' });
  const speedVal = el('div', { className: 'metric-value mono tabular-nums', textContent: '0 B/s' });
  const speedLabel = el('div', { className: 'metric-label mono text-xs muted', textContent: 'Speed' });
  speedMetric.append(speedVal, speedLabel);

  const progressMetric = el('div', { className: 'metric' });
  const progressVal = el('div', { className: 'metric-value mono tabular-nums', textContent: '0%' });
  const progressLabel = el('div', { className: 'metric-label mono text-xs muted', textContent: 'Progress' });
  progressMetric.append(progressVal, progressLabel);

  const etaMetric = el('div', { className: 'metric' });
  const etaVal = el('div', { className: 'metric-value mono tabular-nums', textContent: '--' });
  const etaLabel = el('div', { className: 'metric-label mono text-xs muted', textContent: 'ETA' });
  etaMetric.append(etaVal, etaLabel);

  metrics.append(speedMetric, progressMetric, etaMetric);
  container.append(header, track, metrics);

  return {
    element: container,
    update({ percent, speed, eta, transferred }) {
      fill.style.width = `${percent}%`;
      speedVal.textContent = speed;
      progressVal.textContent = `${Math.round(percent)}%`;
      etaVal.textContent = eta;
      fileLabel.textContent = transferred;
    },
  };
}

// ─── Complete Screen ────────────────────────────────

export function createCompleteView(
  fileName: string,
  fileSize: number,
  sha256: string,
  onDone: () => void,
  onDownload?: () => void
): HTMLElement {
  const container = el('div', { className: 'stack stack-md text-center fade-in' });

  const icon = el('div', { className: 'complete-icon' });
  icon.innerHTML = iconCheck({ size: 28 });

  const title = el('h2', { className: 'font-semibold', textContent: 'Transfer Complete' });

  const info = el('div', { className: 'stack stack-sm' });
  const nameEl = el('div', { className: 'text-sm font-semibold', textContent: fileName });
  const sizeEl = el('div', { className: 'text-xs mono muted tabular-nums', textContent: formatBytes(fileSize) });
  info.append(nameEl, sizeEl);

  const hashWrap = el('div', { className: 'stack stack-sm' });
  const hashLabel = el('div', { className: 'text-xs muted mono', textContent: 'SHA-256 Verified' });
  const hashVal = el('div', { className: 'hash-display mono tabular-nums', textContent: sha256 });
  hashWrap.append(hashLabel, hashVal);

  container.append(icon, title, info, hashWrap);

  if (onDownload) {
    const dlBtn = el('button', { className: 'btn btn-primary w-full mt-sm', textContent: 'Download File' });
    dlBtn.addEventListener('click', onDownload);
    container.append(dlBtn);
  }

  const doneBtn = el('button', { className: 'btn w-full mt-sm', textContent: 'Transfer Another' });
  doneBtn.addEventListener('click', onDone);
  container.append(doneBtn);

  return container;
}

// ─── Error Display ──────────────────────────────────

export function createErrorView(message: string, onRetry: () => void): HTMLElement {
  const container = el('div', { className: 'stack stack-md text-center fade-in' });

  const icon = el('div', { className: 'complete-icon' });
  icon.style.borderColor = 'var(--danger)';
  icon.style.background = 'rgba(220, 38, 38, 0.08)';
  icon.innerHTML = iconX({ size: 28 });

  const title = el('h2', { className: 'font-semibold', textContent: 'Connection Lost' });
  const msg = el('div', { className: 'text-sm muted', textContent: message });

  const retryBtn = el('button', { className: 'btn btn-primary w-full mt-md', textContent: 'Try Again' });
  retryBtn.addEventListener('click', onRetry);

  container.append(icon, title, msg, retryBtn);
  return container;
}
