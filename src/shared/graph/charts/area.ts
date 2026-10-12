/**
 * Area chart: one filled area per run of non-null values, drawn from the zero
 * baseline, with the series line on top. Series are not stacked, so areas may
 * overlap. All areas are drawn before any line so the lines stay visible.
 */
import type { CategoryData, ChartRenderer } from '../types';
import { finishFrame, seriesColor } from '../layout';
import {
  MARKER_LIMIT,
  areaElement,
  areaPathD,
  categoryChart,
  countPoints,
  lineElement,
  linePathD,
  pointMarkers,
  runsOf,
  seriesPoints,
} from './lineCommon';

export const renderArea: ChartRenderer<CategoryData> = (graph, data, theme, size) => {
  const chart = categoryChart(graph, data, theme, size, { includeZero: true, legendShape: 'rect', axisAtZero: true });
  const baseline = chart.scale(0);
  const areas: string[] = [];
  const lines: string[] = [];
  const markers: string[] = [];
  data.series.forEach((s, i) => {
    const color = seriesColor(theme, i);
    const runs = runsOf(seriesPoints(s.values, chart.band, chart.scale));
    for (const run of runs) areas.push(areaElement(i, areaPathD(run, baseline), color, theme));
    if (runs.length > 0) lines.push(lineElement(i, linePathD(runs), color, theme));
    markers.push(pointMarkers(i, runs, countPoints(s.values) <= MARKER_LIMIT, color, theme));
  });
  return finishFrame(chart.frame, [chart.axes, ...areas, ...lines, ...markers]);
};
