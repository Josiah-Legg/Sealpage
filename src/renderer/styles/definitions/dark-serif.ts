import type { StyleDefinition } from '../schema';
import { FONTS, FALLBACK } from '../fonts';

/*
 * Dark Serif: a literary dark theme, the feel of a fine hardback read by
 * lamplight. Ink-black surfaces with a cool blue tint, cream type instead of
 * white, Young Serif headings and a muted antique-gold accent. Everything is
 * serif (Source Serif 4 for text and UI) and there are no screen effects.
 * It is deliberately unlike Warm Grey: cool rather than warm, serif rather
 * than sans, gold rather than clay.
 */

// --- core palette: every token below reuses these values
const INK = '#0b0e13'; // app window, title bar
const PAGE = '#0e1218'; // editor page
const SURFACE = '#11161d'; // sidebar, tab strip
const RAISED = '#171d26'; // menus, dialogs
const HOVER = '#1c2430';
const ACTIVE = '#24303f';
const INPUT = '#131922'; // text inputs, code blocks
const LINE = '#222b38';
const LINE_STRONG = '#33404f';

const CREAM = '#e6dfcf'; // body text
const CREAM_HEAD = '#f1e9d6'; // headings
const CREAM_SOFT = '#c9c2b1'; // block quote text
const MUTED = '#a39f94';
const FAINT = '#6f7480';
const CHROME_TEXT = '#d6cfbf';
const CHROME_MUTED = '#8e8f8f';

const GOLD = '#c9a45c'; // accent
const GOLD_RGB = '201, 164, 92';
const GOLD_PALE = '#d9b872'; // links
const GOLD_INK = '#14110a'; // text on gold

const CRIMSON = '#8e3b45';
const AMBER = '#d9a441';
const SAGE = '#8fb08a';

const fontStack = (family: string, fallback: string): string => `"${family}", ${fallback}`;

