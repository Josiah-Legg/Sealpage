/**
 * Shared geometry for the bar-family renderers (bar, grouped bar, stacked bar,
 * histogram): the cartesian frame with axes, and the <rect class="sp-bar">
 * element. Pure and DOM-free like everything in src/shared/graph.
 */
import type { GraphBlock } from '../../model';
import {
  type BandScale,
  type Frame,
  type LegendItem,
  type LinearScale,
  beginFrame,
  bandScale,
  drawXBandAxis,
  drawYAxis,
  esc,
  formatNumber,
  linearScale,
  niceTicks,
  r,
} from '../layout';
import type { GraphTheme, Size } from '../types';

export interface CategoryChartLayout {
  frame: Frame;
  band: BandScale;
  y: LinearScale;
  /** Pixel y of the value zero (the baseline bars grow from). */
  zeroY: number;
  /** Axis fragments (y axis with grid, x axis on the zero baseline). Drawn before the marks. */
  axes: string;
}

/**
 * Frame, scales and axes for a category chart whose values span [lo, hi].
 * The y domain always includes zero, as the spec requires for bar-like charts.
 */
export function layoutCategoryChart(
  graph: GraphBlock,
  theme: GraphTheme,
  size: Size,
  categories: string[],
  lo: number,
  hi: number,
  legend: LegendItem[],
): CategoryChartLayout {
  const ticks = niceTicks(lo, hi, 5, true);
  const frame = beginFrame(graph, theme, size, {
    legend,
    cartesian: true,
    yTickLabels: ticks.ticks.map((t) => formatNumber(t)),
    xTickLabels: categories,
  });
  const { plot } = frame;
  const y = linearScale(ticks.min, ticks.max, plot.y + plot.h, plot.y);
  const band = bandScale(categories.length, plot.x, plot.x + plot.w, 0.25);
  const zeroY = y(0);
  const axes = drawYAxis(frame, theme, y, ticks.ticks) + drawXBandAxis(frame, theme, band, categories, zeroY);
  return { frame, band, y, zeroY, axes };
}

/** Corner radius for a bar of the given width: the theme radius, but never more than half the width. */
export function barCornerRadius(theme: GraphTheme, width: number): number {
  return Math.max(0, Math.min(theme.barRadius, width / 2));
}

/** Formats data attributes such as ` data-series="1" data-category="4"` from integer indices. */
export function dataAttrs(values: Record<string, number>): string {
  return Object.entries(values)
    .map(([name, v]) => ` data-${name}="${r(v)}"`)
    .join('');
}

export interface BarRectOptions {
  /** Left edge in px. */
  x: number;
  width: number;
  /** The two ends of the bar in px (any order); the rect spans the gap between them. */
  yA: number;
  yB: number;
  fill: string;
  rx: number;
  /** Pre-formatted data attributes from dataAttrs, or ''. */
  data: string;
  stroke?: { color: string; width: number };
}

/** A bar rectangle. Height is always non-negative, whichever way the bar grows. */
export function barRect(o: BarRectOptions): string {
  const width = Math.max(0, o.width);
  const top = Math.min(o.yA, o.yB);
  const height = Math.abs(o.yB - o.yA);
  const stroke = o.stroke ? ` stroke="${esc(o.stroke.color)}" stroke-width="${r(o.stroke.width)}"` : '';
  return `<rect class="sp-bar" x="${r(o.x)}" y="${r(top)}" width="${r(width)}" height="${r(height)}" rx="${r(o.rx)}" fill="${esc(o.fill)}"${stroke}${o.data}/>`;
}

/** Smallest and largest of the values, always including zero. Loops rather than spreads so long inputs are safe. */
export function extent(values: readonly number[]): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}
