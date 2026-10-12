/**
 * Terminal: a classic phosphor screen. Glowing green (or amber) text on
 * near-black glass, set in the Glass TTY VT220 bitmap font, with an optional
 * CRT effect (scanlines, glow, curved-glass shading).
 *
 * Design intent: monochrome. Every colour is a shade of one phosphor on black,
 * so hierarchy comes from brightness rather than hue. The font is a pixel
 * font drawn for 20px, so all sizes are whole or half multiples and smoothing
 * is off to keep the pixels crisp. Shapes are square and hard-edged. The CRT
 * effect is atmosphere only: it is a toggle and it never reduces contrast.
 */
import type { StyleDefinition, StyleTokens } from '../schema';
import { FALLBACK, FONTS } from '../fonts';

const FONT_STACK = '"Glass TTY VT220", ' + FALLBACK.mono;

/** Status colours are not phosphor-hued, so they are the same for both screens. */
const DANGER = '#ff5f4a';
const WARNING = '#ffd24a';

/** `#rrggbb` + alpha -> `rgba(r, g, b, a)`. */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface Phosphor {
  /** Headings, links, success, focus ring. */
  bright: string;
  /** Body text, accent, caret, selection. */
  normal: string;
  /** Secondary text, rules, quote bars, syntax punctuation. */
  dim: string;
  /** Faint text (must still reach 2.5:1 on the page). */
  faint: string;
  /** The page and the glass behind it. */
  bg: string;
  /** Title bar and status-level chrome, one step from the page. */
  chrome: string;
  surface: string;
  surfaceRaised: string;
  surfaceHover: string;
  surfaceActive: string;
  inputBg: string;
  /** Hairlines and box borders: dim at low brightness. */
  border: string;
  /** Five hues for graph series 4 to 8 that still read as a CRT. */
  series: string[];
}

const GREEN: Phosphor = {
  bright: '#7dffa0',
  normal: '#33ff66',
  dim: '#1fb84a',
  faint: '#178a39',
  bg: '#050805',
  chrome: '#070b07',
  surface: '#081008',
  surfaceRaised: '#0b160c',
  surfaceHover: '#102414',
  surfaceActive: '#17361d',
  inputBg: '#030503',
  border: '#145c28',
  series: ['#33d6ff', '#ffd24a', '#ff5f4a', '#c58cff', '#f2f2f2'],
};

const AMBER: Phosphor = {
  bright: '#ffd166',
  normal: '#ffb000',
  dim: '#c98a00',
  faint: '#946500',
  bg: '#080602',
  chrome: '#0b0903',
  surface: '#100c04',
  surfaceRaised: '#171204',
  surfaceHover: '#241b06',
  surfaceActive: '#3b2c0a',
  inputBg: '#060401',
  border: '#644500',
  series: ['#33d6ff', '#33ff66', '#ff5f4a', '#c58cff', '#f2f2f2'],
};

