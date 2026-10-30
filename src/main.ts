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

// Handle ?room= query parameter for QR code deep links
function getRoomFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('room');
}

// Initialize app
const rootEl = document.getElementById('app');
if (rootEl) {
  const app = new App(rootEl);
  app.init();

  // If URL contains room code, auto-join
  const roomCode = getRoomFromURL();
  if (roomCode) {
    // Clean URL without reload
    window.history.replaceState({}, '', '/');
    app.joinWithCode(roomCode);
  }
}