const style: StyleDefinition = {
  id: 'dark-serif',
  name: 'Dark Serif',
  description: 'Cool ink-black pages, cream serif type and a gold accent, like a hardback read by lamplight.',
  order: 3,
  fontFaces: [...FONTS.youngSerif, ...FONTS.sourceSerif4, ...FONTS.jetbrainsMono],
  tokens: {
    fonts: {
      ui: fontStack('Source Serif 4', FALLBACK.serif),
      body: fontStack('Source Serif 4', FALLBACK.serif),
      heading: fontStack('Young Serif', FALLBACK.serif),
      mono: fontStack('JetBrains Mono', FALLBACK.mono),
    },
    type: {
      baseSize: 18,
      lineHeight: 1.7,
      uiSize: 14,
      titleSize: 2.4,
      h1Size: 1.7,
      h2Size: 1.35,
      h3Size: 1.12,
      // Young Serif has only weight 400: never let the browser fake a bold.
      titleWeight: 400,
      headingWeight: 400,
      bodyWeight: 400,
      boldWeight: 700,
      headingLineHeight: 1.2,
      headingLetterSpacing: '0',
      bodyLetterSpacing: '0.003em',
      codeSize: 0.82,
      codeLineHeight: 1.6,
      blockSpacing: 1,
      headingSpacing: 0.8,
      contentWidth: 700,
      fontSmoothing: 'antialiased',
    },
    colors: {
      // --- window and chrome
      appBg: INK,
      chromeBg: INK,
      chromeText: CHROME_TEXT,
      chromeTextMuted: CHROME_MUTED,
      chromeBorder: '#1a212c',
      // --- surfaces
      surface: SURFACE,
      surfaceRaised: RAISED,
      surfaceHover: HOVER,
      surfaceActive: ACTIVE,
      inputBg: INPUT,
      border: LINE,
      borderStrong: LINE_STRONG,
      // --- text
      text: CREAM,
      textMuted: MUTED,
      textFaint: FAINT,
      heading: CREAM_HEAD,
      link: GOLD_PALE,
      // --- accent and status
      accent: GOLD,
      accentText: GOLD_INK,
      accentMuted: `rgba(${GOLD_RGB}, 0.16)`,
      danger: CRIMSON,
      dangerText: CREAM_HEAD,
      warning: AMBER,
      success: SAGE,
      // --- editor page
      editorBg: PAGE,
      selectionBg: `rgba(${GOLD_RGB}, 0.28)`,
      selectionText: 'inherit',
      caret: GOLD,
      // --- scrollbars
      scrollbarThumb: '#2a3442',
      scrollbarThumbHover: '#3d4a5c',
      scrollbarTrack: 'transparent',
      // --- blocks
      codeBg: INPUT,
      codeText: CREAM,
      codeBorder: LINE,
      inlineCodeBg: 'rgba(120, 150, 200, 0.12)',
      inlineCodeText: '#e3c98f',
      quoteBar: GOLD,
      quoteText: CREAM_SOFT,
      quoteBg: 'transparent',
      tableBorder: LINE,
      tableHeaderBg: '#161c25',
      tableHeaderText: CREAM,
      tableStripeBg: 'rgba(200, 215, 235, 0.03)',
      divider: LINE,
      checkboxBorder: '#4a5566',
      checkboxCheckedBg: GOLD,
      checkboxCheck: GOLD_INK,
      checkedText: FAINT,
      // --- misc
      searchMatchBg: '#3d3220',
      searchMatchActiveBg: '#6b5526',
      overlay: 'rgba(3, 5, 9, 0.65)',
      focusRing: GOLD,
    },
    syntax: {
      comment: '#7d8a9c',
      keyword: GOLD_PALE,
      string: '#9cc09a',
      number: '#d59a72',
      function: '#b9d0ea',
      type: '#b7a6d6',
      variable: CREAM,
      operator: '#a9b4c4',
      punctuation: '#8f9bab',
      tag: '#d9908a',
      attribute: '#cdd49a',
      meta: '#8fa3b8',
      addition: '#8fbf8a',
      deletion: '#d98585',
    },
    shape: {
      radiusSm: 2,
      radiusMd: 3,
      radiusLg: 5,
      borderWidth: 1,
      focusRingWidth: 1.5,
      scrollbarWidth: 9,
      scrollbarRadius: 4,
      quoteBarWidth: 2,
      dividerWidth: 1,
      dividerStyle: 'solid',
      caretWidth: 1.5,
      shadowMenu: '0 8px 24px rgba(0, 0, 0, 0.5)',
      shadowDialog: '0 12px 36px rgba(0, 0, 0, 0.6)',
    },
    graph: {
      palette: [
        GOLD, // gold
        '#7da2c8', // dusty blue
        '#9cbf8f', // sage
        '#c97b84', // muted rose
        '#a897d0', // lavender
        '#d08e62', // copper
        '#5fb0a6', // teal
        '#bdb7a8', // cream grey
      ],
      background: 'transparent',
      text: CREAM,
      textMuted: MUTED,
      axis: '#5b6b82',
      grid: '#1c2431',
      fontFamily: fontStack('Source Serif 4', FALLBACK.serif),
      titleFontFamily: fontStack('Young Serif', FALLBACK.serif),
      fontSize: 12.5,
      titleFontSize: 17,
      titleWeight: 400,
      lineWidth: 1.75,
      axisWidth: 1,
      gridWidth: 0.75,
      gridDash: '1 3',
      barRadius: 1,
      pointRadius: 3,
      areaOpacity: 0.2,
      sliceStroke: PAGE,
      sliceStrokeWidth: 1.5,
    },
    chrome: {
      titleBarColor: INK,
      titleBarSymbolColor: CHROME_TEXT,
      colorScheme: 'dark',
    },
    effects: {
      textGlow: 'none',
      scanlines: 0,
      scanlineSize: 3,
      vignette: 0,
      curvature: 0,
      grain: 0,
    },
  },
  options: [],
};

export default style;
