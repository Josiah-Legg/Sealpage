/**
 * Export a document as GitHub-Flavoured Markdown (CommonMark + tables + task lists).
 *
 * Pure TypeScript: no DOM, no Node APIs, no I/O. Never throws.
 */
import {
  type Block,
  type Doc,
  type GraphBlock,
  type Inline,
  type ListBlock,
  type TextRun,
  blockToPlainText,
  normalizeDoc,
  normalizeInline,
} from '../model';
import { GRAPH_TYPE_LABELS } from '../graph/render';

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** Characters escaped everywhere in text (always, to be safe). */
const SPECIAL_CHARS = new Set(['\\', '`', '*', '_', '[', ']', '<', '>', '#', '|', '~', '&']);

/** Escape plain text so that it renders literally inside a paragraph, heading or cell. */
function escapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (SPECIAL_CHARS.has(ch)) out += '\\' + ch;
    else if (ch === '!' && value.charAt(i + 1) === '[') out += '\\!';
    else out += ch;
  }
  return out;
}

/**
 * Escape what would start a list, heading underline or rule at the start of a
 * physical line. Applied to the output of the inline renderer, so only text can
 * sit at a line start here (delimiters and code spans never begin with these characters).
 */
function escapeLineStarts(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) =>
      line
        // four or more leading spaces (or a tab) would make the line an indented code block
        .replace(/^ (?= {3})/, '&#32;')
        .replace(/^\t/, '&#9;')
        .replace(/^(\s*)([+=-])/, '$1\\$2')
        .replace(/^(\s*\d+)([.)])/, '$1\\$2'),
    )
    .join('\n');
}

/** Longest run of backticks in a string (0 when there are none). */
function longestBacktickRun(value: string): number {
  const runs = value.match(/`+/g) ?? [];
  return runs.reduce((max, run) => Math.max(max, run.length), 0);
}

/** A code span whose fence is one longer than the longest backtick run inside it. */
function codeSpan(value: string, cell: boolean): string {
  const fence = '`'.repeat(longestBacktickRun(value) + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  const body = cell ? value.replace(/\|/g, '\\|') : value;
  return fence + pad + body + pad + fence;
}

/** The destination part of a link: backslash-escaped, in <...> when it has spaces or control characters. */
function linkDestination(href: string): string {
  const escaped = href.replace(/[\\()]/g, (ch) => '\\' + ch);
  if (/[\s\u0000-\u001f\u007f]/.test(href) || href.startsWith('<')) {
    return '<' + escaped.replace(/[<>]/g, (ch) => '\\' + ch) + '>';
  }
  return escaped;
}

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

type MarkKind = 'link' | 'bold' | 'italic';

/** A mark a run needs open. `key` identifies it when comparing with the open stack. */
interface MarkSpec {
  key: string;
  kind: MarkKind;
  open: string;
  close: string;
}

/**
 * Inline output tokens. Text is still raw (escaped at emit time, so that
 * whitespace can be hoisted and the "!" rule can look ahead); code spans and
 * delimiters are final strings.
 */
type Token =
  | { k: 'text'; raw: string }
  | { k: 'code'; out: string }
  | { k: 'break' }
  | { k: 'open' | 'close'; kind: MarkKind; out: string };

interface InlineStyle {
  /** Escape a leading list/rule/number marker at the start of each physical line. */
  lineStart: boolean;
  /** Output for a hard line break. */
  lineBreak: string;
  /** Escape pipes inside code spans (table cells). */
  cell: boolean;
}

const PARAGRAPH_STYLE: InlineStyle = { lineStart: true, lineBreak: '\\\n', cell: false };
const CELL_STYLE: InlineStyle = { lineStart: false, lineBreak: '<br>', cell: true };
const HEADING_STYLE: InlineStyle = { lineStart: false, lineBreak: ' ', cell: false };

function marksOf(run: TextRun): MarkSpec[] {
  const marks: MarkSpec[] = [];
  if (run.href) {
    marks.push({ key: 'link:' + run.href, kind: 'link', open: '[', close: '](' + linkDestination(run.href) + ')' });
  }
  if (run.bold) marks.push({ key: 'bold', kind: 'bold', open: '**', close: '**' });
  if (run.italic) marks.push({ key: 'italic', kind: 'italic', open: '*', close: '*' });
  return marks;
}

/**
 * Turn normalised inline content into tokens, keeping one stack of open marks
 * (link, bold, italic in that order) so that consecutive runs share delimiters.
 */
function buildTokens(content: readonly Inline[], cell: boolean): Token[] {
  const stack: MarkSpec[] = [];
  const tokens: Token[] = [];
  for (const node of content) {
    if (node.type === 'break') {
      // A hard break is transparent to marks: emphasis may span a line break.
      tokens.push({ k: 'break' });
      continue;
    }
    const wanted = marksOf(node);
    const whitespaceOnly = !node.code && node.text.trim() === '';
    let desired = wanted;
    if (whitespaceOnly) {
      // Whitespace gets no delimiters of its own: it only keeps open the marks it shares.
      let n = 0;
      while (n < stack.length && wanted.some((w) => w.key === stack[n].key)) n++;
      desired = stack.slice(0, n);
    }
    let common = 0;
    while (common < stack.length && common < desired.length && stack[common].key === desired[common].key) common++;
    while (stack.length > common) {
      const mark = stack.pop() as MarkSpec;
      tokens.push({ k: 'close', kind: mark.kind, out: mark.close });
    }
    for (let i = common; i < desired.length; i++) {
      const mark = desired[i];
      stack.push(mark);
      tokens.push({ k: 'open', kind: mark.kind, out: mark.open });
    }
    tokens.push(node.code ? { k: 'code', out: codeSpan(node.text, cell) } : { k: 'text', raw: node.text });
  }
  while (stack.length > 0) {
    const mark = stack.pop() as MarkSpec;
    tokens.push({ k: 'close', kind: mark.kind, out: mark.close });
  }
  return tokens;
}

/** Remove trailing whitespace and breaks from the end of `out`, returned in their original order. */
function takeTrailingSpace(out: Token[]): Token[] {
  const taken: Token[] = [];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.k === 'break') {
      taken.unshift(last);
      out.pop();
      continue;
    }
    if (last.k !== 'text') break;
    const match = /\s+$/.exec(last.raw);
    if (!match) break;
    taken.unshift({ k: 'text', raw: match[0] });
    const rest = last.raw.slice(0, last.raw.length - match[0].length);
    if (rest === '') {
      out.pop();
      continue;
    }
    out[out.length - 1] = { k: 'text', raw: rest };
    break;
  }
  return taken;
}

