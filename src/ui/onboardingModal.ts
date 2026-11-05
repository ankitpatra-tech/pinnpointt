/**
 * Interactive Onboarding & Welcome Modal for PinnPointt.
 * Swiss Architectural Daylight Guide:
 * 1. Set display name
 * 2. Pair via 6-digit code or QR scan
 * 3. Direct P2P transfer & End-to-End Encrypted chat (WebRTC DTLS)
 */

import { iconZap, iconX } from './icons';

export function openOnboardingModal(onStart?: () => void): void {
  if (document.getElementById('pinnpointt-onboarding-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'pinnpointt-onboarding-modal';
  overlay.className = 'modal-backdrop onboarding-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'onboarding-modal-card';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-labelledby', 'onboarding-title');

  modal.innerHTML = `
    <div class="onboarding-modal-header">
      <div class="onboarding-modal-badge text-xs">How It Works</div>
      <h2 id="onboarding-title" class="onboarding-modal-title">Fast, Direct Device-to-Device Sharing</h2>
      <p class="onboarding-modal-sub">Transfer files of any size directly between phones, tablets, and computers on your local Wi-Fi or across the internet. No servers storing your data, no accounts, and 100% private.</p>
      <button class="onboarding-close-btn" type="button" aria-label="Close guide">${iconX({ size: 16 })}</button>
    </div>

    <div class="onboarding-modal-steps">
      <div class="onboarding-card-step">
        <div class="step-num-badge">1</div>
        <div class="step-details">
          <div class="step-header-text">Set Your Device Name</div>
          <div class="step-body-text">
            Choose your device's display name or tap <strong>↻</strong> so peers recognize your device.
          </div>
        </div>
      </div>

      <div class="onboarding-card-step">
        <div class="step-num-badge">2</div>
        <div class="step-details">
          <div class="step-header-text">Connect with Code or QR</div>
          <div class="step-body-text">
            Tap <strong>Start New Room</strong> to display a 6-letter room code and QR. The second device taps <strong>Join Room</strong> or scans the code.
          </div>
        </div>
      </div>

      <div class="onboarding-card-step">
        <div class="step-num-badge">3</div>
        <div class="step-details">
          <div class="step-header-text">Transfer Files &amp; Clipboard Notes</div>
          <div class="step-body-text">
            Drag and drop files of any size directly to the other screen. All transfers are end-to-end encrypted with zero intermediary servers.
          </div>
        </div>
      </div>
    </div>

    <div class="onboarding-modal-footer">
      <label class="onboarding-dismiss-label">
        <input type="checkbox" id="onboarding-dont-show" />
        <span>Don't show this again on startup</span>
      </label>
      <button type="button" class="btn btn-primary onboarding-cta-btn">
        ${iconZap({ size: 14 })} <span>Got It</span>
      </button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => {
    const checkbox = modal.querySelector('#onboarding-dont-show') as HTMLInputElement | null;
    if (checkbox?.checked) {
      localStorage.setItem('pinnpointt_onboarding_dismissed', '1');
    }
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.remove();
      if (onStart) onStart();
    }, 200);
  };

  const closeBtn = modal.querySelector('.onboarding-close-btn') as HTMLButtonElement;
  closeBtn?.addEventListener('click', close);

  const ctaBtn = modal.querySelector('.onboarding-cta-btn') as HTMLButtonElement;
  ctaBtn?.addEventListener('click', close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', handleKeydown);
      close();
    }
  };
  window.addEventListener('keydown', handleKeydown);
}

export function shouldShowOnboardingOnStartup(): boolean {
  return localStorage.getItem('pinnpointt_onboarding_dismissed') !== '1';
}
