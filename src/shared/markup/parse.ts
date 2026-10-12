/**
 * Sealmark parser: text -> Doc. See docs/FORMAT.md.
 *
 * The parser is total and lenient: it never throws, and any line it does not
 * recognise becomes a paragraph, so no text is ever silently dropped.
 */
import {
  type Block,
  type Doc,
  type GraphBlock,
  type GraphType,
  type HeadingLevel,
  type Inline,
  type LegendPosition,
  type ListBlock,
  type ListItem,
  type ListKind,
  GRAPH_TYPES,
  LEGEND_POSITIONS,
  normalizeDoc,
} from '../model';
import { endsWithEscape, parseInline, splitUnescaped } from './inline';

const HEADER_RE = /^~sealpage (\d{1,9})\s*$/;
const HEADING_RE = /^(={1,4})(?: (.*))?$/s;
const LIST_RE = /^((?: {2})*)(-\[ \]|-\[x\]|-|\+)(?: (.*))?$/s;
const QUOTE_RE = /^>(?: (.*))?$/s;
const DIRECTIVE_RE = /^@(code|table|graph)(?: (.*))?$/s;
const BLANK_RE = /^[ \t]*$/;

/** The markup version declared on the first line, or null when there is no header. */
export function markupVersion(source: string): number | null {
  const nl = source.indexOf('\n');
  const first = (nl < 0 ? source : source.slice(0, nl)).replace(/^\uFEFF/, '').replace(/\r$/, '');
  const m = HEADER_RE.exec(first);
  return m ? Number(m[1]) : null;
}

interface ListLine {
  depth: number;
  kind: ListKind;
  checked: boolean;
  content: Inline[];
}

function parseListLine(m: RegExpExecArray): ListLine {
  const marker = m[2]!;
  return {
    depth: m[1]!.length / 2,
    kind: marker === '+' ? 'numbered' : marker === '-' ? 'bullet' : 'check',
    checked: marker === '-[x]',
    content: parseInline(m[3] ?? ''),
  };
}

/** Build sibling lists at `depth` from lines[i...]; a deeper line nests under the item before it. */
function buildLists(lines: ListLine[], start: number, depth: number): { lists: ListBlock[]; next: number } {
  const lists: ListBlock[] = [];
  let i = start;
  while (i < lines.length && lines[i]!.depth >= depth) {
    const line = lines[i]!;
    let cur = lists[lists.length - 1];
    if (!cur || cur.kind !== line.kind) {
      cur = { type: 'list', kind: line.kind, items: [] };
      lists.push(cur);
    }
    const item: ListItem = { content: line.content, checked: line.checked, children: [] };
    i++;
    if (i < lines.length && lines[i]!.depth > depth) {
      const nested = buildLists(lines, i, depth + 1);
      item.children = nested.lists;
      i = nested.next;
    }
    cur.items.push(item);
  }
  return { lists, next: i };
}

function parseJsonString(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"')) {
    try {
      const v: unknown = JSON.parse(s);
      if (typeof v === 'string') return v;
    } catch {
      /* fall through to the raw text */
    }
  }
  return s;
}

function parseJsonStringArray(raw: string): string[] | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((c) => (typeof c === 'string' ? c : c == null ? '' : String(c)));
  } catch {
    /* not a data row */
  }
  return null;
}

function parseTableRow(line: string): Inline[][] {
  const parts = splitUnescaped(line, '|');
  parts.shift(); // text before the leading bar (always empty)
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop(); // after the closing bar
  return parts.map((raw) => {
    let cell = raw;
    if (cell.startsWith(' ')) cell = cell.slice(1);
    if (cell.endsWith(' ') && !endsWithEscape(cell)) cell = cell.slice(0, -1);
    return parseInline(cell);
  });
}

function codeLine(line: string): string {
  if (line.startsWith('| ')) return line.slice(2);
  return line.slice(1);
}

