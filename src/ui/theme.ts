/**
 * PinnPointt Design System — Swiss Architectural Daylight & Refined Slate
 * Zero orange, pure geometric utility.
 */

export type ThemeMode = 'dark' | 'light';

export const THEME_DARK = {
  bg: '#111315',
  surface: '#181A1D',
  surfaceHover: '#1F2227',
  border: '#26292E',
  borderFocus: '#3A3F47',
  text: '#F3F4F6',
  muted: '#9CA3AF',
  accent: '#3B82F6',
  accentDim: 'rgba(59, 130, 246, 0.12)',
  danger: '#EF4444',
  success: '#10B981',
} as const;

export const THEME_LIGHT = {
  bg: '#F6F5F0',
  surface: '#FFFFFF',
  surfaceHover: '#EFECE6',
  border: '#E2E0D8',
  borderFocus: '#C8C5BC',
  text: '#111110',
  muted: '#85837E',
  accent: '#0047FF',
  accentDim: 'rgba(0, 71, 255, 0.08)',
  danger: '#DC2626',
  success: '#059669',
} as const;

const THEME_STORAGE_KEY = 'pinnpointt_theme';
const LEGACY_THEME_STORAGE_KEY = 'pinpoint_theme';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const saved = (localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY)) as ThemeMode | null;
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function toggleTheme(): ThemeMode {
  const current = (document.documentElement.getAttribute('data-theme') as ThemeMode) || 'dark';
  const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
