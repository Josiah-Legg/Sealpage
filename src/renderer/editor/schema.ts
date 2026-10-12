/**
 * ProseMirror schema for Sealpage documents. See docs/ARCHITECTURE.md §5.6
 * for the mapping to the shared document model.
 */
import { type DOMOutputSpec, type MarkSpec, type NodeSpec, Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';
import { type GraphBlock, defaultGraph, normalizeBlock } from '../../shared/model';

/** Parse the JSON carried by a pasted / dragged graph element back into a spec. */
export function parseGraphSpec(json: string | null): GraphBlock {
  try {
    const raw = JSON.parse(json ?? '') as GraphBlock;
    if (raw && typeof raw === 'object') {
      const n = normalizeBlock({ ...raw, type: 'graph' });
      if (n && n.type === 'graph') return n;
    }
  } catch {
    /* fall through */
  }
  return defaultGraph();
}

const tables = tableNodes({ tableGroup: 'block', cellContent: 'inline*', cellAttributes: {} });

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: (): DOMOutputSpec => ['p', 0],
  },

  /** level 1 is the document title; 2-4 are subheading levels 1-3. */
  heading: {
    attrs: { level: { default: 2, validate: 'number' } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      { tag: 'h4', attrs: { level: 4 } },
      { tag: 'h5', attrs: { level: 4 } },
      { tag: 'h6', attrs: { level: 4 } },
    ],
    toDOM: (node): DOMOutputSpec => {
      const level = Math.min(4, Math.max(1, Number(node.attrs.level) || 2));
      return [`h${level}`, { class: level === 1 ? 'sp-title' : `sp-heading sp-heading-${level - 1}` }, 0];
    },
  },

  code_block: {
    attrs: { language: { default: '', validate: 'string' } },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs: (dom) => ({ language: (dom as HTMLElement).getAttribute('data-language') ?? '' }),
      },
    ],
    toDOM: (node): DOMOutputSpec => ['pre', { class: 'sp-code', 'data-language': String(node.attrs.language) }, ['code', 0]],
  },

  blockquote: {
    content: 'paragraph+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: (): DOMOutputSpec => ['blockquote', { class: 'sp-quote' }, 0],
  },

  bullet_list: {
    content: 'list_item+',
    group: 'block list',
    parseDOM: [{ tag: 'ul:not([data-sp-list="check"])' }],
    toDOM: (): DOMOutputSpec => ['ul', { class: 'sp-list sp-list-bullet', 'data-sp-list': 'bullet' }, 0],
  },

  ordered_list: {
    content: 'list_item+',
    group: 'block list',
    parseDOM: [{ tag: 'ol' }],
    toDOM: (): DOMOutputSpec => ['ol', { class: 'sp-list sp-list-numbered', 'data-sp-list': 'numbered' }, 0],
  },

  check_list: {
    content: 'list_item+',
    group: 'block list',
    parseDOM: [{ tag: 'ul[data-sp-list="check"]', priority: 60 }],
    toDOM: (): DOMOutputSpec => ['ul', { class: 'sp-list sp-list-check', 'data-sp-list': 'check' }, 0],
  },

  /** `checked` is only shown (and only meaningful) inside a check_list. */
  list_item: {
    attrs: { checked: { default: false, validate: 'boolean' } },
    content: 'paragraph list*',
    defining: true,
    parseDOM: [
      {
        tag: 'li',
        getAttrs: (dom) => ({ checked: (dom as HTMLElement).getAttribute('data-checked') === 'true' }),
      },
    ],
    toDOM: (node): DOMOutputSpec => ['li', { class: 'sp-list-item', 'data-checked': node.attrs.checked ? 'true' : 'false' }, 0],
  },

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: (): DOMOutputSpec => ['hr', { class: 'sp-divider' }],
  },

  /** A graph: an atom whose whole definition lives in the `spec` attribute. */
  graph: {
    attrs: { spec: { default: defaultGraph() } },
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    parseDOM: [
      {
        tag: 'div[data-sp-graph]',
        getAttrs: (dom) => ({ spec: parseGraphSpec((dom as HTMLElement).getAttribute('data-sp-graph')) }),
      },
    ],
    toDOM: (node): DOMOutputSpec => ['div', { class: 'sp-graph-block', 'data-sp-graph': JSON.stringify(node.attrs.spec) }],
  },

  table: { ...tables.table, toDOM: (): DOMOutputSpec => ['table', { class: 'sp-table' }, ['tbody', 0]] },
  table_row: tables.table_row,
  table_cell: tables.table_cell,
  table_header: tables.table_header,

  text: { group: 'inline' },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: (): DOMOutputSpec => ['br'],
  },
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: { validate: 'string' } },
    inclusive: false,
    parseDOM: [
      {
        // a[data-href] is our own rendering (copy / paste inside the app); a[href] is foreign HTML
        tag: 'a[data-href], a[href]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const href = el.getAttribute('data-href') ?? el.getAttribute('href') ?? '';
          return href === '' ? false : { href };
        },
      },
    ],
    // No real href attribute: the editor decides what a click does (Ctrl+click opens).
    toDOM: (mark): DOMOutputSpec => ['a', { class: 'sp-link', 'data-href': String(mark.attrs.href), title: String(mark.attrs.href) }, 0],
  },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (dom) => (dom as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null },
    ],
    toDOM: (): DOMOutputSpec => ['strong', 0],
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: (): DOMOutputSpec => ['em', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: (): DOMOutputSpec => ['code', { class: 'sp-inline-code' }, 0],
  },
};

export const schema = new Schema({ nodes, marks });

export const LIST_NODE_NAMES = ['bullet_list', 'ordered_list', 'check_list'] as const;
export type ListNodeName = (typeof LIST_NODE_NAMES)[number];
