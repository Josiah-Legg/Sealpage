/**
 * Graph data parsing: turns the string grid stored in a GraphBlock into typed,
 * numeric data for a chart type. Pure and total: never throws, reports
 * problems as human-readable warnings.
 */
import { type GraphBlock, MAX_BINS } from '../model';
import type { CategoryData, GraphData, HistogramData, PieData, ScatterData, Series } from './types';

/**
 * Parse one cell as a number.
 *
 * Accepts optional sign, digits with optional thousands separators (commas,
 * spaces, apostrophes, underscores), a decimal point, an exponent, a leading
 * currency symbol and a trailing percent sign ("12%" is 12, not 0.12).
 * Returns null for blank or non-numeric text and for non-finite results.
 */
export function parseNumber(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s === '') return null;
  // Unicode minus and friends
  s = s.replace(/[\u2212\u2012\u2013]/g, '-');
  let negative = false;
  // accounting style: (123) means -123
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1]!.trim();
  }
  // one optional sign, either before or after a currency symbol (never both)
  let signed = false;
  const takeSign = (): void => {
    if (signed) return;
    if (s.startsWith('-')) {
      negative = !negative;
      signed = true;
      s = s.slice(1).trim();
    } else if (s.startsWith('+')) {
      signed = true;
      s = s.slice(1).trim();
    }
  };
  takeSign();
  s = s.replace(/^[$£€¥]\s*/, '');
  takeSign();
  s = s.replace(/\s*%$/, '');
  // thousands separators are only valid between digits
  if (/^\d{1,3}(?:[, '_\u00A0\u202F]\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(s)) {
    s = s.replace(/[, '_\u00A0\u202F]/g, '');
  }
  if (!/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function seriesName(g: GraphBlock, col: number): string {
  const name = g.columns[col]?.trim() ?? '';
  return name === '' ? `Series ${col}` : name;
}

/** Rows that are entirely blank are ignored by every chart type. */
function nonBlankRows(g: GraphBlock): string[][] {
  return g.rows.filter((row) => row.some((cell) => cell.trim() !== ''));
}

function badCellWarning(count: number): string {
  return count === 1 ? '1 cell is not a number and was skipped.' : `${count} cells are not numbers and were skipped.`;
}

function interpretCategory(g: GraphBlock): CategoryData {
  const rows = nonBlankRows(g);
  const warnings: string[] = [];
  let bad = 0;
  const categories = rows.map((row, i) => {
    const label = row[0]!.trim();
    return label === '' ? String(i + 1) : label;
  });
  const series: Series[] = [];
  for (let c = 1; c < g.columns.length; c++) {
    const values = rows.map((row) => {
      const cell = row[c] ?? '';
      const n = parseNumber(cell);
      if (n === null && cell.trim() !== '') bad++;
      return n;
    });
    series.push({ name: seriesName(g, c), values });
  }
  if (bad > 0) warnings.push(badCellWarning(bad));
  if (g.chart === 'stacked-bar' && series.some((s) => s.values.some((v) => v !== null && v < 0))) {
    warnings.push('Stacked bars with negative values are stacked downwards from zero.');
  }
  return { kind: 'category', categories, series, warnings };
}

function interpretPie(g: GraphBlock): PieData {
  const rows = nonBlankRows(g);
  const warnings: string[] = [];
  const slices: { label: string; value: number }[] = [];
  let bad = 0;
  let nonPositive = 0;
  rows.forEach((row, i) => {
    const cell = row[1] ?? '';
    const n = parseNumber(cell);
    if (n === null) {
      if (cell.trim() !== '') bad++;
      return;
    }
    if (n <= 0) {
      nonPositive++;
      return;
    }
    const label = row[0]!.trim();
    slices.push({ label: label === '' ? String(i + 1) : label, value: n });
  });
  if (bad > 0) warnings.push(badCellWarning(bad));
  if (nonPositive > 0) warnings.push('Zero and negative values cannot be shown in a pie chart and were skipped.');
  if (g.columns.length > 2) warnings.push('A pie chart uses only the first data series.');
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return { kind: 'pie', slices, total, warnings };
}

function interpretScatter(g: GraphBlock): ScatterData {
  const rows = nonBlankRows(g);
  const warnings: string[] = [];
  let bad = 0;
  const series: ScatterData['series'] = [];
  for (let c = 1; c < g.columns.length; c++) {
    const points: { x: number; y: number }[] = [];
    for (const row of rows) {
      const xs = row[0] ?? '';
      const ys = row[c] ?? '';
      if (ys.trim() === '') continue;
      const x = parseNumber(xs);
      const y = parseNumber(ys);
      if (x === null || y === null) {
        bad++;
        continue;
      }
      points.push({ x, y });
    }
    series.push({ name: seriesName(g, c), points });
  }
  if (bad > 0) {
    warnings.push(
      bad === 1 ? '1 point has a non-numeric coordinate and was skipped.' : `${bad} points have a non-numeric coordinate and were skipped.`,
    );
  }
  return { kind: 'scatter', series, warnings };
}

/** Values beyond this magnitude are clamped before binning. */
const HISTOGRAM_LIMIT = 1e300;

/** Sturges' rule, clamped to a sensible range. */
export function autoBinCount(n: number): number {
  if (n <= 1) return 1;
  return Math.max(1, Math.min(50, Math.ceil(Math.log2(n)) + 1));
}

function interpretHistogram(g: GraphBlock): HistogramData {
  const rows = nonBlankRows(g);
  const warnings: string[] = [];
  let bad = 0;
  const seriesNames: string[] = [];
  const perSeries: number[][] = [];
  for (let c = 1; c < g.columns.length; c++) {
    const values: number[] = [];
    for (const row of rows) {
      const cell = row[c] ?? '';
      const n = parseNumber(cell);
      if (n === null) {
        if (cell.trim() !== '') bad++;
      } else {
        // keep (max - min) representable so bin widths stay finite
        values.push(Math.max(-HISTOGRAM_LIMIT, Math.min(HISTOGRAM_LIMIT, n)));
      }
    }
    seriesNames.push(seriesName(g, c));
    perSeries.push(values);
  }
  if (bad > 0) warnings.push(badCellWarning(bad));
  const all = perSeries.flat();
  const count = all.length;
  if (count === 0) return { kind: 'histogram', bins: [], seriesNames, count: 0, warnings };

  let min = all[0]!;
  let max = all[0]!;
  for (const v of all) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const allSame = min === max;
  if (allSame) {
    // A single distinct value: one unit-wide bin centred on it.
    min -= 0.5;
    max += 0.5;
  }
  const requested = Math.min(MAX_BINS, Math.max(0, Math.trunc(g.bins)));
  const binCount = requested > 0 ? requested : allSame ? 1 : autoBinCount(count);
  const width = (max - min) / binCount;
  const bins: HistogramData['bins'] = Array.from({ length: binCount }, (_, i) => ({
    x0: min + i * width,
    x1: i === binCount - 1 ? max : min + (i + 1) * width,
    counts: perSeries.map(() => 0),
  }));
  perSeries.forEach((values, s) => {
    for (const v of values) {
      let idx = Math.floor((v - min) / width);
      if (idx >= binCount) idx = binCount - 1; // the top edge belongs to the last bin
      if (idx < 0) idx = 0;
      bins[idx]!.counts[s]!++;
    }
  });
  return { kind: 'histogram', bins, seriesNames, count, warnings };
}

/** Interpret a graph's data table for its chart type. */
export function interpretGraph(g: GraphBlock): GraphData {
  switch (g.chart) {
    case 'pie':
      return interpretPie(g);
    case 'scatter':
      return interpretScatter(g);
    case 'histogram':
      return interpretHistogram(g);
    default:
      return interpretCategory(g);
  }
}
