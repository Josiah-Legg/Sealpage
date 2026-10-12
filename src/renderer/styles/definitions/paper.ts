import type { StyleDefinition } from '../schema';
import { FALLBACK, FONTS } from '../fonts';

/**
 * Paper: warm, tactile writing paper. A creamy off-white page on a slightly
 * darker desk, soft warm-black ink, low-contrast warm-grey chrome and a single
 * earthy terracotta accent. Everything leans yellow/brown (red > blue); nothing
 * is stark white or cool grey. The only texture is a very faint grain, which
 * the user can switch off.
 */

// --- core palette (every neutral has a warm undertone)
const PAGE = '#f8f3e8';
const DESK = '#efe8da';
const CHROME = '#e9e1d1';
const RAISED = '#fbf7ee';
const HOVER = '#e4dccb';
const ACTIVE = '#d9cfbb';
const INPUT = '#fcf9f1';
const LINE = '#d8cebb';
const LINE_STRONG = '#bfb39c';

const INK = '#2b2620';
const INK_HEAD = '#1f1b16';
const INK_MUTED = '#5f574b';
const INK_FAINT = '#8c8373';
const CHROME_INK = '#3a342b';
const CHROME_INK_MUTED = '#6b6255';

const TERRACOTTA = '#a8492b';
const CREAM = '#fdf8ee';
const BRICK = '#8f2a1f';
const OCHRE = '#8a5d10';
const OLIVE = '#4f6428';

const CODE_BG = '#efe9dc';
const CODE_LINE = '#dcd3c0';

const UI_STACK = '"Bricolage Grotesque", ' + FALLBACK.sans;
const MONO_STACK = '"JetBrains Mono", ' + FALLBACK.mono;

const definition: StyleDefinition = {
  id: 'paper',
  name: 'Paper',
  description: 'Creamy writing paper, soft ink and a single terracotta accent.',
  order: 2,
  fontFaces: [...FONTS.bricolageGrotesque, ...FONTS.jetbrainsMono],
  tokens: {
    fonts: {
      ui: UI_STACK,
      body: UI_STACK,
      heading: UI_STACK,
      mono: MONO_STACK,
    },
    type: {
      baseSize: 17,
      lineHeight: 1.6,
      uiSize: 13.5,
      titleSize: 2.3,
      h1Size: 1.7,
      h2Size: 1.35,
      h3Size: 1.12,
      titleWeight: 700,
      headingWeight: 650,
      bodyWeight: 400,
      boldWeight: 700,
      headingLineHeight: 1.2,
      headingLetterSpacing: '-0.02em',
      bodyLetterSpacing: '0',
      codeSize: 0.86,
      codeLineHeight: 1.55,
      blockSpacing: 0.95,
      headingSpacing: 0.7,
      contentWidth: 720,
      fontSmoothing: 'antialiased',
    },
    colors: {
      // --- window and chrome
      appBg: DESK,
      chromeBg: CHROME,
      chromeText: CHROME_INK,
      chromeTextMuted: CHROME_INK_MUTED,
      chromeBorder: LINE,
      // --- surfaces
      surface: DESK,
      surfaceRaised: RAISED,
      surfaceHover: HOVER,
      surfaceActive: ACTIVE,
      inputBg: INPUT,
      border: LINE,
      borderStrong: LINE_STRONG,
      // --- text
      text: INK,
      textMuted: INK_MUTED,
      textFaint: INK_FAINT,
      heading: INK_HEAD,
      link: '#98401f',
      // --- accent and status
      accent: TERRACOTTA,
      accentText: CREAM,
      accentMuted: 'rgba(168, 73, 43, 0.14)',
      danger: BRICK,
      dangerText: CREAM,
      warning: OCHRE,
      success: OLIVE,
      // --- editor page
      editorBg: PAGE,
      selectionBg: 'rgba(168, 73, 43, 0.22)',
      selectionText: 'inherit',
      caret: INK,
      // --- scrollbars
      scrollbarThumb: 'rgba(90, 72, 48, 0.28)',
      scrollbarThumbHover: 'rgba(90, 72, 48, 0.45)',
      scrollbarTrack: 'transparent',
      // --- blocks
      codeBg: CODE_BG,
      codeText: INK,
      codeBorder: CODE_LINE,
      inlineCodeBg: CODE_BG,
      inlineCodeText: '#3d2e22',
      quoteBar: TERRACOTTA,
      quoteText: '#5a5246',
      quoteBg: 'transparent',
      tableBorder: LINE,
      tableHeaderBg: '#ece5d4',
      tableHeaderText: INK,
      tableStripeBg: 'rgba(90, 60, 20, 0.035)',
      divider: LINE,
      checkboxBorder: '#9d9280',
      checkboxCheckedBg: TERRACOTTA,
      checkboxCheck: CREAM,
      checkedText: INK_FAINT,
      // --- misc
      searchMatchBg: '#f0d68a',
      searchMatchActiveBg: '#e0a94a',
      overlay: 'rgba(43, 38, 32, 0.35)',
      focusRing: TERRACOTTA,
    },
    syntax: {
      comment: '#6e6250',
      keyword: '#9a3b1f',
      string: '#4d6122',
      number: '#8a5a12',
      function: '#1f5f6b',
      type: '#6b3a6e',
      variable: '#4a3b2c',
      operator: '#6b4a2e',
      punctuation: '#5a4f42',
      tag: '#34507a',
      attribute: '#7d5a14',
      meta: '#7a6d5a',
      addition: '#3f6b2a',
      deletion: '#8f2a1f',
    },
    shape: {
      radiusSm: 3,
      radiusMd: 5,
      radiusLg: 8,
      borderWidth: 1,
      focusRingWidth: 2,
      scrollbarWidth: 10,
      scrollbarRadius: 5,
      quoteBarWidth: 3,
      dividerWidth: 1,
      dividerStyle: 'solid',
      caretWidth: 2,
      shadowMenu: '0 8px 28px rgba(60, 45, 20, 0.18)',
      shadowDialog: '0 16px 48px rgba(60, 45, 20, 0.24)',
    },
    graph: {
      palette: [
        TERRACOTTA, // terracotta
        '#2f6f73', // deep teal
        '#b07d1e', // ochre
        '#5f7a2e', // olive
        '#7a4a7e', // plum
        '#4a6790', // slate blue
        '#b8566a', // brick rose
        '#7d6b55', // warm grey-brown
      ],
      background: 'transparent',
      text: INK,
      textMuted: INK_MUTED,
      axis: '#8a7b66',
      grid: '#dcd2bf',
      fontFamily: UI_STACK,
      titleFontFamily: UI_STACK,
      fontSize: 12,
      titleFontSize: 16,
      titleWeight: 650,
      lineWidth: 2.25,
      axisWidth: 1,
      gridWidth: 1,
      gridDash: '2 4',
      barRadius: 2,
      pointRadius: 3.5,
      areaOpacity: 0.28,
      sliceStroke: PAGE,
      sliceStrokeWidth: 2,
    },
    chrome: {
      titleBarColor: CHROME,
      titleBarSymbolColor: CHROME_INK,
      colorScheme: 'light',
    },
    effects: {
      textGlow: 'none',
      scanlines: 0,
      scanlineSize: 3,
      vignette: 0,
      curvature: 0,
      grain: 0.05,
    },
  },
  options: [
    {
      kind: 'toggle',
      id: 'grain',
      label: 'Paper grain',
      description: 'A faint paper texture over the page.',
      default: true,
      off: { effects: { grain: 0 } },
    },
  ],
};

export default definition;
