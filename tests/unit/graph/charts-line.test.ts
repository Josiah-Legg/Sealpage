import { describe, it, expect } from 'vitest';
import { renderArea } from '../../../src/shared/graph/charts/area';
import { renderLine } from '../../../src/shared/graph/charts/line';
import { renderPie } from '../../../src/shared/graph/charts/pie';
import { renderScatter } from '../../../src/shared/graph/charts/scatter';
import { interpretGraph } from '../../../src/shared/graph/data';
import { formatNumber, niceTicks } from '../../../src/shared/graph/layout';
import type { CategoryData, GraphTheme, PieData, ScatterData, Size } from '../../../src/shared/graph/types';
import type { GraphBlock, LegendPosition } from '../../../src/shared/model';
import { TEST_THEME, allText, expectValidSvg, findAll, makeGraph, type SvgElement } from './svgCheck';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Kind = 'line' | 'area' | 'scatter' | 'pie';
const KINDS: Kind[] = ['line', 'area', 'scatter', 'pie'];
const SIZE: Size = { width: 720, height: 420 };

interface DataSet {
  columns: string[];
  rows: string[][];
}

function graphOf(kind: Kind, ds: DataSet, extra: Partial<GraphBlock> = {}): GraphBlock {
  return makeGraph(kind, ds.columns, ds.rows, extra);
}

function draw(kind: Kind, graph: GraphBlock, theme: GraphTheme = TEST_THEME, size: Size = SIZE): string {
  const data = interpretGraph(graph);
  switch (kind) {
    case 'line':
      return renderLine(graph, data as CategoryData, theme, size);
    case 'area':
      return renderArea(graph, data as CategoryData, theme, size);
    case 'scatter':
      return renderScatter(graph, data as ScatterData, theme, size);
    case 'pie':
      return renderPie(graph, data as PieData, theme, size);
  }
}

function render(kind: Kind, ds: DataSet, extra: Partial<GraphBlock> = {}, size: Size = SIZE, theme: GraphTheme = TEST_THEME) {
  const svg = draw(kind, graphOf(kind, ds, extra), theme, size);
  return { svg, root: expectValidSvg(svg) };
}

function byClass(root: SvgElement, tag: string, cls: string): SvgElement[] {
  return findAll(root, tag).filter((el) => el.attrs.class === cls);
}

function hasLegend(root: SvgElement): boolean {
  return findAll(root, 'g').some((g) => g.attrs.class === 'sp-graph-legend');
}

/** Sub-paths of a path `d` made of M/L/Z commands; each M starts a new one. */
function subpaths(d: string): { x: number; y: number }[][] {
  return d
    .split('M')
    .slice(1)
    .map((seg) => {
      const n = seg
        .replace(/[LZ]/g, ' ')
        .trim()
        .split(/\s+/)
        .map(Number);
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i]!, y: n[i + 1]! });
      return out;
    });
}

function percentLabels(root: SvgElement): string[] {
  return findAll(root, 'text')
    .filter((t) => t.attrs.class === 'sp-slice-label')
    .map((t) => t.text);
}

const labelFor = (kind: Kind, row: number): string => (kind === 'scatter' ? String(row + 1) : `Item ${row + 1}`);

/** Build a dataset: column 0 is the label (or x) column, then `series` value columns. */
function table(kind: Kind, series: number, n: number, cell: (row: number, col: number) => string): DataSet {
  const columns = [kind === 'scatter' ? 'X' : 'Label', ...Array.from({ length: series }, (_, i) => `Series ${i + 1}`)];
  const rows = Array.from({ length: n }, (_, row) =>
    Array.from({ length: series + 1 }, (_, col) => (col === 0 ? labelFor(kind, row) : cell(row, col))),
  );
  return { columns, rows };
}

const HOSTILE = ['<script>alert(1)</script>', 'a & b', '"quoted"', '😀 emoji', 'x'.repeat(300)];

type Variant = 'basic' | 'single' | 'equal' | 'negative' | 'huge' | 'tiny' | 'gaps' | 'long' | 'many' | 'hostile';

