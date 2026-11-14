/**
 * Pinnpointt — Synthetic Haptic Audio Engine
 * Pure Web Audio API synthesis. Zero external audio assets or network requests.
 *
 * Micro-sounds:
 *   - playConnectSound(): Delicate, warm two-tone chime (520Hz -> 780Hz, 60ms decay) when peer locks in.
 *   - playCompleteSound(): Crisp micro-tick (880Hz, 25ms decay) when OPFS stream finishes SHA-256 verification.
 */

const STORAGE_KEY = 'pinnpointt_sound_muted';

let audioCtx: AudioContext | null = null;
let memoryMuted = false;

function getStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null {
  try {
    if (
      typeof localStorage !== 'undefined' &&
      typeof localStorage.getItem === 'function' &&
      typeof localStorage.setItem === 'function'
    ) {
      return localStorage;
    }
  } catch {}
  return null;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

// User-gesture listener to unlock AudioContext in strict autoplay browsers
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('drop', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
  window.addEventListener('drop', unlockAudio, { passive: true });
}

export function isSoundMuted(): boolean {
  const storage = getStorage();
  if (storage) {
    try {
      return storage.getItem(STORAGE_KEY) === '1';
    } catch {}
  }
  return memoryMuted;
}

export function setSoundMuted(muted: boolean): void {
  memoryMuted = muted;
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {}
  }
}

export function toggleSoundMuted(): boolean {
  const next = !isSoundMuted();
  setSoundMuted(next);
  return next;
}

/**
 * Delicate, warm two-tone chime (520Hz -> 780Hz, 60ms decay)
 * Plays when a WebRTC peer successfully connects.
 */
export function playConnectSound(): void {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Tone 1: 520Hz (Root)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(520, now);

    // Smooth attack (4ms) then warm 60ms exponential decay
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.14, now + 0.005);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.075);

    // Tone 2: 780Hz (Harmonic Fifth: 520Hz * 1.5)
    // Enters 55ms after tone 1 with ~60ms decay
    const t2 = now + 0.055;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(780, t2);

    gain2.gain.setValueAtTime(0.0001, t2);
    gain2.gain.exponentialRampToValueAtTime(0.15, t2 + 0.005);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.065);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(t2);
    osc2.stop(t2 + 0.075);
  } catch (err) {
    console.debug('[AudioHaptics] playConnectSound suppressed:', err);
  }
}

/**
 * Crisp micro-tick (880Hz, 25ms decay)
 * Plays when an OPFS stream finishes SHA-256 integrity verification.
 */
export function playCompleteSound(): void {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);

    // Crisp micro-tick: rapid 1.5ms attack to 0.12, rapid 25ms decay to silence
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.027);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.035);
  } catch (err) {
    console.debug('[AudioHaptics] playCompleteSound suppressed:', err);
  }
}
