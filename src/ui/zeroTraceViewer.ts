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

import { iconLock, iconShield, iconX } from './icons';

export interface ZeroTraceViewerOptions {
  blob: Blob | File;
  fileName: string;
  onClose?: () => void;
}

export async function openZeroTraceViewer(options: ZeroTraceViewerOptions): Promise<void> {
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
  badge.innerHTML = `${iconLock({ size: 13 })} <span>Zero-Trace View</span>`;

  const title = document.createElement('span');
  title.className = 'zero-trace-filename mono text-xs';
  title.textContent = options.fileName;

  titleWrap.append(badge, title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-icon modal-close-btn';
  closeBtn.innerHTML = iconX({ size: 16 });
  closeBtn.title = 'Close and wipe memory buffer';

  header.append(titleWrap, closeBtn);

  // 2. Banner
  const banner = document.createElement('div');
  banner.className = 'zero-trace-banner text-xs';
  banner.innerHTML = `
    ${iconShield({ size: 14 })}
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
  document.body.classList.add('modal-open');

  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;

  const wipeMemory = () => {
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 1;
        canvas.height = 1;
      }
      if (bitmap) {
        bitmap.close();
        bitmap = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    } catch (e) {
      console.warn('Wipe memory notice:', e);
    }
  };

  const closeViewer = () => {
    window.removeEventListener('keydown', handleKeydown);
    document.body.classList.remove('modal-open');
    wipeMemory();
    backdrop.remove();
    options.onClose?.();
  };

  closeBtn.addEventListener('click', closeViewer);
  dismissBtn.addEventListener('click', closeViewer);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeViewer();
  });

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', handleKeydown);
      closeViewer();
    }
  };
  window.addEventListener('keydown', handleKeydown);

  // Render blob
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(options.blob);
      loadingEl.remove();

      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
      }
    } else {
      objectUrl = URL.createObjectURL(options.blob);
      const img = new Image();
      img.onload = () => {
        loadingEl.remove();
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
        }
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      };
      img.onerror = () => {
        loadingEl.textContent = 'Unable to render image format in ephemeral viewer.';
      };
      img.src = objectUrl;
    }
  } catch (err) {
    loadingEl.textContent = `Rendering error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
