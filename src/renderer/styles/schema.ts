/**
 * Style definition schema.
 *
 * A style is pure data: one file in src/renderer/styles/definitions/ that
 * default-exports a StyleDefinition. Adding a style means adding one file
 * there; the build regenerates the registry (scripts/gen-style-index.mjs) and
 * nothing else needs to change.
 *
 * Every token is turned into a CSS custom property by ./apply.ts (see the
 * naming rule there and the full list in docs/ARCHITECTURE.md). Component CSS
 * must use those variables only: no literal colours, fonts or radii.
 */

/** One @font-face rule. Fonts are bundled; `file` is relative to assets/fonts/. */
export interface FontFaceDef {
  family: string;
  /** e.g. "inter/inter-latin-wght-normal.woff2" */
  file: string;
  /** A single weight ("400") or a variable-font range ("100 900"). */
  weight: string;
  style: 'normal' | 'italic';
  /** CSS unicode-range, when the font is split into subsets. */
  unicodeRange?: string;
}

export interface StyleFonts {
  /** Menus, tabs, sidebar, dialogs. A CSS font-family stack. */
  ui: string;
  /** Document body text. */
  body: string;
  /** Title and subheadings. */
  heading: string;
  /** Code blocks and inline code. */
  mono: string;
}

export interface StyleType {
  /** Document body font size in px. */
  baseSize: number;
  /** Document body line height (unitless). */
  lineHeight: number;
  /** UI font size in px. */
  uiSize: number;
  /** Heading sizes in em, relative to baseSize. */
  titleSize: number;
  h1Size: number;
  h2Size: number;
  h3Size: number;
  titleWeight: number;
  headingWeight: number;
  bodyWeight: number;
  boldWeight: number;
  headingLineHeight: number;
  /** CSS letter-spacing for headings, e.g. "-0.01em". */
  headingLetterSpacing: string;
  /** CSS letter-spacing for body text, e.g. "0". */
  bodyLetterSpacing: string;
  /** Code font size in em, relative to the surrounding text. */
  codeSize: number;
  /** Line height inside code blocks. */
  codeLineHeight: number;
  /** Vertical space between blocks, in em. */
  blockSpacing: number;
  /** Extra space above headings, in em. */
  headingSpacing: number;
  /** Maximum width of the text column in px. */
  contentWidth: number;
  /** "antialiased" for smooth fonts, "none" for pixel fonts. */
  fontSmoothing: 'antialiased' | 'none' | 'auto';
}

export interface StyleColors {
  // --- window and chrome
  /** Window background behind everything. */
  appBg: string;
  /** Title bar, menu bar, toolbar, status bar background. */
  chromeBg: string;
  chromeText: string;
  chromeTextMuted: string;
  chromeBorder: string;
  // --- surfaces
  /** Sidebar and tab strip background. */
  surface: string;
  /** Menus, popovers, dialogs. */
  surfaceRaised: string;
  /** Hovered row / button. */
  surfaceHover: string;
  /** Pressed or selected row / button, active tab. */
  surfaceActive: string;
  /** Text inputs and the graph data grid. */
  inputBg: string;
  border: string;
  borderStrong: string;
  // --- text
  text: string;
  textMuted: string;
  textFaint: string;
  heading: string;
  link: string;
  // --- accent and status
  accent: string;
  /** Text / icons drawn on top of `accent`. */
  accentText: string;
  /** Soft accent tint for subtle highlights. */
  accentMuted: string;
  danger: string;
  dangerText: string;
  warning: string;
  success: string;
  // --- editor page
  editorBg: string;
  selectionBg: string;
  /** Text colour inside a selection, or "inherit". */
  selectionText: string;
  caret: string;
  // --- scrollbars
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  scrollbarTrack: string;
  // --- blocks
  codeBg: string;
  codeText: string;
  codeBorder: string;
  inlineCodeBg: string;
  inlineCodeText: string;
  quoteBar: string;
  quoteText: string;
  quoteBg: string;
  tableBorder: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  tableStripeBg: string;
  divider: string;
  checkboxBorder: string;
  checkboxCheckedBg: string;
  checkboxCheck: string;
  /** Strikethrough-ish dim colour for completed checklist items. */
  checkedText: string;
  // --- misc
  searchMatchBg: string;
  searchMatchActiveBg: string;
  /** Modal backdrop (should be translucent). */
  overlay: string;
  focusRing: string;
}

