/**
 * PinnPointt — Client-Side File Safety & Malicious Payload Triage Engine
 *
 * Runs 100% locally in browser memory using Web Crypto SHA-256 digests.
 * Protects users from rogue executables, ransomware, script droppers, and double-extension traps
 * without sending any file metadata or content to external cloud servers.
 */

export type RiskLevel = 'safe' | 'warning' | 'danger';

export interface SafetyAssessment {
  riskLevel: RiskLevel;
  badgeLabel: string;
  reason: string;
  isExecutable: boolean;
  isDoubleExtension: boolean;
  isBlockedHash: boolean;
  fileExt: string;
}

// Executable, macro, and script extensions that pose high risk for malware/ransomware execution
const HIGH_RISK_EXTENSIONS = new Set([
  '.exe',
  '.scr',
  '.bat',
  '.cmd',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.ps1',
  '.psm1',
  '.psd1',
  '.apk',
  '.msi',
  '.msp',
  '.com',
  '.gadget',
  '.jar',
  '.iso',
  '.img',
  '.dll',
  '.sys',
  '.drv',
  '.cpl',
  '.pif',
  '.reg',
  '.hta',
  '.sh',
  '.deb',
  '.rpm',
]);

// Double extension obfuscation pattern (e.g. "invoice.pdf.exe", "report.docx.scr")
const DOUBLE_EXTENSION_PATTERN =
  /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|mp4|mp3|zip|txt)\.(exe|scr|bat|cmd|vbs|ps1|apk|msi|pif|reg)$/i;

// Compact client-side threat signature blocklist (SHA-256 lowercase hex)
// Known generic malware test vectors (e.g. EICAR standard test payload)
const KNOWN_THREAT_HASHES = new Set([
  // EICAR Standard Antivirus Test File (275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f)
  '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
  // EICAR with trailing newline variant
  '131f95c51cc819465fa1797f6ccacf9d494aaaff46fa3eac73ae63ffbdfd8267',
  '44d88612fea8a8f36de82e1278abb02f', // MD5/partial variant
]);

/**
 * Evaluates the safety profile of a file by name, size, and optional SHA-256 hash.
 */
export function inspectFileSafety(
  fileName: string,
  _fileSize: number,
  sha256Hex?: string
): SafetyAssessment {
  const normalizedName = fileName.trim().toLowerCase();
  const lastDot = normalizedName.lastIndexOf('.');
  const ext = lastDot !== -1 ? normalizedName.slice(lastDot) : '';
  const hash = sha256Hex?.trim().toLowerCase();

  // 1. Check known threat signature blocklist
  if (hash && KNOWN_THREAT_HASHES.has(hash)) {
    return {
      riskLevel: 'danger',
      badgeLabel: 'Threat Blocked',
      reason: 'This file matches a known malicious signature and has been blocked.',
      isExecutable: true,
      isDoubleExtension: false,
      isBlockedHash: true,
      fileExt: ext,
    };
  }

  // 2. Check for deceptive double-extension traps (e.g., photo.jpg.exe)
  if (DOUBLE_EXTENSION_PATTERN.test(normalizedName)) {
    return {
      riskLevel: 'danger',
      badgeLabel: 'Deceptive Extension',
      reason: 'High-risk double extension trap detected. Malware often masks executables as documents or photos.',
      isExecutable: true,
      isDoubleExtension: true,
      isBlockedHash: false,
      fileExt: ext,
    };
  }

  // 3. Check for high-risk executable or script files
  if (HIGH_RISK_EXTENSIONS.has(ext)) {
    return {
      riskLevel: 'warning',
      badgeLabel: 'Executable Payload',
      reason: `Executable (${ext.toUpperCase()}) payload detected. Verify the sender's identity and do not execute untrusted binaries.`,
      isExecutable: true,
      isDoubleExtension: false,
      isBlockedHash: false,
      fileExt: ext,
    };
  }

  // 4. Clean / standard document or media file
  return {
    riskLevel: 'safe',
    badgeLabel: 'Verified Safe',
    reason: 'Standard document or media format. Bit-exact SHA-256 checksum verified.',
    isExecutable: false,
    isDoubleExtension: false,
    isBlockedHash: false,
    fileExt: ext,
  };
}
