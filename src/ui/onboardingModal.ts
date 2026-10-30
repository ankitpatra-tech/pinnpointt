/**
 * Interactive Onboarding & Welcome Modal for PinnPointt.
 * Guides users through 3 simple steps:
 * 1. Setting a friendly name
 * 2. Pairing via 6-digit code or QR scan
 * 3. Direct P2P transfer & End-to-End Encrypted chat (WebRTC DTLS)
 */

export function openOnboardingModal(onStart?: () => void): void {
  // Prevent duplicate modals
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
      <div class="onboarding-modal-badge">Welcome to PinnPointt</div>
      <h2 id="onboarding-title" class="onboarding-modal-title">Fast, Private & Direct Device-to-Device Sharing</h2>
      <p class="onboarding-modal-sub">Everything streams direct peer-to-peer. No cloud storage, no account needed, and no file size limits.</p>
      <button class="onboarding-close-btn" type="button" aria-label="Close guide">&times;</button>
    </div>

    <div class="onboarding-modal-steps">
      <div class="onboarding-card-step">
        <div class="step-num-badge">1</div>
        <div class="step-details">
          <div class="step-header-text">Set Your Name</div>
          <div class="step-body-text">
            Choose your display name or click <strong>↻</strong> for a generated moniker so your peer knows who is connecting.
          </div>
        </div>
      </div>

      <div class="onboarding-card-step">
        <div class="step-num-badge">2</div>
        <div class="step-details">
          <div class="step-header-text">Pair Devices with Code or QR</div>
          <div class="step-body-text">
            One device taps <strong>Create Room</strong> to generate a 6-digit code and QR code. The second device taps <strong>Join Room</strong> or scans the QR code with their camera.
          </div>
        </div>
      </div>

      <div class="onboarding-card-step">
        <div class="step-num-badge">3</div>
        <div class="step-details">
          <div class="step-header-text">Stream Files & Chat (100% E2EE)</div>
          <div class="step-body-text">
            Send files of any size directly between browsers. All chat and files are <strong>End-to-End Encrypted (WebRTC DTLS)</strong> with zero server storage.
          </div>
        </div>
      </div>
    </div>

    <div class="onboarding-modal-footer">
      <label class="onboarding-dismiss-label">
        <input type="checkbox" id="onboarding-dont-show" />
        <span>Don't show this guide on startup</span>
      </label>
      <button type="button" class="btn btn-primary onboarding-cta-btn">
        <span>⚡</span> <span>Got It, Let's Transfer!</span>
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
  try {
    return localStorage.getItem('pinnpointt_onboarding_dismissed') !== '1';
  } catch {
    return true;
  }
}
