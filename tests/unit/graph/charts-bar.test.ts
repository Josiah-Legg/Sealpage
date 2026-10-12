/**
 * Tests for the bar-family chart renderers: bar, grouped bar, stacked bar and
 * histogram. Each test builds a graph from a table, renders it, then inspects
 * the resulting SVG tree (see ./svgCheck).
 */
import { describe, expect, it } from 'vitest';
import { renderBar } from '../../../src/shared/graph/charts/bar';
import { renderGroupedBar } from '../../../src/shared/graph/charts/groupedBar';
import { renderHistogram } from '../../../src/shared/graph/charts/histogram';
import { renderStackedBar } from '../../../src/shared/graph/charts/stackedBar';
import { interpretGraph } from '../../../src/shared/graph/data';
import { seriesColor } from '../../../src/shared/graph/layout';
import type { CategoryData, GraphTheme, HistogramData, Size } from '../../../src/shared/graph/types';
import type { GraphBlock, GraphType } from '../../../src/shared/model';
import { type SvgElement, allText, expectValidSvg, findAll, makeGraph, TEST_THEME } from './svgCheck';

const SIZE: Size = { width: 720, height: 420 };

/** A chart type under test, with a representative table and its renderer. */
interface Subject {
  name: string;
  chart: GraphType;
  columns: string[];
  rows: string[][];
  render: (graph: GraphBlock, theme: GraphTheme, size: Size) => string;
}

const asCategory = (g: GraphBlock): CategoryData => interpretGraph(g) as CategoryData;
const asHistogram = (g: GraphBlock): HistogramData => interpretGraph(g) as HistogramData;

const BAR: Subject = {
  name: 'bar',
  chart: 'bar',
  columns: ['Month', 'Sales', 'Costs'],
  rows: [
    ['Jan', '10', '4'],
    ['Feb', '5', '6'],
    ['Mar', '8', '7'],
  ],
  render: (g, t, s) => renderBar(g, asCategory(g), t, s),
};

const GROUPED: Subject = {
  name: 'grouped-bar',
  chart: 'grouped-bar',
  columns: ['Month', 'Sales', 'Costs'],
  rows: [
    ['Jan', '10', '4'],
    ['Feb', '5', '6'],
    ['Mar', '8', '7'],
  ],
  render: (g, t, s) => renderGroupedBar(g, asCategory(g), t, s),
};

const STACKED: Subject = {
  name: 'stacked-bar',
  chart: 'stacked-bar',
  columns: ['Month', 'Sales', 'Costs'],
  rows: [
    ['Jan', '10', '4'],
    ['Feb', '5', '6'],
    ['Mar', '8', '7'],
  ],
  render: (g, t, s) => renderStackedBar(g, asCategory(g), t, s),
};

const HISTOGRAM: Subject = {
  name: 'histogram',
  chart: 'histogram',
  columns: ['Value', 'Count'],
  rows: [
    ['a', '1'],
    ['b', '2'],
    ['c', '2'],
    ['d', '3'],
    ['e', '8'],
    ['f', '9'],
  ],
  render: (g, t, s) => renderHistogram(g, asHistogram(g), t, s),
};

const SUBJECTS: Subject[] = [BAR, GROUPED, STACKED, HISTOGRAM];

interface BuildOptions {
  columns?: string[];
  rows?: string[][];
  extra?: Partial<GraphBlock>;
  theme?: GraphTheme;
  size?: Size;
}

/** Render a subject and check the SVG is valid. */
function build(s: Subject, o: BuildOptions = {}): { svg: string; root: SvgElement } {
  const graph = makeGraph(s.chart, o.columns ?? s.columns, o.rows ?? s.rows, o.extra ?? {});
  const svg = s.render(graph, o.theme ?? TEST_THEME, o.size ?? SIZE);
  return { svg, root: expectValidSvg(svg) };
}

/** Bar rectangles (class sp-bar), in document order. */
function bars(root: SvgElement): SvgElement[] {
  return findAll(root, 'rect').filter((el) => el.attrs.class === 'sp-bar');
}

/** The single bar whose attributes match. */
function one(list: SvgElement[], want: Record<string, string>): SvgElement {
  const hits = list.filter((el) => Object.entries(want).every(([k, v]) => el.attrs[k] === v));
  expect(hits, `expected exactly one bar matching ${JSON.stringify(want)}`).toHaveLength(1);
  return hits[0]!;
}

