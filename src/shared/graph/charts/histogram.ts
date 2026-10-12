/**
 * Histogram: equal-width bins along a linear x axis, with the counts of each
 * series stacked inside a bin.
 */
import type { ChartRenderer, HistogramData } from '../types';
import {
  beginFrame,
  drawXLinearAxis,
  drawYAxis,
  emptyGraphSvg,
  finishFrame,
  formatNumber,
  linearScale,
  niceTicks,
  seriesColor,
} from '../layout';
import type { LegendItem } from '../layout';
import { barCornerRadius, barRect, dataAttrs } from './barCommon';

/** Up to this many bins, the x ticks are the bin edges; beyond it, nice ticks. */
const EDGE_TICK_MAX_BINS = 12;

export const renderHistogram: ChartRenderer<HistogramData> = (graph, data, theme, size) => {
  const { bins } = data;
  if (bins.length === 0) return emptyGraphSvg(graph, theme, size, 'No data to plot');
  const x0 = bins[0]!.x0;
  const x1 = bins[bins.length - 1]!.x1;

  // Y: counts, stacked per bin. Only whole-number ticks are labelled.
  let maxTotal = 0;
  for (const b of bins) {
    let total = 0;
    for (const c of b.counts) total += c;
    if (total > maxTotal) maxTotal = total;
  }
  const yNice = niceTicks(0, maxTotal, 5, true);
  const yTicks = yNice.ticks.filter((t) => Number.isInteger(t));

  // X: bin edges for small histograms, otherwise nice ticks that fall inside [x0, x1].
  const eps = Math.abs(x1 - x0) * 1e-9;
  const xTicks =
    bins.length <= EDGE_TICK_MAX_BINS
      ? [...bins.map((b) => b.x0), x1]
      : niceTicks(x0, x1, 6).ticks.filter((t) => t >= x0 - eps && t <= x1 + eps);

  const legend: LegendItem[] = data.seriesNames.map((name, i) => ({ label: name, color: seriesColor(theme, i), shape: 'rect' }));
  const frame = beginFrame(graph, theme, size, {
    legend,
    cartesian: true,
    yTickLabels: yTicks.map((t) => formatNumber(t)),
    xTickLabels: xTicks.map((t) => formatNumber(t)),
  });
  const { plot } = frame;
  const xScale = linearScale(x0, x1, plot.x, plot.x + plot.w);
  const yScale = linearScale(yNice.min, yNice.max, plot.y + plot.h, plot.y);
  const axes = drawYAxis(frame, theme, yScale, yTicks) + drawXLinearAxis(frame, theme, xScale, xTicks);

  const marks: string[] = [];
  bins.forEach((bin, j) => {
    const left = xScale(bin.x0);
    const binWidth = Math.max(0, xScale(bin.x1) - left);
    // a 1px gap between neighbouring bins, when there is room for one
    const gap = binWidth > 2 ? 1 : 0;
    const width = Math.max(0, binWidth - gap);
    let base = 0;
    bin.counts.forEach((count, i) => {
      if (!(count > 0)) return;
      const from = base;
      base += count;
      marks.push(
        barRect({
          x: left + gap / 2,
          width,
          yA: yScale(from),
          yB: yScale(base),
          fill: seriesColor(theme, i),
          rx: barCornerRadius(theme, width),
          data: dataAttrs({ series: i, bin: j }),
        }),
      );
    });
  });
  return finishFrame(frame, [axes, ...marks]);
};
