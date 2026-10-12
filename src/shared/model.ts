/**
 * Sealpage document model.
 *
 * A document is an ordered list of typed blocks. This model is the single
 * source of truth for what a document *is*: the markup serialiser/parser
 * (src/shared/markup) and the editor (src/renderer/editor/convert.ts) both
 * convert to and from it.
 *
 * Every value in the model has exactly one canonical shape (all fields always
 * present, no `undefined`), so two equal documents are structurally identical
 * and can be compared with a plain deep-equality check.
 *
 * The round-trip contract is:   parse(serialise(d)) deep-equals normalizeDoc(d)
 * and for an already normalised document:   parse(serialise(d)) deep-equals d.
 */

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

/** A run of text carrying a flat set of marks. */
export interface TextRun {
  type: 'text';
  /** Never empty, never contains "\n" or "\r", always well-formed UTF-16. */
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  /** Link target, or null when the run is not part of a link. Never "". */
  href: string | null;
}

/** A hard line break inside a block (Shift+Enter). */
export interface LineBreak {
  type: 'break';
}

export type Inline = TextRun | LineBreak;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface TitleBlock {
  type: 'title';
  content: Inline[];
}

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingBlock {
  type: 'heading';
  level: HeadingLevel;
  content: Inline[];
}

export interface ParagraphBlock {
  type: 'paragraph';
  content: Inline[];
}

export interface CodeBlock {
  type: 'code';
  /** Language label. Single line, trimmed, may be "". */
  language: string;
  /** Raw code. Lines separated by "\n" only. */
  text: string;
}

export type ListKind = 'bullet' | 'numbered' | 'check';

export interface ListItem {
  content: Inline[];
  /** Only meaningful when the owning list is a checklist; false otherwise. */
  checked: boolean;
  /** Nested lists. Adjacent nested lists of the same kind are merged. */
  children: ListBlock[];
}

export interface ListBlock {
  type: 'list';
  kind: ListKind;
  /** Never empty. */
  items: ListItem[];
}

export interface QuoteBlock {
  type: 'quote';
  /** One entry per paragraph inside the quote. Never empty. */
  paragraphs: Inline[][];
}

export interface TableBlock {
  type: 'table';
  /** When true the first row is rendered as a header row. */
  headerRow: boolean;
  /** rows[r][c] is the inline content of a cell. Rectangular, at least 1x1. */
  rows: Inline[][][];
}

export interface DividerBlock {
  type: 'divider';
}

export const GRAPH_TYPES = [
  'bar',
  'grouped-bar',
  'stacked-bar',
  'line',
  'area',
  'pie',
  'scatter',
  'histogram',
] as const;
export type GraphType = (typeof GRAPH_TYPES)[number];

export const LEGEND_POSITIONS = ['top', 'bottom', 'left', 'right'] as const;
export type LegendPosition = (typeof LEGEND_POSITIONS)[number];

export interface GraphLegend {
  show: boolean;
  position: LegendPosition;
}

/**
 * A graph. The data table is stored exactly as the user typed it (a grid of
 * strings); `src/shared/graph/data.ts` interprets it for a given chart type.
 */
export interface GraphBlock {
  type: 'graph';
  chart: GraphType;
  title: string;
  xLabel: string;
  yLabel: string;
  legend: GraphLegend;
  /** Histogram bin count; 0 means "choose automatically". Integer 0..200. */
  bins: number;
  /**
   * Column names. columns[0] names the label / x column, the rest name data
   * series. Always at least 2 entries.
   */
  columns: string[];
  /** Data rows; every row has exactly columns.length cells. */
  rows: string[][];
}

export type Block =
  | TitleBlock
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | ListBlock
  | QuoteBlock
  | TableBlock
  | DividerBlock
  | GraphBlock;

export type BlockType = Block['type'];

export interface Doc {
  blocks: Block[];
}

// ---------------------------------------------------------------------------
// Constructors (always produce canonical shapes)
// ---------------------------------------------------------------------------

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string | null;
}

export function text(value: string, marks: Marks = {}): TextRun {
  return {
    type: 'text',
    text: value,
    bold: marks.bold === true,
    italic: marks.italic === true,
    code: marks.code === true,
    href: marks.href ? marks.href : null,
  };
}

export function lineBreak(): LineBreak {
  return { type: 'break' };
}

export function paragraph(content: Inline[] = []): ParagraphBlock {
  return { type: 'paragraph', content };
}

