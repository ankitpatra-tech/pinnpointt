/**
 * PinnPointt Product Website — Main Orchestrator
 *
 * Implements:
 *   - Shared Light / Dark theme management
 *   - Dynamic ISO/IEC 18004 V2-M QR Canvas preview
 *   - Native PWA Install prompt trigger (Chrome, Android, iOS Safari guide)
 *   - Interactive feature and roadmap navigation
 *   - Integration with legal & rate-limited contact modal
 */

// If landing on / with ?room= or #room=, immediately redirect to /app to join room
const searchParams = new URLSearchParams(window.location.search);
const incomingRoom = searchParams.get('room');
if (incomingRoom && /^[A-Za-z0-9]{4,8}$/.test(incomingRoom.trim())) {
  window.location.replace(`/app?room=${encodeURIComponent(incomingRoom.trim().toUpperCase())}`);
}

import { getInitialTheme, applyTheme, toggleTheme, type ThemeMode } from '../ui/theme';
import { QREngine } from '../lib/qr/QREngine';
import { QRCanvas } from '../lib/qr/QRCanvas';
import {
  initPWAInstaller,
  promptPWAInstall,
  onInstallAvailabilityChange,
  isStandalone,
  isIOS,
} from '../lib/pwaInstaller';
import { openDocModal, type DocTab } from '../ui/legalModal';
import { iconSun, iconMoon } from '../ui/icons';

let currentTheme: ThemeMode = getInitialTheme();

function renderHeroQR(): void {
  const canvas = document.getElementById('hero-qr-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  try {
    const qrEngine = new QREngine();
    const matrix = qrEngine.encode('ROOM:K9X-402');
    const qrCanvas = new QRCanvas(canvas);
    qrCanvas.render(matrix, {
      moduleSize: 3.2,
      quietZone: 1,
      darkColor: '#0A0B0E',
      lightColor: '#FFFFFF',
    });
  } catch (err) {
    console.warn('Hero QR render notice:', err);
  }
}

function setupTheme(): void {
  applyTheme(currentTheme);
  updateThemeButton();
  renderHeroQR();

  const themeBtn = document.getElementById('website-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      currentTheme = toggleTheme();
      updateThemeButton();
      renderHeroQR();
    });
  }
}

function updateThemeButton(): void {
  const themeBtn = document.getElementById('website-theme-toggle');
  if (!themeBtn) return;
  const icon = currentTheme === 'dark' ? iconSun({ size: 14 }) : iconMoon({ size: 14 });
  const label = currentTheme === 'dark' ? 'Light' : 'Dark';
  themeBtn.innerHTML = `<span class="theme-icon">${icon}</span> <span class="theme-label">${label}</span>`;
  themeBtn.setAttribute('title', `Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode`);
}

function setupPWAInstallation(): void {
  initPWAInstaller();

  const installButtons = document.querySelectorAll<HTMLButtonElement>('.trigger-pwa-install');
  const iosGuidance = document.getElementById('ios-install-steps');

  installButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const outcome = await promptPWAInstall();
      if (outcome === 'accepted') {
        btn.textContent = 'App Installed!';
        btn.disabled = true;
      } else if (outcome === 'ios') {
        if (iosGuidance) {
          iosGuidance.style.display = iosGuidance.style.display === 'none' ? 'block' : 'none';
          iosGuidance.scrollIntoView({ behavior: 'smooth' });
        }
      } else if (outcome === 'unavailable') {
        alert(
          'To install PinnPointt on this device:\n\n' +
          '• Chrome / Edge: Click the install icon (⊕ or ↓) in your address bar or browser menu.\n' +
          '• Mobile Safari (iOS): Tap the Share button (⎋) and select "Add to Home Screen".\n' +
          '• Android Chrome: Tap the three dots (⋮) and tap "Install app".'
        );
      }
    });
  });

  onInstallAvailabilityChange((canInstall) => {
    installButtons.forEach((btn) => {
      if (isStandalone()) {
        btn.textContent = 'Installed';
        btn.disabled = true;
      } else if (canInstall || isIOS()) {
        btn.style.display = 'inline-flex';
      }
    });
  });
}

function setupModalTriggers(): void {
  const triggers = document.querySelectorAll<HTMLElement>('[data-open-modal]');
  triggers.forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = (el.getAttribute('data-open-modal') as DocTab) || 'privacy';
      openDocModal(tab);
    });
  });
}