const num = (el: SvgElement, attr: string): number => Number(el.attrs[attr]);
const bottom = (el: SvgElement): number => num(el, 'y') + num(el, 'height');

/** Legend swatches (rects inside the legend group) and their labels. */
function legend(root: SvgElement): { swatches: SvgElement[]; labels: string[] } {
  const groups = findAll(root, 'g').filter((g) => g.attrs.class === 'sp-graph-legend');
  const swatches = groups.flatMap((g) => g.children.filter((c) => c.tag === 'rect'));
  const labels = groups.flatMap((g) => g.children.filter((c) => c.tag === 'text').map((c) => c.text));
  return { swatches, labels };
}

/** Every fill and stroke value in the document. */
function paints(root: SvgElement): string[] {
  return [root, ...findAll(root)].flatMap((el) => [el.attrs.fill, el.attrs.stroke].filter((v): v is string => v !== undefined));
}

function allowedPaints(theme: GraphTheme = TEST_THEME): Set<string> {
  return new Set([
    ...theme.palette,
    theme.background,
    theme.text,
    theme.textMuted,
    theme.axis,
    theme.grid,
    theme.sliceStroke,
    'none',
  ]);
}

// ---------------------------------------------------------------------------
// Every renderer: shared contract
// ---------------------------------------------------------------------------

