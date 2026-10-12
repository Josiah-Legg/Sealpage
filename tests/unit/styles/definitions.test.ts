/**
 * Acceptance checks that every style definition must pass: complete tokens,
 * valid colours, bundled fonts present, readable contrast, resolvable options.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTokens, tokensToCssVars, graphThemeFromTokens, effectiveOptionValues } from '../../../src/renderer/styles/apply';
import { allStyles, getStyle, DEFAULT_STYLE_ID } from '../../../src/renderer/styles/registry';
import type { StyleDefinition, StyleOptionValues, StyleTokens } from '../../../src/renderer/styles/schema';

type RGBA = [number, number, number, number];

function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const hex = m[1]!;
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split('').map((c) => parseInt(c + c, 16));
      return [r!, g!, b!, a === undefined ? 1 : a / 255];
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  return null;
}

function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function luminance([r, g, b]: RGBA): number {
  const f = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio of `fg` drawn on `bg` (both composited over `base` if translucent). */
function contrast(fg: string, bg: string, base: string): number {
  const baseC = parseColor(base)!;
  const bgC = over(parseColor(bg)!, baseC);
  const fgC = over(parseColor(fg)!, bgC);
  const a = luminance(fgC);
  const b = luminance(bgC);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const KEYWORD_OK: Record<string, string[]> = {
  selectionText: ['inherit'],
  quoteBg: ['transparent'],
  tableStripeBg: ['transparent'],
  scrollbarTrack: ['transparent'],
};

function keyShape(v: unknown): unknown {
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, keyShape((v as Record<string, unknown>)[k])]));
  }
  return typeof v;
}

/** Every combination of option values for a style. */
function optionCombos(def: StyleDefinition): StyleOptionValues[] {
  let combos: StyleOptionValues[] = [{}];
  for (const opt of def.options) {
    const values: (boolean | string)[] = opt.kind === 'toggle' ? [true, false] : opt.choices.map((c) => c.id);
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [opt.id]: v })));
  }
  return combos;
}