function setupThreatSandbox(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.sandbox-btn');
  const badge = document.getElementById('sandbox-badge');
  const filename = document.getElementById('sandbox-filename');
  const reason = document.getElementById('sandbox-reason');
  const hash = document.getElementById('sandbox-hash');
  const policy = document.getElementById('sandbox-policy');
  const network = document.getElementById('sandbox-network');

  if (!badge || !filename || !reason || !hash || !policy) return;

  const samples = {
    clean: {
      name: 'presentation_deck.pdf (4.8 MB)',
      badge: 'Verified Safe',
      badgeClass: 'safe',
      reason: 'Normal document. Transferred directly between your devices without any cloud storage.',
      hash: 'Verified Bit-Exact (SHA-256 Matched)',
      policy: 'Safe to Download (Direct Stream)',
      network: '0 network requests (100% on your device)',
    },
    'double-ext': {
      name: 'invoice_receipt.pdf.exe (1.4 MB)',
      badge: 'Blocked: double extension trap',
      badgeClass: 'danger',
      reason: 'High-risk double extension trap detected. Malware often masks executables as documents or photos.',
      hash: 'Blocked Before Sending (Trap Neutralized)',
      policy: 'Blocked (Never Sent or Downloaded)',
      network: '0 network requests (100% on your device)',
    },
    archive: {
      name: 'project_footage_4k.zip (18.2 GB)',
      badge: 'Verified Safe (Archive)',
      badgeClass: 'safe',
      reason: 'Multi-gigabyte archive streamed straight to disk with OPFS without tab memory allocation.',
      hash: 'Verified Bit-Exact (SHA-256 Matched)',
      policy: 'Safe to Download (Direct Stream)',
      network: '0 network requests (100% on your device)',
    },
    script: {
      name: 'update_patch.ps1 (12 KB)',
      badge: 'Warning: Executable Script',
      badgeClass: 'warning',
      reason: 'Script file (.ps1) detected. PinnPointt pauses it in memory so it cannot run automatically on your device.',
      hash: 'Held in Browser Memory (Execution Blocked)',
      policy: 'Quarantined (Requires Your Approval)',
      network: '0 network requests (100% on your device)',
    },
    'malware-hash': {
      name: 'eicar_antivirus_test.com (68 B)',
      badge: 'Blocked: Threat Signature',
      badgeClass: 'danger',
      reason: 'Known harmful payload detected. Blocked instantly before transfer to protect the receiver.',
      hash: 'Matched Known Threat (Client Triage)',
      policy: 'Hard-Blocked Client-Side (0 Network Calls)',
      network: '0 network requests (100% on your device)',
    },
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const sampleKey = (btn.getAttribute('data-sample') || 'clean') as keyof typeof samples;
      const data = samples[sampleKey] || samples.clean;

      badge.textContent = data.badge;
      badge.className = `sandbox-status-badge ${data.badgeClass}`;
      filename.textContent = data.name;
      reason.textContent = data.reason;
      hash.textContent = data.hash;
      policy.textContent = data.policy;
      if (network && data.network) {
        network.textContent = data.network;
      }

      const outputBox = document.getElementById('sandbox-output');
      if (outputBox) {
        outputBox.classList.remove('sandbox-animate');
        void outputBox.offsetWidth; // trigger reflow
        outputBox.classList.add('sandbox-animate');
      }

      const scanBeam = document.getElementById('sandbox-scan-beam');
      if (scanBeam) {
        scanBeam.classList.remove('scanning');
        void scanBeam.offsetWidth; // trigger reflow
        scanBeam.classList.add('scanning');
      }
    });
  });
}

function setupScreenScale(): void {
  const syncViewportScale = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const root = document.documentElement;
    root.style.setProperty('--viewport-w', `${vw}px`);
    root.style.setProperty('--viewport-h', `${vh}px`);

    // Dynamically adjust --fluid-max-w based on Windows screen resolution
    if (vw >= 1920) {
      // 1440p / 4K / Ultrawide monitors
      root.style.setProperty('--fluid-max-w', 'min(92vw, 1840px)');
    } else if (vw >= 1280) {
      // 1080p / Standard Windows laptops
      root.style.setProperty('--fluid-max-w', '92vw');
    } else {
      // Tablets / Phones
      root.style.setProperty('--fluid-max-w', '94vw');
    }
  };

  window.addEventListener('resize', syncViewportScale, { passive: true });
  syncViewportScale();

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => syncViewportScale());
    ro.observe(document.documentElement);
  }
}

