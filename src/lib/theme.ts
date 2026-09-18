// Canonical terminal-theme palette. Mirrors the values in src/styles/globals.css's
// @theme block and :root custom properties — keep both in sync when either changes.
// This is the single TypeScript source of truth for colors used as inline style
// values (SVG strokes, icon `color` props, etc.) that can't consume a CSS variable
// directly through Tailwind utility classes.

export const TERM = {
  bg: '#0a0d13',
  panel: '#111621',
  inset: '#0d1119',
  card: '#111621',
  border: 'rgba(255, 255, 255, 0.08)',
  text: '#e6e8ee',
  subtext: '#c3c8d4',
  muted: '#8b93a7',
  faint: '#5c6478',
  fainter: '#3a4152',
  accent: '#38bdf8',
  green: '#34d399',
  yellow: '#fbbf24',
  red: '#f87171',
  pink: '#f472b6',
  lime: '#a3e635'
} as const;

// The dashboard's title-bar "traffic light" window controls.
export const TRAFFIC_LIGHT = {
  red: '#ff5f56',
  yellow: '#ffbd2e',
  green: '#27c93f'
} as const;
