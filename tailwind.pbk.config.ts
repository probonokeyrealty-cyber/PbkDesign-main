/**
 * PBK COMMAND CENTER — TAILWIND CONFIG EXTENSION
 * ================================================
 * Merge this into your tailwind.config.ts.
 * Maps PBK design tokens into Tailwind utilities so you can use
 * both PBK classes (pbk-btn, pbk-status, etc.) AND Tailwind utilities
 * (bg-pbk-panel, text-pbk-sky, border-pbk-dim) in the same codebase.
 *
 * Usage:
 *   import { pbkTheme } from './tailwind.pbk.config';
 *   export default { theme: { extend: pbkTheme } };
 *
 * IMPORTANT: This does NOT replace pbk-tokens.css.
 * You still need the :root variables for the component CSS to work.
 * This config just makes Tailwind aware of the same palette.
 */

export const pbkTheme = {
  colors: {
    pbk: {
      void: '#06080B',
      console: '#0B0E13',
      panel: '#11151C',
      'panel-elevated': '#171C25',
      hover: '#1D232E',

      // Borders
      'border-dim': '#1C222C',
      border: '#2A3140',
      'border-bright': '#3B4352',

      // Text
      'text-primary': '#E8EDF4',
      'text-secondary': '#9AA4B4',
      'text-tertiary': '#5A6372',
      'text-ghost': '#38404D',

      // Sky (primary brand)
      sky: '#7DD3FC',
      'sky-bright': '#BAE6FD',
      'sky-dim': '#38BDF8',
      'sky-deep': '#0284C7',

      // Semantic
      amber: '#FFB020',
      ion: '#38BDF8',
      crimson: '#F87171',
      'crimson-deep': '#EF4444',
      magenta: '#E879F9',
      lime: '#A3E635',
    },
  },

  backgroundColor: {
    'sky-glow': 'rgba(125, 211, 252, 0.15)',
    'sky-glow-strong': 'rgba(125, 211, 252, 0.28)',
    'amber-glow': 'rgba(255, 176, 32, 0.12)',
    'ion-glow': 'rgba(56, 189, 248, 0.12)',
    'crimson-glow': 'rgba(248, 113, 113, 0.12)',
    'magenta-glow': 'rgba(232, 121, 249, 0.12)',
    'lime-glow': 'rgba(163, 230, 53, 0.12)',
  },

  fontFamily: {
    display: ["'Fraunces'", "'Georgia'", "'Times New Roman'", 'serif'],
    ui: ["'Geist'", '-apple-system', "'Segoe UI'", 'sans-serif'],
    mono: ["'JetBrains Mono'", "'Fira Code'", "'Courier New'", 'monospace'],
  },

  spacing: {
    's-1': '4px',
    's-2': '8px',
    's-3': '12px',
    's-4': '16px',
    's-5': '20px',
    's-6': '24px',
    's-8': '32px',
    's-10': '40px',
    's-12': '48px',
    's-16': '64px',
  },

  borderRadius: {
    'pbk-sm': '4px',
    pbk: '6px',
    'pbk-lg': '10px',
    'pbk-xl': '16px',
  },
};

/**
 * Safelist — prevent Tailwind from purging PBK component classes.
 * Add this to your tailwind.config.ts safelist array.
 */
export const pbkSafelist = [
  // All pbk- prefixed classes
  { pattern: /^pbk-/ },
];

/**
 * Content paths — tell Tailwind to scan PBK CSS files for class names.
 * Add these to your tailwind.config.ts content array.
 */
export const pbkContentPaths = [
  './src/styles/pbk-tokens.css',
  './src/styles/pbk-components.css',
];
