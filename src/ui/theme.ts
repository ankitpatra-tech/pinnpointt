/**
 * PinnPointt Design System — Apple & Google Human Interface System Colors
 * Clean, tactile, authentic system tokens.
 */

export type ThemeMode = 'dark' | 'light';

export const THEME_DARK = {
  bg: '#000000',
  surface: '#1C1C1E',
  surfaceHover: '#2C2C2E',
  border: 'rgba(255, 255, 255, 0.12)',
  borderFocus: '#0A84FF',
  text: '#F5F5F7',
  muted: '#A1A1A6',
  accent: '#0A84FF',
  accentDim: 'rgba(10, 132, 255, 0.14)',
  danger: '#FF453A',
  success: '#30D158',
} as const;

export const THEME_LIGHT = {
  bg: '#F5F5F7',
  surface: '#FFFFFF',
  surfaceHover: '#F2F2F7',
  border: 'rgba(0, 0, 0, 0.08)',
  borderFocus: '#0071E3',
  text: '#1D1D1F',
  muted: '#86868B',
  accent: '#0071E3',
  accentDim: 'rgba(0, 113, 227, 0.08)',
  danger: '#FF3B30',
  success: '#34C759',
} as const;

const THEME_STORAGE_KEY = 'pinnpointt_theme';
const LEGACY_THEME_STORAGE_KEY = 'pinpoint_theme';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const saved = (localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY)) as ThemeMode | null;
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  return 'dark';
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
