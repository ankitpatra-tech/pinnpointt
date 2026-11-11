/**
 * PinnPointt Product Website — Main Orchestrator
 *
 * Implements:
 *   - Shared Light / Dark theme management
 *   - Dynamic ISO/IEC 18004 V2-M QR Canvas preview
 *   - Native PWA Install prompt trigger (Chrome, Android, iOS Safari guide)
 *   - Interactive feature and roadmap navigation
 *   - Integration with legal & rate-limited contact modal
 */

// If landing on / with ?room= or #room=, immediately redirect to /app to join room
const searchParams = new URLSearchParams(window.location.search);
const incomingRoom = searchParams.get('room');
if (incomingRoom && /^[A-Za-z0-9]{4,8}$/.test(incomingRoom.trim())) {
  window.location.replace(`/app?room=${encodeURIComponent(incomingRoom.trim().toUpperCase())}`);
}

import { getInitialTheme, applyTheme, toggleTheme, type ThemeMode } from '../ui/theme';
import { QREngine } from '../lib/qr/QREngine';
import { QRCanvas } from '../lib/qr/QRCanvas';
import {
  initPWAInstaller,
  promptPWAInstall,
  onInstallAvailabilityChange,
  isStandalone,
  isIOS,
} from '../lib/pwaInstaller';
import { openDocModal, type DocTab } from '../ui/legalModal';
import { iconSun, iconMoon } from '../ui/icons';

let currentTheme: ThemeMode = getInitialTheme();

function renderHeroQR(): void {
  const canvas = document.getElementById('hero-qr-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  try {
    const qrEngine = new QREngine();
    const matrix = qrEngine.encode('ROOM:P88XYZ');
    const qrCanvas = new QRCanvas(canvas);
    qrCanvas.render(matrix, {
      moduleSize: 4.5,
      quietZone: 2,
      darkColor: currentTheme === 'light' ? '#111110' : '#F3F4F6',
      lightColor: currentTheme === 'light' ? '#FFFFFF' : '#15181C',
    });
  } catch (err) {
    console.warn('Hero QR render notice:', err);
  }
}

function setupTheme(): void {
  applyTheme(currentTheme);
  updateThemeButton();
  renderHeroQR();

  const themeBtn = document.getElementById('website-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      currentTheme = toggleTheme();
      updateThemeButton();
      renderHeroQR();
    });
  }
}

function updateThemeButton(): void {
  const themeBtn = document.getElementById('website-theme-toggle');
  if (!themeBtn) return;
  const icon = currentTheme === 'dark' ? iconSun({ size: 14 }) : iconMoon({ size: 14 });
  const label = currentTheme === 'dark' ? 'Light' : 'Dark';
  themeBtn.innerHTML = `<span class="theme-icon">${icon}</span> <span class="theme-label">${label}</span>`;
  themeBtn.setAttribute('title', `Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode`);
}

function setupPWAInstallation(): void {
  initPWAInstaller();

  const installButtons = document.querySelectorAll<HTMLButtonElement>('.trigger-pwa-install');
  const iosGuidance = document.getElementById('ios-install-steps');

  installButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const outcome = await promptPWAInstall();
      if (outcome === 'accepted') {
        btn.textContent = 'App Installed!';
        btn.disabled = true;
      } else if (outcome === 'ios') {
        if (iosGuidance) {
          iosGuidance.style.display = iosGuidance.style.display === 'none' ? 'block' : 'none';
          iosGuidance.scrollIntoView({ behavior: 'smooth' });
        }
      } else if (outcome === 'unavailable') {
        alert(
          'To install PinnPointt on this device:\n\n' +
          '• Chrome / Edge: Click the install icon (⊕ or ↓) in your address bar or browser menu.\n' +
          '• Mobile Safari (iOS): Tap the Share button (⎋) and select "Add to Home Screen".\n' +
          '• Android Chrome: Tap the three dots (⋮) and tap "Install app".'
        );
      }
    });
  });

  onInstallAvailabilityChange((canInstall) => {
    installButtons.forEach((btn) => {
      if (isStandalone()) {
        btn.textContent = 'Installed';
        btn.disabled = true;
      } else if (canInstall || isIOS()) {
        btn.style.display = 'inline-flex';
      }
    });
  });
}

function setupModalTriggers(): void {
  const triggers = document.querySelectorAll<HTMLElement>('[data-open-modal]');
  triggers.forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = (el.getAttribute('data-open-modal') as DocTab) || 'privacy';
      openDocModal(tab);
    });
  });
}

