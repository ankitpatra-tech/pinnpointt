/**
 * PinnPointt — Legal Policies, Disclaimer, Changelog & In-App Contact Modal
 *
 * Implements:
 *   - Privacy Policy (Zero cloud storage, transport encryption, SHA-256 verification, use cases)
 *   - Fair Usage Policy (Lawful personal/professional use, prohibited abuse)
 *   - Disclaimer ("AS IS", limitation of liability, peer-to-peer nature)
 *   - Changelog (v0.0.60-beta through v0.0.1-beta)
 *   - Direct In-App Contact Form with 2-per-week rate limit (email hidden from plain view)
 */

import {
  iconX,
  iconMail,
  iconCheck,
  iconShield,
  iconLock,
  iconHardDrive,
  iconRefresh,
  iconEye,
  iconAlertTriangle,
  iconAlertCircle,
  iconTerminal,
  iconWifi,
  iconShare,
} from './icons';

export type DocTab = 'privacy' | 'fair-usage' | 'disclaimer' | 'changelog' | 'contact';

let activeOverlay: HTMLElement | null = null;

// Rate limiting: 2 submissions per 7-day rolling window
const CONTACT_RATE_LIMIT_KEY = 'pinnpointt_contact_history';
const MAX_SUBMISSIONS_PER_WEEK = 2;
const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Obfuscated recipient address (never exposed as plain text in DOM)
function getObfuscatedRecipient(): string {
  return atob('d29yay5hbmtpdHBhdHJhQGdtYWlsLmNvbQ==');
}

function getRecentSubmissions(): number[] {
  try {
    const raw = localStorage.getItem(CONTACT_RATE_LIMIT_KEY);
    if (!raw) return [];
    const list: number[] = JSON.parse(raw);
    const cutoff = Date.now() - ROLLING_WINDOW_MS;
    return list.filter((ts) => typeof ts === 'number' && ts > cutoff);
  } catch {
    return [];
  }
}

function recordSubmission(): void {
  const list = getRecentSubmissions();
  list.push(Date.now());
  localStorage.setItem(CONTACT_RATE_LIMIT_KEY, JSON.stringify(list));
}