describe.each(SUBJECTS)('$name renderer: shared contract', (s) => {
  it('produces a valid standalone SVG that uses the theme font', () => {
    const { root } = build(s);
    expect(root.attrs['font-family']).toBe(TEST_THEME.fontFamily);
    expect(bars(root).length).toBeGreaterThan(0);
  });

  it('uses only colours from the theme', () => {
    const { root } = build(s);
    const allowed = allowedPaints();
    expect(paints(root).filter((c) => !allowed.has(c))).toEqual([]);
  });

  it('is deterministic', () => {
    expect(build(s).svg).toBe(build(s).svg);
  });

  it('escapes hostile labels and keeps the SVG valid', () => {
    const hostileLabels = ['<script>alert(1)</script>', 'a & b', '"quoted"', '😀 emoji', 'x'.repeat(300)];
    const rows = s.rows.map((row, i) => [hostileLabels[i % hostileLabels.length]!, ...row.slice(1)]);
    const seriesNames = ['a & b', '"quoted"', '😀 emoji', 'x'.repeat(300)];
    const columns = [hostileLabels[0]!, ...s.columns.slice(1).map((_, k) => seriesNames[k % seriesNames.length]!)];
    const { svg } = build(s, {
      columns,
      rows,
      extra: { title: '"quoted" & <b>bold</b>', xLabel: '<script>', yLabel: 'a & b' },
    });
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script');
    expect(svg).toContain('&amp;');
    expect(svg).not.toMatch(/x{300}/);
  });

  it('draws the legend in each position, and not at all when hidden', () => {
    for (const position of ['top', 'bottom', 'left', 'right'] as const) {
      const { root } = build(s, { extra: { legend: { show: true, position } } });
      expect(legend(root).swatches.length, position).toBeGreaterThan(0);
    }
    const hidden = build(s, { extra: { legend: { show: false, position: 'bottom' } } }).root;
    expect(legend(hidden).swatches).toHaveLength(0);
    expect(findAll(hidden, 'g').filter((g) => g.attrs.class === 'sp-graph-legend')).toHaveLength(0);
  });

  it('omits the title and axis titles when they are empty', () => {
    const { root } = build(s, { extra: { title: '', xLabel: '', yLabel: '' } });
    const titles = findAll(root, 'text').filter((t) => t.attrs.class === 'sp-graph-title' || t.attrs.class === 'sp-graph-axis-title');
    expect(titles).toHaveLength(0);
  });

  it('draws at the very small size and at a large size', () => {
    const small = build(s, { size: { width: 160, height: 120 } }).root;
    expect(small.attrs.width).toBe('160');
    expect(small.attrs.height).toBe('120');
    const large = build(s, { size: { width: 1600, height: 1000 } }).root;
    expect(large.attrs.width).toBe('1600');
  });

  it('handles a single category or value', () => {
    const { root } = build(s, { rows: [s.rows[0]!] });
    expect(bars(root).length).toBeGreaterThan(0);
  });

  it('handles very large (1e12) and very small (1e-9) values', () => {
    const rows = s.rows.map((row, i) => [row[0]!, i === 0 ? '1e12' : i === 1 ? '1e-9' : row[1]!, ...row.slice(2)]);
    const { root } = build(s, { rows });
    expect(bars(root).length).toBeGreaterThan(0);
  });

  it('handles 300 rows', () => {
    const rows = Array.from({ length: 300 }, (_, i) => [`R${i}`, ...s.columns.slice(1).map((_, k) => String((i + k) % 17))]);
    const { root } = build(s, { rows });
    expect(bars(root).length).toBeGreaterThan(0);
  });

  it('handles twelve series', () => {
    const columns = ['Label', ...Array.from({ length: 12 }, (_, k) => `Series ${k + 1}`)];
    const rows = [0, 1, 2].map((i) => ['L' + i, ...Array.from({ length: 12 }, (_, k) => String(i + k + 1))]);
    const { root } = build(s, { columns, rows });
    expect(bars(root).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// bar
// ---------------------------------------------------------------------------

describe('bar', () => {
  it('draws one bar per category, for the first series only', () => {
    const { root } = build(BAR);
    const all = bars(root);
    expect(all).toHaveLength(3);
    expect(all.every((el) => el.attrs['data-series'] === '0')).toBe(true);
    expect(all.map((el) => el.attrs['data-category'])).toEqual(['0', '1', '2']);
  });

  it('makes bar heights proportional to values', () => {
    const { root } = build(BAR, {
      rows: [
        ['A', '10', '0'],
        ['B', '5', '0'],
      ],
    });
    const [ten, five] = bars(root);
    expect(num(ten!, 'height')).toBeCloseTo(2 * num(five!, 'height'), 1);
  });

  it('grows bars from the zero baseline, and a negative bar extends downwards from it', () => {
    const { root } = build(BAR, {
      rows: [
        ['A', '10', '0'],
        ['B', '-4', '0'],
      ],
    });
    const [pos, neg] = bars(root);
    // the negative bar starts where the positive bar ends (the zero line) and goes down
    expect(num(neg!, 'y')).toBeCloseTo(bottom(pos!), 1);
    expect(bottom(neg!)).toBeGreaterThan(num(neg!, 'y'));
    expect(num(neg!, 'height') / num(pos!, 'height')).toBeCloseTo(0.4, 1);
  });

  it('draws only-negative values hanging from the top zero line', () => {
    const { root } = build(BAR, {
      rows: [
        ['A', '-2', '0'],
        ['B', '-6', '0'],
      ],
    });
    const [small, big] = bars(root);
    expect(num(small!, 'y')).toBeCloseTo(num(big!, 'y'), 2);
    expect(num(big!, 'height')).toBeCloseTo(3 * num(small!, 'height'), 1);
    expect(num(small!, 'height')).toBeGreaterThan(0);
  });

  it('draws no bar for blank or non-numeric cells', () => {
    const { root } = build(BAR, {
      rows: [
        ['A', '10', '0'],
        ['B', '', '0'],
        ['C', 'n/a', '0'],
        ['D', '5', '0'],
      ],
    });
    const all = bars(root);
    expect(all.map((el) => el.attrs['data-category'])).toEqual(['0', '3']);
  });

  it('draws a single category as a single bar', () => {
    const { root } = build(BAR, { rows: [['Only', '7', '1']] });
    expect(bars(root)).toHaveLength(1);
  });

  it('draws a single value of zero as a zero-height bar', () => {
    const { root } = build(BAR, { rows: [['Zero', '0', '1']] });
    const all = bars(root);
    expect(all).toHaveLength(1);
    expect(all[0]!.attrs.height).toBe('0');
  });

  it('scales huge values (1e12) proportionally', () => {
    const { root } = build(BAR, {
      rows: [
        ['A', '1e12', '0'],
        ['B', '5e11', '0'],
      ],
    });
    const [big, half] = bars(root);
    expect(num(big!, 'height')).toBeCloseTo(2 * num(half!, 'height'), 1);
  });

  it('scales tiny values (1e-9) proportionally', () => {
    const { root } = build(BAR, {
      rows: [
        ['A', '1e-9', '0'],
        ['B', '5e-10', '0'],
      ],
    });
    const [tiny, half] = bars(root);
    expect(num(tiny!, 'height')).toBeCloseTo(2 * num(half!, 'height'), 1);
  });

  it('draws 300 categories as 300 bars', () => {
    const rows = Array.from({ length: 300 }, (_, i) => [`C${i}`, String(i + 1), '0']);
    const { root } = build(BAR, { rows });
    expect(bars(root)).toHaveLength(300);
  });

  it('shows a legend item for the first series only', () => {
    const { root } = build(BAR);
    const { swatches, labels } = legend(root);
    expect(labels).toEqual(['Sales']);
    expect(swatches).toHaveLength(1);
    expect(swatches[0]!.attrs.fill).toBe(TEST_THEME.palette[0]);
  });

  it('uses the first palette colour for every bar', () => {
    const { root } = build(BAR);
    expect(bars(root).every((el) => el.attrs.fill === TEST_THEME.palette[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// grouped bar
// ---------------------------------------------------------------------------

describe('grouped-bar', () => {
  it('draws one bar per non-null value, with its series and category', () => {
    const { root } = build(GROUPED);
    const all = bars(root);
    expect(all).toHaveLength(6);
    for (const series of ['0', '1']) {
      for (const category of ['0', '1', '2']) {
        one(all, { 'data-series': series, 'data-category': category });
      }
    }
  });

  it('sits bars side by side within a category with a 1px gap', () => {
    const { root } = build(GROUPED, {
      columns: ['Cat', 'S1', 'S2', 'S3'],
      rows: [['A', '10', '4', '2']],
    });
    const [a, b, c] = bars(root);
    expect(num(a!, 'x') + num(a!, 'width') + 1).toBeCloseTo(num(b!, 'x'), 1);
    expect(num(b!, 'x') + num(b!, 'width') + 1).toBeCloseTo(num(c!, 'x'), 1);
    expect(num(a!, 'width')).toBeCloseTo(num(b!, 'width'), 1);
  });

  it('makes heights within a series proportional to values', () => {
    const { root } = build(GROUPED, {
      rows: [
        ['A', '10', '1'],
        ['B', '5', '1'],
      ],
    });
    const ten = one(bars(root), { 'data-series': '0', 'data-category': '0' });
    const five = one(bars(root), { 'data-series': '0', 'data-category': '1' });
    expect(num(ten, 'height')).toBeCloseTo(2 * num(five, 'height'), 1);
  });

  it('leaves a gap where a series has a null value', () => {
    const { root } = build(GROUPED, {
      rows: [
        ['A', '10', ''],
        ['B', '5', '6'],
      ],
    });
    const all = bars(root);
    expect(all).toHaveLength(3);
    expect(all.some((el) => el.attrs['data-series'] === '1' && el.attrs['data-category'] === '0')).toBe(false);
  });

  it('grows negative values downwards from the zero baseline', () => {
    const { root } = build(GROUPED, {
      rows: [['A', '10', '-5']],
    });
    const pos = one(bars(root), { 'data-series': '0' });
    const neg = one(bars(root), { 'data-series': '1' });
    expect(num(neg, 'y')).toBeCloseTo(bottom(pos), 1);
    expect(bottom(neg)).toBeGreaterThan(num(neg, 'y'));
  });

  it('colours each series with its palette entry, cycling the palette', () => {
    const columns = ['Label', ...Array.from({ length: 12 }, (_, k) => `S${k}`)];
    const rows = [['L', ...Array.from({ length: 12 }, (_, k) => String(k + 1))]];
    const { root } = build(GROUPED, { columns, rows });
    for (const el of bars(root)) {
      expect(el.attrs.fill).toBe(seriesColor(TEST_THEME, Number(el.attrs['data-series'])));
    }
    // twelve series over an eight-colour palette: series 8 reuses the first colour
    expect(one(bars(root), { 'data-series': '8' }).attrs.fill).toBe(TEST_THEME.palette[0]);
  });

  it('shows one legend item per series', () => {
    const { root } = build(GROUPED);
    const { swatches, labels } = legend(root);
    expect(labels).toEqual(['Sales', 'Costs']);
    expect(swatches.map((s) => s.attrs.fill)).toEqual([TEST_THEME.palette[0], TEST_THEME.palette[1]]);
  });
});

// ---------------------------------------------------------------------------
// stacked bar
// ---------------------------------------------------------------------------

describe('stacked-bar', () => {
  it('draws one segment per non-zero, non-null value', () => {
    const { root } = build(STACKED);
    const all = bars(root);
    expect(all).toHaveLength(6);
    expect(all.filter((el) => el.attrs['data-category'] === '1')).toHaveLength(2);
  });

  it('stacks positive segments upwards and adds their heights up', () => {
    const { root } = build(STACKED, { rows: [['A', '2', '3', '5']], columns: ['Cat', 'S1', 'S2', 'S3'] });
    const [a, b, c] = ['0', '1', '2'].map((s) => one(bars(root), { 'data-series': s }));
    // each segment sits on top of the one before it
    expect(num(a!, 'y') + num(a!, 'height')).toBeCloseTo(bottom(a!), 2);
    expect(bottom(b!)).toBeCloseTo(num(a!, 'y'), 1);
    expect(bottom(c!)).toBeCloseTo(num(b!, 'y'), 1);
    // heights are proportional to values: 2 : 3 : 5
    expect(num(b!, 'height') / num(a!, 'height')).toBeCloseTo(1.5, 1);
    expect(num(c!, 'height') / num(a!, 'height')).toBeCloseTo(2.5, 1);
  });

  it('stacks mixed signs in both directions from the zero line', () => {
    // 4 and 2 stack up from zero; -3 and -1 stack down from zero
    const { root } = build(STACKED, { rows: [['X', '4', '-3', '2', '-1']], columns: ['Cat', 'A', 'B', 'C', 'D'] });
    const a = one(bars(root), { 'data-series': '0' });
    const b = one(bars(root), { 'data-series': '1' });
    const c = one(bars(root), { 'data-series': '2' });
    const d = one(bars(root), { 'data-series': '3' });
    const zero = bottom(a);
    expect(num(b, 'y')).toBeCloseTo(zero, 1);
    expect(bottom(b)).toBeGreaterThan(zero);
    expect(bottom(c)).toBeCloseTo(num(a, 'y'), 1);
    expect(num(c, 'y')).toBeLessThan(num(a, 'y'));
    expect(num(d, 'y')).toBeCloseTo(bottom(b), 1);
    expect(bottom(d)).toBeGreaterThan(bottom(b));
  });

  it('stacks all-negative values downwards', () => {
    const { root } = build(STACKED, { rows: [['A', '-2', '-3']], columns: ['Cat', 'S1', 'S2'] });
    const first = one(bars(root), { 'data-series': '0' });
    const second = one(bars(root), { 'data-series': '1' });
    expect(num(second, 'y')).toBeCloseTo(bottom(first), 1);
    expect(num(second, 'height') / num(first, 'height')).toBeCloseTo(1.5, 1);
  });

  it('outlines every segment with the slice stroke, at most 1px wide', () => {
    const { root } = build(STACKED);
    for (const el of bars(root)) {
      expect(el.attrs.stroke).toBe(TEST_THEME.sliceStroke);
      expect(el.attrs['stroke-width']).toBe(String(Math.min(TEST_THEME.sliceStrokeWidth, 1)));
    }
  });

  it('draws nothing for null or zero values', () => {
    const { root } = build(STACKED, {
      rows: [
        ['A', '2', '', '0'],
        ['B', '', '4', '1'],
      ],
      columns: ['Cat', 'S1', 'S2', 'S3'],
    });
    const keys = bars(root).map((el) => `${el.attrs['data-category']}/${el.attrs['data-series']}`);
    expect(keys).toEqual(['0/0', '1/1', '1/2']);
  });

  it('draws no segments for a single value of zero, and the SVG is still valid', () => {
    const { root } = build(STACKED, { rows: [['A', '0', '0']] });
    expect(bars(root)).toHaveLength(0);
  });

  it('shows one legend item per series', () => {
    const { root } = build(STACKED);
    expect(legend(root).labels).toEqual(['Sales', 'Costs']);
  });
});

// ---------------------------------------------------------------------------
// histogram
// ---------------------------------------------------------------------------

describe('histogram', () => {
  // values 1, 2, 2, 3, 8, 9 in 4 bins over [1, 9]: counts 3, 1, 0, 2
  const FOUR_BIN_ROWS = [
    ['a', '1'],
    ['b', '2'],
    ['c', '2'],
    ['d', '3'],
    ['e', '8'],
    ['f', '9'],
  ];

  it('draws one bar per non-empty bin', () => {
    const { root } = build(HISTOGRAM, { rows: FOUR_BIN_ROWS, extra: { bins: 4 } });
    const all = bars(root);
    expect(all).toHaveLength(3);
    expect(all.map((el) => el.attrs['data-bin'])).toEqual(['0', '1', '3']);
  });

  it('places bars at increasing x positions', () => {
    const { root } = build(HISTOGRAM, { rows: FOUR_BIN_ROWS, extra: { bins: 4 } });
    const xs = bars(root).map((el) => num(el, 'x'));
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('respects a requested bin count', () => {
    const data = interpretGraph(makeGraph('histogram', HISTOGRAM.columns, FOUR_BIN_ROWS, { bins: 4 })) as HistogramData;
    expect(data.bins).toHaveLength(4);
    const seven = interpretGraph(makeGraph('histogram', HISTOGRAM.columns, FOUR_BIN_ROWS, { bins: 7 })) as HistogramData;
    expect(seven.bins).toHaveLength(7);
    build(HISTOGRAM, { rows: FOUR_BIN_ROWS, extra: { bins: 7 } });
  });

  it('makes bar heights proportional to counts', () => {
    const { root } = build(HISTOGRAM, { rows: FOUR_BIN_ROWS, extra: { bins: 4 } });
    const three = one(bars(root), { 'data-bin': '0' });
    const single = one(bars(root), { 'data-bin': '1' });
    expect(num(three, 'height')).toBeCloseTo(3 * num(single, 'height'), 1);
  });

  it('stacks two series within a bin, the second on top of the first', () => {
    const rows = [
      ['', '1', '2'],
      ['', '1', '2'],
      ['', '1', '2'],
      ['', '9', ''],
    ];
    const { root } = build(HISTOGRAM, { columns: ['Value', 'A', 'B'], rows, extra: { bins: 2 } });
    const a = one(bars(root), { 'data-series': '0', 'data-bin': '0' });
    const b = one(bars(root), { 'data-series': '1', 'data-bin': '0' });
    expect(bottom(b)).toBeCloseTo(num(a, 'y'), 1);
    expect(num(b, 'y')).toBeLessThan(num(a, 'y'));
    expect(bars(root)).toHaveLength(3);
  });

  it('labels the y axis with whole numbers only', () => {
    const rows = [
      ['', '1'],
      ['', '2'],
    ];
    const { root } = build(HISTOGRAM, { rows, extra: { bins: 2 } });
    const yLabels = findAll(root, 'text')
      .filter((t) => t.attrs['text-anchor'] === 'end')
      .map((t) => t.text);
    expect(yLabels).toEqual(['0', '1']);
  });

  it('draws a single distinct value as one bin', () => {
    const rows = [0, 1, 2, 3, 4].map((i) => [String.fromCharCode(97 + i), '7']);
    const { root } = build(HISTOGRAM, { rows });
    const all = bars(root);
    expect(all).toHaveLength(1);
    expect(all[0]!.attrs['data-bin']).toBe('0');
  });

  it('handles twenty bins with nice x ticks', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ['', String(i + 1)]);
    const { root } = build(HISTOGRAM, { rows, extra: { bins: 20 } });
    expect(bars(root).length).toBeGreaterThan(0);
    expect(allText(root).length).toBeGreaterThan(0);
  });

  it('shows one legend item per series', () => {
    const { root } = build(HISTOGRAM, { columns: ['Value', 'A', 'B'], rows: [['', '1', '2']] });
    expect(legend(root).labels).toEqual(['A', 'B']);
    const single = build(HISTOGRAM, { rows: FOUR_BIN_ROWS });
    expect(legend(single.root).labels).toEqual(['Count']);
  });
});
