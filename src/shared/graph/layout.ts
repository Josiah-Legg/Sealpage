/**
 * Shared SVG building blocks for chart renderers: escaping, text metrics,
 * scales, tick generation, and the chart frame (title, legend, axes).
 *
 * Renderers only draw their marks; everything around the plot area comes from
 * here so that all eight chart types look like one family.
 *
 * Typical cartesian renderer:
 *
 *   const { ticks, min, max } = niceTicks(dataMin, dataMax);
 *   const frame = beginFrame(graph, theme, size, {
 *     legend: legendItems, cartesian: true,
 *     yTickLabels: ticks.map((t) => formatNumber(t)), xTickLabels: categories,
 *   });
 *   const y = linearScale(min, max, frame.plot.y + frame.plot.h, frame.plot.y);
 *   const x = bandScale(categories.length, frame.plot.x, frame.plot.x + frame.plot.w, 0.2);
 *   const body = [drawYAxis(frame, theme, y, ticks), drawXBandAxis(frame, theme, x, categories), ...marks];
 *   return finishFrame(frame, body);
 */
import type { GraphBlock } from '../model';
import type { GraphTheme, Rect, Size } from './types';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Escape a string for use in SVG text content or an attribute value. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    // characters that are not allowed in XML 1.0 documents
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/g, '');
}

/** Round to 2 decimals for compact, stable SVG output. */
export function r(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? '0' : String(v);
}

/** Approximate rendered width of text in px (no DOM available). */
export function textWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f300)) w += 1.0;
    else if ('iljI.,:;|!\'` '.includes(ch)) w += 0.32;
    else if ('mwMW@%'.includes(ch)) w += 0.85;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else w += 0.56;
  }
  return w * fontSize;
}

/** Shorten text with an ellipsis so it fits in maxWidth px. */
export function truncate(s: string, maxWidth: number, fontSize: number): string {
  if (textWidth(s, fontSize) <= maxWidth) return s;
  const chars = Array.from(s);
  while (chars.length > 1 && textWidth(chars.join('') + '…', fontSize) > maxWidth) chars.pop();
  return chars.join('') + '…';
}

/** Colour for series index i (cycles through the palette). */
export function seriesColor(theme: GraphTheme, i: number): string {
  const p = theme.palette.length > 0 ? theme.palette : ['#888888'];
  return p[((i % p.length) + p.length) % p.length]!;
}

/** Compact number formatting for tick labels and value labels. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 1e15 || abs < 1e-6) return n.toExponential(2).replace(/\.?0+e/, 'e');
  if (abs >= 1e9) return trimZeros(n / 1e9) + 'B';
  if (abs >= 1e6) return trimZeros(n / 1e6) + 'M';
  if (abs >= 1e4) return trimZeros(n / 1e3) + 'k';
  return trimZeros(n);
}

function trimZeros(n: number): string {
  // 6 significant digits is plenty for an axis label and hides float noise
  return String(Number(n.toPrecision(6)));
}

// ---------------------------------------------------------------------------
// Scales and ticks
// ---------------------------------------------------------------------------

export type LinearScale = (value: number) => number;

/** Map [d0, d1] linearly onto [r0, r1]. A zero-width domain maps to the middle. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): LinearScale {
  const span = d1 - d0;
  if (span === 0 || !Number.isFinite(span)) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

export interface BandScale {
  /** Left edge of band i. */
  start(i: number): number;
  /** Centre of band i. */
  center(i: number): number;
  /** Width of one band (after padding). */
  bandwidth: number;
  /** Distance between the starts of adjacent bands. */
  step: number;
}

/** Split [r0, r1] into n equal bands; `padding` (0..1) is the fraction of each step left empty. */
export function bandScale(n: number, r0: number, r1: number, padding = 0.2): BandScale {
  const count = Math.max(1, n);
  const step = (r1 - r0) / count;
  const bandwidth = step * (1 - Math.min(0.95, Math.max(0, padding)));
  const offset = (step - bandwidth) / 2;
  return {
    start: (i) => r0 + i * step + offset,
    center: (i) => r0 + i * step + step / 2,
    bandwidth,
    step,
  };
}

export interface Ticks {
  ticks: number[];
  /** Axis domain, expanded outwards to the nearest tick. */
  min: number;
  max: number;
  step: number;
}

/**
 * "Nice" axis ticks covering [lo, hi] with roughly `target` intervals.
 * With includeZero (the default for bar-like charts) the domain always
 * contains 0. Handles lo === hi and non-finite input.
 */
