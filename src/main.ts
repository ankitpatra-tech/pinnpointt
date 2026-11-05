import { App } from './ui/App';

// Manage Service Worker & cache-busting
if ('serviceWorker' in navigator) {
  const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  if (isDev) {
    // In dev mode, unregister any active service worker and clear caches to guarantee live updates
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) reg.unregister();
    });
    if ('caches' in window) {
      caches.keys().then((names) => {
        for (const name of names) caches.delete(name);
      });
    }
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

// Handle ?room= or #room= parameter for QR code deep links
function getRoomFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  const qRoom = params.get('room');
  if (qRoom && /^[A-Za-z0-9]{4,8}$/.test(qRoom.trim())) {
    return qRoom.trim().toUpperCase();
  }
  const hash = window.location.hash.replace(/^#/, '');
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const hRoom = hashParams.get('room');
    if (hRoom && /^[A-Za-z0-9]{4,8}$/.test(hRoom.trim())) {
      return hRoom.trim().toUpperCase();
    }
    const directMatch = hash.match(/^([A-Za-z0-9]{6})$/);
    if (directMatch) return directMatch[1].toUpperCase();
  }
  return null;
}

// Initialize app
const rootEl = document.getElementById('app');
if (rootEl) {
  const roomCode = getRoomFromURL();
  if (roomCode) {
    // Suppress onboarding popup on direct room join
    localStorage.setItem('pinnpointt_onboarding_dismissed', '1');
  }

  const app = new App(rootEl);
  app.init();

  // If URL contains room code, auto-join immediately
  if (roomCode) {
    // Clean URL without reload
    window.history.replaceState({}, '', window.location.pathname);
    app.joinWithCode(roomCode);
  }
}