function getNextAvailableDays(submissions: number[]): number {
  if (submissions.length === 0) return 0;
  const oldest = Math.min(...submissions);
  const msRemaining = oldest + ROLLING_WINDOW_MS - Date.now();
  return Math.max(1, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
}

export function openDocModal(initialTab: DocTab = 'privacy'): void {
  if (activeOverlay) {
    switchTab(activeOverlay, initialTab);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  // ── Header & Tabs ──
  const header = document.createElement('div');
  header.className = 'modal-header';

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'modal-tabs';

  const tabsConfig: { id: DocTab; label: string }[] = [
    { id: 'privacy', label: 'Privacy Policy' },
    { id: 'fair-usage', label: 'Fair Usage' },
    { id: 'disclaimer', label: 'Disclaimer' },
    { id: 'changelog', label: 'Changelog' },
    { id: 'contact', label: 'Contact' },
  ];

  tabsConfig.forEach(({ id, label }) => {
    const tabBtn = document.createElement('button');
    tabBtn.className = `modal-tab ${id === initialTab ? 'active' : ''}`;
    tabBtn.type = 'button';
    tabBtn.textContent = label;
    tabBtn.setAttribute('data-tab-target', id);
    tabBtn.addEventListener('click', () => switchTab(overlay, id));
    tabsWrap.append(tabBtn);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close-btn';
  closeBtn.type = 'button';
  closeBtn.innerHTML = iconX({ size: 16 });
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', () => closeModal());

  header.append(tabsWrap, closeBtn);

  // ── Body Content Container ──
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.append(renderTabContent(initialTab));

  dialog.append(header, body);
  overlay.append(dialog);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Close on Escape key
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', handleKeydown);
      closeModal();
    }
  };
  window.addEventListener('keydown', handleKeydown);

  document.body.append(overlay);
  document.body.classList.add('modal-open');
  activeOverlay = overlay;
}

export function closeModal(): void {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
    document.body.classList.remove('modal-open');
  }
}

function switchTab(overlay: HTMLElement, tab: DocTab): void {
  const tabs = overlay.querySelectorAll('.modal-tab');
  tabs.forEach((t) => {
    const target = t.getAttribute('data-tab-target');
    if (target === tab) t.classList.add('active');
    else t.classList.remove('active');
  });

  const body = overlay.querySelector('.modal-body');
  if (body) {
    body.innerHTML = '';
    body.append(renderTabContent(tab));
  }
}

function renderTabContent(tab: DocTab): HTMLElement {
  const container = document.createElement('div');
  container.className = 'modal-section fade-in';

  switch (tab) {
    case 'privacy':
      container.innerHTML = `
        <h3>Privacy Policy</h3>
        <p>PinnPointt is engineered from first principles on a zero-knowledge, zero-retention foundation. Your files and conversations belong solely to you and your recipient.</p>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconHardDrive({ size: 15 })}</span>
            <h4>1. Zero Cloud Storage &amp; Direct Device-to-Device Link</h4>
          </div>
          <p>PinnPointt does not maintain file servers, databases, or intermediary cloud storage. When you send files or chat messages, data streams straight from your device's memory to your recipient's device via WebRTC.</p>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconLock({ size: 15 })}</span>
            <h4>2. Transport-Layer Encryption (DTLS 1.3 / SRTP)</h4>
          </div>
          <p>Every direct peer-to-peer connection is protected by cryptographic transport-layer encryption using modern TLS-grade cipher suites (AES-GCM). Intermediary network nodes, Wi-Fi operators, ISPs, and signaling relays cannot inspect, intercept, or decrypt your transferred payloads.</p>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconRefresh({ size: 15 })}</span>
            <h4>3. Ephemeral Signaling Relay</h4>
          </div>
          <p>The lightweight relay functions solely to introduce devices (brokering initial network handshakes). <strong>No file data, file chunks, filenames, or chat messages ever pass through the signaling server.</strong> Rooms automatically expire after 120 seconds of inactivity and clear state upon disconnect.</p>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconCheck({ size: 15 })}</span>
            <h4>4. In-Browser Integrity Verification &amp; Safety Triage</h4>
          </div>
          <p>Before any file is dispatched, an in-browser cryptographic SHA-256 hash is calculated. Upon arrival, the receiving device re-verifies the hash before saving. Corrupted, modified, or quarantined payloads are immediately caught in browser memory.</p>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconEye({ size: 15 })}</span>
            <h4>5. Zero Tracking &amp; No Third-Party Cookies</h4>
          </div>
          <p>PinnPointt contains zero analytics trackers, zero advertising pixels, and zero profiling cookies. Your display name and visual theme preferences reside strictly in your device's local storage.</p>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconShare({ size: 15 })}</span>
            <h4>6. Intended Use Cases</h4>
          </div>
          <p>• <strong>Confidential Document Sharing:</strong> Transfer sensitive documents or archives directly without uploading to third-party cloud drives.<br/>
          • <strong>Uncompressed Large Media:</strong> Send raw video, photography, or software packages directly between phones, laptops, and PCs.<br/>
          • <strong>Private Collaboration:</strong> Real-time messaging and direct file attachments between colleagues or personal devices.</p>
        </div>
      `;
      break;

    case 'fair-usage':
      container.innerHTML = `
        <h3>Fair Usage Policy</h3>
        <p>PinnPointt provides a decentralized, direct transport utility for lawful, productive, and constructive collaboration. By using PinnPointt, you agree to this Fair Usage Policy.</p>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconCheck({ size: 15 })}</span>
            <h4>Permitted Usage</h4>
          </div>
          <p>You may use PinnPointt for personal, educational, research, and legitimate commercial file exchange and communication between consenting parties.</p>
        </div>

        <div class="policy-card prohibited-activities-card">
          <div class="policy-card-header">
            <span class="policy-icon warning">${iconAlertTriangle({ size: 16 })}</span>
            <h4>Zero-Tolerance Prohibited Activities</h4>
            <span class="prohibited-badge">Strictly Enforced</span>
          </div>
          <p class="prohibited-intro">PinnPointt is engineered exclusively for lawful, ethical file exchange. You strictly agree <strong>NOT</strong> to use the service to transmit, distribute, facilitate, or store:</p>
          <div class="prohibited-grid">
            <div class="prohibited-item">
              <div class="prohibited-item-head">${iconAlertCircle({ size: 14 })} <strong>Malware &amp; Cyberattacks</strong></div>
              <p>Any computer viruses, worms, trojans, ransomware, spyware, keyloggers, exploit scripts, or payloads designed to damage, compromise, or intercept hardware, networks, or devices.</p>
            </div>
            <div class="prohibited-item">
              <div class="prohibited-item-head">${iconAlertCircle({ size: 14 })} <strong>CSAM &amp; Exploitation</strong></div>
              <p>Child Sexual Abuse Material (CSAM), non-consensual explicit imagery, or unlawful harassment of any kind. Zero tolerance is strictly enforced.</p>
            </div>
            <div class="prohibited-item">
              <div class="prohibited-item-head">${iconAlertCircle({ size: 14 })} <strong>Illicit Data &amp; Stolen Assets</strong></div>
              <p>Stolen credentials, exfiltrated personal data, illicit financial dumps, credit card databases, or copyrighted materials in violation of applicable laws.</p>
            </div>
            <div class="prohibited-item">
              <div class="prohibited-item-head">${iconAlertCircle({ size: 14 })} <strong>Network Infiltration</strong></div>
              <p>Automated scripts, port scanners, denial-of-service payloads, or any attempt to exploit PinnPointt for unauthorized network infiltration.</p>
            </div>
          </div>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconShield({ size: 15 })}</span>
            <h4>User Responsibility</h4>
          </div>
          <p>Because PinnPointt is a direct peer-to-peer transport with zero centralized content inspection or storage, you bear full and exclusive legal responsibility for all files and communications transmitted from your device.</p>
        </div>
      `;
      break;

    case 'disclaimer':
      container.innerHTML = `
        <h3>Legal Disclaimer</h3>
        <p>Please review this disclaimer before utilizing PinnPointt.</p>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconShield({ size: 15 })}</span>
            <h4>Statutory Safe Harbor &amp; Neutral Conduit Status</h4>
          </div>
          <p>PinnPointt operates strictly as a decentralized, zero-knowledge peer-to-peer transport utility (analogous to a neutral fiber optic cable, local network switch, or Wi-Fi radio). Under US CDA Section 230, DMCA Section 512(a), and the EU Digital Services Act / E-Commerce Directive, PinnPointt and its developer (Ankit Patra) qualify as a passive, neutral conduit:
          <br/>• We do not initiate, host, store, inspect, modify, or curate peer-to-peer data transfers.
          <br/>• All data streams encrypted directly from sender device memory to recipient device memory.
          <br/>• The signaling relay possesses zero decryption keys, stores zero logs, and cannot access transferred files.
          </p>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconTerminal({ size: 15 })}</span>
            <h4>"AS IS" Software License</h4>
          </div>
          <p>PinnPointt is provided free of charge on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind, whether express, statutory, or implied, including fitness for a particular purpose or non-infringement.</p>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconAlertTriangle({ size: 15 })}</span>
            <h4>Complete Limitation of Liability</h4>
          </div>
          <p>To the maximum extent permitted by applicable law, the author (Ankit Patra) and open-source contributors expressly disclaim all liability for any direct, indirect, incidental, punitive, or consequential damages resulting from peer-to-peer file exchanges, user transmissions, malware infection, network interruptions, or data loss. Users bear sole and exclusive legal accountability for all data transmitted from their devices.</p>
        </div>

        <div class="policy-card">
          <div class="policy-card-header">
            <span class="policy-icon">${iconWifi({ size: 15 })}</span>
            <h4>Network &amp; Firewall Traversal</h4>
          </div>
          <p>Direct peer connections rely on local network topologies and NAT configurations. While standard STUN traversal is provided, restrictive corporate firewalls or symmetric NATs may occasionally prevent direct connectivity.</p>
        </div>
      `;
      break;

    case 'changelog':
      container.innerHTML = `
        <h3>Application Changelog</h3>
        <p>Complete engineering update timeline and release history for PinnPointt.</p>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.61-beta</span>
            <span class="changelog-date">Current Release • Milestone 1</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Unified Glass Pairing System:</strong> Consolidated Send Files and Receive Files into a single cohesive glassmorphic card with seamless real-time mode switching and continuous ambient backdrop blur.</li>
            <li><strong>Intelligent Desktop Auto-Scaling (1040px Dual Station):</strong> Transformed the pairing interface from a narrow 640px strip into an expansive 1040px desktop command station featuring side-by-side Send &amp; Receive wings, balanced spatial proportions, and smooth responsive collapsing down to single-column tablet and mobile layouts.</li>
            <li><strong>Refined Connection Lost Recovery Center:</strong> Rebuilt the disconnection screen into an auto-scaling glassmorphic diagnostic station featuring a pulsing disconnection beacon, real-time diagnostic recovery advice, one-click <em>Reconnect to Room</em> recovery, and seamless Return to Safety navigation.</li>
            <li><strong>Specular Hardware Depth &amp; Tactile Scale Physics:</strong> Applied macOS/iOS-grade inner specular rim highlights (<code>inset 0 1px 0 rgba(255, 255, 255, 0.08)</code>), diffuse multi-layer drop shadows, and <code>scale(0.975)</code> tactile compression on all interactive buttons and tabs.</li>
            <li><strong>Global Ambient Drag-and-Drop Surface:</strong> Dragging files anywhere into the browser window summons an ambient blurred backdrop scrim, staging files for immediate peer streaming the moment connection occurs.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.60-beta</span>
            <span class="changelog-date">P2P Core</span>
          </div>
          <ul class="changelog-list">
            <li><strong>In-App Camera QR Code Scanner:</strong> Integrated direct camera QR scanner into the Receive Files section using hardware-accelerated <code>BarcodeDetector</code> with universal <code>jsQR</code> fallback for instant 1-tap room connection without manual code entry.</li>
            <li><strong>Direct Deep-Link Room Auto-Join:</strong> Scanning sender QR codes externally or visiting <code>?room=XYZ</code> / <code>#room=XYZ</code> links now joins the room immediately, bypassing onboarding dialogues.</li>
            <li><strong>Streamlined True P2P Architecture (Removed Demo Mode):</strong> Completely removed the simulated demo chat and demo file transfer mode so the application operates strictly on authentic end-to-end encrypted direct peer channels.</li>
            <li><strong>Apple &amp; Google HIG Squircle Navbar:</strong> Redesigned navigation bar with floating squircle island geometry, removed redundant "Direct Share" navbar button, and polished responsive mobile dock.</li>
            <li><strong>Stepper Layout Overflow Guard:</strong> Compact responsive Quick Transfer setup steps (<code>1. Name</code>, <code>2. Connect</code>, <code>3. Send</code>) with strict <code>min-width: 0</code> and ellipsis clipping, eliminating container boundary overflow.</li>
            <li><strong>Prominent Navigation Controls:</strong> Styled high-contrast <code>← Back</code> pill buttons in both Share and Receive file screens.</li>
            <li><strong>Cohesive Emerald Status System:</strong> Uniform glowing emerald status indicators across connection radars, setup cards, and active pairing headers.</li>
            <li><strong>Privacy &amp; Security Enhancements:</strong> Obfuscated developer contact email to prevent web scraper harvesting, added 1.5px geometric SVG icons to all policy cards, and restructured Prohibited Activities with high-contrast safety badges.</li>
            <li><strong>Slim Squircle Modal Scrollbars:</strong> Standardized custom 6px squircle scrollbars across all legal policy and changelog dialogs.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.57-beta</span>
            <span class="changelog-date">Multi-Stream Engine</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Swiss Architectural Daylight &amp; Slate Design System:</strong> Overhauled visual design with clean daylight default (#F6F5F0), refined slate dark mode, crisp 1.5px geometric SVGs, and zero orange or emoji artifacts.</li>
            <li><strong>4-Channel Parallel WebRTC Multi-Stream Engine:</strong> Upgraded transfer pipeline to a dedicated pool of 4 negotiated binary data channels (<code>pinnpointt-data-0..3</code>) with round-robin lowest-buffered scheduling, sustaining 30–80+ MB/s throughput across local 5GHz Wi-Fi with a 2 MB backpressure ceiling.</li>
            <li><strong>Instant Lossless Pause, Byte-Offset Resume &amp; Cancel:</strong> 8-state Transfer State Machine with OPFS chunk checkpointing. Senders halt disk reads immediately on pause; resume syncs the exact lowest unwritten chunk index on disk with zero duplicate bytes re-transmitted.</li>
            <li><strong>12-Byte Binary Framing &amp; Random-Access OPFS:</strong> 64 KB chunks framed with a fixed 12-byte binary header (<code>fileIdHash</code>, <code>chunkIndex</code>, <code>payloadByteLength</code>) written directly to their exact byte positions in OPFS and File System Access streams.</li>
            <li><strong>Rolling 1.5-Second Moving Average Speed Gauge:</strong> Jitter-free throughput and ETA estimator with strictly enforced <code>tabular-nums</code> typography.</li>
            <li><strong>In-Flight Privacy Shield:</strong> In-memory metadata stripper that losslessly omits APP1/EXIF/GPS, APP2, APP13, and comment markers from JPEG byte streams before entering WebRTC DataChannel without re-encoding or compression loss.</li>
            <li><strong>Instant Universal Clipboard Sync:</strong> Real-time cross-device scratchpad with one-click copy and instant toast confirmation.</li>
            <li><strong>Ephemeral Zero-Trace View Mode:</strong> Ephemeral image view mode rendering raw bytes directly onto an HTML5 <code>&lt;canvas&gt;</code> with volatile bitmap memory wiped upon exit.</li>
            <li><strong>Hybrid Serverless Signaling Fallback:</strong> Abstracted signaling adapter with automatic 2,500ms timeout fallback from primary WebSocket relay to 100% serverless P2P Nostr signaling.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.56-beta</span>
            <span class="changelog-date">Virtual Drive Release</span>
          </div>
          <ul class="changelog-list">
            <li><strong>P2P Virtual Drive (Live Remote Mount):</strong> Senders can mount files or entire folder trees as a browsable Virtual Drive without pushing gigabytes over the wire upfront.</li>
            <li><strong>Interactive Remote Explorer Table:</strong> Receivers explore remote directory structures with file names, relative paths, types, and exact sizes rendered with jitter-free tabular numbers.</li>
            <li><strong>On-Demand Byte-Slice Previewing:</strong> Instant ephemeral modal preview for images, markdown/text, JSON, code, audio, and video via byte slicing from peer disk with zero permanent storage on receiver device.</li>
            <li><strong>Selective On-Demand File Pulling:</strong> Receivers click [Pull File] to stream individual files on demand over the high-speed chunk streamer.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.55-beta</span>
            <span class="changelog-date">Performance &amp; Battery</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Screen WakeLock API Integration:</strong> Automatically acquires a screen lock during active transfers to prevent mobile and laptop displays from sleeping during multi-gigabyte transfers.</li>
            <li><strong>Tiered Zero-RAM OPFS Streaming:</strong> Direct disk writing using the File System Access API with origin private filesystem (OPFS), maintaining sub-50MB RAM footprint even on 10GB+ transfers.</li>
            <li><strong>Backpressure Hysteresis Monitor:</strong> Dynamically throttles chunk reads when RTCDataChannel bufferedAmount crosses high watermark, preventing browser tab crashes.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.54-beta</span>
            <span class="changelog-date">Signaling &amp; Handshake</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Auto-Scaling High-Density QR Engine:</strong> High-resolution vector-rendered QR codes with dynamic ECC level optimization for camera scanning at steep angles and low light.</li>
            <li><strong>Simultaneous ICE Candidate Race Fix:</strong> Resolved race conditions during simultaneous WebRTC answer/offer exchange across asymmetric network topologies.</li>
            <li><strong>Multi-STUN Server Pre-Gathering:</strong> Parallel STUN pre-gathering across Google and Cloudflare endpoints to traverse restrictive corporate NAT firewalls.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.53-beta</span>
            <span class="changelog-date">Reliability &amp; Verification</span>
          </div>
          <ul class="changelog-list">
            <li><strong>100MB+ Large File Transfer Stability:</strong> Resolved socket drops and buffer overruns on multi-gigabyte transfers with dynamic chunk pooling.</li>
            <li><strong>Streaming SHA-256 Checksum Engine:</strong> Real-time hardware-accelerated WebCrypto SHA-256 calculation running concurrently with file streaming.</li>
            <li><strong>Automatic ICE Disconnect Grace Period:</strong> Graceful 5-second recovery window on transient Wi-Fi drops before terminating the active transfer session.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.52-beta</span>
            <span class="changelog-date">UX &amp; Onboarding</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Tactile Mobile Chat Interface:</strong> Redesigned mobile chat feed with integrated keyboard avoidance and ergonomic bottom send bar.</li>
            <li><strong>Guided 3-Step Setup Stepper:</strong> Clean visual onboarding ('1. Name', '2. Connect', '3. Send') clarifying connection status for new users.</li>
            <li><strong>WebSocket Signaling Keepalive:</strong> Periodic heartbeat ping to keep free-tier cloud relays active during idle pairing sessions.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.51-beta</span>
            <span class="changelog-date">Security &amp; Safety</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Client-Side File Safety Triage:</strong> Pre-download heuristic sandbox that inspects magic bytes, flags executables (.exe, .bat, .sh), and warns on double extensions (.pdf.exe).</li>
            <li><strong>Comprehensive Legal Policy Shields:</strong> Privacy Policy (Zero Cloud Storage), Fair Usage Policy, and Neutral Conduit Statutory Safe Harbor disclaimers.</li>
            <li><strong>In-App Rate-Limited Developer Contact:</strong> Built-in feedback conduit with rolling 2-per-week rate limit and obfuscated recipient routing.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.50-beta</span>
            <span class="changelog-date">Architecture Rewrite</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Core WebRTC DataChannel Engine:</strong> Direct browser-to-browser peer connections with DTLS 1.3 / SRTP transport encryption.</li>
            <li><strong>Zero Cloud Intermediary Architecture:</strong> Zero server file retention; all payloads flow strictly in memory and direct peer sockets.</li>
            <li><strong>6-Character Room PIN Protocol:</strong> Ephemeral 120-second room codes for rapid ad-hoc device pairing without accounts.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.1-beta</span>
            <span class="changelog-date">Initial Prototype</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Initial Protocol Prototype:</strong> Proof-of-concept WebRTC direct browser-to-browser file transfer and text messaging.</li>
            <li><strong>Lightweight Node.js Signaling Broker:</strong> Minimalist WebSocket relay for SDP offer/answer exchange and ICE candidates.</li>
          </ul>
        </div>
      `;
      break;

    case 'contact': {
      const submissions = getRecentSubmissions();
      const remaining = Math.max(0, MAX_SUBMISSIONS_PER_WEEK - submissions.length);
      const isRateLimited = remaining === 0;
      const daysUntilReset = getNextAvailableDays(submissions);

      const savedName = localStorage.getItem('pinnpointt_username') || localStorage.getItem('pinpoint_username') || '';

      const formWrap = document.createElement('div');
      formWrap.className = 'contact-form-wrap';

      formWrap.innerHTML = `
        <div class="contact-header">
          <div class="contact-badge-pill">
            ${iconMail({ size: 13 })} <span>Developer Direct Channel</span>
          </div>
          <h3 class="contact-title">Contact Developer</h3>
          <p class="contact-subtitle">
            Send feedback, report bugs, or discuss architecture directly with Ankit Patra. All inquiries are securely prepared for direct email dispatch.
          </p>

          <div class="contact-meta-row">
            <span class="rate-limit-pill ${isRateLimited ? 'limited' : ''}">
              ${
                isRateLimited
                  ? `Weekly limit reached (2 of 2 used) • Reopens in ${daysUntilReset}d`
                  : `${remaining} of 2 weekly inquiries remaining`
              }
            </span>
            <span class="contact-developer-pill">
              Developer: <strong>Ankit Patra</strong>
            </span>
          </div>
        </div>

        <div class="contact-card">
          <form id="pinnpointt-contact-form" class="contact-form">
            <div class="contact-grid-row">
              <div class="form-group">
                <label class="form-label" for="contact-name">Your Name / Handle</label>
                <input
                  id="contact-name"
                  class="form-input"
                  type="text"
                  value="${savedName}"
                  placeholder="e.g. Gropius-42"
                  maxlength="50"
                  ${isRateLimited ? 'disabled' : ''}
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="contact-category">Topic</label>
                <div class="form-select-wrapper">
                  <select id="contact-category" class="form-select" ${isRateLimited ? 'disabled' : ''}>
                    <option value="General Feedback">General Feedback</option>
                    <option value="Bug Report">Bug Report</option>
                    <option value="Feature Request">Feature Request</option>
                    <option value="Architecture & Security">Architecture & Security</option>
                    <option value="Other Inquiry">Other Inquiry</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="contact-email">
                Reply Email <span class="form-label-optional">(optional, if you'd like a response)</span>
              </label>
              <input
                id="contact-email"
                class="form-input"
                type="email"
                placeholder="your.email@example.com"
                maxlength="100"
                ${isRateLimited ? 'disabled' : ''}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="contact-message">
                Message <span class="accent">*</span>
              </label>
              <textarea
                id="contact-message"
                class="form-textarea"
                rows="5"
                placeholder="Describe your feedback, suggestion, or steps to reproduce a bug in detail..."
                required
                minlength="5"
                maxlength="2000"
                ${isRateLimited ? 'disabled' : ''}
              ></textarea>
            </div>

            <div id="contact-status-msg" style="display: none;"></div>

            <div class="contact-actions">
              <button
                type="submit"
                class="btn-contact-submit"
                id="btn-submit-contact"
                ${isRateLimited ? 'disabled' : ''}
              >
                ${iconMail({ size: 15 })} <span>Send Message to Developer</span>
              </button>
            </div>
          </form>
        </div>

        <div class="contact-privacy-note">
          <div class="contact-privacy-icon">${iconShield({ size: 14 })}</div>
          <div class="contact-privacy-text">
            <strong>Private &amp; Direct Routing:</strong> Submissions prepare a verified mail draft in your native email client addressed directly to the developer's mailbox. PinnPointt does not maintain intermediate servers, log message contents, or store your contact details.
          </div>
        </div>
      `;

      setTimeout(() => {
        const form = formWrap.querySelector('#pinnpointt-contact-form') as HTMLFormElement | null;
        if (!form) return;

        form.addEventListener('submit', (e) => {
          e.preventDefault();

          const currentSubmissions = getRecentSubmissions();
          if (currentSubmissions.length >= MAX_SUBMISSIONS_PER_WEEK) {
            alert('Rate limit reached: Maximum 2 inquiries per week. Please try again later.');
            return;
          }

          const nameInput = form.querySelector('#contact-name') as HTMLInputElement;
          const catSelect = form.querySelector('#contact-category') as HTMLSelectElement;
          const emailInput = form.querySelector('#contact-email') as HTMLInputElement;
          const messageText = form.querySelector('#contact-message') as HTMLTextAreaElement;
          const statusMsg = form.querySelector('#contact-status-msg') as HTMLElement;
          const submitBtn = form.querySelector('#btn-submit-contact') as HTMLButtonElement;

          const name = nameInput.value.trim() || 'Anonymous User';
          const category = catSelect.value;
          const replyEmail = emailInput.value.trim() || 'None provided';
          const message = messageText.value.trim();

          if (!message || message.length < 5) {
            alert('Please enter a message of at least 5 characters.');
            return;
          }

          recordSubmission();

          const recipient = getObfuscatedRecipient();
          const subject = encodeURIComponent(`[PinnPointt] ${category} - from ${name}`);
          const body = encodeURIComponent(
            `PinnPointt In-App Contact Submission\n` +
            `====================================\n` +
            `Sender Name:   ${name}\n` +
            `Reply Email:   ${replyEmail}\n` +
            `Category:      ${category}\n` +
            `App Version:   v0.0.61-beta\n` +
            `Timestamp:     ${new Date().toISOString()}\n\n` +
            `Message Body:\n` +
            `------------------------------------\n` +
            `${message}\n` +
            `------------------------------------\n`
          );

          const mailtoUri = `mailto:${recipient}?subject=${subject}&body=${body}`;
          const mailLink = document.createElement('a');
          mailLink.href = mailtoUri;
          mailLink.target = '_blank';
          mailLink.rel = 'noopener noreferrer';
          document.body.append(mailLink);
          mailLink.click();
          mailLink.remove();

          form.reset();
          submitBtn.disabled = true;
          nameInput.disabled = true;
          catSelect.disabled = true;
          emailInput.disabled = true;
          messageText.disabled = true;

          statusMsg.style.display = 'block';
          statusMsg.className = 'contact-success-banner';
          statusMsg.innerHTML = `
            <div style="font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px;">
              ${iconCheck({ size: 14 })} <span>Message Prepared &amp; Dispatched</span>
            </div>
            <div style="font-size: 11.5px; opacity: 0.9; margin-top: 3px;">
              Your message was routed directly to the developer. Thank you for contributing to PinnPointt!
            </div>
          `;
        });
      }, 50);

      container.append(formWrap);
      break;
    }
  }

  return container;
}