const VARIANTS: Record<Variant, (kind: Kind) => DataSet> = {
  basic: (k) => table(k, 2, 5, (r, c) => String((r + 1) * (c + 1))),
  single: (k) => table(k, 2, 1, (_r, c) => String(4 + c)),
  equal: (k) => table(k, 2, 4, () => '3'),
  negative: (k) => table(k, 2, 4, (r, c) => String(-(r + 1) * c)),
  huge: (k) => table(k, 2, 3, (r, c) => String((r + 1) * c * 1e12)),
  tiny: (k) => table(k, 2, 3, (r, c) => String((r + 1) * c * 1e-9)),
  gaps: (k) => table(k, 2, 6, (r, c) => ((r + c) % 3 === 0 ? '' : String(r * 2 + c + 1))),
  long: (k) => table(k, 1, 500, (r) => String((r % 7) + 1)),
  many: (k) => table(k, 12, 4, (r, c) => String(r + c)),
  hostile: (k) => {
    const ds = table(k, 3, HOSTILE.length, (r, c) => String(r + c + 1));
    return {
      columns: [k === 'scatter' ? 'X' : 'Label', HOSTILE[0]!, HOSTILE[1]!, HOSTILE[4]!],
      rows: ds.rows.map((row, r) => [k === 'scatter' ? row[0]! : HOSTILE[r]!, ...row.slice(1)]),
    };
  },
};

// ---------------------------------------------------------------------------
// Line
// ---------------------------------------------------------------------------