function makeTokens(p: Phosphor): StyleTokens {
  return {
    fonts: { ui: FONT_STACK, body: FONT_STACK, heading: FONT_STACK, mono: FONT_STACK },
    type: {
      baseSize: 20,
      lineHeight: 1.3,
      uiSize: 20,
      titleSize: 2,
      h1Size: 1.5,
      h2Size: 1,
      h3Size: 1,
      titleWeight: 400,
      headingWeight: 400,
      bodyWeight: 400,
      boldWeight: 400,
      headingLineHeight: 1.2,
      headingLetterSpacing: '0',
      bodyLetterSpacing: '0',
      codeSize: 1,
      codeLineHeight: 1.3,
      blockSpacing: 0.8,
      headingSpacing: 0.6,
      contentWidth: 880,
      fontSmoothing: 'none',
    },
    colors: {
      appBg: p.bg,
      chromeBg: p.chrome,
      chromeText: p.normal,
      chromeTextMuted: p.dim,
      chromeBorder: p.border,
      surface: p.surface,
      surfaceRaised: p.surfaceRaised,
      surfaceHover: p.surfaceHover,
      surfaceActive: p.surfaceActive,
      inputBg: p.inputBg,
      border: p.border,
      borderStrong: p.dim,
      text: p.normal,
      textMuted: p.dim,
      textFaint: p.faint,
      heading: p.bright,
      link: p.bright,
      accent: p.normal,
      accentText: p.bg,
      accentMuted: rgba(p.normal, 0.18),
      danger: DANGER,
      dangerText: p.bg,
      warning: WARNING,
      success: p.bright,
      editorBg: p.bg,
      selectionBg: p.normal,
      selectionText: p.bg,
      caret: p.normal,
      scrollbarThumb: p.dim,
      scrollbarThumbHover: p.normal,
      scrollbarTrack: p.surface,
      codeBg: p.surface,
      codeText: p.normal,
      codeBorder: p.border,
      inlineCodeBg: p.surfaceHover,
      inlineCodeText: p.bright,
      quoteBar: p.dim,
      quoteText: p.normal,
      quoteBg: 'transparent',
      tableBorder: p.dim,
      tableHeaderBg: p.surfaceActive,
      tableHeaderText: p.bright,
      tableStripeBg: p.surface,
      divider: p.dim,
      checkboxBorder: p.normal,
      checkboxCheckedBg: p.normal,
      checkboxCheck: p.bg,
      checkedText: p.dim,
      searchMatchBg: rgba(p.dim, 0.45),
      searchMatchActiveBg: rgba(WARNING, 0.55),
      overlay: 'rgba(0, 0, 0, 0.7)',
      focusRing: p.bright,
    },
    syntax: {
      comment: p.dim,
      keyword: p.bright,
      string: p.normal,
      number: p.bright,
      function: p.bright,
      type: p.normal,
      variable: p.normal,
      operator: p.dim,
      punctuation: p.dim,
      tag: p.bright,
      attribute: p.normal,
      meta: p.dim,
      addition: p.bright,
      deletion: DANGER,
    },
    shape: {
      radiusSm: 0,
      radiusMd: 0,
      radiusLg: 0,
      borderWidth: 1,
      focusRingWidth: 2,
      scrollbarWidth: 12,
      scrollbarRadius: 0,
      quoteBarWidth: 4,
      dividerWidth: 2,
      dividerStyle: 'dashed',
      caretWidth: 10,
      shadowMenu: `0 0 0 1px ${rgba(p.normal, 0.35)}, 0 0 18px ${rgba(p.normal, 0.12)}`,
      shadowDialog: `0 0 0 1px ${rgba(p.normal, 0.35)}, 0 0 18px ${rgba(p.normal, 0.12)}`,
    },
    graph: {
      palette: [p.normal, p.bright, p.dim, ...p.series],
      background: 'transparent',
      text: p.normal,
      textMuted: p.dim,
      axis: p.dim,
      grid: p.border,
      fontFamily: FONT_STACK,
      titleFontFamily: FONT_STACK,
      fontSize: 20,
      titleFontSize: 20,
      titleWeight: 400,
      lineWidth: 2,
      axisWidth: 2,
      gridWidth: 1,
      gridDash: '2 4',
      barRadius: 0,
      pointRadius: 4,
      areaOpacity: 0.25,
      sliceStroke: p.bg,
      sliceStrokeWidth: 2,
    },
    chrome: {
      titleBarColor: p.chrome,
      titleBarSymbolColor: p.normal,
      colorScheme: 'dark',
    },
    effects: {
      textGlow: `0 0 5px ${rgba(p.normal, 0.45)}`,
      scanlines: 0.14,
      scanlineSize: 3,
      vignette: 0.32,
      curvature: 0.45,
      grain: 0,
    },
  };
}

const terminal: StyleDefinition = {
  id: 'terminal',
  name: 'Terminal',
  description: 'Glowing phosphor text on near-black glass, in a VT220 pixel font, with an optional CRT effect.',
  order: 4,
  fontFaces: [...FONTS.glassTty],
  tokens: makeTokens(GREEN),
  options: [
    {
      kind: 'choice',
      id: 'phosphor',
      label: 'Phosphor',
      description: 'The colour of the screen.',
      default: 'green',
      choices: [
        { id: 'green', label: 'Green', tokens: {} },
        { id: 'amber', label: 'Amber', tokens: makeTokens(AMBER) },
      ],
    },
    {
      kind: 'toggle',
      id: 'crt',
      label: 'CRT effect',
      description: 'Scanlines, phosphor glow and curved-glass shading.',
      default: true,
      on: { effects: { scanlines: 0.14, scanlineSize: 3, vignette: 0.32, curvature: 0.45 } },
      off: { effects: { textGlow: 'none', scanlines: 0, vignette: 0, curvature: 0, grain: 0 } },
    },
  ],
};

export default terminal;
