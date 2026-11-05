/**
 * PinnPointt — Hardware-Accelerated & Universal Camera QR Scanner
 * Uses native BarcodeDetector API when available, falling back to pure jsQR.
 */

import jsQR from 'jsqr';

export function extractRoomCode(raw: string): string | null {
  if (!raw) return null;
  const str = raw.trim();

  // 1. Direct URL check: URL with room query parameter
  try {
    const url = new URL(str, window.location.origin);
    const roomParam = url.searchParams.get('room');
    if (roomParam && /^[A-Za-z0-9]{4,8}$/.test(roomParam.trim())) {
      return roomParam.trim().toUpperCase();
    }
    const hash = url.hash.replace(/^#/, '');
    const hashParams = new URLSearchParams(hash);
    const hashRoom = hashParams.get('room');
    if (hashRoom && /^[A-Za-z0-9]{4,8}$/.test(hashRoom.trim())) {
      return hashRoom.trim().toUpperCase();
    }
    const pathMatch = url.pathname.match(/\/([A-Za-z0-9]{6})$/);
    if (pathMatch) return pathMatch[1].toUpperCase();
  } catch {
    // not a valid full URL
  }

  // 2. Query param string like "room=ABC123" or "?room=ABC123"
  const paramMatch = str.match(/[?&#]room=([A-Za-z0-9]{4,8})/i);
  if (paramMatch) return paramMatch[1].toUpperCase();

  // 3. Prefix like "ROOM:ABC123" or "PIN:ABC123"
  const prefixMatch = str.match(/^(?:ROOM|PIN|PINNPOINTT):?\s*([A-Za-z0-9]{4,8})$/i);
  if (prefixMatch) return prefixMatch[1].toUpperCase();

  // 4. Raw 6-character code
  if (/^[A-Za-z0-9]{6}$/.test(str)) {
    return str.toUpperCase();
  }

  return null;
}

export interface QRScannerSession {
  stop: () => void;
}

export async function startCameraQRScanner(
  videoEl: HTMLVideoElement,
  onDetected: (code: string) => void,
  onError: (err: Error) => void
): Promise<QRScannerSession> {
  let stream: MediaStream | null = null;
  let isRunning = true;
  let animFrameId: number | null = null;

  try {
    // Request environment camera for mobile scanning, fallback to default camera
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', 'true');
    await videoEl.play();

    // Check for native BarcodeDetector
    const hasBarcodeDetector = 'BarcodeDetector' in window;
    let barcodeDetector: any = null;
    if (hasBarcodeDetector) {
      try {
        barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        barcodeDetector = null;
      }
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const scanFrame = async () => {
      if (!isRunning) return;

      if (videoEl.readyState >= videoEl.HAVE_CURRENT_DATA && videoEl.videoWidth > 0) {
        let detectedRaw: string | null = null;

        if (barcodeDetector) {
          try {
            const barcodes = await barcodeDetector.detect(videoEl);
            if (barcodes && barcodes.length > 0) {
              detectedRaw = barcodes[0].rawValue || barcodes[0].data || null;
            }
          } catch {
            // fallback to jsQR
          }
        }

        if (!detectedRaw && ctx) {
          canvas.width = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (qr && qr.data) {
            detectedRaw = qr.data;
          }
        }

        if (detectedRaw) {
          const roomCode = extractRoomCode(detectedRaw);
          if (roomCode) {
            isRunning = false;
            stop();
            onDetected(roomCode);
            return;
          }
        }
      }

      if (isRunning) {
        animFrameId = requestAnimationFrame(() => {
          setTimeout(() => void scanFrame(), 80);
        });
      }
    };

    void scanFrame();
  } catch (err) {
    isRunning = false;
    stop();
    onError(err instanceof Error ? err : new Error(String(err)));
  }

  function stop() {
    isRunning = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    videoEl.srcObject = null;
  }

  return { stop };
}