export function title(content: Inline[] = []): TitleBlock {
  return { type: 'title', content };
}

export function heading(level: HeadingLevel, content: Inline[] = []): HeadingBlock {
  return { type: 'heading', level, content };
}

export function codeBlock(language: string, code: string): CodeBlock {
  return { type: 'code', language, text: code };
}

export function listItem(content: Inline[] = [], checked = false, children: ListBlock[] = []): ListItem {
  return { content, checked, children };
}

export function list(kind: ListKind, items: ListItem[]): ListBlock {
  return { type: 'list', kind, items };
}

export function quote(paragraphs: Inline[][]): QuoteBlock {
  return { type: 'quote', paragraphs };
}

export function table(rows: Inline[][][], headerRow = true): TableBlock {
  return { type: 'table', headerRow, rows };
}

export function divider(): DividerBlock {
  return { type: 'divider' };
}

export function defaultGraph(chart: GraphType = 'bar'): GraphBlock {
  return {
    type: 'graph',
    chart,
    title: '',
    xLabel: '',
    yLabel: '',
    legend: { show: true, position: 'bottom' },
    bins: 0,
    columns: ['Label', 'Series 1'],
    rows: [
      ['A', '3'],
      ['B', '5'],
      ['C', '2'],
    ],
  };
}

export function emptyDoc(): Doc {
  return { blocks: [] };
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Maximum histogram bin count accepted by the model. */
export const MAX_BINS = 200;

/** Replace lone surrogates so the string survives UTF-8 encoding unchanged. */
export function wellFormed(s: string): string {
  return s.toWellFormed();
}

/** Canonical link target: well-formed, no line terminators, null when empty. */
export function normalizeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const h = wellFormed(href).replace(/[\r\n]/g, '');
  return h === '' ? null : h;
}

function sameMarks(a: TextRun, b: TextRun): boolean {
  return (
    (a.bold === true) === (b.bold === true) &&
    (a.italic === true) === (b.italic === true) &&
    (a.code === true) === (b.code === true) &&
    normalizeHref(a.href) === normalizeHref(b.href)
  );
}

/**
 * Canonicalise inline content: well-formed text, line terminators turned into
 * break nodes, empty runs dropped, adjacent runs with equal marks merged.
 */
export function normalizeInline(content: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  const pushText = (run: TextRun, value: string): void => {
    if (value === '') return;
    const last = out[out.length - 1];
    if (last && last.type === 'text' && sameMarks(last, run)) {
      last.text += value;
    } else {
      out.push({
        type: 'text',
        text: value,
        bold: run.bold === true,
        italic: run.italic === true,
        code: run.code === true,
        href: normalizeHref(run.href),
      });
    }
  };
  for (const node of content) {
    if (!node) continue;
    if (node.type === 'break') {
      out.push({ type: 'break' });
      continue;
    }
    if (node.type !== 'text' || typeof node.text !== 'string') continue;
    const parts = wellFormed(node.text).split(/\r\n|\r|\n/);
    parts.forEach((part, i) => {
      if (i > 0) out.push({ type: 'break' });
      pushText(node, part);
    });
  }
  return out;
}

/** Single-line plain string: well-formed, line terminators become spaces. */
export function normalizeLabel(s: unknown): string {
  return wellFormed(typeof s === 'string' ? s : '').replace(/\r\n|\r|\n/g, ' ');
}

function normalizeList(block: ListBlock): ListBlock | null {
  const kind: ListKind = block.kind === 'numbered' || block.kind === 'check' ? block.kind : 'bullet';
  const items: ListItem[] = [];
  for (const item of block.items ?? []) {
    if (!item) continue;
    items.push({
      content: normalizeInline(item.content ?? []),
      checked: kind === 'check' && item.checked === true,
      children: normalizeLists(item.children ?? []),
    });
  }
  if (items.length === 0) return null;
  return { type: 'list', kind, items };
}

/** Normalise sibling nested lists, merging adjacent lists of the same kind. */
function normalizeLists(lists: readonly ListBlock[]): ListBlock[] {
  const out: ListBlock[] = [];
  for (const raw of lists) {
    if (!raw || raw.type !== 'list') continue;
    const l = normalizeList(raw);
    if (!l) continue;
    const last = out[out.length - 1];
    if (last && last.kind === l.kind) last.items.push(...l.items);
    else out.push(l);
  }
  return out;
}

