/**
 * PinnPointt — Human, Tactile Design System Components
 * Inspired by Apple AirDrop, WeTransfer, and Arc Browser.
 * Clean, spacious, and free of engineering jargon.
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
  iconTerminal,
  iconDownload,
  iconEye,
  iconFolder,
  iconFileText,
  iconFile,
  iconAlertTriangle,
  iconAlertCircle,
  iconHelpCircle,
  iconHardDrive,
  iconZap,
  iconUsers,
  iconActivity,
  iconShare,
  iconUpload,
  iconKey,
  iconQrCode,
  iconRefresh,
  iconCamera,
} from './icons';
import { startCameraQRScanner, extractRoomCode, type QRScannerSession } from '../lib/qrScanner';

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
    className: 'pinnpointt-toast text-xs',
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
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  if (bps === 0) return '0 B/s';
  const val = formatBytes(bps);
  return `${val}/s`;
}

export function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return 'Just a moment';
  if (seconds < 60) return `About ${Math.ceil(seconds)} seconds left`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  if (s === 0) return `About ${m} minute${m > 1 ? 's' : ''} left`;
  return `About ${m}m ${s}s left`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ─── Top Mode Bar (1-to-1, Broadcast, Virtual Drive) ──

export type AppWorkspaceMode = 'direct' | 'broadcast' | 'drive';

export function createModeBar(
  activeMode: AppWorkspaceMode,
  onSelect: (mode: AppWorkspaceMode) => void
): HTMLElement {
  const bar = el('div', { className: 'workspace-mode-bar' });
  const modes: { id: AppWorkspaceMode; label: string; icon: string }[] = [
    { id: 'direct', label: 'Direct Share', icon: iconActivity({ size: 14 }) },
    { id: 'broadcast', label: 'Broadcast to Multiple', icon: iconUsers({ size: 14 }) },
    { id: 'drive', label: 'Browse Other Device', icon: iconHardDrive({ size: 14 }) },
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
    <span class="radar-text">Nearby on your Wi-Fi: <strong>${deviceCount} Device Detected</strong> — Tap to Connect</span>
  `;

  if (onPair) {
    banner.style.cursor = 'pointer';
    banner.addEventListener('click', onPair);
  }

  return banner;
}

// ─── Desktop & Mobile Navigation Bar (Clean 64px Header) ─

export interface NavbarPeerInfo {
  name: string;
  roomCode: string;
  onDisconnect: () => void;
}

export function createNavbar(
  theme: ThemeMode,
  onToggleTheme: () => void,
  onBrandClick?: () => void,
  onOpenGuide?: () => void,
  peerInfo?: NavbarPeerInfo
): HTMLElement {
  const nav = el('header', { className: 'app-navbar' });
  const inner = el('div', { className: 'app-navbar-inner' });

  // Left Brand Area
  const brand = el('div', { className: 'nav-brand' });
  const logo = el('div', { className: 'nav-logo' });
  logo.innerHTML = iconLogo(20);
  const titleWrap = el('div', { className: 'nav-title-wrap' });
  const title = el('span', { className: 'nav-title', textContent: 'PinnPointt' });
  titleWrap.append(title);
  brand.append(logo, titleWrap);

  if (onBrandClick) {
    brand.addEventListener('click', onBrandClick);
  }

  // Center Connection Area (Active connected peer info or dynamic live telemetry)
  const centerArea = el('div', { className: 'nav-center-area' });
  if (peerInfo) {
    const pill = el('div', { className: 'header-connected-pill workspace-peer-badge' });
    pill.innerHTML = `
      <span class="status-dot connected"></span>
      <span class="peer-text">Connected to <strong class="peer-name">${peerInfo.name}</strong></span>
      <span class="pill-divider">•</span>
      <span class="room-pill-code mono">Room ${peerInfo.roomCode}</span>
      <span class="workspace-e2e-badge text-xs">${iconLock({ size: 11 })} Direct &amp; Private</span>
    `;

    const discBtn = el('button', {
      type: 'button',
      className: 'btn-pill-disconnect text-xs',
      textContent: 'Disconnect',
    });
    discBtn.addEventListener('click', peerInfo.onDisconnect);
    pill.append(discBtn);
    centerArea.append(pill);
  } else {
    const telemetry = el('div', { className: 'header-dynamic-telemetry' });
    telemetry.innerHTML = `
      <span class="nav-status-beacon"></span>
      <span class="telemetry-bold text-xs">Direct P2P Link</span>
      <span class="telemetry-sub text-xs muted">• End-to-End Encrypted</span>
    `;
    centerArea.append(telemetry);
  }

  // Right Actions
  const actions = el('div', { className: 'nav-actions' });

  if (onOpenGuide) {
    const guideBtn = el('button', {
      className: 'btn-nav-guide text-xs',
      type: 'button',
      title: 'How to use PinnPointt',
    });
    guideBtn.innerHTML = `${iconHelpCircle({ size: 14 })} <span>Guide</span>`;
    guideBtn.addEventListener('click', onOpenGuide);
    actions.append(guideBtn);
  }

  const aboutLink = el('a', {
    className: 'nav-website-link text-xs',
    href: '/',
    textContent: 'About & Roadmap ↗',
    title: 'Why PinnPointt, Features & Open Source Roadmap',
  });

  const themeBtn = el('button', {
    className: 'btn-theme-toggle',
    type: 'button',
    title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`,
  });

  const themeIcon = theme === 'dark' ? iconSun({ size: 14 }) : iconMoon({ size: 14 });
  const themeLabel = theme === 'dark' ? 'Light' : 'Dark';
  themeBtn.innerHTML = `<span class="theme-icon">${themeIcon}</span> <span class="theme-label">${themeLabel}</span>`;
  themeBtn.addEventListener('click', onToggleTheme);

  actions.append(aboutLink, themeBtn);
  inner.append(brand, centerArea, actions);
  nav.append(inner);
  return nav;
}

// ─── PWA Install Banner ─────────────────────────────

import { promptPWAInstall, onInstallAvailabilityChange, isStandalone, isIOS } from '../lib/pwaInstaller';

export function createInstallBanner(): HTMLElement {
  const banner = el('div', { className: 'install-banner' });
  banner.style.display = 'none';

  const left = el('div', { className: 'install-banner-left' });
  const icon = el('span', { className: 'install-icon' });
  icon.innerHTML = iconDownload({ size: 16 });
  const textWrap = el('div');
  const title = el('div', { className: 'install-title', textContent: 'Install PinnPointt App' });
  const desc = el('div', { className: 'install-desc', textContent: 'Launch full-screen from your dock or home screen.' });
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
  const inner = el('div', { className: 'app-footer-inner' });

  const linksRow = el('div', { className: 'footer-links' });

  const siteLink = el('a', {
    className: 'footer-link footer-pill-link',
    href: '/',
    textContent: 'Home & Roadmap',
    title: 'Why PinnPointt, Features & Open Source Roadmap',
  });
  linksRow.append(siteLink);

  const docLinks: { id: DocTab; label: string }[] = [
    { id: 'privacy', label: 'Privacy Policy' },
    { id: 'fair-usage', label: 'Fair Usage' },
    { id: 'disclaimer', label: 'Disclaimer' },
    { id: 'changelog', label: 'Changelog' },
  ];

  docLinks.forEach(({ id, label }) => {
    const btn = el('button', {
      className: 'footer-link footer-pill-link',
      type: 'button',
      textContent: label,
      title: `View ${label}`,
    });
    btn.addEventListener('click', () => {
      if (onOpenDocModal) onOpenDocModal(id);
      else openDocModal(id);
    });
    linksRow.append(btn);
  });

  const contactBtn = el('button', {
    className: 'footer-link footer-pill-link',
    type: 'button',
    textContent: 'Contact',
    title: 'Send a message directly from PinnPointt',
  });
  contactBtn.addEventListener('click', () => {
    if (onOpenDocModal) onOpenDocModal('contact');
    else openDocModal('contact');
  });
  linksRow.append(contactBtn);

  const bottomRow = el('div', { className: 'footer-bottom-row' });

  const credit = el('div', { className: 'footer-credit' });
  credit.innerHTML = `Developed by <span>Ankit Patra</span> for the community`;

  const meta = el('div', { className: 'footer-meta' });
  const subtitle = el('span', {
    className: 'footer-subtitle',
    textContent: 'Direct device-to-device transfers • Fast & private',
  });
  const version = el('span', {
    className: 'footer-version tabular-nums',
    textContent: 'v0.0.61-beta',
    title: 'PinnPointt Version 0.0.61 Beta',
  });
  meta.append(subtitle, version);

  bottomRow.append(credit, meta);
  inner.append(linksRow, bottomRow);
  footer.append(inner);
  return footer;
}

// ─── Username & Identity Card ───────────────────────

import { generateDefaultUsername } from '../lib/username';

function getMonogram(name: string): string {
  const parts = name.split(/[-_ ]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || 'ME';
}

export function createUsernameBar(
  username: string,
  onUpdate: (newName: string) => void
): HTMLElement {
  const card = el('div', { className: 'identity-card identity-chip' });

  const labelTag = el('span', { className: 'identity-chip-label text-xs muted font-semibold', textContent: 'Device:' });
  const avatar = el('div', { className: 'avatar-monogram', textContent: getMonogram(username) });

  const inputWrap = el('div', { className: 'identity-input-wrap' });
  const input = el('input', {
    className: 'identity-input username-input',
    type: 'text',
    value: username,
    placeholder: 'Device name...',
    maxlength: '24',
    title: 'Click to edit your device name',
  }) as HTMLInputElement;

  const randBtn = el('button', {
    className: 'btn-randomize',
    type: 'button',
    title: 'Generate random name',
  });
  randBtn.innerHTML = iconRefresh({ size: 14 });

  randBtn.addEventListener('click', () => {
    const generated = generateDefaultUsername();
    input.value = generated;
    avatar.textContent = getMonogram(generated);
    onUpdate(generated);
  });

  input.addEventListener('input', () => {
    avatar.textContent = getMonogram(input.value.trim() || 'ME');
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
  card.append(labelTag, avatar, inputWrap);
  return card;
}

// ─── Intuitive 3-Step Setup Tracker ─────────────────

export function createOnboarding(
  activeStep: number,
  onSelectStep?: (step: 1 | 2 | 3) => void,
  onOpenTour?: () => void
): HTMLElement {
  const wrap = el('div', { className: 'onboarding-stepper onboarding' });

  const headerRow = el('div', { className: 'stepper-header onboarding-header' });
  const titleSpan = el('span', { className: 'stepper-label text-xs font-semibold', textContent: 'Quick Transfer Setup' });
  const controls = el('div', { className: 'stepper-controls onboarding-controls' });

  if (onOpenTour) {
    const tourBtn = el('button', {
      className: 'stepper-guide-btn onboarding-guide-btn text-xs',
      type: 'button',
      title: 'Open visual walkthrough guide',
    });
    tourBtn.innerHTML = `${iconHelpCircle({ size: 13 })} <span>How it works</span>`;
    tourBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onOpenTour();
    });
    controls.append(tourBtn);
  }

  headerRow.append(titleSpan, controls);

  const steps = el('div', { className: 'onboarding-steps' });

  const stepData = [
    {
      num: 1 as const,
      title: '1. Name',
      desc: 'Name this device',
    },
    {
      num: 2 as const,
      title: '2. Connect',
      desc: 'Pair code or QR',
    },
    {
      num: 3 as const,
      title: '3. Send',
      desc: 'Drop files directly',
    },
  ];

  stepData.forEach(({ num, title, desc }) => {
    const isActive = num === activeStep;
    const stepAttrs: Record<string, string> = {
      className: `onboarding-step ${isActive ? 'active' : ''} ${onSelectStep ? 'clickable' : ''}`,
      title: `Step ${num}: ${desc}`,
    };
    if (onSelectStep) {
      stepAttrs.role = 'button';
      stepAttrs.tabindex = '0';
    }
    const step = el('div', stepAttrs);
    const badge = el('div', {
      className: `step-badge ${isActive ? 'active' : ''}`,
      textContent: String(num),
    });
    const content = el('div', { className: 'step-content' });
    const titleEl = el('span', { className: 'step-title font-semibold', textContent: title });
    content.append(titleEl);
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
  return wrap;
}

// ─── Pair Selection ─────────────────────────────────

export interface PairCallbacks {
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  activeMode?: 'share' | 'receive' | 'idle';
}

export function createPairSelection(callbacks: PairCallbacks): HTMLElement {
  const container = el('div', { className: 'pair-selection-wrap' });

  // Sliding Segmented Control (Apple HIG pill switch)
  const options = el('div', { className: 'pair-options segmented-control' });

  const createOpt = el('button', {
    type: 'button',
    className: `pair-option ${callbacks.activeMode === 'share' || callbacks.activeMode === 'idle' ? 'active' : ''}`,
  });
  createOpt.setAttribute('data-mode', 'share');
  createOpt.innerHTML = `
    <span class="pair-option-icon">${iconShare({ size: 15 })}</span>
    <span class="pair-option-label">Send Files</span>
  `;
  createOpt.addEventListener('click', callbacks.onCreateRoom);

  const joinOpt = el('button', {
    type: 'button',
    className: `pair-option ${callbacks.activeMode === 'receive' ? 'active' : ''}`,
  });
  joinOpt.setAttribute('data-mode', 'receive');
  joinOpt.innerHTML = `
    <span class="pair-option-icon">${iconKey({ size: 15 })}</span>
    <span class="pair-option-label">Receive Files</span>
  `;
  joinOpt.addEventListener('click', callbacks.onJoinRoom);

  options.append(createOpt, joinOpt);
  container.append(options);

  return container;
}

// ─── Room Display (QR + Code) ───────────────────────

export function createRoomDisplay(
  roomCode: string,
  canvasElement: HTMLCanvasElement,
  onBack?: () => void,
  onJoinCode?: (code: string) => void
): HTMLElement {
  const container = el('div', { className: 'stack stack-md text-center fade-in' });

  if (onBack) {
    const headerRow = el('div', { className: 'room-header-row row-between' });
    const backBtn = el('button', {
      className: 'btn-subtle-back btn-back-room',
      type: 'button',
      title: 'Return to pairing setup',
    });
    backBtn.innerHTML = `<span>←</span> <span>Back</span>`;
    backBtn.addEventListener('click', onBack);

    const titleBadge = el('div', { className: 'ready-to-connect-badge' });
    titleBadge.innerHTML = `<span class="ready-status-dot"></span> <span>Ready to Connect</span>`;
    headerRow.append(backBtn, titleBadge);
    container.append(headerRow);
  }

  // QR Code Area
  const qrWrap = el('div', { className: 'qr-container' });
  const canvasWrap = el('div', { className: 'qr-canvas-wrap' });
  canvasWrap.append(canvasElement);

  const qrHint = el('div', {
    className: 'qr-instruction text-sm font-semibold',
    textContent: 'Scan with your phone camera to connect',
  });

  qrWrap.append(canvasWrap, qrHint);
  container.append(qrWrap);

  // Large 6-Character Code in JetBrains Mono
  const codeWrap = el('div', { className: 'room-code-section stack stack-xs' });
  const codeLabel = el('div', { className: 'text-xs muted', textContent: 'Or enter this 6-letter code on your other device:' });

  const codeDisplay = el('div', { className: 'room-code-display mono' });
  for (const ch of roomCode) {
    const digit = el('span', { className: 'digit tabular-nums', textContent: ch });
    codeDisplay.append(digit);
  }

  const linkRow = el('div', { className: 'room-actions-row' });
  const copyCodeBtn = el('button', {
    className: 'btn btn-sm btn-secondary',
    type: 'button',
  });
  copyCodeBtn.innerHTML = `${iconCopy({ size: 13 })} <span>Copy Code</span>`;
  copyCodeBtn.addEventListener('click', () => {
    void copyTextToClipboard(roomCode).then(() => {
      showToast(`Room code ${roomCode} copied!`);
      copyCodeBtn.innerHTML = `${iconCheck({ size: 13 })} <span>Copied!</span>`;
      setTimeout(() => {
        copyCodeBtn.innerHTML = `${iconCopy({ size: 13 })} <span>Copy Code</span>`;
      }, 1500);
    });
  });

  const copyLinkBtn = el('button', {
    className: 'btn btn-sm btn-secondary',
    type: 'button',
  });
  copyLinkBtn.innerHTML = `${iconShare({ size: 13 })} <span>Copy Link</span>`;
  copyLinkBtn.addEventListener('click', () => {
    const joinUrl = `${window.location.origin}/app?room=${roomCode}`;
    void copyTextToClipboard(joinUrl).then(() => {
      showToast('Direct connect link copied!');
      copyLinkBtn.innerHTML = `${iconCheck({ size: 13 })} <span>Copied!</span>`;
      setTimeout(() => {
        copyLinkBtn.innerHTML = `${iconShare({ size: 13 })} <span>Copy Link</span>`;
      }, 1500);
    });
  });

  linkRow.append(copyCodeBtn, copyLinkBtn);
  codeWrap.append(codeLabel, codeDisplay, linkRow);
  container.append(codeWrap);

  // Bottom Input Row: "Connecting from another device? Enter code..." + Join
  if (onJoinCode) {
    const joinRowWrap = el('div', { className: 'quick-join-row-wrap' });
    const joinRowLabel = el('div', { className: 'text-xs muted mb-xs', textContent: 'Connecting from another device?' });

    const joinInputGroup = el('div', { className: 'quick-join-input-group' });
    const quickInput = el('input', {
      type: 'text',
      className: 'quick-join-input mono',
      placeholder: 'Enter 6-letter code...',
      maxlength: '6',
      autocomplete: 'off',
    }) as HTMLInputElement;

    const quickJoinBtn = el('button', {
      type: 'button',
      className: 'btn btn-primary btn-sm btn-connect-room',
      textContent: 'Join',
    });

    const submitQuick = () => {
      const val = quickInput.value.trim().toUpperCase();
      if (val.length === 6) {
        onJoinCode(val);
      }
    };

    quickJoinBtn.addEventListener('click', submitQuick);
    quickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitQuick();
    });

    joinInputGroup.append(quickInput, quickJoinBtn);
    joinRowWrap.append(joinRowLabel, joinInputGroup);
    container.append(joinRowWrap);
  }

  return container;
}

// ─── Join Input View ────────────────────────────────

export function createJoinInputWithBack(onSubmit: (code: string) => void): {
  element: HTMLElement;
  backBtn: HTMLButtonElement;
} {
  const container = el('div', { className: 'stack stack-md text-center fade-in receive-join-container' });

  // Top Header Row with prominent Back Button & Status Badge
  const headerRow = el('div', { className: 'room-header-row row-between' });
  const backBtn = el('button', {
    className: 'btn-subtle-back btn-back-room',
    type: 'button',
    title: 'Return to pairing setup',
  }) as HTMLButtonElement;
  backBtn.innerHTML = `<span>←</span> <span>Back</span>`;

  const statusBadge = el('div', { className: 'ready-to-connect-badge' });
  statusBadge.innerHTML = `<span class="ready-status-dot"></span> <span>Ready to Connect</span>`;
  headerRow.append(backBtn, statusBadge);

  const titleWrap = el('div', { className: 'stack stack-xs text-left' });
  const title = el('h2', { className: 'pairing-title font-semibold text-base', textContent: 'Receive Files' });
  const subtitle = el('p', {
    className: 'pairing-subtitle text-xs muted',
    textContent: 'Scan the sender device QR code with your camera, or enter their 6-letter room code below.',
  });
  titleWrap.append(title, subtitle);

  // 1. Camera QR Scanner Section
  const scannerCard = el('div', { className: 'camera-scanner-card' });
  const scanTriggerBtn = el('button', {
    type: 'button',
    className: 'btn-scan-qr',
    title: 'Open camera to scan QR code and connect instantly',
  });
  scanTriggerBtn.innerHTML = `${iconCamera({ size: 16 })} <span>Scan QR Code with Camera</span>`;

  const scannerLiveWrap = el('div', { className: 'scanner-live-wrap' });
  scannerLiveWrap.style.display = 'none';

  const video = el('video', { className: 'scanner-video' }) as HTMLVideoElement;
  video.autoplay = true;
  video.muted = true;

  const reticle = el('div', { className: 'scanner-reticle' });
  reticle.innerHTML = `
    <div class="reticle-corner top-left"></div>
    <div class="reticle-corner top-right"></div>
    <div class="reticle-corner bottom-left"></div>
    <div class="reticle-corner bottom-right"></div>
    <div class="reticle-laser"></div>
  `;

  const scannerHint = el('div', {
    className: 'scanner-hint text-xs',
    textContent: 'Aim camera at the QR code on the sender screen',
  });

  const stopCameraBtn = el('button', {
    type: 'button',
    className: 'btn-stop-camera',
    textContent: '✕ Stop Camera',
  });

  scannerLiveWrap.append(video, reticle, scannerHint, stopCameraBtn);
  scannerCard.append(scanTriggerBtn, scannerLiveWrap);

  let activeSession: QRScannerSession | null = null;

  const stopScanner = () => {
    if (activeSession) {
      activeSession.stop();
      activeSession = null;
    }
    scannerLiveWrap.style.display = 'none';
    scanTriggerBtn.style.display = 'inline-flex';
  };

  scanTriggerBtn.addEventListener('click', async () => {
    scanTriggerBtn.style.display = 'none';
    scannerLiveWrap.style.display = 'flex';
    scannerHint.textContent = 'Requesting camera access...';

    activeSession = await startCameraQRScanner(
      video,
      (detectedCode) => {
        showToast(`QR Code Detected! Joining Room ${detectedCode}...`);
        stopScanner();
        onSubmit(detectedCode);
      },
      (err) => {
        console.warn('Camera scan error:', err);
        showToast('Camera access denied or unavailable. Enter code below.');
        stopScanner();
      }
    );
  });

  stopCameraBtn.addEventListener('click', () => {
    stopScanner();
  });

  backBtn.addEventListener('click', () => {
    stopScanner();
  });

  // 2. Divider
  const divider = el('div', { className: 'pairing-divider' });
  divider.innerHTML = `<span>OR ENTER 6-LETTER CODE</span>`;

  // 3. Manual 6-character Code Inputs
  const inputRow = el('div', { className: 'room-code-input' });
  const inputs: HTMLInputElement[] = [];

  for (let i = 0; i < 6; i++) {
    const input = el('input', {
      type: 'text',
      inputmode: 'text',
      maxlength: '1',
      className: 'code-char mono',
      autocomplete: 'off',
      autocapitalize: 'characters',
    }) as HTMLInputElement;

    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase();
      if (input.value && i < 5) {
        inputs[i + 1].focus();
      }
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        inputs[i - 1].focus();
      }
      if (e.key === 'Enter') {
        const code = inputs.map((inp) => inp.value).join('');
        if (code.length === 6) {
          stopScanner();
          onSubmit(code);
        }
      }
    });

    // Handle full paste into any box
    input.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData?.getData('text') || '';
      const parsed = extractRoomCode(pasted);
      if (parsed) {
        for (let j = 0; j < 6; j++) {
          inputs[j].value = parsed[j] || '';
        }
        stopScanner();
        onSubmit(parsed);
      }
    });

    inputs.push(input);
    inputRow.append(input);
  }

  const submitBtn = el('button', {
    className: 'btn btn-primary w-full mt-md btn-connect-room',
    textContent: 'Connect to Room →',
  });
  submitBtn.addEventListener('click', () => {
    const code = inputs.map((inp) => inp.value).join('');
    if (code.length === 6) {
      stopScanner();
      onSubmit(code);
    } else {
      showToast('Please enter all 6 letters of the room code.');
    }
  });

  container.append(headerRow, titleWrap, scannerCard, divider, inputRow, submitBtn);
  return { element: container, backBtn };
}

// ─── Drop Surface for State A (Right Canvas) ─────────

export interface DropSurfaceOptions {
  onFilesSelected: (files: FileList) => void;
  onTogglePrivacy: (enabled: boolean) => void;
  privacyEnabled: boolean;
  queuedFiles?: File[];
  onRemoveQueuedFile?: (index: number) => void;
}

export function createDropZoneReadySurface(opts: DropSurfaceOptions): HTMLElement {
  const canvas = el('div', { className: 'pairing-drop-surface' });

  const fileInput = el('input', {
    type: 'file',
    multiple: '',
    className: 'file-hidden-input',
    style: 'display: none;',
  }) as HTMLInputElement;

  const folderInput = el('input', {
    type: 'file',
    multiple: '',
    style: 'display: none;',
  }) as HTMLInputElement;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      opts.onFilesSelected(fileInput.files);
    }
  });

  folderInput.addEventListener('change', () => {
    if (folderInput.files && folderInput.files.length > 0) {
      opts.onFilesSelected(folderInput.files);
    }
  });

  canvas.append(fileInput, folderInput);

  // Center Drag & Drop Prompt
  const centerPrompt = el('div', { className: 'drop-canvas-prompt' });
  const iconWrap = el('div', { className: 'drop-canvas-icon' });
  iconWrap.innerHTML = iconUpload({ size: 36 });

  const title = el('h3', { className: 'drop-canvas-title font-semibold', textContent: 'Drop Files to Send' });
  const subtitle = el('p', {
    className: 'drop-canvas-sub text-xs muted',
    textContent: 'Drop files here anytime, or click below. They will stream the moment your other device connects.',
  });

  const btnRow = el('div', { className: 'drop-canvas-actions' });
  const browseFilesBtn = el('button', {
    type: 'button',
    className: 'btn btn-primary btn-sm',
  });
  browseFilesBtn.innerHTML = `${iconFile({ size: 14 })} <span>Choose Files</span>`;
  browseFilesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  const browseFolderBtn = el('button', {
    type: 'button',
    className: 'btn btn-secondary btn-sm',
  });
  browseFolderBtn.innerHTML = `${iconFolder({ size: 14 })} <span>Choose Folder</span>`;
  browseFolderBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    folderInput.click();
  });

  btnRow.append(browseFilesBtn, browseFolderBtn);
  centerPrompt.append(iconWrap, title, subtitle, btnRow);
  canvas.append(centerPrompt);

  // Queued Files Display (if any)
  if (opts.queuedFiles && opts.queuedFiles.length > 0) {
    const queueCard = el('div', { className: 'queued-files-card stack stack-xs' });
    const queueHead = el('div', { className: 'queued-files-head' });
    queueHead.innerHTML = `
      <span class="status-dot connected"></span>
      <span class="font-semibold text-xs">${opts.queuedFiles.length} file(s) ready to stream upon connection</span>
    `;
    queueCard.append(queueHead);

    const queueList = el('div', { className: 'queued-files-list' });
    opts.queuedFiles.forEach((f, idx) => {
      const item = el('div', { className: 'queued-file-item row-between' });
      item.innerHTML = `
        <div class="queued-file-info">
          <span class="queued-file-name font-semibold text-xs">${f.name}</span>
          <span class="queued-file-size text-xs muted tabular-nums">• ${formatBytes(f.size)}</span>
        </div>
      `;
      const removeBtn = el('button', {
        type: 'button',
        className: 'btn-remove-queued text-xs muted',
        textContent: '✕',
        title: 'Remove from queue',
      });
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onRemoveQueuedFile?.(idx);
      });
      item.append(removeBtn);
      queueList.append(item);
    });

    queueCard.append(queueList);
    canvas.append(queueCard);
  }

  // Bottom Toggle Pill: [✓] Remove location details from photos
  const toggleWrap = el('div', { className: 'drop-canvas-footer' });
  const toggleLabel = el('label', {
    className: 'clean-toggle-pill',
    title: 'Automatically remove camera and location metadata from photos',
  });

  const checkbox = el('input', {
    type: 'checkbox',
    id: 'toggle-zero-trace',
    className: 'toggle-checkbox',
  }) as HTMLInputElement;
  checkbox.checked = opts.privacyEnabled;

  checkbox.addEventListener('change', () => {
    opts.onTogglePrivacy(checkbox.checked);
  });

  const toggleText = el('span', { className: 'toggle-pill-label text-xs' });
  toggleText.innerHTML = `${iconShield({ size: 13 })} <span>Remove location details from photos</span>`;

  toggleLabel.append(checkbox, toggleText);
  toggleWrap.append(toggleLabel);
  canvas.append(toggleWrap);

  // Drag events
  canvas.addEventListener('click', () => fileInput.click());
  canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvas.classList.add('dragover');
  });
  canvas.addEventListener('dragleave', () => {
    canvas.classList.remove('dragover');
  });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    canvas.classList.remove('dragover');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      opts.onFilesSelected(e.dataTransfer.files);
    }
  });

  return canvas;
}

// ─── Unified Connected Workspace (State B) ───────────

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
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'ZIP';
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
      className: 'vfs-local-empty text-xs muted',
      textContent: 'No local files mounted. Use "Mount Files" or "Mount Folder" to let the other device browse items.',
    });
    container.append(hint);
    return;
  }

  const totalBytes = entries.reduce((acc, f) => acc + f.size, 0);
  const card = el('div', { className: 'vfs-local-card' });

  const head = el('div', { className: 'row-between mb-xs' });
  const badge = el('div', { className: 'vfs-local-badge text-xs' });
  badge.innerHTML = `<span class="vfs-local-dot"></span> <span class="tabular-nums font-semibold">${entries.length} items shared (${formatBytes(totalBytes)})</span>`;

  const unmountBtn = el('button', {
    type: 'button',
    className: 'btn btn-ghost btn-xs',
    textContent: 'Stop Sharing',
  });
  unmountBtn.addEventListener('click', () => onUnmount?.());
  head.append(badge, unmountBtn);

  const note = el('div', {
    className: 'text-xs muted',
    textContent: 'The connected device can browse these files and preview or download items on demand.',
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
      <div class="vfs-empty-title font-semibold">No Shared Files Available</div>
      <div class="vfs-empty-desc text-xs muted">When ${peerName} shares files or folders, you can explore them and preview or download items here.</div>
    `;
    container.append(empty);
    return;
  }

  const totalBytes = entries.reduce((acc, f) => acc + f.size, 0);

  const sectionHead = el('div', { className: 'row-between vfs-section-head' });
  const title = el('div', { className: 'vfs-section-title font-semibold text-sm', textContent: `Files on ${peerName}'s Device` });
  const stats = el('div', { className: 'text-xs muted tabular-nums', textContent: `${entries.length} items • ${formatBytes(totalBytes)}` });
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
    const pathEl = el('div', { className: 'vfs-table-path text-xs muted', textContent: f.relativePath });
    tdName.append(nameEl, pathEl);

    const tdType = el('td');
    const typeBadge = el('span', { className: 'vfs-type-tag text-xs', textContent: inferShortType(f.mimeType, f.name) });
    tdType.append(typeBadge);

    const tdSize = el('td', { className: 'text-xs tabular-nums', textContent: formatBytes(f.size) });

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
  const container = el('div', { className: 'app-connected-workspace fade-in' });

  // ── MAIN SHARING STAGE (Left / Center 1fr) ──
  const mainStage = el('div', { className: 'connected-main-stage' });

  // Top Switcher Tabs (Send & Receive Files | Browse Other Device's Files)
  const tabRow = el('div', { className: 'workspace-tab-row' });
  const activityTabBtn = el('button', {
    type: 'button',
    className: 'workspace-tab-btn active',
  });
  activityTabBtn.setAttribute('data-tab', 'activity');
  activityTabBtn.innerHTML = `<span>File Transfers &amp; Activity</span>`;

  const driveTabBtn = el('button', {
    type: 'button',
    className: 'workspace-tab-btn',
  });
  driveTabBtn.setAttribute('data-tab', 'drive');
  const driveTabTitle = el('span', {}, 'Explore Other Device');
  const driveTabBadge = el('span', { className: 'vfs-tab-badge tabular-nums' });
  driveTabBadge.style.display = 'none';
  driveTabBtn.append(driveTabTitle, driveTabBadge);

  tabRow.append(activityTabBtn, driveTabBtn);
  mainStage.append(tabRow);

  // Hidden File Inputs
  const fileInput = el('input', {
    type: 'file',
    multiple: '',
    className: 'file-hidden-input',
    style: 'display: none;',
  }) as HTMLInputElement;

  const folderInput = el('input', {
    type: 'file',
    multiple: '',
    style: 'display: none;',
  }) as HTMLInputElement;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');

  let isMountMode = false;
  const handleIncomingFiles = (files: FileList) => {
    if (isMountMode) {
      callbacks.onMountFiles?.(files);
      switchTab('drive');
    } else {
      callbacks.onFilesSelected(files);
    }
  };

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleIncomingFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  folderInput.addEventListener('change', () => {
    if (folderInput.files && folderInput.files.length > 0) {
      handleIncomingFiles(folderInput.files);
      folderInput.value = '';
    }
  });

  mainStage.append(fileInput, folderInput);

  // Panels
  const activityPanel = el('div', { className: 'workspace-panel activity-panel stack stack-md' });
  const drivePanel = el('div', { className: 'workspace-panel drive-panel stack stack-md' });
  drivePanel.style.display = 'none';

  function switchTab(tab: 'activity' | 'drive') {
    if (tab === 'activity') {
      activityTabBtn.classList.add('active');
      driveTabBtn.classList.remove('active');
      activityPanel.style.display = 'flex';
      drivePanel.style.display = 'none';
    } else {
      driveTabBtn.classList.add('active');
      activityTabBtn.classList.remove('active');
      activityPanel.style.display = 'none';
      drivePanel.style.display = 'flex';
    }
  }

  activityTabBtn.addEventListener('click', () => switchTab('activity'));
  driveTabBtn.addEventListener('click', () => switchTab('drive'));

  // Clean Dropzone Banner at Top of Stage
  const dropzone = el('div', { className: 'stage-dropzone' });
  dropzone.innerHTML = `
    <div class="stage-dropzone-icon">${iconUpload({ size: 24 })}</div>
    <div class="stage-dropzone-title">Add More Files or Folders</div>
    <div class="stage-dropzone-sub">Drop files anywhere, or select to stream immediately across your direct link.</div>
  `;

  const dropActions = el('div', { className: 'stage-dropzone-actions' });
  const browseFilesBtn = el('button', {
    type: 'button',
    className: 'btn btn-primary btn-sm stage-dropzone-btn',
  });
  browseFilesBtn.innerHTML = `${iconFile({ size: 14 })} <span>Browse Files</span>`;
  browseFilesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  const browseFolderBtn = el('button', {
    type: 'button',
    className: 'btn btn-secondary btn-sm',
  });
  browseFolderBtn.innerHTML = `${iconFolder({ size: 14 })} <span>Add Folder</span>`;
  browseFolderBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    folderInput.click();
  });

  const privacyPill = el('label', {
    className: 'clean-toggle-pill stage-privacy-toggle',
    title: 'Remove camera and location metadata from photos before sending',
  });
  const privacyCheckbox = el('input', {
    type: 'checkbox',
    id: 'toggle-zero-trace',
    className: 'toggle-checkbox',
  }) as HTMLInputElement;
  privacyCheckbox.checked = true;
  privacyCheckbox.addEventListener('change', (e) => {
    e.stopPropagation();
    privacyShieldChecked = privacyCheckbox.checked;
  });
  const privacyLabel = el('span', { className: 'toggle-pill-label text-xs' });
  privacyLabel.innerHTML = `${iconShield({ size: 12 })} <span>Remove Photo Locations</span>`;
  privacyPill.append(privacyCheckbox, privacyLabel);
  privacyPill.addEventListener('click', (e) => e.stopPropagation());

  dropActions.append(browseFilesBtn, browseFolderBtn, privacyPill);
  dropzone.append(dropActions);

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleIncomingFiles(e.dataTransfer.files);
    }
  });

  // File Transfer List Feed
  const fileFeed = el('div', { className: 'transfer-feed stack stack-sm' });
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      activityPanel.scrollTop = activityPanel.scrollHeight;
    });
  };

  activityPanel.append(dropzone, fileFeed);

  // Virtual Drive Panel Layout
  const driveTopBar = el('div', { className: 'vfs-top-bar row-between' });
  const driveBarLeft = el('div');
  const driveBarTitle = el('div', { className: 'vfs-top-title font-semibold text-sm', textContent: 'Browse Files on Other Device' });
  const driveBarSub = el('div', { className: 'text-xs muted', textContent: 'Explore files mounted by the other device and selectively preview or pull items.' });
  driveBarLeft.append(driveBarTitle, driveBarSub);

  const mountActions = el('div', { className: 'vfs-mount-actions' });
  const mountFilesBtn = el('button', {
    type: 'button',
    className: 'btn btn-secondary btn-sm',
  });
  mountFilesBtn.innerHTML = `${iconFile({ size: 13 })} <span>Mount Files</span>`;
  mountFilesBtn.addEventListener('click', () => fileInput.click());

  const mountFolderBtn = el('button', {
    type: 'button',
    className: 'btn btn-secondary btn-sm',
  });
  mountFolderBtn.innerHTML = `${iconFolder({ size: 13 })} <span>Mount Folder</span>`;
  mountFolderBtn.addEventListener('click', () => folderInput.click());

  mountActions.append(mountFilesBtn, mountFolderBtn);
  driveTopBar.append(driveBarLeft, mountActions);

  const localVfsContainer = el('div', { className: 'vfs-local-container' });
  const remoteVfsContainer = el('div', { className: 'vfs-remote-container' });

  drivePanel.append(driveTopBar, localVfsContainer, remoteVfsContainer);
  mainStage.append(activityPanel, drivePanel);

  // ── RIGHT DRAWER: Shared Notes & Links (340px) ──
  const rightDrawer = el('div', { className: 'connected-notes-drawer' });

  const drawerHeader = el('div', { className: 'drawer-header stack stack-xs' });
  const drawerTitle = el('div', { className: 'drawer-title font-semibold text-sm', textContent: 'Shared Notes & Links' });
  const drawerSubtitle = el('div', { className: 'drawer-subtitle text-xs muted', textContent: 'Send a quick link or message to the other device' });
  drawerHeader.append(drawerTitle, drawerSubtitle);

  const chatFeed = el('div', { className: 'chat-feed' });
  const scrollToChatBottom = () => {
    requestAnimationFrame(() => {
      chatFeed.scrollTop = chatFeed.scrollHeight;
    });
  };

  const toolsBar = el('div', { className: 'workspace-tools-bar row-between' });
  const clipboardBtn = el('button', {
    type: 'button',
    className: 'btn-clipboard-sync text-xs',
    title: 'Share clipboard content with other device',
  });
  clipboardBtn.innerHTML = `${iconCopy({ size: 13 })} <span>Share Clipboard</span>`;
  clipboardBtn.addEventListener('click', () => {
    callbacks.onSendClipboard?.();
  });

  const toolsHint = el('span', {
    className: 'tools-hint text-xs muted',
    textContent: 'Ctrl+V anywhere to send',
  });
  toolsBar.append(clipboardBtn, toolsHint);

  const inputRow = el('div', { className: 'chat-input-row' });
  const attachBtn = el('button', {
    className: 'btn-attach',
    type: 'button',
    title: 'Attach file',
  });
  attachBtn.innerHTML = `${iconPaperclip({ size: 14 })}`;
  attachBtn.addEventListener('click', () => fileInput.click());

  const textInput = el('input', {
    type: 'text',
    className: 'chat-input',
    placeholder: 'Type a message or paste a link...',
    autocomplete: 'off',
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

  inputRow.append(attachBtn, textInput, sendBtn);
  rightDrawer.append(drawerHeader, chatFeed, toolsBar, inputRow);

  container.append(mainStage, rightDrawer);

  let localVfsList: VfsFileEntry[] = [];
  let remoteVfsList: VfsFileEntry[] = [];
  let currentPeerName = initialPeerName;
  let privacyShieldChecked = true;

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
    setPeerName(name: string, _role: string) {
      currentPeerName = name;
      updateRemoteView();
    },
    setWakeLockActive(_active: boolean) {},
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
      const notice = el('div', { className: 'system-notice text-xs', textContent: text });
      chatFeed.append(notice);
      scrollToChatBottom();
    },
    addChatMessage(msg: { sender: string; text: string; timestamp: number; isMine: boolean }) {
      const row = el('div', { className: `chat-msg ${msg.isMine ? 'mine' : 'peer'}` });

      const meta = el('div', { className: 'chat-meta' });
      const sender = el('span', { className: 'chat-sender font-semibold', textContent: msg.sender });
      const time = el('span', { className: 'chat-time text-xs muted tabular-nums', textContent: formatTime(msg.timestamp) });
      meta.append(sender, time);

      const bubble = el('div', { className: 'chat-bubble', textContent: msg.text });
      row.append(meta, bubble);

      chatFeed.append(row);
      scrollToChatBottom();
    },
    getPrivacyShieldEnabled() {
      return privacyShieldChecked;
    },
    getZeroTraceEnabled() {
      return privacyCheckbox.checked;
    },
    addClipboardItem(item: ClipboardItemData, isMine: boolean) {
      const row = el('div', { className: `chat-msg ${isMine ? 'mine' : 'peer'}` });

      const meta = el('div', { className: 'chat-meta' });
      const sender = el('span', { className: 'chat-sender font-semibold', textContent: item.sender });
      const time = el('span', { className: 'chat-time text-xs muted tabular-nums', textContent: formatTime(item.timestamp) });
      meta.append(sender, time);

      const card = el('div', { className: 'clipboard-sync-card' });
      const head = el('div', { className: 'clipboard-card-head row-between' });
      const typeBadge = el('span', {
        className: `clipboard-type-badge ${item.type} text-xs`,
      });
      const typeIcon = item.type === 'code' ? iconTerminal({ size: 12 }) : item.type === 'url' ? iconShare({ size: 12 }) : iconFileText({ size: 12 });
      typeBadge.innerHTML = `${typeIcon} <span>${item.type.toUpperCase()}</span>`;
      head.append(typeBadge);

      const content = el('div', {
        className: 'clipboard-card-content text-xs',
        textContent: item.content,
      });

      const actions = el('div', { className: 'clipboard-card-actions' });
      const copyBtn = el('button', {
        type: 'button',
        className: 'btn btn-secondary btn-sm btn-copy-clipboard',
      });
      copyBtn.innerHTML = `${iconCopy({ size: 13 })} <span>Copy</span>`;
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

      chatFeed.append(row);
      scrollToChatBottom();
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
      icon.innerHTML = iconFileText({ size: 20 });
      const info = el('div', { className: 'feed-file-info' });
      const name = el('div', { className: 'feed-file-name font-semibold', textContent: opts.fileName });
      const size = el('div', { className: 'feed-file-size tabular-nums text-xs muted', textContent: formatBytes(opts.fileSize) });
      info.append(name, size);

      const initialSafety = inspectFileSafety(opts.fileName, opts.fileSize);
      if (initialSafety.riskLevel !== 'safe') {
        const badge = el('span', {
          className: `safety-badge ${initialSafety.riskLevel} text-xs`,
          textContent: initialSafety.badgeLabel,
          title: initialSafety.reason,
        });
        info.append(badge);
      }

      const privacyBadge = el('span', {
        className: 'safety-badge safe file-badge-privacy-shield text-xs',
        title: 'Location details and camera tags were removed.',
      });
      privacyBadge.innerHTML = `${iconShield({ size: 12 })} <span>Location Hidden</span>`;
      privacyBadge.style.display = isMetadataStripped ? 'inline-flex' : 'none';

      info.append(privacyBadge);
      head.append(icon, info);

      // ONE Single Smooth Progress Bar
      const progWrap = el('div', { className: 'feed-file-progress' });
      const track = el('div', { className: 'feed-file-track' });
      const fill = el('div', { className: 'feed-file-fill' });
      track.append(fill);

      const stats = el('div', { className: 'feed-file-stats tabular-nums text-xs' });
      const percentEl = el('span', { className: 'tabular-nums font-semibold', textContent: '0%' });
      const speedEl = el('span', { className: 'tabular-nums', textContent: '0 B/s' });
      const etaEl = el('span', { className: 'tabular-nums', textContent: 'Starting...' });
      stats.append(percentEl, el('span', {}, '•'), speedEl, el('span', {}, '•'), etaEl);

      const controls = el('div', { className: 'feed-file-controls' });
      const statusBadge = el('span', { className: 'feed-file-status-badge text-xs' });
      statusBadge.style.display = 'none';

      const btnPause = el('button', {
        type: 'button',
        className: 'btn-file-control btn-control-pause text-xs',
        title: 'Pause file transfer',
      });
      btnPause.innerHTML = `${iconPause({ size: 12 })} <span>Pause</span>`;

      const btnResume = el('button', {
        type: 'button',
        className: 'btn-file-control btn-control-resume text-xs',
        title: 'Resume file transfer',
      });
      btnResume.innerHTML = `${iconPlay({ size: 12 })} <span>Resume</span>`;
      btnResume.style.display = 'none';

      const btnCancel = el('button', {
        type: 'button',
        className: 'btn-file-control btn-control-cancel text-xs',
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
      progWrap.append(track, stats, controls);
      card.append(head, progWrap);
      row.append(card);

      fileFeed.append(row);

      return {
        updateProgress(p: TransferProgress) {
          const pct = p.bytesTotal > 0 ? (p.bytesSent / p.bytesTotal) * 100 : 0;
          fill.style.width = `${pct}%`;
          percentEl.textContent = `${Math.round(pct)}%`;
          speedEl.textContent = formatSpeed(p.speedBps);
          etaEl.textContent = formatETA(p.etaSeconds);
        },
        setMetadataStripped(stripped: boolean) {
          isMetadataStripped = stripped;
          privacyBadge.style.display = stripped ? 'inline-flex' : 'none';
        },
        setZeroTrace(zt: boolean) {
          isZeroTrace = zt;
        },
        setPaused(isPaused: boolean, pausedBy?: 'you' | 'peer' | 'sender' | 'receiver') {
          if (isPaused) {
            btnPause.style.display = 'none';
            btnResume.style.display = 'inline-flex';
            statusBadge.style.display = 'inline-flex';
            statusBadge.className = 'feed-file-status-badge paused text-xs';
            const isYou =
              pausedBy === 'you' ||
              (opts.isMine && pausedBy === 'sender') ||
              (!opts.isMine && pausedBy === 'receiver');
            statusBadge.textContent = isYou ? 'Paused by you' : 'Paused by other device';
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
            className: 'text-xs muted',
            style: 'display: flex; align-items: center; gap: 4px;',
          });
          const who = cancelledBy === 'peer' ? 'other device' : 'you';
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

          const doneRow = el('div', { className: 'feed-file-done' });
          const safety = inspectFileSafety(opts.fileName, opts.fileSize, info.sha256);

          if (safety.isBlockedHash) {
            const blocked = el('div', { className: 'feed-file-threat danger text-xs' });
            blocked.innerHTML = `${iconAlertCircle({ size: 13 })} <span>Blocked Threat</span>`;
            doneRow.append(blocked);
          } else {
            const verified = el('div', { className: 'feed-file-verified text-xs' });
            verified.innerHTML = `${iconCheck({ size: 13 })} <span>Verified Safe</span>`;
            doneRow.append(verified);

            if (info.isDirectDiskSave) {
              const savedBadge = el('div', {
                className: 'feed-file-disk-saved text-xs',
              });
              savedBadge.innerHTML = `${iconCheck({ size: 12 })} <span>Saved to Disk</span>`;
              doneRow.append(savedBadge);
            } else if (safety.riskLevel === 'warning') {
              const warningBadge = el('div', { className: 'feed-file-threat warning text-xs' });
              warningBadge.innerHTML = `${iconAlertTriangle({ size: 13 })} <span>Executable</span>`;
              doneRow.append(warningBadge);

              if (info.onDownload) {
                const dlBtn = el('button', {
                  className: 'btn btn-secondary btn-sm text-xs',
                  textContent: 'Save File',
                });
                dlBtn.style.padding = '4px 10px';
                dlBtn.addEventListener('click', info.onDownload);
                doneRow.append(dlBtn);
              }
            } else {
              if (info.onDownload) {
                const dlBtn = el('button', {
                  className: 'btn btn-primary btn-sm text-xs',
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
            className: 'text-xs',
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

// ─── Error Display ──────────────────────────────────

export function createErrorView(
  message: string,
  onRetry: () => void,
  lastRoomCode?: string | null,
  onReconnect?: (roomCode: string) => void
): HTMLElement {
  const layout = el('div', { className: 'connection-lost-layout fade-in' });
  const card = el('div', { className: 'card connection-lost-card stack stack-md' });

  // Pulsing Disconnect Beacon
  const beaconWrap = el('div', { className: 'connection-lost-beacon' });
  const beaconRing = el('div', { className: 'lost-beacon-ring' });
  const beaconIcon = el('div', { className: 'lost-beacon-icon' });
  beaconIcon.innerHTML = iconAlertCircle({ size: 28 });
  beaconWrap.append(beaconRing, beaconIcon);

  // Title & Humanized Diagnostics
  const titleWrap = el('div', { className: 'stack stack-xs text-center' });
  const badge = el('div', { className: 'connection-lost-badge text-xs font-semibold', textContent: 'CONNECTION INTERRUPTED' });
  const title = el('h2', { className: 'font-semibold connection-lost-title', textContent: 'Direct Connection Was Interrupted' });
  const msg = el('p', {
    className: 'connection-lost-desc text-xs muted',
    textContent: message || 'The peer link was closed or network conditions changed between your devices.',
  });
  titleWrap.append(badge, title, msg);

  // Diagnostic Recovery Card
  const diagCard = el('div', { className: 'connection-lost-diag' });
  diagCard.innerHTML = `
    <div class="diag-item">
      <span class="diag-bullet">📶</span>
      <div>
        <strong>Check Wi-Fi or Mobile Data</strong>
        <p class="text-xs muted">Ensure both devices have an active network connection or are on the same Wi-Fi.</p>
      </div>
    </div>
    <div class="diag-item">
      <span class="diag-bullet">⚡</span>
      <div>
        <strong>Transfer Checkpoints Preserved</strong>
        <p class="text-xs muted">Transfers paused cleanly. All verified chunks are retained in memory and will resume upon re-linking.</p>
      </div>
    </div>
  `;

  // Action Buttons
  const actions = el('div', { className: 'connection-lost-actions stack stack-sm' });

  if (lastRoomCode && onReconnect) {
    const reconnectBtn = el('button', {
      type: 'button',
      className: 'btn btn-primary btn-lg w-full btn-reconnect',
    });
    reconnectBtn.innerHTML = `${iconRefresh({ size: 16 })} <span>Reconnect to Room ${lastRoomCode}</span>`;
    reconnectBtn.addEventListener('click', () => onReconnect(lastRoomCode));
    actions.append(reconnectBtn);
  }

  const retryBtn = el('button', {
    type: 'button',
    className: `btn ${lastRoomCode && onReconnect ? 'btn-secondary' : 'btn-primary'} w-full btn-return-home`,
    textContent: lastRoomCode && onReconnect ? '← Return to Pairing Home' : 'Try Again',
  });
  retryBtn.addEventListener('click', onRetry);
  actions.append(retryBtn);

  card.append(beaconWrap, titleWrap, diagCard, actions);
  layout.append(card);
  return layout;
}