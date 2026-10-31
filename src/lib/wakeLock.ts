/**
 * Screen WakeLock Manager for PinnPointt.
 *
 * Keeps the device screen awake during active WebRTC connections and file transfers.
 * Automatically handles re-acquiring the lock on `visibilitychange` when the tab
 * returns to the foreground, and releases it cleanly when transfers complete or rooms close.
 */

export type WakeLockStateCallback = (active: boolean) => void;

class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private readonly activeTags: Set<string> = new Set();
  private readonly listeners: Set<WakeLockStateCallback> = new Set();
  private isReacquiring = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.activeTags.size > 0) {
          void this.reacquire();
        }
      });
    }
  }

  /** Checks if the Screen WakeLock API is supported in the current browser. */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  /** Returns whether a screen wake lock is currently held. */
  isActive(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /** Subscribes to changes in wake lock status. Returns an unsubscribe function. */
  onStateChange(cb: WakeLockStateCallback): () => void {
    this.listeners.add(cb);
    cb(this.isActive());
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Acquires a screen wake lock tagged with a specific reason/component.
   * Multiple callers can acquire concurrently using different tags.
   */
  async acquire(tag: string = 'default'): Promise<boolean> {
    this.activeTags.add(tag);
    if (this.isActive()) {
      this.notify(true);
      return true;
    }
    return this.requestLock();
  }

  /**
   * Releases a screen wake lock for a specific tag.
   * The lock is only released from the OS once all tags have released.
   */
  async release(tag: string = 'default'): Promise<void> {
    this.activeTags.delete(tag);
    if (this.activeTags.size === 0 && this.sentinel) {
      try {
        await this.sentinel.release();
      } catch (err) {
        console.warn('[WakeLock] Release error:', err);
      } finally {
        this.sentinel = null;
        this.notify(false);
      }
    }
  }

  /** Drops all active locks and releases the wake lock immediately. */
  async releaseAll(): Promise<void> {
    this.activeTags.clear();
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch (err) {
        console.warn('[WakeLock] ReleaseAll error:', err);
      } finally {
        this.sentinel = null;
        this.notify(false);
      }
    }
  }

  private async requestLock(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        // If the OS drops the lock (e.g., power saver or tab backgrounded)
        if (this.activeTags.size === 0) {
          this.sentinel = null;
          this.notify(false);
        }
      });
      this.notify(true);
      return true;
    } catch (err) {
      // NotAllowedError is expected when battery saver is active or permissions policy disallows wake-lock
      console.warn('[WakeLock] Could not acquire screen wake lock:', err);
      this.sentinel = null;
      this.notify(false);
      return false;
    }
  }

  private async reacquire(): Promise<void> {
    if (this.isReacquiring) return;
    this.isReacquiring = true;
    try {
      if (this.activeTags.size > 0 && (!this.sentinel || this.sentinel.released)) {
        await this.requestLock();
      }
    } finally {
      this.isReacquiring = false;
    }
  }

  private notify(active: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(active);
      } catch (err) {
        console.error('[WakeLock] Listener callback failed:', err);
      }
    }
  }
}

export const wakeLock = new WakeLockManager();
