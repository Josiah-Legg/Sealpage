/**
 * Grouped bar chart: within each category band, one bar per series side by side.
 */
import type { CategoryData, ChartRenderer } from '../types';
import type { LegendItem } from '../layout';
import { finishFrame, seriesColor } from '../layout';
import { barCornerRadius, barRect, dataAttrs, extent, layoutCategoryChart } from './barCommon';

export const renderGroupedBar: ChartRenderer<CategoryData> = (graph, data, theme, size) => {
  const all: number[] = [];
  for (const s of data.series) {
    for (const v of s.values) if (v !== null) all.push(v);
  }
  const { lo, hi } = extent(all);
  const legend: LegendItem[] = data.series.map((s, i) => ({ label: s.name, color: seriesColor(theme, i), shape: 'rect' }));

  const chart = layoutCategoryChart(graph, theme, size, data.categories, lo, hi, legend);
  const { band, y, zeroY } = chart;

  // Each series gets an equal slot of the band; neighbours are 1px apart once the bars are wider than 4px.
  const slot = band.bandwidth / Math.max(1, data.series.length);
  const gap = slot > 4 ? 1 : 0;
  const width = Math.max(0, slot - gap);

  const marks: string[] = [];
  data.series.forEach((s, i) => {
    const fill = seriesColor(theme, i);
    s.values.forEach((v, c) => {
      if (v === null) return;
      marks.push(
        barRect({
          x: band.start(c) + i * slot + gap / 2,
          width,
          yA: y(v),
          yB: zeroY,
          fill,
          rx: barCornerRadius(theme, width),
          data: dataAttrs({ series: i, category: c }),
        }),
      );
    });
  });
  return finishFrame(chart.frame, [chart.axes, ...marks]);
};
