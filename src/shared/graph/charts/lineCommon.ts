/**
 * Shared helpers for the line and area renderers, plus the numeric extent
 * helper used by the scatter renderer. Pure, DOM-free and deterministic.
 */
import type { GraphBlock } from '../../model';
import {
  type BandScale,
  type Frame,
  type LegendItem,
  type LinearScale,
  bandScale,
  beginFrame,
  drawXBandAxis,
  drawYAxis,
  esc,
  formatNumber,
  linearScale,
  niceTicks,
  r,
  seriesColor,
} from '../layout';
import type { CategoryData, GraphTheme, Size } from '../types';

/** Series with more points than this get markers only where a point is isolated. */
export const MARKER_LIMIT = 60;

export interface Pt {
  x: number;
  y: number;
}

export interface CategoryChartOptions {
  /** Include zero in the y domain (area charts). */
  includeZero: boolean;
  /** Swatch shape used in the legend. */
  legendShape: LegendItem['shape'];
  /** Draw the x axis line at y = 0 instead of the bottom of the plot. */
  axisAtZero: boolean;
}

export interface CategoryChart {
  frame: Frame;
  band: BandScale;
  scale: LinearScale;
  /** Y grid, y tick labels and the x axis, already rendered. Drawn before the marks. */
  axes: string;
}

/** The value if it is a finite number, otherwise null. */
export function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** [min, max] of the values, or [0, 1] when there are none. */
export function extent(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = values[0]!;
  let hi = lo;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** Number of non-null values in a series. */
export function countPoints(values: readonly (number | null)[]): number {
  let n = 0;
  for (const v of values) if (finiteOrNull(v) !== null) n++;
  return n;
}

/**
 * Frame, category band, y scale and axes shared by the line and area charts.
 * The x band uses no padding so point i sits at band.center(i).
 */
export function categoryChart(
  graph: GraphBlock,
  data: CategoryData,
  theme: GraphTheme,
  size: Size,
  opts: CategoryChartOptions,
): CategoryChart {
  const present: number[] = [];
  for (const s of data.series) {
    for (const v of s.values) {
      const n = finiteOrNull(v);
      if (n !== null) present.push(n);
    }
  }
  const [lo, hi] = extent(present);
  const ticks = niceTicks(lo, hi, 5, opts.includeZero);
  const legend: LegendItem[] = data.series.map((s, i) => ({
    label: s.name,
    color: seriesColor(theme, i),
    shape: opts.legendShape,
  }));
  const frame = beginFrame(graph, theme, size, {
    legend,
    cartesian: true,
    yTickLabels: ticks.ticks.map((t) => formatNumber(t)),
    xTickLabels: data.categories,
  });
  const { plot } = frame;
  const band = bandScale(data.categories.length, plot.x, plot.x + plot.w, 0);
  const scale = linearScale(ticks.min, ticks.max, plot.y + plot.h, plot.y);
  const xAxisY = opts.axisAtZero ? scale(0) : undefined;
  const axes = drawYAxis(frame, theme, scale, ticks.ticks) + drawXBandAxis(frame, theme, band, data.categories, xAxisY);
  return { frame, band, scale, axes };
}

/** Pixel position of each value; null stays null so it breaks the line. */
export function seriesPoints(values: readonly (number | null)[], band: BandScale, scale: LinearScale): (Pt | null)[] {
  return values.map((v, i) => {
    const n = finiteOrNull(v);
    return n === null ? null : { x: band.center(i), y: scale(n) };
  });
}

/** Split points into runs of consecutive non-null points. */
export function runsOf(points: readonly (Pt | null)[]): Pt[][] {
  const runs: Pt[][] = [];
  let current: Pt[] | null = null;
  for (const p of points) {
    if (p === null) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [];
      runs.push(current);
    }
    current.push(p);
  }
  return runs;
}

/** "M x y L x y ..." for every run. Each run starts a new sub-path. */
export function linePathD(runs: readonly Pt[][]): string {
  return runs.map((run) => run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r(p.x)} ${r(p.y)}`).join(' ')).join(' ');
}

/** Closed outline from the baseline up to the points of one run and back down. */
export function areaPathD(run: readonly Pt[], baseY: number): string {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const b = r(baseY);
  const top = run.map((p) => `L ${r(p.x)} ${r(p.y)}`).join(' ');
  return `M ${r(first.x)} ${b} ${top} L ${r(last.x)} ${b} Z`;
}

export function lineElement(series: number, d: string, color: string, theme: GraphTheme): string {
  return (
    `<path class="sp-line" data-series="${series}" d="${d}" fill="none" stroke="${esc(color)}"` +
    ` stroke-width="${r(theme.lineWidth)}" stroke-linejoin="round" stroke-linecap="round"/>`
  );
}

export function areaElement(series: number, d: string, color: string, theme: GraphTheme): string {
  return `<path class="sp-area" data-series="${series}" d="${d}" fill="${esc(color)}" fill-opacity="${r(theme.areaOpacity)}" stroke="none"/>`;
}

/**
 * Point markers for one series. Every point is marked when `showAll` is set;
 * otherwise only isolated points (runs of length one) are, so they stay visible.
 */
export function pointMarkers(series: number, runs: readonly Pt[][], showAll: boolean, color: string, theme: GraphTheme): string {
  let out = '';
  for (const run of runs) {
    if (!showAll && run.length !== 1) continue;
    for (const p of run) {
      out +=
        `<circle class="sp-point" data-series="${series}" cx="${r(p.x)}" cy="${r(p.y)}"` +
        ` r="${r(theme.pointRadius)}" fill="${esc(color)}"/>`;
    }
  }
  return out;
}