function setupNavIndicator(): void {
  const navGroup = document.getElementById('site-nav-links');
  const indicator = document.getElementById('pp-nav-indicator');
  const navItems = document.querySelectorAll<HTMLElement>('.pp-nav-item');
  if (!navGroup || !indicator || navItems.length === 0) return;

  let isHovering = false;

  const movePill = (el: HTMLElement | null) => {
    if (!el || !indicator) return;
    indicator.style.width = `${el.offsetWidth}px`;
    indicator.style.transform = `translateX(${el.offsetLeft}px)`;
    indicator.style.opacity = '1';
  };

  navItems.forEach((item) => {
    item.addEventListener('mouseenter', () => {
      isHovering = true;
      movePill(item);
    });
    item.addEventListener('click', () => {
      navItems.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      movePill(item);
    });
  });

  navGroup.addEventListener('mouseleave', () => {
    isHovering = false;
    const active = navGroup.querySelector<HTMLElement>('.pp-nav-item.active');
    if (active) {
      movePill(active);
    } else {
      indicator.style.opacity = '0';
    }
  });

  // IntersectionObserver Scroll-Spy to glide highlight behind active section
  const sectionIds = ['how-it-works', 'why', 'security', 'comparison', 'faq'];
  const sections = sectionIds
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el !== null);

  if ('IntersectionObserver' in window && sections.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (isHovering) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const id = visible.target.id;
          navItems.forEach((item) => {
            const match = item.getAttribute('href') === `#${id}`;
            item.classList.toggle('active', match);
            if (match) {
              movePill(item);
            }
          });
        }
      },
      {
        rootMargin: '-20% 0px -50% 0px',
        threshold: [0.1, 0.25, 0.5],
      }
    );

    sections.forEach((sec) => observer.observe(sec));
  }

  // Initial pill placement
  setTimeout(() => {
    const active = document.querySelector<HTMLElement>('.pp-nav-item.active') || navItems[0];
    if (active) movePill(active);
  }, 100);
}

function setupDemoCodeCopy(): void {
  const btn = document.getElementById('copy-demo-code');
  if (!btn) return;
  btn.addEventListener('click', () => {
    navigator.clipboard?.writeText('K9X-402').then(() => {
      btn.innerHTML = '<span>Copied!</span>';
      setTimeout(() => {
        btn.innerHTML = '<span>Room Code: <strong>K9X-402</strong></span>';
      }, 1500);
    }).catch(() => {
      btn.innerHTML = '<span>Copied!</span>';
      setTimeout(() => {
        btn.innerHTML = '<span>Room Code: <strong>K9X-402</strong></span>';
      }, 1500);
    });
  });
}

function setupLiveDemoTransfer(): void {
  const fill = document.getElementById('demo-progress-fill');
  const percentEl = document.getElementById('demo-percent');
  const etaEl = document.getElementById('demo-eta');
  if (!fill || !percentEl || !etaEl) return;

  let percent = 72;
  const speed = 68.4;
  const totalMB = 4200;

  setInterval(() => {
    percent += 0.4;
    if (percent > 100) {
      percent = 72;
    }
    const currentPercent = Math.round(percent);
    fill.style.width = `${currentPercent}%`;
    percentEl.innerHTML = `<strong>${currentPercent}%</strong> transferred`;
    const remainingMB = Math.max(0, totalMB * (1 - percent / 100));
    const secLeft = Math.max(1, Math.round(remainingMB / speed));
    etaEl.innerHTML = `About <strong>${secLeft} sec left</strong>`;
  }, 220);
}

function setupNavbarScroll(): void {
  const navbar = document.querySelector('.site-navbar');
  if (!navbar) return;

  const onScroll = () => {
    if (window.scrollY > 15) {
      navbar.classList.add('scrolled', 'is-scrolled');
    } else {
      navbar.classList.remove('scrolled', 'is-scrolled');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function setupMobileMenu(): void {
  const toggleBtn = document.getElementById('nav-toggle-btn') as HTMLButtonElement | null;
  const navLinks = document.getElementById('site-nav-links');
  if (!toggleBtn || !navLinks) return;

  const toggleMenu = (forceOpen?: boolean) => {
    const shouldOpen = forceOpen !== undefined ? forceOpen : !navLinks.classList.contains('mobile-open');
    navLinks.classList.toggle('mobile-open', shouldOpen);
    toggleBtn.classList.toggle('active', shouldOpen);
    toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
  };

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Close when clicking any nav link
  navLinks.querySelectorAll<HTMLAnchorElement>('.site-nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      toggleMenu(false);
    });
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!navLinks.contains(e.target as Node) && !toggleBtn.contains(e.target as Node)) {
      toggleMenu(false);
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleMenu(false);
    }
  });

  // Close when expanding to desktop viewport
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1060) {
      toggleMenu(false);
    }
  });
}