function setupThreatSandbox(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.sandbox-btn');
  const badge = document.getElementById('sandbox-badge');
  const filename = document.getElementById('sandbox-filename');
  const reason = document.getElementById('sandbox-reason');
  const hash = document.getElementById('sandbox-hash');
  const policy = document.getElementById('sandbox-policy');
  const network = document.getElementById('sandbox-network');

  if (!badge || !filename || !reason || !hash || !policy) return;

  const samples = {
    clean: {
      name: 'presentation_deck.pdf (4.8 MB)',
      badge: 'Verified Safe',
      badgeClass: 'safe',
      reason: 'Normal document. Transferred directly between your devices without any cloud storage.',
      hash: 'Verified Bit-Exact (SHA-256 Matched)',
      policy: 'Safe to Download (Direct Stream)',
      network: '0 network requests (100% on your device)',
    },
    'double-ext': {
      name: 'urgent_invoice.pdf.exe (1.4 MB)',
      badge: 'Blocked: double extension trap',
      badgeClass: 'danger',
      reason: 'High-risk double extension trap detected. Malware often masks executables as documents or photos.',
      hash: 'Blocked Before Sending (Trap Neutralized)',
      policy: 'Blocked (Never Sent or Downloaded)',
      network: '0 network requests (100% on your device)',
    },
    archive: {
      name: 'project_footage_4k.zip (18.2 GB)',
      badge: 'Verified Safe (Archive)',
      badgeClass: 'safe',
      reason: 'Multi-gigabyte archive streamed straight to disk with OPFS without tab memory allocation.',
      hash: 'Verified Bit-Exact (SHA-256 Matched)',
      policy: 'Safe to Download (Direct Stream)',
      network: '0 network requests (100% on your device)',
    },
    script: {
      name: 'update_patch.ps1 (12 KB)',
      badge: 'Warning: Executable Script',
      badgeClass: 'warning',
      reason: 'Script file (.ps1) detected. PinnPointt pauses it in memory so it cannot run automatically on your device.',
      hash: 'Held in Browser Memory (Execution Blocked)',
      policy: 'Quarantined (Requires Your Approval)',
      network: '0 network requests (100% on your device)',
    },
    'malware-hash': {
      name: 'eicar_antivirus_test.com (68 B)',
      badge: 'Blocked: Threat Signature',
      badgeClass: 'danger',
      reason: 'Known harmful payload detected. Blocked instantly before transfer to protect the receiver.',
      hash: 'Matched Known Threat (Client Triage)',
      policy: 'Hard-Blocked Client-Side (0 Network Calls)',
      network: '0 network requests (100% on your device)',
    },
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const sampleKey = (btn.getAttribute('data-sample') || 'clean') as keyof typeof samples;
      const data = samples[sampleKey] || samples.clean;

      badge.textContent = data.badge;
      badge.className = `sandbox-status-badge ${data.badgeClass}`;
      filename.textContent = data.name;
      reason.textContent = data.reason;
      hash.textContent = data.hash;
      policy.textContent = data.policy;
      if (network && data.network) {
        network.textContent = data.network;
      }

      const outputBox = document.getElementById('sandbox-output');
      if (outputBox) {
        outputBox.classList.remove('sandbox-animate');
        void outputBox.offsetWidth; // trigger reflow
        outputBox.classList.add('sandbox-animate');
      }
    });
  });
}

function setupNavbarScroll(): void {
  const navbar = document.querySelector('.site-navbar');
  if (!navbar) return;

  const onScroll = () => {
    if (window.scrollY > 15) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function setupMobileMenu(): void {
  const toggleBtn = document.getElementById('nav-toggle-btn') as HTMLButtonElement | null;
  const navLinks = document.getElementById('site-nav-links');
  if (!toggleBtn || !navLinks) return;

  const toggleMenu = (forceOpen?: boolean) => {
    const shouldOpen = forceOpen !== undefined ? forceOpen : !navLinks.classList.contains('mobile-open');
    navLinks.classList.toggle('mobile-open', shouldOpen);
    toggleBtn.classList.toggle('active', shouldOpen);
    toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
  };

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Close when clicking any nav link
  navLinks.querySelectorAll<HTMLAnchorElement>('.site-nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      toggleMenu(false);
    });
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!navLinks.contains(e.target as Node) && !toggleBtn.contains(e.target as Node)) {
      toggleMenu(false);
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleMenu(false);
    }
  });

  // Close when expanding to desktop viewport
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1060) {
      toggleMenu(false);
    }
  });
}

// ── Startup ──
document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  setupPWAInstallation();
  setupModalTriggers();
  setupThreatSandbox();
  setupNavbarScroll();
  setupMobileMenu();
});
