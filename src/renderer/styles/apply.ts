/**
 * Style plumbing: resolve a definition + option values to concrete tokens,
 * turn tokens into CSS custom properties, and apply them to the document.
 *
 * CSS variable naming rule (mechanical, no exceptions):
 *
 *   tokens.<group>.<camelCaseKey>  ->  --sp-<prefix>-<kebab-case-key>
 *
 *   group    prefix   example
 *   fonts    font     --sp-font-body
 *   type     type     --sp-type-base-size      (px / em units added, see UNITS)
 *   colors   color    --sp-color-surface-hover
 *   syntax   syntax   --sp-syntax-keyword
 *   shape    shape    --sp-shape-radius-md     (numbers get "px")
 *   effects  fx       --sp-fx-scanlines
 *
 * `graph` and `chrome` tokens are not exposed to CSS: graphs are drawn as SVG
 * from a GraphTheme, and chrome colours are sent to the main process.
 */
import type { GraphTheme } from '../../shared/graph/types';
import type {
  DeepPartial,
  FontFaceDef,
  StyleDefinition,
  StyleOptionValues,
  StyleTokens,
} from './schema';

const PX_TYPE_KEYS = new Set(['baseSize', 'uiSize', 'contentWidth']);
const EM_TYPE_KEYS = new Set(['titleSize', 'h1Size', 'h2Size', 'h3Size', 'codeSize', 'blockSpacing', 'headingSpacing']);
const RAW_SHAPE_KEYS = new Set(['dividerStyle', 'shadowMenu', 'shadowDialog']);
const PX_FX_KEYS = new Set(['scanlineSize']);

export function kebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursively merge `patch` into a copy of `base`. Arrays are replaced whole. */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = deepMerge((base as Record<string, unknown>)[k], v as never);
  }
  return out as T;
}

/** The effective value of every option of a style: stored value if valid, else the default. */
export function effectiveOptionValues(def: StyleDefinition, stored: StyleOptionValues | undefined): StyleOptionValues {
  const out: StyleOptionValues = {};
  for (const opt of def.options) {
    const v = stored?.[opt.id];
    if (opt.kind === 'toggle') out[opt.id] = typeof v === 'boolean' ? v : opt.default;
    else out[opt.id] = typeof v === 'string' && opt.choices.some((c) => c.id === v) ? v : opt.default;
  }
  return out;
}

/** Apply a style's options (in declaration order) on top of its base tokens. */
export function resolveTokens(def: StyleDefinition, stored?: StyleOptionValues): StyleTokens {
  const values = effectiveOptionValues(def, stored);
  let tokens = def.tokens;
  for (const opt of def.options) {
    if (opt.kind === 'toggle') {
      tokens = deepMerge(tokens, values[opt.id] === true ? opt.on : opt.off);
    } else {
      const choice = opt.choices.find((c) => c.id === values[opt.id]);
      tokens = deepMerge(tokens, choice?.tokens);
    }
  }
  return tokens;
}

/** Tokens -> CSS custom properties. Pure. */
export function tokensToCssVars(t: StyleTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.fonts)) vars[`--sp-font-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(t.type)) {
    const unit = PX_TYPE_KEYS.has(k) ? 'px' : EM_TYPE_KEYS.has(k) ? 'em' : '';
    vars[`--sp-type-${kebab(k)}`] = `${v}${unit}`;
  }
  for (const [k, v] of Object.entries(t.colors)) vars[`--sp-color-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(t.syntax)) vars[`--sp-syntax-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(t.shape)) {
    vars[`--sp-shape-${kebab(k)}`] = RAW_SHAPE_KEYS.has(k) || typeof v !== 'number' ? String(v) : `${v}px`;
  }
  for (const [k, v] of Object.entries(t.effects)) {
    vars[`--sp-fx-${kebab(k)}`] = PX_FX_KEYS.has(k) ? `${v}px` : String(v);
  }
  return vars;
}

export function graphThemeFromTokens(t: StyleTokens): GraphTheme {
  return { ...t.graph, palette: [...t.graph.palette] };
}

function cssString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** @font-face rules for a style. `fontBase` is the URL prefix of the bundled fonts folder. */
export function fontFaceCss(faces: FontFaceDef[], fontBase: string): string {
  return faces
    .map((f) => {
      const format = f.file.endsWith('.woff2') ? 'woff2' : f.file.endsWith('.woff') ? 'woff' : 'truetype';
      const range = f.unicodeRange ? `unicode-range:${f.unicodeRange};` : '';
      return `@font-face{font-family:${cssString(f.family)};src:url(${cssString(fontBase + f.file)}) format("${format}");font-weight:${f.weight};font-style:${f.style};font-display:block;${range}}`;
    })
    .join('\n');
}

export interface AppliedStyle {
  def: StyleDefinition;
  tokens: StyleTokens;
  graphTheme: GraphTheme;
}

const FONT_STYLE_ID = 'sp-style-fonts';

/**
 * Apply a style to the live document: font faces, CSS variables, the
 * data-style attribute and effect flags. Returns the resolved tokens.
 */
export function applyStyle(def: StyleDefinition, stored: StyleOptionValues | undefined, doc: Document = document): AppliedStyle {
  const tokens = resolveTokens(def, stored);
  const root = doc.documentElement;

  let fontEl = doc.getElementById(FONT_STYLE_ID) as HTMLStyleElement | null;
  if (!fontEl) {
    fontEl = doc.createElement('style');
    fontEl.id = FONT_STYLE_ID;
    doc.head.appendChild(fontEl);
  }
  fontEl.textContent = fontFaceCss(def.fontFaces, 'fonts/');

  // Drop variables from the previous style, then set the new ones.
  for (const name of Array.from(root.style)) {
    if (name.startsWith('--sp-')) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(tokensToCssVars(tokens))) root.style.setProperty(name, value);

  root.dataset.style = def.id;
  root.style.colorScheme = tokens.chrome.colorScheme;
  const fx = tokens.effects;
  root.toggleAttribute('data-fx-scanlines', fx.scanlines > 0);
  root.toggleAttribute('data-fx-vignette', fx.vignette > 0 || fx.curvature > 0);
  root.toggleAttribute('data-fx-grain', fx.grain > 0);
  root.toggleAttribute('data-fx-glow', fx.textGlow !== 'none' && fx.textGlow !== '');
  // Pixel fonts (no smoothing) have one weight and no italic; a wide caret is drawn as a block.
  root.toggleAttribute('data-pixel-font', tokens.type.fontSmoothing === 'none');
  root.dataset.caret = tokens.shape.caretWidth >= 6 ? 'block' : 'bar';

  return { def, tokens, graphTheme: graphThemeFromTokens(tokens) };
}
