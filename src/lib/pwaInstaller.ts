/**
 * PinnPointt — PWA Installation Controller & Browser Prompt Manager
 *
 * Handles:
 *   - Native beforeinstallprompt capture on Chrome/Edge/Android
 *   - iOS Safari "Add to Home Screen" micro-guidance
 *   - Standalone PWA detection (hides prompt if already installed)
 *   - Floating / in-page install prompt banner UI
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(canInstall: boolean) => void>();

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export function initPWAInstaller(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn(true));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn(false));
  });
}

export function onInstallAvailabilityChange(callback: (canInstall: boolean) => void): () => void {
  listeners.add(callback);
  callback(Boolean(deferredPrompt) || (isIOS() && !isStandalone()));
  return () => listeners.delete(callback);
}

export async function promptPWAInstall(): Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'> {
  if (isStandalone()) {
    return 'accepted';
  }

  if (deferredPrompt) {
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        deferredPrompt = null;
        listeners.forEach((fn) => fn(false));
      }
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }

  if (isIOS()) {
    return 'ios';
  }

  return 'unavailable';
}

/**
 * Creates an interactive Bauhaus PWA Install Banner
 */
export function createInstallBanner(options?: { onLaunched?: () => void }): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'pwa-install-banner fade-in';

  if (isStandalone()) {
    banner.style.display = 'none';
    return banner;
  }

  const iconWrap = document.createElement('div');
  iconWrap.className = 'install-icon-wrap';
  iconWrap.innerHTML = `
    <div class="install-logo-gem">
      <span>◉</span>
    </div>
  `;

  const infoWrap = document.createElement('div');
  infoWrap.className = 'install-info';

  const title = document.createElement('div');
  title.className = 'install-title';
  title.textContent = 'Install PinnPointt App';

  const desc = document.createElement('div');
  desc.className = 'install-desc';
  desc.textContent = isIOS()
    ? 'Add to your Home Screen for instant offline peer transfers'
    : 'Install native web app for one-tap direct file transfers';

  infoWrap.append(title, desc);

  const actionWrap = document.createElement('div');
  actionWrap.className = 'install-actions';

  const installBtn = document.createElement('button');
  installBtn.className = 'btn btn-install-cta btn-sm install-cta-btn';
  installBtn.type = 'button';
  installBtn.innerHTML = `<span>↓</span> <span>Install App</span>`;

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'btn-dismiss-install';
  dismissBtn.type = 'button';
  dismissBtn.title = 'Dismiss';
  dismissBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  dismissBtn.addEventListener('click', () => {
    banner.style.display = 'none';
  });

  const iosNotice = document.createElement('div');
  iosNotice.className = 'ios-install-guide';
  iosNotice.style.display = 'none';
  iosNotice.innerHTML = `
    <div class="ios-guide-box">
      <span>Tap Safari Share</span>
      <span class="share-icon">⎋</span>
      <span>then select <strong>"Add to Home Screen"</strong> ⊕</span>
    </div>
  `;

  installBtn.addEventListener('click', async () => {
    const outcome = await promptPWAInstall();
    if (outcome === 'accepted') {
      banner.style.display = 'none';
      options?.onLaunched?.();
    } else if (outcome === 'ios') {
      iosNotice.style.display = iosNotice.style.display === 'none' ? 'block' : 'none';
    } else if (outcome === 'unavailable') {
      // Fallback instruction for browsers where deferredPrompt isn't available
      alert('To install PinnPointt: Tap your browser menu (⋮ or ⋯) and select "Install PinnPointt" or "Add to Home Screen".');
    }
  });

  actionWrap.append(installBtn, dismissBtn);
  banner.append(iconWrap, infoWrap, actionWrap, iosNotice);

  // Auto-hide when already installed
  onInstallAvailabilityChange((canInstall) => {
    if (!canInstall && !isIOS()) {
      banner.style.display = 'none';
    }
  });

  return banner;
}