export function niceTicks(lo: number, hi: number, target = 5, includeZero = false): Ticks {
  let a = Number.isFinite(lo) ? lo : 0;
  let b = Number.isFinite(hi) ? hi : 0;
  if (a > b) [a, b] = [b, a];
  // Keep the span representable: (b - a) must not overflow to Infinity.
  const LIMIT = Number.MAX_VALUE / 4;
  a = Math.max(a, -LIMIT);
  b = Math.min(b, LIMIT);
  if (includeZero) {
    if (a > 0) a = 0;
    if (b < 0) b = 0;
  }
  if (a === b) {
    if (a === 0) b = 1;
    else {
      const pad = Math.abs(a) * 0.5;
      a -= pad;
      b += pad;
      if (includeZero && a > 0) a = 0;
    }
  }
  const rawStep = (b - a) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const min = Math.floor(a / step + 1e-9) * step;
  const max = Math.ceil(b / step - 1e-9) * step;
  const ticks: number[] = [];
  const n = Math.round((max - min) / step);
  for (let i = 0; i <= n && i < 1000; i++) ticks.push(Number((min + i * step).toPrecision(12)));
  return { ticks, min: ticks[0]!, max: ticks[ticks.length - 1]!, step };
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export interface LegendItem {
  label: string;
  color: string;
  /** Swatch shape: filled square, short line, or dot. */
  shape: 'rect' | 'line' | 'dot';
}

export interface FrameOptions {
  /** Legend entries. Ignored when graph.legend.show is false or the array is empty. */
  legend: LegendItem[];
  /** Reserve room for x / y axes, tick labels and axis titles. False for pie. */
  cartesian: boolean;
  /** Y tick labels, used only to measure the left margin. */
  yTickLabels?: string[];
  /** X tick labels, used only to decide whether they need a second line of space. */
  xTickLabels?: string[];
}

export interface Frame {
  size: Size;
  /** The area marks may be drawn in. */
  plot: Rect;
  /** Already-rendered fragments: background, title, legend, axis titles. */
  parts: string[];
  /** Accessible label for the root element. */
  label: string;
  theme: GraphTheme;
}

const PAD = 16;

function legendLayout(items: LegendItem[], theme: GraphTheme, maxWidth: number, vertical: boolean) {
  const fs = theme.fontSize;
  const swatch = fs;
  const gap = 6;
  const itemGap = 22;
  const rowH = Math.round(fs * 1.7);
  const labelMax = vertical ? Math.max(40, maxWidth - swatch - gap) : Math.max(60, Math.min(220, maxWidth - swatch - gap));
  const entries = items.map((it) => {
    const label = truncate(it.label, labelMax, fs);
    return { ...it, label, w: swatch + gap + textWidth(label, fs) };
  });
  const pos: { x: number; y: number }[] = [];
  let width = 0;
  let height = 0;
  if (vertical) {
    entries.forEach((e, i) => {
      pos.push({ x: 0, y: i * rowH });
      width = Math.max(width, e.w);
    });
    height = entries.length * rowH;
  } else {
    let x = 0;
    let y = 0;
    for (const e of entries) {
      if (x > 0 && x + e.w > maxWidth) {
        x = 0;
        y += rowH;
      }
      pos.push({ x, y });
      x += e.w + itemGap;
      width = Math.max(width, x - itemGap);
    }
    height = y + rowH;
  }
  return { entries, pos, width, height, rowH, swatch, gap };
}

function drawLegend(items: LegendItem[], theme: GraphTheme, x: number, y: number, maxWidth: number, vertical: boolean, center: boolean): string {
  const L = legendLayout(items, theme, maxWidth, vertical);
  const fs = theme.fontSize;
  const ox = center ? x + Math.max(0, (maxWidth - L.width) / 2) : x;
  let out = '<g class="sp-graph-legend">';
  L.entries.forEach((e, i) => {
    const px = ox + L.pos[i]!.x;
    const py = y + L.pos[i]!.y;
    const cy = py + L.rowH / 2;
    if (e.shape === 'line') {
      out += `<line x1="${r(px)}" y1="${r(cy)}" x2="${r(px + L.swatch)}" y2="${r(cy)}" stroke="${esc(e.color)}" stroke-width="${r(Math.max(2, theme.lineWidth))}" stroke-linecap="round"/>`;
    } else if (e.shape === 'dot') {
      out += `<circle cx="${r(px + L.swatch / 2)}" cy="${r(cy)}" r="${r(L.swatch * 0.36)}" fill="${esc(e.color)}"/>`;
    } else {
      const s = L.swatch * 0.8;
      out += `<rect x="${r(px)}" y="${r(cy - s / 2)}" width="${r(s)}" height="${r(s)}" rx="${r(Math.min(theme.barRadius, s / 3))}" fill="${esc(e.color)}"/>`;
    }
    out += `<text x="${r(px + L.swatch + L.gap)}" y="${r(cy)}" dominant-baseline="central" font-size="${r(fs)}" fill="${esc(theme.text)}">${esc(e.label)}</text>`;
  });
  return out + '</g>';
}

/**
 * Lay out everything around the plot: background, title, legend, axis titles.
 * Returns the remaining plot rectangle for the renderer's marks and axes.
 */
export function beginFrame(graph: GraphBlock, theme: GraphTheme, size: Size, opts: FrameOptions): Frame {
  const width = Math.max(160, size.width);
  const height = Math.max(120, size.height);
  const parts: string[] = [];
  const fs = theme.fontSize;
  let top = PAD;
  let bottom = height - PAD;
  let left = PAD;
  let right = width - PAD;

  if (theme.background && theme.background !== 'transparent') {
    parts.push(`<rect x="0" y="0" width="${r(width)}" height="${r(height)}" fill="${esc(theme.background)}"/>`);
  }

  const title = graph.title.trim();
  if (title !== '') {
    const t = truncate(title, width - PAD * 2, theme.titleFontSize);
    parts.push(
      `<text class="sp-graph-title" x="${r(width / 2)}" y="${r(top + theme.titleFontSize * 0.8)}" text-anchor="middle" font-family="${esc(theme.titleFontFamily)}" font-size="${r(theme.titleFontSize)}" font-weight="${theme.titleWeight}" fill="${esc(theme.text)}">${esc(t)}</text>`,
    );
    top += theme.titleFontSize * 1.2 + 8;
  }

  const legend = graph.legend.show ? opts.legend.filter((l) => l.label !== '') : [];
  if (legend.length > 0) {
    const pos = graph.legend.position;
    if (pos === 'top' || pos === 'bottom') {
      const L = legendLayout(legend, theme, right - left, false);
      if (pos === 'top') {
        parts.push(drawLegend(legend, theme, left, top, right - left, false, true));
        top += L.height + 6;
      } else {
        parts.push(drawLegend(legend, theme, left, bottom - L.height, right - left, false, true));
        bottom -= L.height + 6;
      }
    } else {
      const maxW = Math.min(180, width * 0.3);
      const L = legendLayout(legend, theme, maxW, true);
      const ly = top + Math.max(0, (bottom - top - L.height) / 2);
      if (pos === 'left') {
        parts.push(drawLegend(legend, theme, left, ly, maxW, true, false));
        left += L.width + 14;
      } else {
        parts.push(drawLegend(legend, theme, right - L.width, ly, maxW, true, false));
        right -= L.width + 14;
      }
    }
  }

  if (opts.cartesian) {
    const xLabel = graph.xLabel.trim();
    const yLabel = graph.yLabel.trim();
    if (xLabel !== '') bottom -= fs * 1.5;
    if (yLabel !== '') left += fs * 1.5;
    // tick label room
    const yW = Math.max(0, ...(opts.yTickLabels ?? []).map((l) => textWidth(l, fs)));
    left += Math.min(yW, width * 0.25) + 10;
    bottom -= fs * 1.6 + 6;
    top += 6;
    right -= 8;
    if (xLabel !== '') {
      parts.push(
        `<text class="sp-graph-axis-title" x="${r((left + right) / 2)}" y="${r(bottom + fs * 1.6 + 6 + fs * 1.1)}" text-anchor="middle" font-size="${r(fs)}" fill="${esc(theme.textMuted)}">${esc(truncate(xLabel, right - left, fs))}</text>`,
      );
    }
    if (yLabel !== '') {
      const cx = left - Math.min(yW, width * 0.25) - 10 - fs * 0.6;
      const cy = (top + bottom) / 2;
      parts.push(
        `<text class="sp-graph-axis-title" x="${r(cx)}" y="${r(cy)}" text-anchor="middle" font-size="${r(fs)}" fill="${esc(theme.textMuted)}" transform="rotate(-90 ${r(cx)} ${r(cy)})">${esc(truncate(yLabel, bottom - top, fs))}</text>`,
      );
    }
  }

  const plot: Rect = { x: left, y: top, w: Math.max(10, right - left), h: Math.max(10, bottom - top) };
  return { size: { width, height }, plot, parts, label: title, theme };
}

/** Horizontal grid lines, y tick labels and the y axis line. */
export function drawYAxis(frame: Frame, theme: GraphTheme, scale: LinearScale, ticks: number[], format: (n: number) => string = formatNumber): string {
  const { plot } = frame;
  const dash = theme.gridDash ? ` stroke-dasharray="${esc(theme.gridDash)}"` : '';
  let out = '<g class="sp-graph-y-axis">';
  for (const t of ticks) {
    const y = scale(t);
    out += `<line x1="${r(plot.x)}" y1="${r(y)}" x2="${r(plot.x + plot.w)}" y2="${r(y)}" stroke="${esc(theme.grid)}" stroke-width="${r(theme.gridWidth)}"${dash}/>`;
    out += `<text x="${r(plot.x - 8)}" y="${r(y)}" text-anchor="end" dominant-baseline="central" font-size="${r(theme.fontSize)}" fill="${esc(theme.textMuted)}">${esc(format(t))}</text>`;
  }
  out += `<line x1="${r(plot.x)}" y1="${r(plot.y)}" x2="${r(plot.x)}" y2="${r(plot.y + plot.h)}" stroke="${esc(theme.axis)}" stroke-width="${r(theme.axisWidth)}"/>`;
  return out + '</g>';
}

/**
 * Category labels under each band plus the x axis line. Labels are thinned
 * out and truncated when there is not enough room. `baselineY` positions the
 * axis line (defaults to the bottom of the plot; pass scale(0) for charts
 * with negative values).
 */
export function drawXBandAxis(frame: Frame, theme: GraphTheme, band: BandScale, labels: string[], baselineY?: number): string {
  const { plot } = frame;
  const fs = theme.fontSize;
  const y = plot.y + plot.h;
  let out = '<g class="sp-graph-x-axis">';
  const maxLabel = Math.max(0, ...labels.map((l) => textWidth(l, fs)));
  const every = Math.max(1, Math.ceil(Math.min(maxLabel, 90) / Math.max(1, band.step - 6)));
  const room = Math.max(24, band.step * every - 6);
  labels.forEach((label, i) => {
    if (i % every !== 0) return;
    out += `<text x="${r(band.center(i))}" y="${r(y + 6 + fs * 0.8)}" text-anchor="middle" font-size="${r(fs)}" fill="${esc(theme.textMuted)}">${esc(truncate(label, room, fs))}</text>`;
  });
  const by = baselineY === undefined ? y : Math.min(y, Math.max(plot.y, baselineY));
  out += `<line x1="${r(plot.x)}" y1="${r(by)}" x2="${r(plot.x + plot.w)}" y2="${r(by)}" stroke="${esc(theme.axis)}" stroke-width="${r(theme.axisWidth)}"/>`;
  return out + '</g>';
}

/** Numeric x axis: tick marks, labels and the axis line (scatter, histogram). */
export function drawXLinearAxis(frame: Frame, theme: GraphTheme, scale: LinearScale, ticks: number[], format: (n: number) => string = formatNumber): string {
  const { plot } = frame;
  const fs = theme.fontSize;
  const y = plot.y + plot.h;
  let out = '<g class="sp-graph-x-axis">';
  let lastRight = -Infinity;
  for (const t of ticks) {
    const x = scale(t);
    const label = format(t);
    const w = textWidth(label, fs);
    out += `<line x1="${r(x)}" y1="${r(y)}" x2="${r(x)}" y2="${r(y + 4)}" stroke="${esc(theme.axis)}" stroke-width="${r(theme.axisWidth)}"/>`;
    if (x - w / 2 > lastRight + 4) {
      out += `<text x="${r(x)}" y="${r(y + 6 + fs * 0.8)}" text-anchor="middle" font-size="${r(fs)}" fill="${esc(theme.textMuted)}">${esc(label)}</text>`;
      lastRight = x + w / 2;
    }
  }
  out += `<line x1="${r(plot.x)}" y1="${r(y)}" x2="${r(plot.x + plot.w)}" y2="${r(y)}" stroke="${esc(theme.axis)}" stroke-width="${r(theme.axisWidth)}"/>`;
  return out + '</g>';
}

/** Assemble the final standalone SVG document. */
export function finishFrame(frame: Frame, body: string[]): string {
  const { width, height } = frame.size;
  const label = frame.label ? ` aria-label="${esc(frame.label)}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="sp-graph" width="${r(width)}" height="${r(height)}" viewBox="0 0 ${r(width)} ${r(height)}" role="img"${label} font-family="${esc(frame.theme.fontFamily)}">` +
    frame.parts.join('') +
    body.join('') +
    '</svg>'
  );
}

/** A frame with a centred message, used when a graph has no drawable data. */
export function emptyGraphSvg(graph: GraphBlock, theme: GraphTheme, size: Size, message: string): string {
  const frame = beginFrame(graph, theme, size, { legend: [], cartesian: false });
  const { plot } = frame;
  const body = [
    `<rect x="${r(plot.x)}" y="${r(plot.y)}" width="${r(plot.w)}" height="${r(plot.h)}" rx="6" fill="none" stroke="${esc(theme.grid)}" stroke-width="${r(theme.gridWidth)}" stroke-dasharray="4 4"/>`,
    `<text x="${r(plot.x + plot.w / 2)}" y="${r(plot.y + plot.h / 2)}" text-anchor="middle" dominant-baseline="central" font-size="${r(theme.fontSize)}" fill="${esc(theme.textMuted)}">${esc(message)}</text>`,
  ];
  return finishFrame(frame, body);
}