/**
 * Keep whitespace outside bold and italic delimiters: leading whitespace of a
 * span goes before its opening delimiter, trailing whitespace goes after the
 * closing delimiters (but still inside any enclosing link).
 */
function hoistWhitespace(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let pending: Token[] = [];
  for (const tok of tokens) {
    if (tok.k === 'close' && tok.kind !== 'link') {
      if (pending.length === 0) pending = takeTrailingSpace(out);
      out.push(tok);
      continue;
    }
    if (pending.length > 0) {
      out.push(...pending);
      pending = [];
    }
    if (tok.k !== 'text') {
      out.push(tok);
      continue;
    }
    let raw = tok.raw;
    const lead = /^\s+/.exec(raw);
    if (lead && raw.trim() !== '') {
      let first = out.length;
      while (first > 0 && out[first - 1].k === 'open') first--;
      const at = out.findIndex((t, i) => i >= first && t.k === 'open' && t.kind !== 'link');
      if (at >= 0) {
        out.splice(at, 0, { k: 'text', raw: lead[0] });
        raw = raw.slice(lead[0].length);
      }
    }
    out.push({ k: 'text', raw });
  }
  if (pending.length > 0) out.push(...pending);
  return out;
}

function emitTokens(tokens: Token[], style: InlineStyle): string {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.k === 'text') {
      let piece = escapeText(tok.raw);
      // "!" directly before "[" would start an image, so it is escaped.
      const next = tokens[i + 1];
      const nextOpensBracket =
        next !== undefined && ((next.k === 'text' && next.raw.startsWith('[')) || (next.k === 'open' && next.kind === 'link'));
      if (nextOpensBracket && tok.raw.endsWith('!')) piece = piece.slice(0, -1) + '\\!';
      out += piece;
    } else if (tok.k === 'break') {
      out += style.lineBreak;
    } else {
      out += tok.out;
    }
  }
  return style.lineStart ? escapeLineStarts(out) : out;
}

function renderInline(content: readonly Inline[], style: InlineStyle): string {
  return emitTokens(hoistWhitespace(buildTokens(normalizeInline(content), style.cell)), style);
}

/** Drop hard breaks at either end of a block's inline content (they have no effect there). */
function trimBreaks(content: readonly Inline[]): Inline[] {
  const nodes = normalizeInline(content);
  let start = 0;
  let end = nodes.length;
  while (start < end && nodes[start].type === 'break') start++;
  while (end > start && nodes[end - 1].type === 'break') end--;
  return nodes.slice(start, end);
}