describe('renderLine', () => {
  it('draws one sp-line path per series in the series palette colour', () => {
    const { root } = render('line', VARIANTS.basic('line'));
    const lines = byClass(root, 'path', 'sp-line');
    expect(lines.map((p) => p.attrs['data-series'])).toEqual(['0', '1']);
    expect(lines[0]!.attrs.stroke).toBe(TEST_THEME.palette[0]);
    expect(lines[1]!.attrs.stroke).toBe(TEST_THEME.palette[1]);
    expect(lines[0]!.attrs.fill).toBe('none');
    expect(lines[0]!.attrs['stroke-width']).toBe(String(TEST_THEME.lineWidth));
  });

  it('places one marker per non-null value, tagged with its series', () => {
    const { root } = render('line', {
      columns: ['Label', 'A', 'B'],
      rows: [
        ['p', '1', '2'],
        ['q', '', '3'],
        ['s', '4', '5'],
      ],
    });
    const markers = byClass(root, 'circle', 'sp-point');
    expect(markers).toHaveLength(5);
    expect(markers.filter((m) => m.attrs['data-series'] === '0')).toHaveLength(2);
    expect(markers.filter((m) => m.attrs['data-series'] === '1')).toHaveLength(3);
  });

  it('draws a larger value higher up (smaller SVG y)', () => {
    const { root } = render('line', {
      columns: ['Label', 'A'],
      rows: [
        ['p', '1'],
        ['q', '9'],
        ['s', '4'],
      ],
    });
    const cy = byClass(root, 'circle', 'sp-point').map((m) => Number(m.attrs.cy));
    expect(cy[1]!).toBeLessThan(cy[2]!);
    expect(cy[2]!).toBeLessThan(cy[0]!);
  });

  it('connects points in increasing x order', () => {
    const { root } = render('line', VARIANTS.basic('line'));
    const [line] = byClass(root, 'path', 'sp-line');
    const xs = subpaths(line!.attrs.d!)[0]!.map((p) => p.x);
    expect(xs.length).toBe(5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it('a null in the middle breaks the line into separate sub-paths and leaves a gap', () => {
    const { root } = render('line', {
      columns: ['Label', 'A'],
      rows: [
        ['a', '1'],
        ['b', ''],
        ['c', '3'],
        ['d', '4'],
        ['e', ''],
        ['f', '6'],
      ],
    });
    const [line] = byClass(root, 'path', 'sp-line');
    const parts = subpaths(line!.attrs.d!);
    expect(parts.map((p) => p.length)).toEqual([1, 2, 1]);
    expect(line!.attrs.d!.match(/M/g)).toHaveLength(3);
    // Markers only on the four real values.
    expect(byClass(root, 'circle', 'sp-point')).toHaveLength(4);
  });

  it('shows markers only on isolated points for series longer than 60 points', () => {
    // Values on even rows only, so every value is isolated and keeps a marker.
    const ds = table('line', 1, 130, (r) => (r % 2 === 0 ? String(r + 1) : ''));
    const { root } = render('line', ds);
    expect(byClass(root, 'circle', 'sp-point')).toHaveLength(65);
  });

  it('draws no markers on a long unbroken series of 61 points, but does on 60', () => {
    const at60 = render('line', table('line', 1, 60, (r) => String(r + 1)));
    expect(byClass(at60.root, 'circle', 'sp-point')).toHaveLength(60);
    const at61 = render('line', table('line', 1, 61, (r) => String(r + 1)));
    expect(byClass(at61.root, 'circle', 'sp-point')).toHaveLength(0);
    expect(byClass(at61.root, 'path', 'sp-line')).toHaveLength(1);
  });

  it('a single category draws a one-point path and one marker', () => {
    const { root } = render('line', { columns: ['Label', 'A'], rows: [['Only', '7']] });
    const [line] = byClass(root, 'path', 'sp-line');
    expect(subpaths(line!.attrs.d!)).toHaveLength(1);
    expect(byClass(root, 'circle', 'sp-point')).toHaveLength(1);
  });

  it('a series with no numeric values draws no path', () => {
    const { root } = render('line', {
      columns: ['Label', 'A', 'B'],
      rows: [
        ['p', '1', 'x'],
        ['q', '2', 'y'],
      ],
    });
    expect(byClass(root, 'path', 'sp-line').map((p) => p.attrs['data-series'])).toEqual(['0']);
  });

  it('tick labels come from niceTicks over the non-null values', () => {
    const ds: DataSet = {
      columns: ['Label', 'A'],
      rows: [
        ['p', '3'],
        ['q', '17'],
        ['s', ''],
        ['t', '42'],
      ],
    };
    const { root } = render('line', ds);
    const ticks = niceTicks(3, 42, 5, false).ticks.map((t) => formatNumber(t));
    const texts = allText(root);
    for (const t of ticks) expect(texts).toContain(t);
  });
});

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

describe('renderArea', () => {
  it('draws every area before any line, one area per run and one line per series', () => {
    const { root } = render('area', {
      columns: ['Label', 'A', 'B'],
      rows: [
        ['p', '1', '2'],
        ['q', '', '3'],
        ['s', '4', '5'],
      ],
    });
    const paths = findAll(root, 'path');
    const areaIdx = paths.map((p, i) => (p.attrs.class === 'sp-area' ? i : -1)).filter((i) => i >= 0);
    const lineIdx = paths.map((p, i) => (p.attrs.class === 'sp-line' ? i : -1)).filter((i) => i >= 0);
    // Series A is split by the null into two runs; series B is one run.
    expect(areaIdx).toHaveLength(3);
    expect(lineIdx).toHaveLength(2);
    expect(Math.max(...areaIdx)).toBeLessThan(Math.min(...lineIdx));
  });

  it('closes each area down to a zero baseline below positive points', () => {
    const { root } = render('area', {
      columns: ['Label', 'A'],
      rows: [
        ['p', '4'],
        ['q', '6'],
        ['s', '5'],
      ],
    });
    const [area] = byClass(root, 'path', 'sp-area');
    expect(area!.attrs.d!.endsWith('Z')).toBe(true);
    const [outline] = subpaths(area!.attrs.d!);
    // First and last points sit on the baseline, which is lower on screen than the data.
    expect(outline![0]!.y).toBe(outline![outline!.length - 1]!.y);
    expect(outline![0]!.y).toBeGreaterThan(outline![1]!.y);
  });

  it('closes an all-negative area to a baseline above the points', () => {
    const { root } = render('area', {
      columns: ['Label', 'A'],
      rows: [
        ['p', '-4'],
        ['q', '-6'],
      ],
    });
    const [area] = byClass(root, 'path', 'sp-area');
    const [outline] = subpaths(area!.attrs.d!);
    expect(outline![0]!.y).toBeLessThan(outline![1]!.y);
  });

  it('a gap splits the area and the line into separate closed shapes and sub-paths', () => {
    const { root } = render('area', {
      columns: ['Label', 'A'],
      rows: [
        ['a', '1'],
        ['b', '2'],
        ['c', ''],
        ['d', '4'],
      ],
    });
    const areas = byClass(root, 'path', 'sp-area');
    expect(areas).toHaveLength(2);
    expect(areas.every((a) => a.attrs.d!.endsWith('Z'))).toBe(true);
    const [line] = byClass(root, 'path', 'sp-line');
    expect(subpaths(line!.attrs.d!).map((p) => p.length)).toEqual([2, 1]);
  });

  it('fills with the area opacity and no stroke', () => {
    const { root } = render('area', VARIANTS.basic('area'));
    for (const area of byClass(root, 'path', 'sp-area')) {
      expect(area.attrs['fill-opacity']).toBe(String(TEST_THEME.areaOpacity));
      expect(area.attrs.stroke).toBe('none');
      expect(area.attrs.fill).toBe(TEST_THEME.palette[Number(area.attrs['data-series'])]);
    }
  });

  it('keeps an isolated value visible with a marker', () => {
    const { root } = render('area', {
      columns: ['Label', 'A'],
      rows: [
        ['a', '1'],
        ['b', ''],
        ['c', '3'],
      ],
    });
    expect(byClass(root, 'circle', 'sp-point')).toHaveLength(2);
  });

  it('tick labels include zero, because the area domain starts at zero', () => {
    const { root } = render('area', {
      columns: ['Label', 'A'],
      rows: [
        ['p', '30'],
        ['q', '35'],
      ],
    });
    expect(allText(root)).toContain('0');
  });
});

// ---------------------------------------------------------------------------
// Scatter
// ---------------------------------------------------------------------------

describe('renderScatter', () => {
  const scatter2: DataSet = {
    columns: ['X', 'A', 'B'],
    rows: [
      ['1', '2', '5'],
      ['3', '4', ''],
      ['5', '', '6'],
    ],
  };

  it('draws one translucent circle per point, tagged with its series', () => {
    const { root } = render('scatter', scatter2);
    const dots = byClass(root, 'circle', 'sp-point');
    expect(dots).toHaveLength(4);
    expect(dots.filter((d) => d.attrs['data-series'] === '0')).toHaveLength(2);
    expect(dots.filter((d) => d.attrs['data-series'] === '1')).toHaveLength(2);
    for (const d of dots) {
      expect(d.attrs['fill-opacity']).toBe('0.85');
      expect(d.attrs.fill).toBe(TEST_THEME.palette[Number(d.attrs['data-series'])]);
      expect(d.attrs.r).toBe(String(TEST_THEME.pointRadius));
    }
  });

  it('larger x is further right and larger y is further up', () => {
    const { root } = render('scatter', {
      columns: ['X', 'A'],
      rows: [
        ['1', '1'],
        ['2', '4'],
        ['3', '9'],
        ['4', '16'],
      ],
    });
    const dots = byClass(root, 'circle', 'sp-point');
    const cx = dots.map((d) => Number(d.attrs.cx));
    const cy = dots.map((d) => Number(d.attrs.cy));
    for (let i = 1; i < dots.length; i++) {
      expect(cx[i]!).toBeGreaterThan(cx[i - 1]!);
      expect(cy[i]!).toBeLessThan(cy[i - 1]!);
    }
  });

  it('x and y are linear: equal steps in data give equal steps on the page', () => {
    const { root } = render('scatter', {
      columns: ['X', 'A'],
      rows: [
        ['0', '1'],
        ['1', '1'],
        ['2', '1'],
        ['3', '1'],
      ],
    });
    const cx = byClass(root, 'circle', 'sp-point').map((d) => Number(d.attrs.cx));
    const d1 = cx[1]! - cx[0]!;
    expect(cx[2]! - cx[1]!).toBeCloseTo(d1, 1);
    expect(cx[3]! - cx[2]!).toBeCloseTo(d1, 1);
  });

  it('legend swatches are dots, so non-point circles equal the series count', () => {
    const { root } = render('scatter', scatter2);
    const swatches = findAll(root, 'circle').filter((c) => c.attrs.class !== 'sp-point');
    expect(swatches).toHaveLength(2);
  });

  it('tick labels come from niceTicks over the data', () => {
    const { root } = render('scatter', scatter2);
    const texts = allText(root);
    for (const t of niceTicks(1, 5, 6, false).ticks) expect(texts).toContain(formatNumber(t));
  });
});

// ---------------------------------------------------------------------------
// Pie
// ---------------------------------------------------------------------------

describe('renderPie', () => {
  const pieRows = (values: number[]): DataSet => ({
    columns: ['Slice', 'Share'],
    rows: values.map((v, i) => [`S${i + 1}`, String(v)]),
  });

  it('draws one slice per value with its index, and the first starts at 12 o clock', () => {
    const { root } = render('pie', pieRows([1, 1, 2]));
    const slices = byClass(root, 'path', 'sp-slice');
    expect(slices.map((s) => s.attrs['data-slice'])).toEqual(['0', '1', '2']);
    expect(slices[0]!.attrs.stroke).toBe(TEST_THEME.sliceStroke);
    expect(slices[0]!.attrs['stroke-width']).toBe(String(TEST_THEME.sliceStrokeWidth));
    // "M cx cy L x1 y1 ...": x1 equals cx and y1 is above the centre.
    const [, cxS, cyS, , x1S, y1S] = slices[0]!.attrs.d!.split(' ');
    expect(Number(x1S)).toBeCloseTo(Number(cxS), 1);
    expect(Number(y1S)).toBeLessThan(Number(cyS));
  });

  it('slice shares are proportional to the values', () => {
    const { root } = render('pie', pieRows([1, 3]));
    expect(percentLabels(root)).toEqual(['25%', '75%']);
  });

  it('percentage labels sum to 100 when every slice is at least 5%', () => {
    const { root } = render('pie', pieRows([1, 2, 3, 4]));
    const labels = percentLabels(root);
    expect(labels).toEqual(['10%', '20%', '30%', '40%']);
    const total = labels.reduce((sum, l) => sum + parseInt(l, 10), 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(1);
  });

  it('slices under 5% get no label', () => {
    const { root } = render('pie', pieRows([1, 99]));
    expect(percentLabels(root)).toEqual(['99%']);
    expect(byClass(root, 'path', 'sp-slice')).toHaveLength(2);
  });

  it('a single slice is drawn as a full circle, labelled 100% at the centre', () => {
    const { root } = render('pie', pieRows([42]));
    expect(byClass(root, 'path', 'sp-slice')).toHaveLength(0);
    const [circle] = byClass(root, 'circle', 'sp-slice');
    expect(circle).toBeDefined();
    expect(circle!.attrs['data-slice']).toBe('0');
    const [label] = findAll(root, 'text').filter((t) => t.attrs.class === 'sp-slice-label');
    expect(label!.text).toBe('100%');
    expect(label!.attrs.x).toBe(circle!.attrs.cx);
    expect(label!.attrs.y).toBe(circle!.attrs.cy);
  });

  it('places a label at 62% of the radius along the middle angle', () => {
    const { root } = render('pie', pieRows([1, 1]));
    const [first] = byClass(root, 'path', 'sp-slice');
    const [cxS, cyS] = first!.attrs.d!.split(' ').slice(1, 3);
    const cx = Number(cxS);
    const cy = Number(cyS);
    const radius = Number(/A ([\d.]+) ([\d.]+)/.exec(first!.attrs.d!)![1]);
    const labels = findAll(root, 'text').filter((t) => t.attrs.class === 'sp-slice-label');
    // The first half-slice is centred on 3 o'clock; the second on 9 o'clock.
    expect(Number(labels[0]!.attrs.x)).toBeCloseTo(cx + 0.62 * radius, 1);
    expect(Number(labels[0]!.attrs.y)).toBeCloseTo(cy, 1);
    expect(Number(labels[1]!.attrs.x)).toBeCloseTo(cx - 0.62 * radius, 1);
  });

  it('hundreds of slices still validate, and none is large enough to label', () => {
    const values = Array.from({ length: 300 }, (_, i) => i + 1);
    const { root } = render('pie', pieRows(values));
    expect(byClass(root, 'path', 'sp-slice')).toHaveLength(300);
    expect(percentLabels(root)).toEqual([]);
  });

  it('slice colours cycle through the palette', () => {
    const { root } = render('pie', pieRows(Array.from({ length: 10 }, () => 1)));
    const slices = byClass(root, 'path', 'sp-slice');
    expect(slices[8]!.attrs.fill).toBe(TEST_THEME.palette[0]);
    expect(slices[9]!.attrs.fill).toBe(TEST_THEME.palette[1]);
  });

  it('the legend has one swatch per slice', () => {
    const { root } = render('pie', pieRows([1, 2, 3]));
    const legend = findAll(root, 'g').find((g) => g.attrs.class === 'sp-graph-legend');
    expect(legend).toBeDefined();
    expect(findAll(legend!, 'rect')).toHaveLength(3);
  });

  it('huge values do not overflow into NaN and still give shares', () => {
    const { root } = render('pie', pieRows([1e308, 1e308]));
    expect(percentLabels(root)).toEqual(['50%', '50%']);
  });

  it('tiny values give proportional shares', () => {
    const { root } = render('pie', pieRows([1e-9, 3e-9]));
    expect(percentLabels(root)).toEqual(['25%', '75%']);
  });
});

// ---------------------------------------------------------------------------
// Shared behaviour across all four renderers
// ---------------------------------------------------------------------------

describe.each(KINDS)('%s renderer: shared behaviour', (kind) => {
  it.each(Object.keys(VARIANTS) as Variant[])('produces valid SVG for the %s dataset', (variant) => {
    const { root } = render(kind, VARIANTS[variant](kind));
    expect(root.tag).toBe('svg');
  });

  it('uses only theme colours and the theme font', () => {
    const { root } = render(kind, VARIANTS.basic(kind));
    const allowed = new Set<string>([
      ...TEST_THEME.palette,
      TEST_THEME.background,
      TEST_THEME.text,
      TEST_THEME.textMuted,
      TEST_THEME.axis,
      TEST_THEME.grid,
      TEST_THEME.sliceStroke,
      'none',
    ]);
    for (const el of findAll(root)) {
      for (const name of ['fill', 'stroke']) {
        const v = el.attrs[name];
        if (v !== undefined) expect(allowed.has(v), `<${el.tag} ${name}="${v}">`).toBe(true);
      }
    }
    expect(root.attrs['font-family']).toBe(TEST_THEME.fontFamily);
  });

  it('takes its colours from a different theme', () => {
    const other: GraphTheme = { ...TEST_THEME, palette: ['#123456', '#654321', ...TEST_THEME.palette.slice(2)] };
    const svg = draw(kind, graphOf(kind, VARIANTS.basic(kind)), other);
    expect(svg).toContain('#123456');
    expect(svg).not.toContain(TEST_THEME.palette[0]!);
  });

  it('escapes and truncates hostile labels, and the SVG still validates', () => {
    const { svg, root } = render(kind, VARIANTS.hostile(kind), { title: '<b>"Bold" & co</b>' });
    expect(svg).not.toContain('<script');
    const texts = allText(root);
    expect(texts).toContain('<b>"Bold" & co</b>');
    expect(texts.some((t) => t.includes('<script>alert(1)</script>'))).toBe(true);
    expect(texts.some((t) => t.includes('a & b'))).toBe(true);
    expect(texts.some((t) => t.endsWith('…'))).toBe(true);
    expect(texts.every((t) => t.length < 300)).toBe(true);
  });

  it('omits the legend when it is hidden', () => {
    const { root } = render(kind, VARIANTS.basic(kind), { legend: { show: false, position: 'bottom' } });
    expect(hasLegend(root)).toBe(false);
  });

  it.each<LegendPosition>(['top', 'bottom', 'left', 'right'])('draws the legend at %s', (position) => {
    const { root } = render(kind, VARIANTS.basic(kind), { legend: { show: true, position } });
    expect(hasLegend(root)).toBe(true);
  });

  it('renders without a title or axis titles when they are empty', () => {
    const { root } = render(kind, VARIANTS.basic(kind), { title: '', xLabel: '', yLabel: '' });
    const titled = findAll(root, 'text').some(
      (t) => t.attrs.class === 'sp-graph-title' || t.attrs.class === 'sp-graph-axis-title',
    );
    expect(titled).toBe(false);
    expect(root.attrs['aria-label']).toBeUndefined();
  });

  it('keeps every marker inside the canvas, at small and large sizes', () => {
    for (const size of [
      { width: 160, height: 120 },
      { width: 1600, height: 1000 },
    ]) {
      const { root } = render(kind, VARIANTS.basic(kind), {}, size);
      expect(Number(root.attrs.width)).toBe(size.width);
      expect(Number(root.attrs.height)).toBe(size.height);
      for (const c of findAll(root, 'circle')) {
        if (c.attrs.cx === undefined) continue;
        expect(Number(c.attrs.cx)).toBeGreaterThanOrEqual(0);
        expect(Number(c.attrs.cx)).toBeLessThanOrEqual(size.width);
        expect(Number(c.attrs.cy)).toBeGreaterThanOrEqual(0);
        expect(Number(c.attrs.cy)).toBeLessThanOrEqual(size.height);
      }
    }
  });

  it('is deterministic: the same input gives the identical string', () => {
    const g = graphOf(kind, VARIANTS.gaps(kind));
    expect(draw(kind, g)).toBe(draw(kind, g));
    const h = graphOf(kind, VARIANTS.long(kind));
    expect(draw(kind, h)).toBe(draw(kind, h));
  });
});
