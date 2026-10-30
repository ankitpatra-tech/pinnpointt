/**
 * PinnPointt — Username management and Bauhaus generator.
 */

const BAUHAUS_NAMES = [
  'Gropius',
  'Kandinsky',
  'Klee',
  'Breuer',
  'Albers',
  'Moholy',
  'Mies',
  'Bayer',
  'Itten',
  'Meyer',
  'Stam',
  'Brandt',
];

const STORAGE_KEY = 'pinnpointt_username';
const LEGACY_STORAGE_KEY = 'pinpoint_username';

export function generateDefaultUsername(): string {
  const name = BAUHAUS_NAMES[Math.floor(Math.random() * BAUHAUS_NAMES.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${name}-${num}`;
}

export function getSavedUsername(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return generateDefaultUsername();
  }
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (saved && saved.trim().length > 0) {
    return saved.trim().slice(0, 24);
  }
  const generated = generateDefaultUsername();
  saveUsername(generated);
  return generated;
}

export function saveUsername(name: string): string {
  const clean = (name || '').trim().slice(0, 24) || generateDefaultUsername();
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem(STORAGE_KEY, clean);
  }
  return clean;
}