function checkTokens(t: StyleTokens, label: string): void {
  const base = t.colors.appBg;
  expect(parseColor(base), `${label}: appBg must be an opaque colour`).not.toBeNull();
  expect(parseColor(base)![3], `${label}: appBg must be opaque`).toBe(1);
  expect(parseColor(t.colors.editorBg)?.[3], `${label}: editorBg must be opaque`).toBe(1);

  for (const [k, v] of Object.entries(t.colors)) {
    if (KEYWORD_OK[k]?.includes(v)) continue;
    expect(parseColor(v), `${label}: colors.${k} = "${v}" is not a #hex or rgb()/rgba() colour`).not.toBeNull();
  }
  for (const [k, v] of Object.entries(t.syntax)) {
    expect(parseColor(v), `${label}: syntax.${k} = "${v}"`).not.toBeNull();
  }
  for (const k of ['text', 'textMuted', 'axis', 'grid', 'sliceStroke'] as const) {
    expect(parseColor(t.graph[k]), `${label}: graph.${k} = "${t.graph[k]}"`).not.toBeNull();
  }
  expect(t.graph.background === 'transparent' || parseColor(t.graph.background) !== null).toBe(true);
  expect(t.graph.palette.length, `${label}: graph palette needs at least 8 colours`).toBeGreaterThanOrEqual(8);
  expect(new Set(t.graph.palette.map((c) => c.toLowerCase())).size, `${label}: graph palette colours must be distinct`).toBe(t.graph.palette.length);
  for (const c of t.graph.palette) expect(parseColor(c), `${label}: palette colour "${c}"`).not.toBeNull();

  expect(t.chrome.titleBarColor, `${label}: chrome.titleBarColor`).toMatch(/^#[0-9a-fA-F]{6}$/);
  expect(t.chrome.titleBarSymbolColor, `${label}: chrome.titleBarSymbolColor`).toMatch(/^#[0-9a-fA-F]{6}$/);

  const c = t.colors;
  const pairs: [string, string, string, number][] = [
    ['text', c.text, c.editorBg, 7],
    ['heading', c.heading, c.editorBg, 4.5],
    ['textMuted', c.textMuted, c.editorBg, 4.5],
    ['textFaint', c.textFaint, c.editorBg, 2.5],
    ['link', c.link, c.editorBg, 4.5],
    ['text on surface', c.text, c.surface, 7],
    ['textMuted on surface', c.textMuted, c.surface, 4.5],
    ['text on surfaceRaised', c.text, c.surfaceRaised, 7],
    ['text on surfaceHover', c.text, c.surfaceHover, 4.5],
    ['text on surfaceActive', c.text, c.surfaceActive, 4.5],
    ['text on inputBg', c.text, c.inputBg, 7],
    ['chromeText', c.chromeText, c.chromeBg, 7],
    ['chromeTextMuted', c.chromeTextMuted, c.chromeBg, 4],
    ['accentText on accent', c.accentText, c.accent, 4.5],
    ['accent on editorBg', c.accent, c.editorBg, 3],
    ['dangerText on danger', c.dangerText, c.danger, 4.5],
    ['codeText', c.codeText, c.codeBg, 7],
    ['inlineCodeText', c.inlineCodeText, c.inlineCodeBg, 4.5],
    ['quoteText', c.quoteText, c.quoteBg === 'transparent' ? c.editorBg : c.quoteBg, 4.5],
    ['tableHeaderText', c.tableHeaderText, c.tableHeaderBg, 4.5],
    ['checkboxCheck', c.checkboxCheck, c.checkboxCheckedBg, 3],
    ['checkedText', c.checkedText, c.editorBg, 3],
    ['caret', c.caret, c.editorBg, 3],
    ['graph text', t.graph.text, c.editorBg, 4.5],
    ['graph textMuted', t.graph.textMuted, c.editorBg, 4],
    ['title bar symbols', t.chrome.titleBarSymbolColor, t.chrome.titleBarColor, 4.5],
  ];
  for (const [name, fg, bg, min] of pairs) {
    const ratio = contrast(fg, bg, c.editorBg);
    expect(ratio, `${label}: contrast of ${name} (${fg} on ${bg}) is ${ratio.toFixed(2)}, needs >= ${min}`).toBeGreaterThanOrEqual(min);
  }
  for (const [k, v] of Object.entries(t.syntax)) {
    const ratio = contrast(v, c.codeBg, c.editorBg);
    expect(ratio, `${label}: syntax.${k} (${v}) on codeBg is ${ratio.toFixed(2)}, needs >= 3`).toBeGreaterThanOrEqual(3);
  }
  t.graph.palette.forEach((p, i) => {
    const ratio = contrast(p, c.editorBg, c.editorBg);
    expect(ratio, `${label}: graph palette[${i}] (${p}) on editorBg is ${ratio.toFixed(2)}, needs >= 2.2`).toBeGreaterThanOrEqual(2.2);
  });
  // selected text must stay readable
  const selBg = c.selectionBg;
  const selText = c.selectionText === 'inherit' ? c.text : c.selectionText;
  expect(contrast(selText, selBg, c.editorBg), `${label}: text inside a selection`).toBeGreaterThanOrEqual(4.5);

  // numeric sanity
  expect(t.type.baseSize).toBeGreaterThanOrEqual(13);
  expect(t.type.baseSize).toBeLessThanOrEqual(24);
  expect(t.type.uiSize).toBeGreaterThanOrEqual(12);
  expect(t.type.uiSize).toBeLessThanOrEqual(20);
  expect(t.type.lineHeight).toBeGreaterThanOrEqual(1.2);
  expect(t.type.lineHeight).toBeLessThanOrEqual(2);
  expect(t.type.contentWidth).toBeGreaterThanOrEqual(560);
  expect(t.type.contentWidth).toBeLessThanOrEqual(1000);
  expect(t.type.titleSize).toBeGreaterThanOrEqual(t.type.h1Size);
  expect(t.type.h1Size).toBeGreaterThanOrEqual(t.type.h2Size);
  expect(t.type.h2Size).toBeGreaterThanOrEqual(t.type.h3Size);
  expect(t.type.h3Size).toBeGreaterThanOrEqual(1);
  for (const k of ['scanlines', 'vignette', 'curvature', 'grain'] as const) {
    expect(t.effects[k]).toBeGreaterThanOrEqual(0);
    expect(t.effects[k]).toBeLessThanOrEqual(1);
  }
  expect(t.graph.fontSize).toBeGreaterThanOrEqual(10);
  expect(t.graph.lineWidth).toBeGreaterThan(0);
}

describe('style registry', () => {
  const styles = allStyles();

  it('contains the four required styles with unique ids, in order', () => {
    const ids = styles.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['paper', 'dark-serif', 'terminal', 'warm-grey']) expect(ids).toContain(id);
    for (const s of styles) {
      expect(s.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.name.trim()).not.toBe('');
      expect(s.description.trim()).not.toBe('');
    }
  });

  it('defaults to Warm Grey and falls back to it for unknown ids', () => {
    expect(DEFAULT_STYLE_ID).toBe('warm-grey');
    expect(getStyle(undefined).id).toBe('warm-grey');
    expect(getStyle('no-such-style').id).toBe('warm-grey');
    expect(getStyle('paper').id).toBe('paper');
  });
});

describe.each(allStyles().map((s) => [s.id, s] as const))('style "%s"', (_id, def) => {
  it('bundles every font file it references', () => {
    expect(def.fontFaces.length).toBeGreaterThan(0);
    for (const face of def.fontFaces) {
      expect(existsSync(join(process.cwd(), 'assets', 'fonts', face.file)), `missing font file assets/fonts/${face.file}`).toBe(true);
      expect(face.family.trim()).not.toBe('');
    }
    // each font stack starts with a bundled family
    const families = new Set(def.fontFaces.map((f) => f.family));
    for (const [role, stack] of Object.entries(def.tokens.fonts)) {
      const first = stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
      expect(families.has(first), `fonts.${role} starts with "${first}", which is not one of the style's bundled font faces`).toBe(true);
    }
  });

  it('has complete, valid, readable tokens for every combination of options', () => {
    const baseShape = keyShape(def.tokens);
    const combos = optionCombos(def);
    expect(combos.length).toBeGreaterThan(0);
    for (const values of combos) {
      const tokens = resolveTokens(def, values);
      const label = `${def.id} ${JSON.stringify(values)}`;
      expect(keyShape(tokens), `${label}: options must not add or remove tokens`).toEqual(baseShape);
      checkTokens(tokens, label);
      const vars = tokensToCssVars(tokens);
      for (const [name, value] of Object.entries(vars)) {
        expect(name.startsWith('--sp-')).toBe(true);
        expect(value, `${label}: ${name}`).not.toMatch(/undefined|NaN|\[object/);
        expect(value.trim(), `${label}: ${name} is empty`).not.toBe('');
      }
      expect(graphThemeFromTokens(tokens).palette.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('has well-formed options whose defaults are valid', () => {
    const ids = def.options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const opt of def.options) {
      expect(opt.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(opt.label.trim()).not.toBe('');
      if (opt.kind === 'choice') {
        expect(opt.choices.length).toBeGreaterThanOrEqual(2);
        expect(opt.choices.map((c) => c.id)).toContain(opt.default);
      }
    }
    const eff = effectiveOptionValues(def, { nonsense: true, ...(def.options[0] ? { [def.options[0].id]: 12345 as unknown as string } : {}) });
    for (const opt of def.options) expect(eff[opt.id]).toBe(opt.default);
  });
});

describe('required style characteristics', () => {
  const tokens = (id: string): StyleTokens => resolveTokens(getStyle(id));

  it('Warm Grey: #151515 base, warm (not cool) greys, Inter', () => {
    const t = tokens('warm-grey');
    expect(t.colors.appBg.toLowerCase()).toBe('#151515');
    expect(t.chrome.colorScheme).toBe('dark');
    expect(t.fonts.body).toMatch(/^"?Inter"?/);
    // warm tint: red channel >= blue channel on the neutral surfaces and text
    for (const k of ['surface', 'surfaceRaised', 'surfaceHover', 'surfaceActive', 'border', 'borderStrong', 'text', 'textMuted', 'textFaint'] as const) {
      const [r, , b] = parseColor(t.colors[k])!;
      expect(r, `warm-grey colors.${k} (${t.colors[k]}) should have a warm undertone (red > blue)`).toBeGreaterThan(b);
    }
  });

  it('Paper: light and warm, Bricolage Grotesque', () => {
    const t = tokens('paper');
    expect(t.chrome.colorScheme).toBe('light');
    expect(t.fonts.body).toMatch(/Bricolage Grotesque/);
    expect(t.fonts.heading).toMatch(/Bricolage Grotesque/);
    const [r, , b] = parseColor(t.colors.editorBg)!;
    expect(luminance(parseColor(t.colors.editorBg)!)).toBeGreaterThan(0.7);
    expect(r).toBeGreaterThan(b);
  });

  it('Dark Serif: cool ink background, cream text, Young Serif headings, clearly different from Warm Grey', () => {
    const t = tokens('dark-serif');
    const w = tokens('warm-grey');
    expect(t.chrome.colorScheme).toBe('dark');
    expect(t.fonts.heading).toMatch(/Young Serif/);
    expect(t.fonts.body).not.toMatch(/^"?Inter"?/);
    const [r, , b] = parseColor(t.colors.editorBg)!;
    expect(b, 'dark-serif editorBg should be cool tinted (blue > red)').toBeGreaterThan(r);
    const [tr, , tb] = parseColor(t.colors.text)!;
    expect(tr, 'dark-serif text should be cream (red > blue)').toBeGreaterThan(tb);
    expect(t.colors.accent.toLowerCase()).not.toBe(w.colors.accent.toLowerCase());
    expect(t.colors.editorBg.toLowerCase()).not.toBe(w.colors.editorBg.toLowerCase());
  });

  it('Terminal: Glass TTY VT220, near-black, CRT effect is a toggle that fully switches off', () => {
    const def = getStyle('terminal');
    const crt = def.options.find((o) => o.kind === 'toggle' && /crt/i.test(o.id));
    expect(crt, 'terminal needs a toggle option whose id contains "crt"').toBeDefined();
    const on = resolveTokens(def, { [crt!.id]: true });
    const off = resolveTokens(def, { [crt!.id]: false });
    expect(on.fonts.body).toMatch(/Glass TTY VT220/);
    expect(on.type.fontSmoothing).toBe('none');
    expect(luminance(parseColor(on.colors.editorBg)!)).toBeLessThan(0.02);
    expect(on.effects.scanlines).toBeGreaterThan(0);
    expect(on.effects.scanlines).toBeLessThanOrEqual(0.25);
    expect(on.effects.vignette + on.effects.curvature).toBeGreaterThan(0);
    expect(on.effects.textGlow).not.toBe('none');
    expect(off.effects.scanlines).toBe(0);
    expect(off.effects.vignette).toBe(0);
    expect(off.effects.curvature).toBe(0);
    expect(off.effects.textGlow).toBe('none');
  });
});
