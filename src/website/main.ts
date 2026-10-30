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

// ── Startup ──
document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  setupPWAInstallation();
  setupModalTriggers();
});
