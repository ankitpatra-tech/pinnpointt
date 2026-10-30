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

let currentTheme: ThemeMode = getInitialTheme();

function renderHeroQR(): void {
  const canvas = document.getElementById('hero-qr-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  try {
    const qrEngine = new QREngine();
    const matrix = qrEngine.encode('ROOM:P88XYZ');
    const qrCanvas = new QRCanvas(canvas);
    qrCanvas.render(matrix, {
      moduleSize: 5,
      quietZone: 3,
      darkColor: currentTheme === 'light' ? '#18181B' : '#EDEDED',
      lightColor: currentTheme === 'light' ? '#FFFFFF' : '#121214',
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
  const icon = currentTheme === 'dark' ? '☀️' : '🌙';
  const label = currentTheme === 'dark' ? 'Light' : 'Dark';
  themeBtn.innerHTML = `<span class="theme-icon">${icon}</span> <span>${label}</span>`;
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
        btn.textContent = '✓ App Installed!';
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
        btn.textContent = '✓ Installed';
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

  if (!badge || !filename || !reason || !hash || !policy) return;

  const samples = {
    clean: {
      name: 'presentation_deck.pdf (4.8 MB)',
      badge: '✓ Verified Safe',
      badgeClass: 'safe',
      reason: 'Standard document format. Hardware Web Crypto SHA-256 verified. Clean transport profile.',
      hash: 'e39bdfd6e88b01b8a7bd473a481741189c717b86853f6af0818cef2a1a306a6b',
      policy: 'Direct Download Ready (Safe)',
    },
    script: {
      name: 'update_patch.ps1 (12 KB)',
      badge: '⚠️ Executable Quarantined',
      badgeClass: 'warning',
      reason: 'Executable script format (.PS1) detected. Quarantined in browser memory; execution blocked by default.',
      hash: '7d8a9b34c21f5e8a1d0b7498c362145e690f142b78912e45fa67c89012345678',
      policy: 'Quarantined in RAM (Requires Explicit Review)',
    },
    'double-ext': {
      name: 'urgent_invoice.pdf.exe (840 KB)',
      badge: '🛑 Deceptive Extension Blocked',
      badgeClass: 'danger',
      reason: 'High-risk double extension trap detected. Malware often masks executables as documents or photos.',
      hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      policy: 'Hard-Blocked Before Transmission (Trap Neutralized)',
    },
    'malware-hash': {
      name: 'eicar_antivirus_test.com (68 B)',
      badge: '🛑 Threat Signature Blocked',
      badgeClass: 'danger',
      reason: 'File SHA-256 matches a known threat signature. Local transfer denied by client triage.',
      hash: '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
      policy: 'Hard-Blocked Client-Side (0 Network Calls)',
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
    });
  });
}

// ── Startup ──
document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  setupPWAInstallation();
  setupModalTriggers();
  setupThreatSandbox();
});