/** Syntax highlighting colours for code blocks. */
export interface StyleSyntax {
  comment: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  type: string;
  variable: string;
  operator: string;
  punctuation: string;
  tag: string;
  attribute: string;
  meta: string;
  addition: string;
  deletion: string;
}

export interface StyleShape {
  /** Corner radii in px. */
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  /** Border width in px. */
  borderWidth: number;
  focusRingWidth: number;
  /** Scrollbar thickness in px. */
  scrollbarWidth: number;
  scrollbarRadius: number;
  /** Width of the bar on the left of block quotes, px. */
  quoteBarWidth: number;
  /** Thickness of horizontal dividers, px. */
  dividerWidth: number;
  /** CSS border-style for dividers: "solid", "dashed", "double"... */
  dividerStyle: string;
  /** Caret (text cursor) width in px. */
  caretWidth: number;
  /** CSS box-shadow for menus and popovers. */
  shadowMenu: string;
  /** CSS box-shadow for dialogs. */
  shadowDialog: string;
}

export interface StyleGraph {
  /** Series colours, at least 8. */
  palette: string[];
  /** Plot background colour or "transparent". */
  background: string;
  text: string;
  textMuted: string;
  axis: string;
  grid: string;
  /** Font stacks; usually the UI / heading stacks. */
  fontFamily: string;
  titleFontFamily: string;
  fontSize: number;
  titleFontSize: number;
  titleWeight: number;
  lineWidth: number;
  axisWidth: number;
  gridWidth: number;
  /** stroke-dasharray for grid lines, "" for solid. */
  gridDash: string;
  barRadius: number;
  pointRadius: number;
  areaOpacity: number;
  sliceStroke: string;
  sliceStrokeWidth: number;
}

/** Native window chrome (the caption buttons drawn by Windows). */
export interface StyleChrome {
  /** Solid #rrggbb colour behind the minimise / maximise / close buttons. */
  titleBarColor: string;
  /** #rrggbb colour of the caption button glyphs. */
  titleBarSymbolColor: string;
  /** Tells Chromium which native form control / scrollbar scheme to use. */
  colorScheme: 'light' | 'dark';
}

/** Full-window visual effects. All default to "off" (0 / "none"). */
export interface StyleEffects {
  /** CSS text-shadow applied to document and UI text, e.g. a phosphor glow. "none" to disable. */
  textGlow: string;
  /** Scanline overlay opacity, 0..1. 0 disables it. */
  scanlines: number;
  /** Scanline period in px. */
  scanlineSize: number;
  /** Darkening towards the window edges, 0..1. 0 disables it. */
  vignette: number;
  /** Strength of the inner edge shading that suggests curved glass, 0..1. */
  curvature: number;
  /** Paper grain / noise overlay opacity, 0..1. 0 disables it. */
  grain: number;
}

export interface StyleTokens {
  fonts: StyleFonts;
  type: StyleType;
  colors: StyleColors;
  syntax: StyleSyntax;
  shape: StyleShape;
  graph: StyleGraph;
  chrome: StyleChrome;
  effects: StyleEffects;
}

export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** A per-style on/off switch shown in Settings > Style. */
export interface StyleToggleOption {
  kind: 'toggle';
  id: string;
  label: string;
  description?: string;
  default: boolean;
  /** Token overrides merged in when the toggle is on / off. */
  on?: DeepPartial<StyleTokens>;
  off?: DeepPartial<StyleTokens>;
}

/** A per-style multiple choice shown in Settings > Style. */
export interface StyleChoiceOption {
  kind: 'choice';
  id: string;
  label: string;
  description?: string;
  default: string;
  choices: { id: string; label: string; tokens: DeepPartial<StyleTokens> }[];
}

export type StyleOption = StyleToggleOption | StyleChoiceOption;

/** Stored values of a style's options: option id -> boolean (toggle) or choice id. */
export type StyleOptionValues = Record<string, boolean | string>;

export interface StyleDefinition {
  /** Stable identifier, kebab-case, unique. Stored in settings. */
  id: string;
  /** Display name. */
  name: string;
  /** One line shown under the name in the style picker. */
  description: string;
  /** Sort position in the style picker (ascending). */
  order: number;
  fontFaces: FontFaceDef[];
  tokens: StyleTokens;
  options: StyleOption[];
}
