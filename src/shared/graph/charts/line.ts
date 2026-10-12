/**
 * Line chart: one polyline per series over the category band centres.
 * A null value breaks the line; markers are drawn on every point for series
 * with up to MARKER_LIMIT points, and on isolated points otherwise.
 */
import type { CategoryData, ChartRenderer } from '../types';
import { finishFrame, seriesColor } from '../layout';
import {
  MARKER_LIMIT,
  categoryChart,
  countPoints,
  lineElement,
  linePathD,
  pointMarkers,
  runsOf,
  seriesPoints,
} from './lineCommon';

export const renderLine: ChartRenderer<CategoryData> = (graph, data, theme, size) => {
  const chart = categoryChart(graph, data, theme, size, { includeZero: false, legendShape: 'line', axisAtZero: false });
  const lines: string[] = [];
  const markers: string[] = [];
  data.series.forEach((s, i) => {
    const color = seriesColor(theme, i);
    const runs = runsOf(seriesPoints(s.values, chart.band, chart.scale));
    if (runs.length > 0) lines.push(lineElement(i, linePathD(runs), color, theme));
    markers.push(pointMarkers(i, runs, countPoints(s.values) <= MARKER_LIMIT, color, theme));
  });
  return finishFrame(chart.frame, [chart.axes, ...lines, ...markers]);
};
