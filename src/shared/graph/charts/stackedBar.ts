/**
 * Stacked bar chart: one bar per category, every series stacked on top of the
 * previous ones. Positive values stack upwards from zero, negative values
 * stack downwards from zero, each with its own running total.
 */
import type { CategoryData, ChartRenderer } from '../types';
import type { LegendItem } from '../layout';
import { finishFrame, seriesColor } from '../layout';
import { barCornerRadius, barRect, dataAttrs, extent, layoutCategoryChart } from './barCommon';

export const renderStackedBar: ChartRenderer<CategoryData> = (graph, data, theme, size) => {
  const n = data.categories.length;

  // Per-category totals, used for the y domain (largest positive total, most negative total).
  const posTotal: number[] = new Array<number>(n).fill(0);
  const negTotal: number[] = new Array<number>(n).fill(0);
  for (const s of data.series) {
    s.values.forEach((v, c) => {
      if (v === null || c >= n) return;
      if (v > 0) posTotal[c]! += v;
      else if (v < 0) negTotal[c]! += v;
    });
  }
  const { lo, hi } = extent(posTotal.concat(negTotal));
  const legend: LegendItem[] = data.series.map((s, i) => ({ label: s.name, color: seriesColor(theme, i), shape: 'rect' }));

  const chart = layoutCategoryChart(graph, theme, size, data.categories, lo, hi, legend);
  const { band, y } = chart;
  const rx = barCornerRadius(theme, band.bandwidth);
  const stroke = { color: theme.sliceStroke, width: Math.min(theme.sliceStrokeWidth, 1) };

  // Second pass: draw each segment from the running total of its own sign.
  const posRun: number[] = new Array<number>(n).fill(0);
  const negRun: number[] = new Array<number>(n).fill(0);
  const marks: string[] = [];
  data.series.forEach((s, i) => {
    const fill = seriesColor(theme, i);
    s.values.forEach((v, c) => {
      // zero-height segments would only leave a stray stroke line
      if (v === null || v === 0 || c >= n) return;
      let from: number;
      let to: number;
      if (v > 0) {
        from = posRun[c]!;
        to = from + v;
        posRun[c] = to;
      } else {
        from = negRun[c]!;
        to = from + v;
        negRun[c] = to;
      }
      marks.push(
        barRect({
          x: band.start(c),
          width: band.bandwidth,
          yA: y(from),
          yB: y(to),
          fill,
          rx,
          data: dataAttrs({ series: i, category: c }),
          stroke,
        }),
      );
    });
  });
  return finishFrame(chart.frame, [chart.axes, ...marks]);
};
