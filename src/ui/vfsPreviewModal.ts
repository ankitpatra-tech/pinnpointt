/**
 * On-Demand Byte-Slice Preview Modal for Virtual Drive.
 *
 * Renders ephemeral file previews (images, text/code, audio, video) streamed
 * on-demand directly from the remote peer's disk with 0 local permanent storage.
 */

import { formatBytes } from './components';
import { iconX, iconZap, iconDownload, iconFolder } from './icons';
import type { VfsFileEntry, VfsSliceResult } from '../lib/webrtc/virtualDrive';

export interface VfsPreviewModalOptions {
  entry: VfsFileEntry;
  slicePromise: Promise<VfsSliceResult>;
  onPullFile: (fileId: string) => void;
  onClose?: () => void;
}

export function openVfsPreviewModal(options: {
  entry: VfsFileEntry;
  slicePromise: Promise<VfsSliceResult>;
  onPullFile: (fileId: string) => void;
  onClose?: () => void;
}): void {
  const existing = document.querySelector('.vfs-preview-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'vfs-preview-backdrop fade-in';

  const modal = document.createElement('div');
  modal.className = 'vfs-preview-modal';

  // 1. Header
  const header = document.createElement('div');
  header.className = 'vfs-preview-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'vfs-preview-title-wrap';

  const title = document.createElement('div');
  title.className = 'vfs-preview-title';
  title.textContent = options.entry.name;

  const pathBadge = document.createElement('div');
  pathBadge.className = 'vfs-preview-path mono text-xs muted';
  pathBadge.textContent = `${options.entry.relativePath} • ${formatBytes(options.entry.size)}`;

  titleWrap.append(title, pathBadge);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-icon modal-close-btn';
  closeBtn.innerHTML = iconX({ size: 16 });
  closeBtn.title = 'Close preview';

  header.append(titleWrap, closeBtn);

  // 2. Body
  const body = document.createElement('div');
  body.className = 'vfs-preview-body';

  const loadingEl = document.createElement('div');
  loadingEl.className = 'vfs-preview-loading';
  loadingEl.innerHTML = `
    <div class="vfs-spinner"></div>
    <div class="mono text-xs muted">Requesting byte slice from remote peer disk (512 KB)...</div>
  `;
  body.append(loadingEl);

  // 3. Notice badge
  const notice = document.createElement('div');
  notice.className = 'vfs-preview-notice mono text-xs';
  notice.innerHTML = `${iconZap({ size: 14 })} <span>Live P2P Byte-Slice Preview • Zero Local Disk Allocation</span>`;

  // 4. Footer
  const footer = document.createElement('div');
  footer.className = 'vfs-preview-footer';

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'btn btn-secondary btn-sm';
  dismissBtn.textContent = 'Close';

  const pullBtn = document.createElement('button');
  pullBtn.type = 'button';
  pullBtn.className = 'btn btn-primary btn-sm';
  pullBtn.innerHTML = `${iconDownload({ size: 14 })} <span>Pull Full File (${formatBytes(options.entry.size)})</span>`;

  footer.append(dismissBtn, pullBtn);

  modal.append(header, body, notice, footer);
  backdrop.append(modal);
  document.body.append(backdrop);
  document.body.classList.add('modal-open');

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', handleKeydown);
      close();
    }
  };
  window.addEventListener('keydown', handleKeydown);

  const close = () => {
    window.removeEventListener('keydown', handleKeydown);
    document.body.classList.remove('modal-open');
    backdrop.remove();
    options.onClose?.();
  };

  closeBtn.addEventListener('click', close);
  dismissBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  pullBtn.addEventListener('click', () => {
    options.onPullFile(options.entry.id);
    close();
  });

  // Handle byte slice resolution
  options.slicePromise
    .then((slice) => {
      loadingEl.remove();
      renderSliceContent(body, options.entry, slice);
    })
    .catch((err) => {
      loadingEl.remove();
      const errEl = document.createElement('div');
      errEl.className = 'vfs-preview-error mono text-xs';
      errEl.textContent = `Preview unavailable: ${err instanceof Error ? err.message : String(err)}`;
      body.append(errEl);
    });
}

function renderSliceContent(
  container: HTMLElement,
  entry: VfsFileEntry,
  slice: VfsSliceResult,
): void {
  const mime = slice.mimeType || entry.mimeType;

  // 1. Text / Code / Markdown / CSV / JSON
  if (slice.text !== undefined) {
    const pre = document.createElement('pre');
    pre.className = 'vfs-preview-code mono';
    pre.textContent = slice.text;

    const metaInfo = document.createElement('div');
    metaInfo.className = 'vfs-preview-meta mono text-xs muted';
    const isTruncated = slice.length < slice.totalSize;
    metaInfo.textContent = `Showing ${slice.length.toLocaleString()} bytes${
      isTruncated ? ` of ${slice.totalSize.toLocaleString()} bytes (Preview slice)` : ''
    }`;

    container.append(metaInfo, pre);
    return;
  }

  // 2. Image
  if (mime.startsWith('image/')) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'vfs-preview-img-wrap';
    const img = document.createElement('img');
    img.className = 'vfs-preview-img';
    img.src = `data:${mime};base64,${slice.dataBase64}`;
    img.alt = entry.name;
    imgWrap.append(img);
    container.append(imgWrap);
    return;
  }

  // 3. Audio
  if (mime.startsWith('audio/')) {
    const audioWrap = document.createElement('div');
    audioWrap.className = 'vfs-preview-media-wrap';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = false;
    audio.src = `data:${mime};base64,${slice.dataBase64}`;
    audioWrap.append(audio);
    container.append(audioWrap);
    return;
  }

  // 4. Video
  if (mime.startsWith('video/')) {
    const videoWrap = document.createElement('div');
    videoWrap.className = 'vfs-preview-media-wrap';
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = false;
    video.src = `data:${mime};base64,${slice.dataBase64}`;
    videoWrap.append(video);
    container.append(videoWrap);
    return;
  }

  // 5. Binary / Fallback
  const binWrap = document.createElement('div');
  binWrap.className = 'vfs-preview-bin mono text-xs';
  binWrap.innerHTML = `
    <div style="margin-bottom: 8px;">${iconFolder({ size: 28 })}</div>
    <div style="font-weight: 600;">${entry.name}</div>
    <div class="muted mt-xs">Binary file (${mime}) • ${formatBytes(entry.size)}</div>
    <div class="muted mt-sm">Binary slice loaded (${slice.length} bytes). Click "Pull Full File" to save locally.</div>
  `;
  container.append(binWrap);
}
