/**
 * Graph schema: the theme a graph is drawn with, the typed data a chart
 * renderer receives, and the renderer signature.
 *
 * A graph is stored in the document as a GraphBlock (src/shared/model.ts): a
 * chart type, labels, legend settings and a grid of strings. `interpretGraph`
 * (./data.ts) turns that grid into one of the typed shapes below; a chart
 * renderer (./charts/*.ts) turns typed data into an SVG string.
 *
 * Everything here is pure and DOM-free so it runs in Node tests and in the
 * renderer process alike.
 */
import type { GraphBlock } from '../model';

/** Visual parameters for graphs. Derived from the active style, never stored in a document. */
export interface GraphTheme {
  /** Series colours, used in order and cycled. At least 8 entries. */
  palette: string[];
  /** Plot background, or 'transparent'. */
  background: string;
  /** Title and legend text. */
  text: string;
  /** Tick labels and axis titles. */
  textMuted: string;
  /** Axis lines and tick marks. */
  axis: string;
  /** Grid lines. */
  grid: string;
  fontFamily: string;
  titleFontFamily: string;
  /** Base font size in px (tick labels, legend). */
  fontSize: number;
  titleFontSize: number;
  titleWeight: number;
  /** Stroke width of line / area / scatter outlines. */
  lineWidth: number;
  axisWidth: number;
  gridWidth: number;
  /** SVG stroke-dasharray for grid lines, '' for solid. */
  gridDash: string;
  /** Corner radius of bars in px. */
  barRadius: number;
  /** Radius of point markers in px. */
  pointRadius: number;
  /** Fill opacity of area charts, 0..1. */
  areaOpacity: number;
  /** Stroke drawn between pie slices and around bars (usually the page background). */
  sliceStroke: string;
  sliceStrokeWidth: number;
}

export interface Size {
  width: number;
  height: number;
}

export const DEFAULT_GRAPH_SIZE: Size = { width: 720, height: 420 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Typed data produced by interpretGraph
// ---------------------------------------------------------------------------

export interface Series {
  name: string;
  /** One entry per category; null marks a missing or non-numeric cell. */
  values: (number | null)[];
}

/** bar, grouped-bar, stacked-bar, line, area */
export interface CategoryData {
  kind: 'category';
  categories: string[];
  series: Series[];
  warnings: string[];
}

/** pie: first series only, positive values only */
export interface PieData {
  kind: 'pie';
  slices: { label: string; value: number }[];
  total: number;
  warnings: string[];
}

/** scatter: column 0 is x, every other column is a y series */
export interface ScatterData {
  kind: 'scatter';
  series: { name: string; points: { x: number; y: number }[] }[];
  warnings: string[];
}

/** histogram: every series column is binned over shared, equal-width bins */
export interface HistogramData {
  kind: 'histogram';
  /** bins[i] spans [x0, x1); the last bin also includes its upper edge. */
  bins: { x0: number; x1: number; counts: number[] }[];
  seriesNames: string[];
  /** Number of numeric values that were binned. */
  count: number;
  warnings: string[];
}

export type GraphData = CategoryData | PieData | ScatterData | HistogramData;

/** True when there is nothing drawable in the data. */
export function isEmptyData(d: GraphData): boolean {
  switch (d.kind) {
    case 'category':
      return d.categories.length === 0 || !d.series.some((s) => s.values.some((v) => v !== null));
    case 'pie':
      return d.slices.length === 0;
    case 'scatter':
      return !d.series.some((s) => s.points.length > 0);
    case 'histogram':
      return d.count === 0;
  }
}

/**
 * A chart renderer: pure function from a graph + its interpreted data to a
 * complete, standalone SVG document string (starting with "<svg").
 * It is only called with non-empty data of the kind it declared.
 */
export type ChartRenderer<D extends GraphData = GraphData> = (
  graph: GraphBlock,
  data: D,
  theme: GraphTheme,
  size: Size,
) => string;
