/**
 * Scatter chart: both axes are linear and every point is a translucent dot.
 */
import type { ChartRenderer, ScatterData } from '../types';
import type { LegendItem } from '../layout';
import {
  beginFrame,
  drawXLinearAxis,
  drawYAxis,
  esc,
  finishFrame,
  formatNumber,
  linearScale,
  niceTicks,
  r,
  seriesColor,
} from '../layout';
import { extent } from './lineCommon';

export const renderScatter: ChartRenderer<ScatterData> = (graph, data, theme, size) => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of data.series) {
    for (const p of s.points) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const [xLo, xHi] = extent(xs);
  const [yLo, yHi] = extent(ys);
  const xt = niceTicks(xLo, xHi, 6, false);
  const yt = niceTicks(yLo, yHi, 5, false);

  const legend: LegendItem[] = data.series.map((s, i) => ({ label: s.name, color: seriesColor(theme, i), shape: 'dot' }));
  const frame = beginFrame(graph, theme, size, {
    legend,
    cartesian: true,
    yTickLabels: yt.ticks.map((t) => formatNumber(t)),
  });
  const { plot } = frame;
  const sx = linearScale(xt.min, xt.max, plot.x, plot.x + plot.w);
  const sy = linearScale(yt.min, yt.max, plot.y + plot.h, plot.y);

  const body: string[] = [drawYAxis(frame, theme, sy, yt.ticks), drawXLinearAxis(frame, theme, sx, xt.ticks)];
  data.series.forEach((s, i) => {
    const color = seriesColor(theme, i);
    for (const p of s.points) {
      body.push(
        `<circle class="sp-point" data-series="${i}" cx="${r(sx(p.x))}" cy="${r(sy(p.y))}"` +
          ` r="${r(theme.pointRadius)}" fill="${esc(color)}" fill-opacity="${r(0.85)}"/>`,
      );
    }
  });
  return finishFrame(frame, body);
};
