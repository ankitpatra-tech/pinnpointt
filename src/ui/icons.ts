/**
 * PinnPointt Design System — Apple & Google Human Interface Iconography
 * Consistent 1.75px optical weight, rounded caps & joins, human proportions.
 */

interface IconOptions {
  size?: number;
  className?: string;
}

function svg(paths: string, size = 16, className = 'svg-icon'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="${className}">${paths}</svg>`;
}

export function iconLogo(size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" class="svg-icon brand-mark">
    <!-- Apple-style continuous rounded squircle container -->
    <rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <!-- Left Radiating Signal Arc -->
    <path d="M7 15.5C7.8 13.8 9.2 12.5 11 12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    <!-- Right Radiating Signal Arc -->
    <path d="M17 8.5C16.2 10.2 14.8 11.5 13 12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    <!-- Beacon Center Point -->
    <circle cx="12" cy="12" r="2.25" fill="currentColor"/>
    <!-- Terminal Node Points -->
    <circle cx="7" cy="15.5" r="1.25" fill="currentColor"/>
    <circle cx="17" cy="8.5" r="1.25" fill="currentColor"/>
  </svg>`;
}

export function iconKey(opts?: IconOptions): string {
  return svg(
    `<circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 7.65-7.65a1.5 1.5 0 0 1 2.12 0l.88.88a1.5 1.5 0 0 1 0 2.12l-1 1"/><path d="m15.5 7.5 2 2"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconQrCode(opts?: IconOptions): string {
  return svg(
    `<rect width="5" height="5" x="3" y="3" rx="1.5"/><rect width="5" height="5" x="16" y="3" rx="1.5"/><rect width="5" height="5" x="3" y="16" rx="1.5"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16h.01"/><path d="M16 12h1"/><path d="M21 12h.01"/><path d="M12 21v-1"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconRefresh(opts?: IconOptions): string {
  return svg(
    `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconGlobe(opts?: IconOptions): string {
  return svg(
    `<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconCamera(opts?: IconOptions): string {
  return svg(
    `<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconRocket(opts?: IconOptions): string {
  return svg(
    `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconZap(opts?: IconOptions): string {
  return svg(
    `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconShield(opts?: IconOptions): string {
  return svg(
    `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconLock(opts?: IconOptions): string {
  return svg(
    `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconFolder(opts?: IconOptions): string {
  return svg(
    `<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconHardDrive(opts?: IconOptions): string {
  return svg(
    `<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconWifi(opts?: IconOptions): string {
  return svg(
    `<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconCheck(opts?: IconOptions): string {
  return svg(
    `<polyline points="20 6 9 17 4 12"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconX(opts?: IconOptions): string {
  return svg(
    `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconPause(opts?: IconOptions): string {
  return svg(
    `<rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconPlay(opts?: IconOptions): string {
  return svg(
    `<polygon points="6 3 20 12 6 21 6 3"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconCopy(opts?: IconOptions): string {
  return svg(
    `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconSun(opts?: IconOptions): string {
  return svg(
    `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconMoon(opts?: IconOptions): string {
  return svg(
    `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconPaperclip(opts?: IconOptions): string {
  return svg(
    `<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconSend(opts?: IconOptions): string {
  return svg(
    `<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconUsers(opts?: IconOptions): string {
  return svg(
    `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconTerminal(opts?: IconOptions): string {
  return svg(
    `<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconArrowRight(opts?: IconOptions): string {
  return svg(
    `<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconEye(opts?: IconOptions): string {
  return svg(
    `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconEyeOff(opts?: IconOptions): string {
  return svg(
    `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconDownload(opts?: IconOptions): string {
  return svg(
    `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconFileText(opts?: IconOptions): string {
  return svg(
    `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconFile(opts?: IconOptions): string {
  return svg(
    `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconAlertTriangle(opts?: IconOptions): string {
  return svg(
    `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconAlertCircle(opts?: IconOptions): string {
  return svg(
    `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconHelpCircle(opts?: IconOptions): string {
  return svg(
    `<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="1" fill="currentColor"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconInfo(opts?: IconOptions): string {
  return svg(
    `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><circle cx="12" cy="8" r="1" fill="currentColor"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconSparkles(opts?: IconOptions): string {
  return svg(
    `<path d="m12 3 1.912 4.908L18.82 9.82 13.912 11.73 12 16.64l-1.912-4.91L5.18 9.82l4.908-1.912L12 3z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconSmartphone(opts?: IconOptions): string {
  return svg(
    `<rect x="5" y="2" width="14" height="20" rx="3"/><line x1="12" y1="18" x2="12.01" y2="18"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconMonitor(opts?: IconOptions): string {
  return svg(
    `<rect x="2" y="3" width="20" height="14" rx="3"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconCloud(opts?: IconOptions): string {
  return svg(
    `<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconShare(opts?: IconOptions): string {
  // Apple AirDrop / iOS system share icon: upward arrow from curved tray
  return svg(
    `<path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconScale(opts?: IconOptions): string {
  return svg(
    `<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconMail(opts?: IconOptions): string {
  return svg(
    `<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconMessageSquare(opts?: IconOptions): string {
  return svg(
    `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconCpu(opts?: IconOptions): string {
  return svg(
    `<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconActivity(opts?: IconOptions): string {
  return svg(
    `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconUpload(opts?: IconOptions): string {
  return svg(
    `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
    opts?.size,
    opts?.className
  );
}

export function iconChevronDown(opts?: IconOptions): string {
  return svg(
    `<polyline points="6 9 12 15 18 9"/>`,
    opts?.size,
    opts?.className
  );
}
