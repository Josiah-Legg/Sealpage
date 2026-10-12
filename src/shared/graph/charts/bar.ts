/**
 * Bar chart: one bar per category, drawn from the first data series only.
 */
import type { CategoryData, ChartRenderer } from '../types';
import type { LegendItem } from '../layout';
import { finishFrame, seriesColor } from '../layout';
import { barCornerRadius, barRect, dataAttrs, extent, layoutCategoryChart } from './barCommon';

export const renderBar: ChartRenderer<CategoryData> = (graph, data, theme, size) => {
  const first = data.series[0];
  const values = first ? first.values : [];
  const { lo, hi } = extent(values.filter((v): v is number => v !== null));
  const fill = seriesColor(theme, 0);
  const legend: LegendItem[] = [{ label: first ? first.name : '', color: fill, shape: 'rect' }];

  const chart = layoutCategoryChart(graph, theme, size, data.categories, lo, hi, legend);
  const { band, y, zeroY } = chart;
  const rx = barCornerRadius(theme, band.bandwidth);

  const marks: string[] = [];
  values.forEach((v, c) => {
    if (v === null) return;
    marks.push(
      barRect({
        x: band.start(c),
        width: band.bandwidth,
        yA: y(v),
        yB: zeroY,
        fill,
        rx,
        data: dataAttrs({ series: 0, category: c }),
      }),
    );
  });
  return finishFrame(chart.frame, [chart.axes, ...marks]);
};
