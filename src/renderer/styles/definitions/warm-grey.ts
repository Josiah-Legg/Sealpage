/**
 * Warm Grey Sans: the default style. A calm, professional dark theme in a
 * neutral sans serif, closer to a well-made writing tool than a code editor.
 * Chrome is quiet, the page is a near-black warm grey, text is soft off-white
 * and there is one restrained clay accent. No effects. Every neutral carries a
 * slight warm (red > blue) undertone.
 */
import type { StyleDefinition } from '../schema';
import { FALLBACK, FONTS } from '../fonts';

// --- core palette (reused below so related tokens stay consistent)
const PAGE = '#151515';
const CHROME = '#1a1917';
const SURFACE = '#1b1a18';
const RAISED = '#23211f';
const HOVER = '#2a2825';
const ACTIVE = '#33302c';
const INPUT = '#1f1e1c';
const BORDER = '#2e2c29';
const BORDER_STRONG = '#403d38';
const TEXT = '#e8e3db';
const HEADING = '#f2ede5';
const MUTED = '#a8a196';
const FAINT = '#7a7469';
const CHROME_TEXT = '#d9d3ca';
const CHROME_MUTED = '#948d82';
const ACCENT = '#d4a373';
const ACCENT_RGB = '212, 163, 115';
const CODE_BG = '#1c1b19';
const SAND = '#e3d3b0';
const SAGE = '#9fb58f';
const TEAL = '#7fa8a6';
const ROSE = '#c98b8b';
const SLATE = '#7d92b5';
const OCHRE = '#c9a14a';
const MAUVE = '#a88ca8';

const UI_SANS = '"Inter", ' + FALLBACK.sans;
const MONO = '"JetBrains Mono", ' + FALLBACK.mono;

const warmGrey: StyleDefinition = {
  id: 'warm-grey',
  name: 'Warm Grey Sans',
  description: 'Calm dark warm grey with Inter and a soft clay accent.',
  order: 1,
  fontFaces: [...FONTS.inter, ...FONTS.jetbrainsMono],
  tokens: {
    fonts: {
      ui: UI_SANS,
      body: UI_SANS,
      heading: UI_SANS,
      mono: MONO,
    },
    type: {
      baseSize: 16,
      lineHeight: 1.65,
      uiSize: 13,
      titleSize: 2.1,
      h1Size: 1.6,
      h2Size: 1.3,
      h3Size: 1.1,
      titleWeight: 700,
      headingWeight: 650,
      bodyWeight: 400,
      boldWeight: 650,
      headingLineHeight: 1.25,
      headingLetterSpacing: '-0.015em',
      bodyLetterSpacing: '0',
      codeSize: 0.88,
      codeLineHeight: 1.55,
      blockSpacing: 0.9,
      headingSpacing: 0.6,
      contentWidth: 760,
      fontSmoothing: 'antialiased',
    },
    colors: {
      // --- window and chrome
      appBg: PAGE,
      chromeBg: CHROME,
      chromeText: CHROME_TEXT,
      chromeTextMuted: CHROME_MUTED,
      chromeBorder: HOVER,
      // --- surfaces
      surface: SURFACE,
      surfaceRaised: RAISED,
      surfaceHover: HOVER,
      surfaceActive: ACTIVE,
      inputBg: INPUT,
      border: BORDER,
      borderStrong: BORDER_STRONG,
      // --- text
      text: TEXT,
      textMuted: MUTED,
      textFaint: FAINT,
      heading: HEADING,
      link: '#e0b07f',
      // --- accent and status
      accent: ACCENT,
      accentText: PAGE,
      accentMuted: `rgba(${ACCENT_RGB}, 0.14)`,
      danger: '#c94a48',
      dangerText: '#ffffff',
      warning: '#d6a548',
      success: '#8fb08a',
      // --- editor page
      editorBg: PAGE,
      selectionBg: `rgba(${ACCENT_RGB}, 0.3)`,
      selectionText: 'inherit',
      caret: ACCENT,
      // --- scrollbars
      scrollbarThumb: BORDER_STRONG,
      scrollbarThumbHover: '#58534b',
      scrollbarTrack: 'transparent',
      // --- blocks
      codeBg: CODE_BG,
      codeText: TEXT,
      codeBorder: BORDER,
      inlineCodeBg: '#2a241e',
      inlineCodeText: '#e6c49c',
      quoteBar: '#b8895e',
      quoteText: '#bdb6aa',
      quoteBg: 'transparent',
      tableBorder: BORDER,
      tableHeaderBg: '#1e1d1b',
      tableHeaderText: HEADING,
      tableStripeBg: 'rgba(232, 227, 219, 0.025)',
      divider: BORDER,
      checkboxBorder: '#5a554d',
      checkboxCheckedBg: ACCENT,
      checkboxCheck: PAGE,
      /** Strikethrough-ish dim colour for completed checklist items. */
      checkedText: FAINT,
      // --- misc
      searchMatchBg: `rgba(${ACCENT_RGB}, 0.22)`,
      searchMatchActiveBg: `rgba(${ACCENT_RGB}, 0.5)`,
      overlay: 'rgba(0, 0, 0, 0.55)',
      focusRing: ACCENT,
    },
    syntax: {
      comment: '#7d766b',
      keyword: ACCENT,
      string: SAGE,
      number: OCHRE,
      function: SAND,
      type: TEAL,
      variable: TEXT,
      operator: '#b5ada0',
      punctuation: MUTED,
      tag: ROSE,
      attribute: '#c9a97a',
      meta: '#9a9284',
      addition: SAGE,
      deletion: '#d8786f',
    },
    shape: {
      radiusSm: 4,
      radiusMd: 6,
      radiusLg: 10,
      borderWidth: 1,
      focusRingWidth: 2,
      scrollbarWidth: 10,
      scrollbarRadius: 5,
      quoteBarWidth: 3,
      dividerWidth: 1,
      dividerStyle: 'solid',
      caretWidth: 2,
      shadowMenu: '0 8px 28px rgba(0, 0, 0, 0.5)',
      shadowDialog: '0 16px 48px rgba(0, 0, 0, 0.6)',
    },
    graph: {
      palette: [ACCENT, TEAL, SAGE, ROSE, SLATE, OCHRE, MAUVE, '#a8a196'],
      background: 'transparent',
      text: TEXT,
      textMuted: MUTED,
      axis: '#6e685e',
      grid: BORDER,
      fontFamily: UI_SANS,
      titleFontFamily: UI_SANS,
      fontSize: 12,
      titleFontSize: 15,
      titleWeight: 600,
      lineWidth: 2,
      axisWidth: 1,
      gridWidth: 1,
      gridDash: '',
      barRadius: 3,
      pointRadius: 3.5,
      areaOpacity: 0.22,
      sliceStroke: PAGE,
      sliceStrokeWidth: 1.5,
    },
    chrome: {
      titleBarColor: CHROME,
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

export default warmGrey;
