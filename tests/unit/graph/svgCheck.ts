/**
 * Minimal structural validation for SVG strings produced by chart renderers.
 * Not a full XML parser, but strict enough to catch unbalanced tags, unquoted
 * or unescaped attribute values, raw "<" / "&" in text, and NaN-style output.
 */
import { expect } from 'vitest';
import type { GraphBlock, GraphType } from '../../../src/shared/model';
import type { GraphTheme } from '../../../src/shared/graph/types';

export interface SvgElement {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: SvgElement[];
}

const NAME = /^[A-Za-z_][\w:.-]*/;

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|#x?[0-9a-fA-F]+);/g, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return _;
  });
}

function assertEscaped(raw: string, where: string): void {
  // any "&" must start a known entity; "<" can never appear in a text/attribute chunk
  const stripped = raw.replace(/&(amp|lt|gt|quot|#39|#x?[0-9a-fA-F]+);/g, '');
  if (stripped.includes('&') || stripped.includes('<')) {
    throw new Error(`Unescaped "&" or "<" in ${where}: ${raw.slice(0, 80)}`);
  }
}

/** Parse an SVG string into a tree; throws a descriptive Error when it is malformed. */
export function parseSvg(svg: string): SvgElement {
  let i = 0;
  const root: SvgElement = { tag: '#root', attrs: {}, text: '', children: [] };
  const stack: SvgElement[] = [root];
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    const chunk = lt < 0 ? svg.slice(i) : svg.slice(i, lt);
    if (chunk !== '') {
      assertEscaped(chunk, 'text');
      if (chunk.includes('>')) throw new Error(`Raw ">" in text: ${chunk.slice(0, 80)}`);
      stack[stack.length - 1]!.text += decodeEntities(chunk);
    }
    if (lt < 0) break;
    i = lt + 1;
    if (svg[i] === '/') {
      const end = svg.indexOf('>', i);
      if (end < 0) throw new Error('Unterminated closing tag');
      const name = svg.slice(i + 1, end).trim();
      const open = stack.pop();
      if (!open || open.tag !== name || stack.length === 0) throw new Error(`Mismatched closing tag </${name}> (open: ${open?.tag})`);
      i = end + 1;
      continue;
    }
    const m = NAME.exec(svg.slice(i));
    if (!m) throw new Error(`Bad tag at offset ${i}: ${svg.slice(i - 1, i + 30)}`);
    const el: SvgElement = { tag: m[0], attrs: {}, text: '', children: [] };
    i += m[0].length;
    for (;;) {
      while (svg[i] === ' ' || svg[i] === '\n' || svg[i] === '\t') i++;
      if (svg[i] === '>') {
        i++;
        stack[stack.length - 1]!.children.push(el);
        stack.push(el);
        break;
      }
      if (svg[i] === '/' && svg[i + 1] === '>') {
        i += 2;
        stack[stack.length - 1]!.children.push(el);
        break;
      }
      const am = NAME.exec(svg.slice(i));
      if (!am) throw new Error(`Bad attribute in <${el.tag}> at offset ${i}: ${svg.slice(i, i + 40)}`);
      i += am[0].length;
      if (svg[i] !== '=' || svg[i + 1] !== '"') throw new Error(`Attribute ${am[0]} in <${el.tag}> must be written as name="value"`);
      const close = svg.indexOf('"', i + 2);
      if (close < 0) throw new Error(`Unterminated attribute ${am[0]}`);
      const raw = svg.slice(i + 2, close);
      assertEscaped(raw, `attribute ${am[0]}`);
      if (am[0] in el.attrs) throw new Error(`Duplicate attribute ${am[0]} in <${el.tag}>`);
      el.attrs[am[0]] = decodeEntities(raw);
      i = close + 1;
    }
  }
  if (stack.length !== 1) throw new Error(`Unclosed tag <${stack[stack.length - 1]!.tag}>`);
  if (root.children.length !== 1 || root.children[0]!.tag !== 'svg') throw new Error('Expected exactly one <svg> root element');
  if (root.text.trim() !== '') throw new Error('Text outside the <svg> element');
  return root.children[0]!;
}

/** All descendant elements (depth first), optionally filtered by tag. */
export function findAll(el: SvgElement, tag?: string): SvgElement[] {
  const out: SvgElement[] = [];
  const walk = (e: SvgElement): void => {
    for (const c of e.children) {
      if (!tag || c.tag === tag) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** All text content in document order. */
export function allText(el: SvgElement): string[] {
  return findAll(el, 'text').map((t) => t.text);
}

const NUMERIC_ATTRS = ['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'font-size', 'opacity', 'fill-opacity', 'stroke-opacity'];

/**
 * Assert that `svg` is a well-formed standalone SVG document with sane
 * numbers, and return its parsed tree.
 */
export function expectValidSvg(svg: string): SvgElement {
  expect(typeof svg).toBe('string');
  expect(svg.startsWith('<svg ')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  expect(svg).not.toMatch(/NaN|undefined|Infinity|\[object|null/);
  const root = parseSvg(svg);
  expect(root.attrs.xmlns).toBe('http://www.w3.org/2000/svg');
  expect(Number(root.attrs.width)).toBeGreaterThan(0);
  expect(Number(root.attrs.height)).toBeGreaterThan(0);
  expect(root.attrs.viewBox).toMatch(/^0 0 [\d.]+ [\d.]+$/);
  for (const el of [root, ...findAll(root)]) {
    for (const name of NUMERIC_ATTRS) {
      const v = el.attrs[name];
      if (v === undefined) continue;
      expect(Number.isFinite(Number(v)), `<${el.tag} ${name}="${v}"> must be a finite number`).toBe(true);
    }
    for (const name of ['width', 'height', 'r']) {
      const v = el.attrs[name];
      if (v !== undefined) expect(Number(v), `<${el.tag} ${name}="${v}"> must not be negative`).toBeGreaterThanOrEqual(0);
    }
    if (el.tag === 'path') {
      expect(el.attrs.d, '<path> needs a d attribute').toBeDefined();
      expect(el.attrs.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE\s,.+-]+$/);
    }
    if (el.tag === 'polyline' || el.tag === 'polygon') {
      expect(el.attrs.points).toMatch(/^[0-9eE\s,.+-]+$/);
    }
  }
  return root;
}

/** A theme with unmistakable values, so tests can check that renderers use the theme. */
export const TEST_THEME: GraphTheme = {
  palette: ['#110001', '#220002', '#330003', '#440004', '#550005', '#660006', '#770007', '#880008'],
  background: '#fafafa',
  text: '#0a0b0c',
  textMuted: '#1a1b1c',
  axis: '#2a2b2c',
  grid: '#3a3b3c',
  fontFamily: 'Test Sans',
  titleFontFamily: 'Test Title',
  fontSize: 12,
  titleFontSize: 18,
  titleWeight: 700,
  lineWidth: 2.5,
  axisWidth: 1,
  gridWidth: 0.5,
  gridDash: '3 3',
  barRadius: 2,
  pointRadius: 4,
  areaOpacity: 0.3,
  sliceStroke: '#fefefe',
  sliceStrokeWidth: 1.5,
};

/** Build a normalised-looking GraphBlock for tests. */
export function makeGraph(chart: GraphType, columns: string[], rows: string[][], extra: Partial<GraphBlock> = {}): GraphBlock {
  return {
    type: 'graph',
    chart,
    title: 'Test graph',
    xLabel: 'X axis',
    yLabel: 'Y axis',
    legend: { show: true, position: 'bottom' },
    bins: 0,
    columns,
    rows,
    ...extra,
  };
}
