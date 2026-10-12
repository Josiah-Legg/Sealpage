/**
 * Graph rendering entry point: GraphBlock + theme -> standalone SVG string.
 * Interprets the data table, handles the empty case, then dispatches to the
 * chart renderer for the block's type.
 */
import type { GraphBlock, GraphType } from '../model';
import { interpretGraph } from './data';
import { emptyGraphSvg } from './layout';
import { type ChartRenderer, type GraphData, type GraphTheme, type Size, DEFAULT_GRAPH_SIZE, isEmptyData } from './types';
import { renderBar } from './charts/bar';
import { renderGroupedBar } from './charts/groupedBar';
import { renderStackedBar } from './charts/stackedBar';
import { renderHistogram } from './charts/histogram';
import { renderLine } from './charts/line';
import { renderArea } from './charts/area';
import { renderScatter } from './charts/scatter';
import { renderPie } from './charts/pie';

const RENDERERS: Record<GraphType, ChartRenderer<never>> = {
  bar: renderBar,
  'grouped-bar': renderGroupedBar,
  'stacked-bar': renderStackedBar,
  histogram: renderHistogram,
  line: renderLine,
  area: renderArea,
  scatter: renderScatter,
  pie: renderPie,
};

export const GRAPH_TYPE_LABELS: Record<GraphType, string> = {
  bar: 'Bar',
  'grouped-bar': 'Grouped bar',
  'stacked-bar': 'Stacked bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  scatter: 'Scatter',
  histogram: 'Histogram',
};

export interface RenderedGraph {
  svg: string;
  warnings: string[];
}

/** Render a graph. Never throws: a renderer failure produces a placeholder SVG and a warning. */
export function renderGraph(graph: GraphBlock, theme: GraphTheme, size: Size = DEFAULT_GRAPH_SIZE): RenderedGraph {
  let data: GraphData;
  try {
    data = interpretGraph(graph);
  } catch {
    return { svg: emptyGraphSvg(graph, theme, size, 'This graph could not be read'), warnings: ['The graph data could not be read.'] };
  }
  if (isEmptyData(data)) {
    return { svg: emptyGraphSvg(graph, theme, size, 'No data to plot'), warnings: data.warnings };
  }
  try {
    const render = RENDERERS[graph.chart] as ChartRenderer;
    return { svg: render(graph, data, theme, size), warnings: data.warnings };
  } catch {
    return { svg: emptyGraphSvg(graph, theme, size, 'This graph could not be drawn'), warnings: [...data.warnings, 'The graph could not be drawn.'] };
  }
}

/** A neutral theme for tests and as a fallback before a style is applied. */
export const FALLBACK_GRAPH_THEME: GraphTheme = {
  palette: ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#9c755f'],
  background: 'transparent',
  text: '#222222',
  textMuted: '#666666',
  axis: '#888888',
  grid: '#dddddd',
  fontFamily: 'sans-serif',
  titleFontFamily: 'sans-serif',
  fontSize: 12,
  titleFontSize: 16,
  titleWeight: 600,
  lineWidth: 2,
  axisWidth: 1,
  gridWidth: 1,
  gridDash: '',
  barRadius: 2,
  pointRadius: 3.5,
  areaOpacity: 0.25,
  sliceStroke: '#ffffff',
  sliceStrokeWidth: 1.5,
};
