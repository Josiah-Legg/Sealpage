/**
 * Conversion between the shared document model (src/shared/model.ts) and a
 * ProseMirror document. Both directions are total, and
 *
 *     pmToDoc(docToPm(d))  deep-equals  normalizeDoc(d)
 *
 * for every document with at least one block (an empty model document is
 * shown in the editor as a single empty paragraph).
 */
import type { Mark, Node as PMNode } from 'prosemirror-model';
import {
  type Block,
  type Doc,
  type GraphBlock,
  type Inline,
  type ListBlock,
  type ListItem,
  type ListKind,
  defaultGraph,
  normalizeBlock,
  normalizeDoc,
} from '../../shared/model';
import { schema } from './schema';

const LIST_NODE: Record<ListKind, string> = { bullet: 'bullet_list', numbered: 'ordered_list', check: 'check_list' };
const LIST_KIND: Record<string, ListKind> = { bullet_list: 'bullet', ordered_list: 'numbered', check_list: 'check' };

// ---------------------------------------------------------------------------
// model -> ProseMirror
// ---------------------------------------------------------------------------

function inlineToPm(content: readonly Inline[]): PMNode[] {
  const out: PMNode[] = [];
  for (const node of content) {
    if (node.type === 'break') {
      out.push(schema.nodes.hard_break!.create());
      continue;
    }
    if (node.text === '') continue;
    const marks: Mark[] = [];
    if (node.href) marks.push(schema.marks.link!.create({ href: node.href }));
    if (node.bold) marks.push(schema.marks.strong!.create());
    if (node.italic) marks.push(schema.marks.em!.create());
    if (node.code) marks.push(schema.marks.code!.create());
    out.push(schema.text(node.text, marks));
  }
  return out;
}

function listToPm(l: ListBlock): PMNode {
  const items = l.items.map((item) =>
    schema.nodes.list_item!.create({ checked: l.kind === 'check' && item.checked }, [
      schema.nodes.paragraph!.create(null, inlineToPm(item.content)),
      ...item.children.map(listToPm),
    ]),
  );
  return schema.nodes[LIST_NODE[l.kind]]!.create(null, items);
}

function blockToPm(block: Block): PMNode {
  switch (block.type) {
    case 'title':
      return schema.nodes.heading!.create({ level: 1 }, inlineToPm(block.content));
    case 'heading':
      return schema.nodes.heading!.create({ level: block.level + 1 }, inlineToPm(block.content));
    case 'paragraph':
      return schema.nodes.paragraph!.create(null, inlineToPm(block.content));
    case 'code':
      return schema.nodes.code_block!.create({ language: block.language }, block.text === '' ? [] : [schema.text(block.text)]);
    case 'list':
      return listToPm(block);
    case 'quote':
      return schema.nodes.blockquote!.create(
        null,
        block.paragraphs.map((p) => schema.nodes.paragraph!.create(null, inlineToPm(p))),
      );
    case 'table':
      return schema.nodes.table!.create(
        null,
        block.rows.map((row, r) =>
          schema.nodes.table_row!.create(
            null,
            row.map((cell) => schema.nodes[block.headerRow && r === 0 ? 'table_header' : 'table_cell']!.create(null, inlineToPm(cell))),
          ),
        ),
      );
    case 'divider':
      return schema.nodes.horizontal_rule!.create();
    case 'graph':
      return schema.nodes.graph!.create({ spec: block });
  }
}

/** Build a ProseMirror document from a model document. */
export function docToPm(doc: Doc): PMNode {
  const blocks = normalizeDoc(doc).blocks.map(blockToPm);
  if (blocks.length === 0) blocks.push(schema.nodes.paragraph!.create());
  return schema.nodes.doc!.create(null, blocks);
}

// ---------------------------------------------------------------------------
// ProseMirror -> model
// ---------------------------------------------------------------------------

function pmToInline(node: PMNode): Inline[] {
  const out: Inline[] = [];
  node.forEach((child) => {
    if (child.type.name === 'hard_break') {
      out.push({ type: 'break' });
    } else if (child.isText) {
      let bold = false;
      let italic = false;
      let code = false;
      let href: string | null = null;
      for (const mark of child.marks) {
        if (mark.type.name === 'strong') bold = true;
        else if (mark.type.name === 'em') italic = true;
        else if (mark.type.name === 'code') code = true;
        else if (mark.type.name === 'link') href = String(mark.attrs.href ?? '') || null;
      }
      out.push({ type: 'text', text: child.text ?? '', bold, italic, code, href });
    }
  });
  return out;
}

function pmToList(node: PMNode): ListBlock {
  const kind = LIST_KIND[node.type.name] ?? 'bullet';
  const items: ListItem[] = [];
  node.forEach((li) => {
    const item: ListItem = { content: [], checked: kind === 'check' && li.attrs.checked === true, children: [] };
    li.forEach((child, _offset, index) => {
      if (index === 0 && child.type.name === 'paragraph') item.content = pmToInline(child);
      else if (child.type.name in LIST_KIND) item.children.push(pmToList(child));
    });
    items.push(item);
  });
  return { type: 'list', kind, items };
}

function pmToBlock(node: PMNode): Block | null {
  switch (node.type.name) {
    case 'paragraph':
      return { type: 'paragraph', content: pmToInline(node) };
    case 'heading': {
      const level = Number(node.attrs.level) || 2;
      if (level <= 1) return { type: 'title', content: pmToInline(node) };
      return { type: 'heading', level: level === 3 ? 2 : level >= 4 ? 3 : 1, content: pmToInline(node) };
    }
    case 'code_block':
      return { type: 'code', language: String(node.attrs.language ?? ''), text: node.textContent };
    case 'bullet_list':
    case 'ordered_list':
    case 'check_list':
      return pmToList(node);
    case 'blockquote': {
      const paragraphs: Inline[][] = [];
      node.forEach((p) => paragraphs.push(pmToInline(p)));
      return { type: 'quote', paragraphs };
    }
    case 'table': {
      const rows: Inline[][][] = [];
      let headerRow = false;
      node.forEach((row, _offset, r) => {
        const cells: Inline[][] = [];
        let allHeaders = row.childCount > 0;
        row.forEach((cell) => {
          cells.push(pmToInline(cell));
          if (cell.type.name !== 'table_header') allHeaders = false;
        });
        if (r === 0) headerRow = allHeaders;
        rows.push(cells);
      });
      return { type: 'table', headerRow, rows };
    }
    case 'horizontal_rule':
      return { type: 'divider' };
    case 'graph': {
      const spec = node.attrs.spec as GraphBlock | undefined;
      const normal = spec ? normalizeBlock({ ...spec, type: 'graph' }) : null;
      return normal ?? defaultGraph();
    }
    default:
      return null;
  }
}

/** Read the model document out of a ProseMirror document. Always normalised. */
export function pmToDoc(doc: PMNode): Doc {
  const blocks: Block[] = [];
  doc.forEach((node) => {
    const b = pmToBlock(node);
    if (b) blocks.push(b);
  });
  return normalizeDoc({ blocks });
}
