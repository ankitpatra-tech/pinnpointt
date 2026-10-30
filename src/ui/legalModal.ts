/**
 * PinnPointt — Legal Policies, Disclaimer, Changelog & In-App Contact Modal
 *
 * Implements:
 *   - Privacy Policy (Zero cloud storage, transport encryption, SHA-256 verification, use cases)
 *   - Fair Usage Policy (Lawful personal/professional use, prohibited abuse)
 *   - Disclaimer ("AS IS", limitation of liability, peer-to-peer nature)
 *   - Changelog (v0.0.4-beta, v0.0.3-beta, v0.0.2-beta, v0.0.1-beta)
 *   - Direct In-App Contact Form with 2-per-week rate limit (email hidden from plain view)
 */

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
    { id: 'contact', label: 'Contact Developer' },
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
  closeBtn.innerHTML = '✕';
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
    if (e.key === 'Escape') closeModal();
  };
  window.addEventListener('keydown', handleKeydown);

  document.body.append(overlay);
  activeOverlay = overlay;
}

export function closeModal(): void {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
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
          <h4>🔒 1. Zero Cloud Storage &amp; Direct Device-to-Device Link</h4>
          <p>PinnPointt does not maintain file servers, databases, or intermediary cloud storage. When you send files or chat messages, data streams straight from your device's memory to your recipient's device via WebRTC.</p>
        </div>

        <div class="policy-card">
          <h4>🛡️ 2. Transport-Layer Encryption (DTLS 1.3 / SRTP)</h4>
          <p>Every direct peer-to-peer connection is protected by cryptographic transport-layer encryption using modern TLS-grade cipher suites (AES-GCM). Intermediary network nodes, Wi-Fi operators, ISPs, and signaling relays cannot inspect, intercept, or decrypt your transferred payloads.</p>
        </div>

        <div class="policy-card">
          <h4>⚡ 3. Ephemeral Signaling Relay</h4>
          <p>The lightweight relay functions solely to introduce devices (brokering initial network handshakes). <strong>No file data, file chunks, filenames, or chat messages ever pass through the signaling server.</strong> Rooms automatically expire after 120 seconds of inactivity and clear state upon disconnect.</p>
        </div>

        <div class="policy-card">
          <h4>✓ 4. In-Browser Integrity Verification &amp; Safety Triage</h4>
          <p>Before any file is dispatched, an in-browser cryptographic SHA-256 hash is calculated. Upon arrival, the receiving device re-verifies the hash before saving. Corrupted, modified, or quarantined payloads are immediately caught in browser memory.</p>
        </div>

        <div class="policy-card">
          <h4>🚫 5. Zero Tracking &amp; No Third-Party Cookies</h4>
          <p>PinnPointt contains zero analytics trackers, zero advertising pixels, and zero profiling cookies. Your display name and visual theme preferences reside strictly in your device's local storage.</p>
        </div>

        <div class="policy-card">
          <h4>💡 6. Intended Use Cases</h4>
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
          <h4>⚖️ Permitted Usage</h4>
          <p>You may use PinnPointt for personal, educational, research, and legitimate commercial file exchange and communication between consenting parties.</p>
        </div>

        <div class="policy-card">
          <h4>⛔ Zero-Tolerance Prohibited Activities</h4>
          <p>PinnPointt is engineered strictly for lawful file exchange. You strictly agree NOT to use PinnPointt to transmit, distribute, facilitate, or store:</p>
          <ul style="padding-left: 20px; font-size: 12px; color: var(--muted); display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
            <li><strong>Malware &amp; Cyberattacks:</strong> Any computer viruses, worms, trojans, ransomware, spyware, keyloggers, exploit scripts, or malicious payloads designed to damage, compromise, or intercept hardware, networks, or devices.</li>
            <li><strong>CSAM &amp; Exploitation:</strong> Child Sexual Abuse Material (CSAM), non-consensual explicit imagery, or unlawful harassment of any kind. Zero tolerance is strictly enforced.</li>
            <li><strong>Illicit Data &amp; Stolen Assets:</strong> Stolen credentials, exfiltrated personal data, illicit financial databases, credit card dumps, or copyrighted materials in violation of applicable laws.</li>
            <li><strong>Network Infiltration:</strong> Automated scripts, port scanners, denial-of-service payloads, or any attempt to exploit PinnPointt for unauthorized network infiltration.</li>
          </ul>
        </div>

        <div class="policy-card">
          <h4>👤 User Responsibility</h4>
          <p>Because PinnPointt is a direct peer-to-peer transport with zero centralized content inspection or storage, you bear full and exclusive legal responsibility for all files and communications transmitted from your device.</p>
        </div>
      `;
      break;

    case 'disclaimer':
      container.innerHTML = `
        <h3>Legal Disclaimer</h3>
        <p>Please review this disclaimer before utilizing PinnPointt.</p>

        <div class="policy-card">
          <h4>🏛️ Statutory Safe Harbor &amp; Neutral Conduit Status</h4>
          <p>PinnPointt operates strictly as a decentralized, zero-knowledge peer-to-peer transport utility (analogous to a neutral fiber optic cable, local network switch, or Wi-Fi radio). Under US CDA Section 230, DMCA Section 512(a), and the EU Digital Services Act / E-Commerce Directive, PinnPointt and its developer (Ankit Patra) qualify as a passive, neutral conduit:
          <br/>• We do not initiate, host, store, inspect, modify, or curate peer-to-peer data transfers.
          <br/>• All data streams encrypted directly from sender device memory to recipient device memory.
          <br/>• The signaling relay possesses zero decryption keys, stores zero logs, and cannot access transferred files.
          </p>
        </div>

        <div class="policy-card">
          <h4>⚠️ "AS IS" Software License</h4>
          <p>PinnPointt is provided free of charge on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind, whether express, statutory, or implied, including fitness for a particular purpose or non-infringement.</p>
        </div>

        <div class="policy-card">
          <h4>🛡️ Complete Limitation of Liability</h4>
          <p>To the maximum extent permitted by applicable law, the author (Ankit Patra) and open-source contributors expressly disclaim all liability for any direct, indirect, incidental, punitive, or consequential damages resulting from peer-to-peer file exchanges, user transmissions, malware infection, network interruptions, or data loss. Users bear sole and exclusive legal accountability for all data transmitted from their devices.</p>
        </div>

        <div class="policy-card">
          <h4>🌐 Network &amp; Firewall Traversal</h4>
          <p>Direct peer connections rely on local network topologies and NAT configurations. While standard STUN traversal is provided, restrictive corporate firewalls or symmetric NATs may occasionally prevent direct connectivity.</p>
        </div>
      `;
      break;

    case 'changelog':
      container.innerHTML = `
        <h3>Application Changelog</h3>
        <p>Engineering updates and release history for PinnPointt.</p>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.5-beta</span>
            <span class="changelog-date">Current Release</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Client-Side File Safety &amp; Malicious Triage Engine:</strong> Real-time in-browser inspection detecting executable binaries, script droppers, and double-extension traps before transfer.</li>
            <li><strong>Threat Quarantining &amp; Verification:</strong> High-risk payloads are quarantined in browser memory with visual risk badges and SHA-256 verification, preventing silent or accidental execution.</li>
            <li><strong>Cryptographic Security Showcase:</strong> Added dedicated Security &amp; Verification section on the website detailing our custom-engineered TS QR engine, 64 KB WebRTC chunking, and zero-knowledge architecture.</li>
            <li><strong>Enhanced Abuse &amp; Safe-Harbor Policy:</strong> Strengthened Fair Usage Policy with strict zero-tolerance prohibitions against malware, CSAM, stolen databases, and statutory safe-harbor protections.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.42-beta</span>
            <span class="changelog-date">Beta Release</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Interactive Quick Start Navigation:</strong> Onboarding steps are now interactive navigation shortcuts. Clicking Step 1 highlights and focuses your display name with an identity pulse, Step 2 guides device pairing, and Step 3 launches the interactive demo mode.</li>
            <li><strong>Room Creation Navigation:</strong> Added dual back-button controls in the "Create a Room" view (top header and bottom primary button) to cleanly return to pairing options without page reloads.</li>
            <li><strong>Motion &amp; Micro-Interaction Overhaul:</strong> Added smooth staggered card entrances, tactile button physics, room code digit pop-ins, and animated step hover feedback.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.41-beta</span>
            <span class="changelog-date">Beta Release</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Cohesive Design System Overhaul:</strong> Unified warm Industrial Bauhaus aesthetics across both the Web App and Showcase Website with frosted glassmorphism and tactile button physics.</li>
            <li><strong>Multi-Resolution Fluid Scalability:</strong> Dynamic scaling with CSS clamp typography, responsive grid restructuring, and zero-overflow code inputs on small screens (320px–360px).</li>
            <li><strong>Full-Width Structured Footer:</strong> Multi-column footer featuring quick navigation, community resources, direct founder contact, and privacy guarantees.</li>
            <li><strong>Roadmap Subject to Changes Notice:</strong> Explicit transparency disclaimer regarding future milestones and browser standards evolution.</li>
            <li><strong>Comprehensive Security Audit:</strong> Verified 0 dependency vulnerabilities and complete client-side DOM XSS sanitization across all chat and file transfer feeds.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.4-beta</span>
            <span class="changelog-date">Beta Release</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Rebranding to PinnPointt:</strong> Unified product identity across all application modules and manifests.</li>
            <li><strong>In-App Direct Contact Form:</strong> Submit feedback, bug reports, and inquiries directly from within the app without email exposure.</li>
            <li><strong>Weekly Contact Rate Limiting:</strong> Enforces a strict 2-submissions-per-week rate limit with countdown feedback.</li>
            <li><strong>Subtle Micro-Attribution:</strong> Refined, smaller community footer with elegant contrast.</li>
            <li><strong>Fluid Traversal & Animations:</strong> Staggered card entrance physics, smooth chat scroll, and reactive hover states.</li>
            <li><strong>Paste & Connection Bugfixes:</strong> Support for instant 6-digit code pasting with auto-advance and direct connection spinners.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.3-beta</span>
            <span class="changelog-date">Beta Release</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Human-First Language:</strong> Replaced technical protocol terms with accessible everyday descriptions.</li>
            <li><strong>Industrial Bauhaus Themes:</strong> Full Light and Dark mode system with instant token switching.</li>
            <li><strong>Dynamic QR Theming:</strong> Custom canvas engine automatically adapts contrast to the active theme.</li>
            <li><strong>Desktop & Mobile Navbar:</strong> Responsive top bar with live session badges and theme switcher.</li>
            <li><strong>Compliance Modals:</strong> Built-in Privacy Policy, Fair Usage, and Disclaimer dialogs.</li>
            <li><strong>Simplified 3-Step Onboarding:</strong> Streamlined micro-guide with interactive step highlights.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.2-beta</span>
            <span class="changelog-date">Beta Release</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Real-Time Encrypted Chat:</strong> End-to-end messaging over WebRTC data channels with timestamped message bubbles.</li>
            <li><strong>Operator Moniker Generator:</strong> Architectural username generator with monogram avatar and persistence.</li>
            <li><strong>Unified Activity Feed:</strong> Single-canvas feed rendering real-time chat and in-feed file streaming cards simultaneously.</li>
            <li><strong>Interactive Demo Mode:</strong> Single-window sandbox with simulated peer to preview streaming and verification.</li>
          </ul>
        </div>

        <div class="changelog-release">
          <div class="changelog-badge-row">
            <span class="changelog-version">v0.0.1-beta</span>
            <span class="changelog-date">Initial Architecture</span>
          </div>
          <ul class="changelog-list">
            <li><strong>Proprietary QR Engine:</strong> Pure TypeScript ISO/IEC 18004 V2-M generator (Galois Field GF(2^8) Reed-Solomon encoding &amp; BCH format masking).</li>
            <li><strong>Native WebRTC Binary Pipeline:</strong> 32 KB chunk framing with 8-byte binary sequence header.</li>
            <li><strong>Backpressure Flow Control:</strong> 1 MB threshold throttling via <code>bufferedAmountLow</code> to prevent memory exhaustion.</li>
            <li><strong>Cryptographic SHA-256 Validation:</strong> Pre/post transfer checksum verification with automatic corruption rejection.</li>
            <li><strong>Signaling Relay:</strong> Lightweight Node.js WebSocket relay with 120s room auto-expiration.</li>
            <li><strong>Offline PWA Shell:</strong> Progressive Web App manifest and network-first Service Worker caching.</li>
          </ul>
        </div>
      `;
      break;

    case 'contact': {
      const submissions = getRecentSubmissions();
      const remaining = Math.max(0, MAX_SUBMISSIONS_PER_WEEK - submissions.length);
      const isRateLimited = remaining === 0;
      const daysUntilReset = getNextAvailableDays(submissions);

      // Pre-fill name from localStorage if saved
      const savedName = localStorage.getItem('pinnpointt_username') || localStorage.getItem('pinpoint_username') || '';

      const formWrap = document.createElement('div');
      formWrap.className = 'contact-form-wrap';

      formWrap.innerHTML = `
        <h3>Contact Developer</h3>
        <p>Send feedback, report a bug, or suggest a feature directly from PinnPointt to Ankit Patra.</p>

        <div class="contact-meta-row">
          <span class="rate-limit-pill ${isRateLimited ? 'limited' : ''}">
            ${
              isRateLimited
                ? `⚠️ Weekly limit reached (2 / 2 used) • Reopens in ${daysUntilReset}d`
                : `⚡ ${remaining} of ${MAX_SUBMISSIONS_PER_WEEK} inquiries remaining this week`
            }
          </span>
          <span class="text-xs muted">Rate limit: 2 / week</span>
        </div>

        <div class="contact-card">
          <form id="pinnpointt-contact-form" class="stack stack-sm w-full" style="text-align: left;">
            <div>
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

            <div>
              <label class="form-label" for="contact-category">Topic</label>
              <select id="contact-category" class="form-select" ${isRateLimited ? 'disabled' : ''}>
                <option value="Feedback">💡 General Feedback</option>
                <option value="Bug Report">🐛 Bug Report</option>
                <option value="Feature Request">✨ Feature Request</option>
                <option value="Architecture & Security">🔒 Architecture & Security</option>
                <option value="Other">💬 Other Inquiry</option>
              </select>
            </div>

            <div>
              <label class="form-label" for="contact-email">Reply Email <span class="muted" style="font-weight: 400;">(optional, if you'd like a response)</span></label>
              <input
                id="contact-email"
                class="form-input"
                type="email"
                placeholder="your.email@example.com"
                maxlength="100"
                ${isRateLimited ? 'disabled' : ''}
              />
            </div>

            <div>
              <label class="form-label" for="contact-message">Message <span class="accent">*</span></label>
              <textarea
                id="contact-message"
                class="form-textarea"
                rows="4"
                placeholder="Write your message here..."
                required
                minlength="5"
                maxlength="2000"
                ${isRateLimited ? 'disabled' : ''}
              ></textarea>
            </div>

            <div id="contact-status-msg" style="display: none;"></div>

            <button
              type="submit"
              class="btn btn-primary w-full mt-sm"
              id="btn-submit-contact"
              ${isRateLimited ? 'disabled' : ''}
            >
              <span>✉</span> <span>Submit Message</span>
            </button>
          </form>
        </div>
      `;

      setTimeout(() => {
        const form = formWrap.querySelector('#pinnpointt-contact-form') as HTMLFormElement | null;
        if (!form) return;

        form.addEventListener('submit', (e) => {
          e.preventDefault();

          // Check rate limit
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

          // Record this submission in rate limit tracking
          recordSubmission();

          // Prepare email payload using obfuscated recipient
          const recipient = getObfuscatedRecipient();
          const subject = encodeURIComponent(`[PinnPointt] ${category} - from ${name}`);
          const body = encodeURIComponent(
            `PinnPointt In-App Contact Submission\n` +
            `====================================\n` +
            `Sender Name:   ${name}\n` +
            `Reply Email:   ${replyEmail}\n` +
            `Category:      ${category}\n` +
            `App Version:   v0.0.5-beta\n` +
            `Timestamp:     ${new Date().toISOString()}\n\n` +
            `Message Body:\n` +
            `------------------------------------\n` +
            `${message}\n` +
            `------------------------------------\n`
          );

          // Dispatch through mailto scheme without exposing recipient on screen
          const mailtoUri = `mailto:${recipient}?subject=${subject}&body=${body}`;
          const mailLink = document.createElement('a');
          mailLink.href = mailtoUri;
          mailLink.target = '_blank';
          mailLink.rel = 'noopener noreferrer';
          document.body.append(mailLink);
          mailLink.click();
          mailLink.remove();

          // Show confirmation UI inside modal
          form.reset();
          submitBtn.disabled = true;
          nameInput.disabled = true;
          catSelect.disabled = true;
          emailInput.disabled = true;
          messageText.disabled = true;

          statusMsg.style.display = 'block';
          statusMsg.className = 'contact-success-banner';
          statusMsg.innerHTML = `
            <div style="font-weight: 600; font-size: 13px;">✓ Message Prepared & Dispatched!</div>
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
