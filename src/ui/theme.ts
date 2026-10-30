/**
 * Pinpoint Design Tokens & Theme Management
 * Industrial Bauhaus Editorial Palette (Dark & Light)
 */

export type ThemeMode = 'dark' | 'light';

export const THEME_DARK = {
  bg: '#121214',
  surface: '#1A1A1E',
  surfaceHover: '#232328',
  border: '#26262A',
  borderFocus: '#3E3E46',
  text: '#EDEDED',
  muted: '#8A8A93',
  accent: '#F26419',
  accentDim: 'rgba(242, 100, 25, 0.15)',
  danger: '#EF4444',
  success: '#10B981',
} as const;

export const THEME_LIGHT = {
  bg: '#F5F4F0',
  surface: '#FFFFFF',
  surfaceHover: '#FAFAF8',
  border: '#E2E0D8',
  borderFocus: '#CBC8BD',
  text: '#18181B',
  muted: '#71717A',
  accent: '#E8590C',
  accentDim: 'rgba(232, 89, 12, 0.12)',
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