function trimLines(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function renderHeading(hashes: number, content: readonly Inline[]): string {
  const body = renderInline(content, HEADING_STYLE).trim();
  return '#'.repeat(hashes) + (body === '' ? '' : ' ' + body);
}

function renderCode(language: string, code: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));
  const label = language.replace(/`/g, '').trim().split(/\s+/)[0] ?? '';
  const open = fence + label;
  return code === '' ? `${open}\n${fence}` : `${open}\n${code}\n${fence}`;
}

/** Lines of a list. Nested lists are indented by the width of the parent's marker. */
function renderList(list: ListBlock): string[] {
  const lines: string[] = [];
  list.items.forEach((item, index) => {
    const marker =
      list.kind === 'numbered' ? `${index + 1}. ` : list.kind === 'check' ? `- [${item.checked ? 'x' : ' '}] ` : '- ';
    const width = list.kind === 'numbered' ? marker.length : 2;
    const pad = ' '.repeat(width);
    renderInline(trimBreaks(item.content), PARAGRAPH_STYLE)
      .split('\n')
      .forEach((line, i) => {
        lines.push(i === 0 ? (marker + line).trimEnd() : (pad + line).trimEnd());
      });
    for (const child of item.children) {
      for (const line of renderList(child)) lines.push(pad + line);
    }
  });
  return lines;
}

function renderQuote(paragraphs: readonly (readonly Inline[])[]): string {
  const lines: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) lines.push('>');
    for (const line of renderInline(trimBreaks(paragraph), PARAGRAPH_STYLE).split('\n')) {
      lines.push(`> ${line}`.trimEnd());
    }
  });
  return lines.join('\n');
}

/** A GFM pipe table. `header` is always emitted; an empty array gives a header of empty cells. */
function gridMarkdown(header: readonly string[], body: readonly (readonly string[])[]): string {
  const width = Math.max(1, header.length, ...body.map((row) => row.length));
  const fill = (cells: readonly string[]): string[] => Array.from({ length: width }, (_, i) => cells[i] ?? '');
  const row = (cells: readonly string[]): string => '| ' + cells.join(' | ') + ' |';
  const lines = [row(fill(header)), row(Array.from({ length: width }, () => '---'))];
  for (const cells of body) lines.push(row(fill(cells)));
  return lines.join('\n');
}

function renderTable(headerRow: boolean, rows: readonly (readonly (readonly Inline[])[])[]): string {
  const cells = rows.map((row) => row.map((cell) => renderInline(cell, CELL_STYLE).trim()));
  if (headerRow && cells.length > 0) return gridMarkdown(cells[0], cells.slice(1));
  return gridMarkdown([], cells);
}

function renderGraph(graph: GraphBlock): string {
  const label = GRAPH_TYPE_LABELS[graph.chart];
  const caption =
    graph.title.trim() === ''
      ? `**${label} chart**`
      : `**${escapeText(graph.title)}** (${label} chart)`;
  const parts = [caption];
  const axes: string[] = [];
  if (graph.xLabel.trim() !== '') axes.push(`X: ${escapeText(graph.xLabel)}`);
  if (graph.yLabel.trim() !== '') axes.push(`Y: ${escapeText(graph.yLabel)}`);
  if (axes.length > 0) parts.push(`*${axes.join(' · ')}*`);
  const cell = (value: string): string => escapeText(value).trim();
  parts.push(gridMarkdown(graph.columns.map(cell), graph.rows.map((row) => row.map(cell))));
  return parts.join('\n\n');
}

/** Markdown for one block, or null when it renders as nothing (an empty paragraph). */
function renderBlock(block: Block): string | null {
  switch (block.type) {
    case 'title':
      return renderHeading(1, block.content);
    case 'heading':
      return renderHeading(block.level + 1, block.content);
    case 'paragraph': {
      const body = trimLines(renderInline(trimBreaks(block.content), PARAGRAPH_STYLE));
      return body.trim() === '' ? null : body;
    }
    case 'code':
      return renderCode(block.language, block.text);
    case 'list':
      return renderList(block).join('\n');
    case 'quote':
      return renderQuote(block.paragraphs);
    case 'table':
      return renderTable(block.headerRow, block.rows);
    case 'divider':
      return '---';
    case 'graph':
      return renderGraph(block);
    default:
      return null;
  }
}

/**
 * Convert a document to GitHub-Flavoured Markdown. Blocks are separated by one
 * blank line and the result ends with a single newline (an empty document gives "").
 */
export function docToMarkdown(doc: Doc): string {
  let blocks: Block[];
  try {
    blocks = normalizeDoc(doc).blocks;
  } catch {
    return '';
  }
  const parts: string[] = [];
  for (const block of blocks) {
    let markdown: string | null;
    try {
      markdown = renderBlock(block);
    } catch {
      // Should not happen for normalised blocks; keep the words rather than lose the block.
      markdown = blockToPlainText(block).trim() || null;
    }
    if (markdown !== null && markdown !== '') parts.push(markdown);
  }
  return parts.length === 0 ? '' : parts.join('\n\n') + '\n';
}
