/**
 * Sealmark serialiser: Doc -> text. See docs/FORMAT.md.
 *
 * The serialiser is strict: it always writes the canonical form, so that
 * parseMarkup(serializeMarkup(doc)) deep-equals normalizeDoc(doc).
 */
import {
  type Block,
  type Doc,
  type GraphBlock,
  type Inline,
  type ListBlock,
  type TableBlock,
  normalizeDoc,
} from '../model';
import { LINE_START_SIGILS, serializeInline } from './inline';

export const MARKUP_VERSION = 1;
export const MARKUP_HEADER = `~sealpage ${MARKUP_VERSION}`;

const LIST_MARKERS = { bullet: '-', numbered: '+' } as const;

function withContent(prefix: string, content: readonly Inline[]): string {
  const s = serializeInline(content);
  return s === '' ? prefix : `${prefix} ${s}`;
}

function paragraphLine(content: readonly Inline[]): string {
  const s = serializeInline(content);
  if (s === '') return '\\';
  return LINE_START_SIGILS.has(s[0]!) ? '\\' + s : s;
}

function listLines(l: ListBlock, depth: number, out: string[]): void {
  const indent = '  '.repeat(depth);
  for (const item of l.items) {
    const marker = l.kind === 'check' ? (item.checked ? '-[x]' : '-[ ]') : LIST_MARKERS[l.kind];
    out.push(withContent(indent + marker, item.content));
    for (const child of item.children) listLines(child, depth + 1, out);
  }
}

function tableLines(t: TableBlock, out: string[]): void {
  out.push(t.headerRow ? '@table header' : '@table');
  for (const row of t.rows) {
    out.push('|' + row.map((cell) => ` ${serializeInline(cell)} |`).join(''));
  }
}

function graphLines(g: GraphBlock, out: string[]): void {
  out.push(`@graph ${g.chart}`);
  out.push(`: title ${JSON.stringify(g.title)}`);
  out.push(`: x-label ${JSON.stringify(g.xLabel)}`);
  out.push(`: y-label ${JSON.stringify(g.yLabel)}`);
  out.push(`: legend ${g.legend.show ? 'show' : 'hide'} ${g.legend.position}`);
  out.push(`: bins ${g.bins}`);
  out.push(`| ${JSON.stringify(g.columns)}`);
  for (const row of g.rows) out.push(`| ${JSON.stringify(row)}`);
}

function blockLines(block: Block, out: string[]): void {
  switch (block.type) {
    case 'title':
      out.push(withContent('=', block.content));
      break;
    case 'heading':
      out.push(withContent('='.repeat(block.level + 1), block.content));
      break;
    case 'paragraph':
      out.push(paragraphLine(block.content));
      break;
    case 'code':
      out.push(`@code ${JSON.stringify(block.language)}`);
      for (const line of block.text.split('\n')) out.push(line === '' ? '|' : `| ${line}`);
      break;
    case 'list':
      listLines(block, 0, out);
      break;
    case 'quote':
      for (const p of block.paragraphs) out.push(withContent('>', p));
      break;
    case 'table':
      tableLines(block, out);
      break;
    case 'divider':
      out.push('---');
      break;
    case 'graph':
      graphLines(block, out);
      break;
  }
}

/** Serialise a document to Sealmark text. The document is normalised first. */
export function serializeMarkup(doc: Doc): string {
  const lines: string[] = [MARKUP_HEADER];
  for (const block of normalizeDoc(doc).blocks) {
    lines.push('');
    blockLines(block, lines);
  }
  return lines.join('\n') + '\n';
}
