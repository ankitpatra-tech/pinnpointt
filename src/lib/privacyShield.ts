/**
 * In-Flight Privacy Shield for PinnPointt.
 *
 * Removes photo metadata (EXIF, GPS coordinates, camera serial numbers,
 * timestamps, and embedded author details) in-memory before bytes
 * enter the WebRTC DataChannel.
 *
 * For JPEGs: Direct lossless binary segment stripping (removes APP1/EXIF/GPS,
 * APP2, APP13, and COM markers without re-encoding or quality loss).
 * For PNG / WebP: Canvas redraw cleans ancillary metadata chunks.
 */

export interface StripResult {
  file: File;
  stripped: boolean;
  removedBytes: number;
}

/**
 * Checks if a file is an image format supported by Privacy Shield.
 */
export function isMetadataStrippable(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type === 'image/jpeg' ||
    type === 'image/jpg' ||
    type === 'image/png' ||
    type === 'image/webp' ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp')
  );
}

/**
 * Strips all metadata from an image file in-memory.
 */
export async function stripImageMetadata(file: File): Promise<StripResult> {
  if (!isMetadataStrippable(file)) {
    return { file, stripped: false, removedBytes: 0 };
  }

  const isJpeg =
    file.type === 'image/jpeg' ||
    file.type === 'image/jpg' ||
    file.name.toLowerCase().endsWith('.jpg') ||
    file.name.toLowerCase().endsWith('.jpeg');

  try {
    if (isJpeg) {
      const buffer = await file.arrayBuffer();
      const stripped = stripJpegExifLossless(buffer);
      if (stripped.stripped && stripped.removedBytes > 0) {
        const cleanFile = new File([stripped.buffer], file.name, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        return { file: cleanFile, stripped: true, removedBytes: stripped.removedBytes };
      }
    }

    // Fallback or PNG/WebP: Canvas re-encoding
    const cleanBlob = await stripViaCanvas(file);
    if (cleanBlob) {
      const cleanFile = new File([cleanBlob], file.name, {
        type: cleanBlob.type || file.type,
        lastModified: Date.now(),
      });
      const removedBytes = Math.max(0, file.size - cleanFile.size);
      return { file: cleanFile, stripped: true, removedBytes };
    }
  } catch (err) {
    console.warn('[PrivacyShield] Metadata stripping failed, using original file:', err);
  }

  return { file, stripped: false, removedBytes: 0 };
}

/**
 * Losslessly strips EXIF/GPS (APP1), Photoshop (APP13), and comment (COM)
 * markers from a JPEG ArrayBuffer without recompressing pixel data.
 */
export function stripJpegExifLossless(inputBuffer: ArrayBuffer): {
  buffer: ArrayBuffer;
  stripped: boolean;
  removedBytes: number;
} {
  const view = new DataView(inputBuffer);
  const length = inputBuffer.byteLength;

  // Must start with SOI marker (0xFF, 0xD8)
  if (length < 4 || view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) {
    return { buffer: inputBuffer, stripped: false, removedBytes: 0 };
  }

  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array(inputBuffer, 0, 2)); // SOI

  let offset = 2;
  let didStrip = false;
  let removedBytes = 0;

  while (offset < length) {
    if (view.getUint8(offset) !== 0xff) {
      // Non-marker byte before SOS; abort lossless strip and fallback
      return { buffer: inputBuffer, stripped: false, removedBytes: 0 };
    }

    const marker = view.getUint8(offset + 1);

    // SOS (Start of Scan 0xDA) or EOI (0xD9): entropy image data begins.
    // Preserve everything from SOS to end of file without modifications.
    if (marker === 0xda || marker === 0xd9) {
      parts.push(new Uint8Array(inputBuffer, offset));
      break;
    }

    // Standalone markers without length: RST0-7, SOI, TEM
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(new Uint8Array(inputBuffer, offset, 2));
      offset += 2;
      continue;
    }

    if (offset + 4 > length) break;
    const segmentLength = view.getUint16(offset + 2, false); // big-endian segment length including length bytes
    const totalSegmentBytes = segmentLength + 2;

    if (offset + totalSegmentBytes > length) break;

    // Markers to strip:
    // 0xE1: APP1 (EXIF, XMP, GPS coordinates)
    // 0xE2: APP2 (Extended EXIF / FlashPix)
    // 0xED: APP13 (Photoshop IPTC metadata)
    // 0xFE: COM (Comment text)
    const shouldStrip =
      marker === 0xe1 ||
      marker === 0xe2 ||
      marker === 0xed ||
      marker === 0xfe;

    if (shouldStrip) {
      didStrip = true;
      removedBytes += totalSegmentBytes;
    } else {
      parts.push(new Uint8Array(inputBuffer, offset, totalSegmentBytes));
    }

    offset += totalSegmentBytes;
  }

  if (!didStrip) {
    return { buffer: inputBuffer, stripped: false, removedBytes: 0 };
  }

  // Concatenate cleaned segments
  const totalCleanBytes = parts.reduce((acc, p) => acc + p.byteLength, 0);
  const cleanBuffer = new Uint8Array(totalCleanBytes);
  let cur = 0;
  for (const part of parts) {
    cleanBuffer.set(part, cur);
    cur += part.byteLength;
  }

  return {
    buffer: cleanBuffer.buffer,
    stripped: true,
    removedBytes,
  };
}

/**
 * Strips metadata by decoding into an in-memory canvas and re-encoding.
 */
async function stripViaCanvas(file: File): Promise<Blob | null> {
  const mime = file.type || 'image/png';

  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const offscreen = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = offscreen.getContext('2d');
        if (ctx) {
          ctx.drawImage(bmp, 0, 0);
          return await offscreen.convertToBlob({ type: mime });
        }
      }
    } finally {
      bmp.close();
    }
  }

  // Standard HTML5 Canvas fallback
  return new Promise<Blob | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => resolve(blob), mime);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
