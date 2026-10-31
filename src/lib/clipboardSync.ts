/**
 * Instant Universal Clipboard Sync for PinnPointt.
 *
 * Transmits clipboard text, URLs, code snippets, and screenshots
 * over the WebRTC DataChannel in real-time ($0 server cost, 100% client-side).
 */

export type ClipboardContentType = 'text' | 'url' | 'code' | 'image';

export interface ClipboardItemData {
  id: string;
  type: ClipboardContentType;
  content: string; // text, URL, code snippet, or image data URL/description
  timestamp: number;
  sender: string;
  preview?: string;
  fileName?: string;
}

export interface ClipboardSyncMessage {
  type: 'clipboard-sync';
  item: ClipboardItemData;
}

/**
 * Type guard for incoming clipboard sync DataChannel messages.
 */
export function isClipboardSyncMessage(msg: unknown): msg is ClipboardSyncMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'clipboard-sync' &&
    !!m.item &&
    typeof m.item === 'object' &&
    typeof (m.item as Record<string, unknown>).content === 'string'
  );
}

/**
 * Inspects a string to detect whether it is a URL, formatted code snippet, or regular text.
 */
export function detectClipboardContentType(text: string): ClipboardContentType {
  const trimmed = text.trim();

  // 1. URL detection
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed)) {
    try {
      new URL(trimmed);
      return 'url';
    } catch {
      // not a strict valid URL
    }
  }

  // 2. Code detection
  // Multi-line or contains typical programming syntax patterns
  const lines = trimmed.split('\n');
  const codeKeywords = [
    'function', 'const ', 'let ', 'var ', 'import ', 'export ', 'class ',
    'def ', 'return ', 'console.', 'public ', 'private ', 'interface ',
    'SELECT ', 'INSERT ', 'UPDATE ', 'FROM ', 'WHERE ',
    '<html', '<div', '<span', '<template', '<script',
    'docker run', 'kubectl ', 'git ', 'npm ', 'pnpm ', 'cargo ', 'pip ',
  ];

  const hasCodeKeywords = codeKeywords.some((kw) => trimmed.includes(kw));
  const hasSyntaxChars = /[{}\[\]();<>=+\-*\/&|]/.test(trimmed);
  const isIndented = lines.length > 1 && lines.some((l) => /^\s{2,}|\t/.test(l));

  if ((lines.length > 2 && (hasCodeKeywords || isIndented)) || (lines.length > 1 && hasCodeKeywords && hasSyntaxChars)) {
    return 'code';
  }

  return 'text';
}

/**
 * Copies text into the user's system clipboard using modern clipboard API
 * with robust execCommand fallback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // 1. Try native modern Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('[ClipboardSync] navigator.clipboard.writeText failed, falling back:', err);
    }
  }

  // 2. Fallback: temporary hidden textarea
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);

    textarea.focus();
    textarea.select();
    const successful = document.execCommand('copy');
    textarea.remove();
    return successful;
  } catch (err) {
    console.error('[ClipboardSync] execCommand fallback failed:', err);
    return false;
  }
}

/**
 * Reads from the system clipboard if permitted by browser permissions.
 * Supports text, URLs, and image files.
 */
export async function readSystemClipboard(): Promise<{
  type: ClipboardContentType;
  content: string;
  file?: File;
} | null> {
  // 1. Try clipboard items API (handles images and text)
  if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        // Image item
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] || 'png';
          const file = new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imageType });
          return {
            type: 'image',
            content: `Screenshot image (${Math.round(blob.size / 1024)} KB)`,
            file,
          };
        }

        // Text item
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          if (text) {
            return {
              type: detectClipboardContentType(text),
              content: text,
            };
          }
        }
      }
    } catch (err) {
      console.warn('[ClipboardSync] navigator.clipboard.read unavailable or rejected, trying readText:', err);
    }
  }

  // 2. Fallback to readText
  if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        return {
          type: detectClipboardContentType(text),
          content: text,
        };
      }
    } catch (err) {
      console.warn('[ClipboardSync] navigator.clipboard.readText failed:', err);
    }
  }

  return null;
}

/**
 * Formats a clean snippet preview for scratchpad cards.
 */
export function formatClipboardSnippet(content: string, maxLen = 120): string {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLen) return singleLine;
  return `${singleLine.slice(0, maxLen - 1)}…`;
}
