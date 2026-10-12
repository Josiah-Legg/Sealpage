/**
 * Pie chart: slices run clockwise from 12 o'clock. Slices of at least 5% carry
 * a percentage label at 62% of the radius.
 */
import type { ChartRenderer, PieData } from '../types';
import type { LegendItem } from '../layout';
import { beginFrame, emptyGraphSvg, esc, finishFrame, r, seriesColor } from '../layout';

const TAU = Math.PI * 2;
const LABEL_MIN_PERCENT = 5;
const LABEL_RADIUS = 0.62;

interface Point {
  x: number;
  y: number;
}

/** Point on a circle at `angle` radians clockwise from 12 o'clock. */
function polar(cx: number, cy: number, radius: number, angle: number): Point {
  return { x: cx + radius * Math.sin(angle), y: cy - radius * Math.cos(angle) };
}

export const renderPie: ChartRenderer<PieData> = (graph, data, theme, size) => {
  // Scale by the largest value first, so that sums of very large values cannot overflow.
  const maxValue = data.slices.reduce((m, s) => Math.max(m, s.value), 0);
  if (data.slices.length === 0 || !(maxValue > 0) || !Number.isFinite(maxValue)) {
    return emptyGraphSvg(graph, theme, size, 'No data to plot');
  }
  const weights = data.slices.map((s) => s.value / maxValue);
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const legend: LegendItem[] = data.slices.map((s, i) => ({
    label: s.label,
    color: seriesColor(theme, i),
    shape: 'rect',
  }));
  const frame = beginFrame(graph, theme, size, { legend, cartesian: false });
  const { plot } = frame;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const radius = Math.max(4, Math.min(plot.w, plot.h) / 2 - 4);

  const shapes: string[] = [];
  const labels: string[] = [];
  let start = 0;
  data.slices.forEach((s, i) => {
    const share = weights[i]! / weightSum;
    const a0 = start * TAU;
    start += share;
    const a1 = start * TAU;
    const full = share >= 1 - 1e-9;
    const style =
      `fill="${esc(seriesColor(theme, i))}" stroke="${esc(theme.sliceStroke)}"` +
      ` stroke-width="${r(theme.sliceStrokeWidth)}" stroke-linejoin="round"`;

    if (full) {
      // An arc from a point back to the same point draws nothing, so a whole pie is a circle.
      shapes.push(`<circle class="sp-slice" data-slice="${i}" cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}" ${style}/>`);
    } else {
      const p0 = polar(cx, cy, radius, a0);
      const p1 = polar(cx, cy, radius, a1);
      const largeArc = a1 - a0 > Math.PI ? 1 : 0;
      shapes.push(
        `<path class="sp-slice" data-slice="${i}" d="M ${r(cx)} ${r(cy)} L ${r(p0.x)} ${r(p0.y)}` +
          ` A ${r(radius)} ${r(radius)} 0 ${largeArc} 1 ${r(p1.x)} ${r(p1.y)} Z" ${style}/>`,
      );
    }

    const percent = share * 100;
    if (percent >= LABEL_MIN_PERCENT - 1e-9) {
      const at = full ? { x: cx, y: cy } : polar(cx, cy, radius * LABEL_RADIUS, (a0 + a1) / 2);
      labels.push(
        `<text class="sp-slice-label" x="${r(at.x)}" y="${r(at.y)}" text-anchor="middle"` +
          ` dominant-baseline="central" font-size="${r(theme.fontSize)}" fill="${esc(theme.sliceStroke)}">` +
          `${esc(`${Math.round(percent)}%`)}</text>`,
      );
    }
  });
  return finishFrame(frame, [...shapes, ...labels]);
};