function normalizeGraph(g: GraphBlock): GraphBlock {
  const chart: GraphType = (GRAPH_TYPES as readonly string[]).includes(g.chart) ? g.chart : 'bar';
  const position: LegendPosition = (LEGEND_POSITIONS as readonly string[]).includes(g.legend?.position)
    ? g.legend.position
    : 'bottom';
  const columns = (Array.isArray(g.columns) ? g.columns : []).map(normalizeLabel);
  while (columns.length < 2) columns.push(columns.length === 0 ? 'Label' : `Series ${columns.length}`);
  const rows = (Array.isArray(g.rows) ? g.rows : []).map((row) => {
    const cells = (Array.isArray(row) ? row : []).slice(0, columns.length).map(normalizeLabel);
    while (cells.length < columns.length) cells.push('');
    return cells;
  });
  let bins = Number.isFinite(g.bins) ? Math.trunc(g.bins) : 0;
  if (bins < 0) bins = 0;
  if (bins > MAX_BINS) bins = MAX_BINS;
  return {
    type: 'graph',
    chart,
    title: normalizeLabel(g.title),
    xLabel: normalizeLabel(g.xLabel),
    yLabel: normalizeLabel(g.yLabel),
    legend: { show: g.legend?.show !== false, position },
    bins,
    columns,
    rows,
  };
}

/** Canonicalise one block. Returns null for blocks that cannot exist (e.g. an empty list). */
export function normalizeBlock(block: Block): Block | null {
  switch (block.type) {
    case 'title':
      return { type: 'title', content: normalizeInline(block.content ?? []) };
    case 'heading': {
      const level: HeadingLevel = block.level === 2 || block.level === 3 ? block.level : 1;
      return { type: 'heading', level, content: normalizeInline(block.content ?? []) };
    }
    case 'paragraph':
      return { type: 'paragraph', content: normalizeInline(block.content ?? []) };
    case 'code':
      return {
        type: 'code',
        language: normalizeLabel(block.language).trim(),
        text: wellFormed(typeof block.text === 'string' ? block.text : '').replace(/\r\n|\r/g, '\n'),
      };
    case 'list':
      return normalizeList(block);
    case 'quote': {
      const paragraphs = (block.paragraphs ?? []).map((p) => normalizeInline(p ?? []));
      if (paragraphs.length === 0) paragraphs.push([]);
      return { type: 'quote', paragraphs };
    }
    case 'table': {
      const rows = (block.rows ?? []).map((row) => (row ?? []).map((cell) => normalizeInline(cell ?? [])));
      if (rows.length === 0) rows.push([]);
      const width = Math.max(1, ...rows.map((r) => r.length));
      for (const row of rows) while (row.length < width) row.push([]);
      return { type: 'table', headerRow: block.headerRow === true, rows };
    }
    case 'divider':
      return { type: 'divider' };
    case 'graph':
      return normalizeGraph(block);
    default:
      return null;
  }
}

/** Canonicalise a whole document. Idempotent. */
export function normalizeDoc(doc: Doc): Doc {
  const blocks: Block[] = [];
  for (const b of doc.blocks ?? []) {
    if (!b) continue;
    const n = normalizeBlock(b);
    if (n) blocks.push(n);
  }
  return { blocks };
}

// ---------------------------------------------------------------------------
// Plain-text helpers
// ---------------------------------------------------------------------------

export function inlineToPlainText(content: readonly Inline[]): string {
  let s = '';
  for (const n of content) s += n.type === 'text' ? n.text : '\n';
  return s;
}

function listToPlainText(l: ListBlock, out: string[]): void {
  for (const item of l.items) {
    out.push(inlineToPlainText(item.content));
    for (const child of item.children) listToPlainText(child, out);
  }
}

/** The human-visible text of a block, used for word counts and search. */
export function blockToPlainText(block: Block): string {
  switch (block.type) {
    case 'title':
    case 'heading':
    case 'paragraph':
      return inlineToPlainText(block.content);
    case 'code':
      return block.text;
    case 'list': {
      const out: string[] = [];
      listToPlainText(block, out);
      return out.join('\n');
    }
    case 'quote':
      return block.paragraphs.map(inlineToPlainText).join('\n');
    case 'table':
      return block.rows.map((r) => r.map(inlineToPlainText).join('\t')).join('\n');
    case 'divider':
      return '';
    case 'graph':
      return block.title;
  }
}

export function docToPlainText(doc: Doc): string {
  return doc.blocks.map(blockToPlainText).join('\n');
}