function parseGraph(arg: string, body: string[]): GraphBlock {
  const chartName = arg.trim();
  const g: GraphBlock = {
    type: 'graph',
    chart: (GRAPH_TYPES as readonly string[]).includes(chartName) ? (chartName as GraphType) : 'bar',
    title: '',
    xLabel: '',
    yLabel: '',
    legend: { show: true, position: 'bottom' },
    bins: 0,
    columns: [],
    rows: [],
  };
  let sawColumns = false;
  for (const line of body) {
    if (line.startsWith('|')) {
      const cells = parseJsonStringArray(line.slice(1));
      if (!cells) continue;
      if (!sawColumns) {
        g.columns = cells;
        sawColumns = true;
      } else {
        g.rows.push(cells);
      }
      continue;
    }
    const m = /^: ?([a-z-]+)(?: (.*))?$/s.exec(line);
    if (!m) continue;
    const value = m[2] ?? '';
    switch (m[1]) {
      case 'title':
        g.title = parseJsonString(value);
        break;
      case 'x-label':
        g.xLabel = parseJsonString(value);
        break;
      case 'y-label':
        g.yLabel = parseJsonString(value);
        break;
      case 'legend': {
        const words = value.trim().split(/\s+/);
        g.legend.show = !words.includes('hide');
        const pos = words.find((w) => (LEGEND_POSITIONS as readonly string[]).includes(w));
        if (pos) g.legend.position = pos as LegendPosition;
        break;
      }
      case 'bins': {
        const n = Number.parseInt(value.trim(), 10);
        g.bins = Number.isFinite(n) ? n : 0;
        break;
      }
      default:
        break; // unknown property: ignored for forward compatibility
    }
  }
  if (!sawColumns) {
    const width = Math.max(2, ...g.rows.map((r) => r.length));
    g.columns = Array.from({ length: width }, (_, i) => (i === 0 ? 'Label' : `Series ${i}`));
  } else if (g.rows.length > 0) {
    // Never drop data cells: widen the column list to the widest row.
    const width = Math.max(g.columns.length, ...g.rows.map((r) => r.length));
    while (g.columns.length < width) g.columns.push(`Series ${g.columns.length}`);
  }
  return g;
}

/** Parse Sealmark text into a normalised document. Never throws. */
export function parseMarkup(source: string): Doc {
  const lines = source.replace(/^\uFEFF/, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.endsWith('\r')) lines[i] = lines[i]!.slice(0, -1);
  }
  const blocks: Block[] = [];
  let i = 0;

  /** Collect the run of lines after a directive that satisfy `accept`. */
  const takeBody = (accept: (line: string) => boolean): string[] => {
    const body: string[] = [];
    while (i < lines.length && accept(lines[i]!)) body.push(lines[i++]!);
    return body;
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (BLANK_RE.test(line) || line.startsWith('~')) {
      i++; // blank separator, or a reserved metadata line
      continue;
    }

    if (line === '---') {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    let m = HEADING_RE.exec(line);
    if (m) {
      const depth = m[1]!.length;
      const content = parseInline(m[2] ?? '');
      if (depth === 1) blocks.push({ type: 'title', content });
      else blocks.push({ type: 'heading', level: (depth - 1) as HeadingLevel, content });
      i++;
      continue;
    }

    m = DIRECTIVE_RE.exec(line);
    if (m) {
      i++;
      const arg = m[2] ?? '';
      if (m[1] === 'code') {
        const body = takeBody((l) => l.startsWith('|'));
        blocks.push({ type: 'code', language: parseJsonString(arg), text: body.map(codeLine).join('\n') });
      } else if (m[1] === 'table') {
        const body = takeBody((l) => l.startsWith('|'));
        blocks.push({
          type: 'table',
          headerRow: arg.trim().split(/\s+/).includes('header'),
          rows: body.map(parseTableRow),
        });
      } else {
        const body = takeBody((l) => l.startsWith('|') || l.startsWith(':'));
        blocks.push(parseGraph(arg, body));
      }
      continue;
    }

    if (LIST_RE.test(line)) {
      const group: ListLine[] = [];
      for (let lm = LIST_RE.exec(lines[i] ?? ''); lm; lm = LIST_RE.exec(lines[i] ?? '')) {
        group.push(parseListLine(lm));
        i++;
        if (i >= lines.length) break;
      }
      blocks.push(...buildLists(group, 0, 0).lists);
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const paragraphs: Inline[][] = [];
      for (let qm = QUOTE_RE.exec(lines[i] ?? ''); qm; qm = QUOTE_RE.exec(lines[i] ?? '')) {
        paragraphs.push(parseInline(qm[1] ?? ''));
        i++;
        if (i >= lines.length) break;
      }
      blocks.push({ type: 'quote', paragraphs });
      continue;
    }

    blocks.push({ type: 'paragraph', content: parseInline(line) });
    i++;
  }

  return normalizeDoc({ blocks });
}
