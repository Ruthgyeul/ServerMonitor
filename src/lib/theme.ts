// Canonical console palette (Dashboard Pro design). Mirrors the `@theme` tokens in
// src/styles/globals.css — keep both in sync when either changes. This is the
// TypeScript source of truth for colors used as inline style values (SVG strokes,
// icon `color` props, computed fills) that can't consume a Tailwind class.

export const PALETTE = {
  // Surfaces, darkest to lightest
  canvas: '#0b0d12',
  sidebar: '#0d1016',
  card: '#11141b',
  raised: '#141821',
  inset: '#161a22',
  toast: '#1a1f2a',
  track: '#1b2029',
  active: '#232834',
  toggleOff: '#2a303c',

  // Hairlines
  line: 'rgba(255, 255, 255, 0.06)',
  lineStrong: 'rgba(255, 255, 255, 0.08)',
  lineSoft: 'rgba(255, 255, 255, 0.04)',

  // Text, brightest to faintest
  text: '#e7e9ee',
  text2: '#c4c9d4',
  text3: '#aeb4c2',
  nav: '#9aa1b1',
  muted: '#8a91a3',
  dim: '#7b8294',
  subtle: '#6b7386',
  faint: '#5b6275',
  divider: '#3d4354',

  // Accents
  accent: '#5aa9f0',
  link: '#7fb4f0',
  linkHover: '#a9cdf6',
  upload: '#a78bfa',

  // Status: solid (dots, strokes) and foreground (text on tinted backgrounds)
  ok: '#3ccf91',
  okFg: '#8fe3be',
  warn: '#e8b445',
  warnFg: '#f2cf86',
  crit: '#ef5f5a',
  critFg: '#f6b0ad',
  infoFg: '#a9cdf6'
} as const;

// Kept for the legacy terminal-themed cards until they are rebuilt on the new
// design (Phase 1/2). Values now point at the console palette so those cards
// already pick up the new colors.
export const TERM = {
  bg: PALETTE.canvas,
  panel: PALETTE.card,
  inset: PALETTE.inset,
  card: PALETTE.card,
  border: PALETTE.lineStrong,
  text: PALETTE.text,
  subtext: PALETTE.text2,
  muted: PALETTE.muted,
  faint: PALETTE.subtle,
  fainter: PALETTE.divider,
  accent: PALETTE.accent,
  green: PALETTE.ok,
  yellow: PALETTE.warn,
  red: PALETTE.crit,
  pink: '#f472b6',
  lime: '#a3e635'
} as const;