function setupScrollReveal(): void {
  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const elements = document.querySelectorAll<HTMLElement>('.reveal-up');

  if (isReducedMotion) {
    elements.forEach((el) => el.classList.add('is-revealed'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      rootMargin: '0px 0px -40px 0px',
      threshold: 0.08,
    }
  );

  elements.forEach((el) => observer.observe(el));
}

function setupScrollytelling(): void {
  const stepCards = document.querySelectorAll<HTMLElement>('.scrolly-step-card');
  const stagePills = document.querySelectorAll<HTMLButtonElement>('.stage-pill');
  const scenes = document.querySelectorAll<HTMLElement>('.stage-scene');
  if (stepCards.length === 0 || scenes.length === 0) return;

  const setActiveStep = (stepNumber: string | number) => {
    const num = String(stepNumber);
    stepCards.forEach((card) => {
      card.classList.toggle('is-active', card.getAttribute('data-step') === num);
    });
    stagePills.forEach((pill) => {
      pill.classList.toggle('active', pill.getAttribute('data-target-step') === num);
    });
    scenes.forEach((scene) => {
      scene.classList.toggle('is-active', scene.getAttribute('data-scene') === num);
    });
  };

  // Default to step 1
  setActiveStep('1');

  // Click on step cards
  stepCards.forEach((card) => {
    card.addEventListener('click', () => {
      const step = card.getAttribute('data-step') || '1';
      setActiveStep(step);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const step = card.getAttribute('data-step') || '1';
        setActiveStep(step);
      }
    });
  });

  // Click on stage pills
  stagePills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const step = pill.getAttribute('data-target-step') || '1';
      setActiveStep(step);
    });
  });

  // Scroll-linked observer to automatically morph stage as user scrolls
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visible) {
        const step = visible.target.getAttribute('data-step');
        if (step) setActiveStep(step);
      }
    },
    {
      rootMargin: '-20% 0px -40% 0px',
      threshold: [0.2, 0.5],
    }
  );

  stepCards.forEach((card) => observer.observe(card));
}

function setupAnimatedCounters(): void {
  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const metrics = document.querySelectorAll<HTMLElement>('.proof-metric[data-counter-target]');
  if (metrics.length === 0) return;

  if (isReducedMotion) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const targetEl = entry.target as HTMLElement;
        observer.unobserve(targetEl);

        const targetValue = parseInt(targetEl.getAttribute('data-counter-target') || '0', 10);
        const suffix = targetEl.getAttribute('data-counter-suffix') || '';
        const prefix = targetEl.getAttribute('data-counter-prefix') || '';
        const counterType = targetEl.getAttribute('data-counter-type') || 'standard';
        const denom = targetEl.getAttribute('data-counter-denom') || '';
        const duration = 1200;
        let startTimestamp: number | null = null;

        const step = (timestamp: number) => {
          if (!startTimestamp) startTimestamp = timestamp;
          const progress = Math.min((timestamp - startTimestamp) / duration, 1);
          // Ease-out cubic: 1 - (1 - t)^3
          const easeProgress = 1 - Math.pow(1 - progress, 3);
          const currentVal = Math.round(easeProgress * targetValue);

          if (counterType === 'fraction') {
            targetEl.textContent = `${currentVal} / ${denom}`;
          } else {
            targetEl.textContent = `${prefix}${currentVal}${suffix}`;
          }

          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            if (counterType === 'fraction') {
              targetEl.textContent = `${targetValue} / ${denom}`;
            } else {
              targetEl.textContent = `${prefix}${targetValue}${suffix}`;
            }
          }
        };

        requestAnimationFrame(step);
      });
    },
    {
      threshold: 0.2,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  metrics.forEach((metric) => {
    const counterType = metric.getAttribute('data-counter-type') || 'standard';
    const suffix = metric.getAttribute('data-counter-suffix') || '';
    const prefix = metric.getAttribute('data-counter-prefix') || '';
    const denom = metric.getAttribute('data-counter-denom') || '';
    if (counterType === 'fraction') {
      metric.textContent = `0 / ${denom}`;
    } else {
      metric.textContent = `${prefix}0${suffix}`;
    }
    observer.observe(metric);
  });
}

function setupPrefooterGlow(): void {
  const glow = document.getElementById('pre-footer-glow');
  const stage = document.querySelector<HTMLElement>('.pre-footer-stage');
  if (!glow || !stage) return;

  const updateGlow = () => {
    const rect = stage.getBoundingClientRect();
    const vh = window.innerHeight;
    if (rect.top < vh && rect.bottom > 0) {
      const progress = Math.min(Math.max((vh - rect.top) / (vh + rect.height * 0.5), 0), 1);
      const scale = 0.85 + progress * 0.65;
      const opacity = 0.45 + progress * 0.5;
      glow.style.setProperty('--glow-scale', scale.toFixed(2));
      glow.style.opacity = opacity.toFixed(2);
    }
  };

  window.addEventListener('scroll', updateGlow, { passive: true });
  updateGlow();
}

// ── Startup ──
document.addEventListener('DOMContentLoaded', () => {
  setupScreenScale();
  setupNavIndicator();
  setupDemoCodeCopy();
  setupLiveDemoTransfer();
  setupScrollReveal();
  setupScrollytelling();
  setupAnimatedCounters();
  setupPrefooterGlow();
  setupTheme();
  setupPWAInstallation();
  setupModalTriggers();
  setupThreatSandbox();
  setupNavbarScroll();
  setupMobileMenu();
});
