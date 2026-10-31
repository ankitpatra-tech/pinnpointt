/**
 * Ephemeral "Zero-Trace View" Viewer for PinnPointt.
 *
 * Renders incoming image bytes directly onto an HTML5 <canvas> inside
 * a secure, ephemeral modal viewer.
 *
 * Security & Zero-Trace Controls:
 * - Context menu disabled (cannot right-click to save)
 * - Drag-and-drop disabled
 * - No download link or file export button in DOM
 * - Text / asset selection disabled
 * - Wipes the canvas bitmap and revokes memory buffers immediately on close.
 */

export interface ZeroTraceViewerOptions {
  blob: Blob | File;
  fileName: string;
  onClose?: () => void;
}

export async function openZeroTraceViewer(options: ZeroTraceViewerOptions): Promise<void> {
  // Remove any previous zero-trace viewer
  const existing = document.querySelector('.zero-trace-backdrop');
  if (existing) {
    existing.remove();
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'zero-trace-backdrop fade-in';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', `Zero-Trace View: ${options.fileName}`);

  const modal = document.createElement('div');
  modal.className = 'zero-trace-modal';

  // 1. Header
  const header = document.createElement('div');
  header.className = 'zero-trace-header row-between';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'zero-trace-title-wrap';

  const badge = document.createElement('span');
  badge.className = 'zero-trace-badge';
  badge.innerHTML = `<span>🔒</span> <span>Zero-Trace View</span>`;

  const title = document.createElement('span');
  title.className = 'zero-trace-filename mono text-xs';
  title.textContent = options.fileName;

  titleWrap.append(badge, title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-icon modal-close-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Close and wipe memory buffer';

  header.append(titleWrap, closeBtn);

  // 2. Banner
  const banner = document.createElement('div');
  banner.className = 'zero-trace-banner text-xs';
  banner.innerHTML = `
    <span>🛡️</span>
    <span><strong>Ephemeral Canvas View:</strong> Rendered directly in volatile memory. Right-click save and downloading are blocked. Data is wiped upon exit.</span>
  `;

  // 3. Body / Canvas Container
  const body = document.createElement('div');
  body.className = 'zero-trace-body';

  const canvas = document.createElement('canvas');
  canvas.className = 'zero-trace-canvas';

  // Disable browser context menu & drag
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dragstart', (e) => e.preventDefault());
  modal.addEventListener('contextmenu', (e) => e.preventDefault());

  const loadingEl = document.createElement('div');
  loadingEl.className = 'zero-trace-loading mono text-xs muted';
  loadingEl.textContent = 'Rendering directly to ephemeral canvas…';
  body.append(loadingEl, canvas);

  // 4. Footer
  const footer = document.createElement('div');
  footer.className = 'zero-trace-footer row-between';

  const notice = document.createElement('span');
  notice.className = 'mono text-xs muted';
  notice.textContent = 'Zero Local Disk Allocation';

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'btn btn-secondary btn-sm';
  dismissBtn.textContent = 'Close & Wipe Memory';

  footer.append(notice, dismissBtn);

  modal.append(header, banner, body, footer);
  backdrop.append(modal);
  document.body.append(backdrop);

  let isWiped = false;
  let objectUrlToRevoke: string | null = null;

  const wipeAndClose = () => {
    if (isWiped) return;
    isWiped = true;

    // 1. Zero out canvas backing store and wipe 2D context
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      // ignore
    }

    // 2. Revoke memory Object URL
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
      objectUrlToRevoke = null;
    }

    // 3. Remove DOM elements
    window.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    options.onClose?.();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      wipeAndClose();
    }
  };

  closeBtn.addEventListener('click', wipeAndClose);
  dismissBtn.addEventListener('click', wipeAndClose);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      wipeAndClose();
    }
  });
  window.addEventListener('keydown', onKeyDown);

  // Render image onto canvas
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(options.blob);
      try {
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bmp, 0, 0);
          loadingEl.remove();
        }
      } finally {
        bmp.close(); // Releases GPU memory backing immediately!
      }
    } else {
      // Fallback via Image element with temporary Object URL
      objectUrlToRevoke = URL.createObjectURL(options.blob);
      const img = new Image();
      img.onload = () => {
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          loadingEl.remove();
        }
        if (objectUrlToRevoke) {
          URL.revokeObjectURL(objectUrlToRevoke);
          objectUrlToRevoke = null;
        }
      };
      img.onerror = () => {
        loadingEl.textContent = 'Failed to decode image in memory.';
      };
      img.src = objectUrlToRevoke;
    }
  } catch (err) {
    console.error('[ZeroTraceViewer] Rendering error:', err);
    loadingEl.textContent = 'Failed to render ephemeral image.';
  }
}
