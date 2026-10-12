/**
 * ProseMirror commands for Sealpage's block and inline formatting. Everything
 * the menus, toolbar, slash menu and key bindings can do to a document is one
 * of these functions.
 */
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { type MarkType, type Node as PMNode, type NodeType, Fragment } from 'prosemirror-model';
import { liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list';
import { type Command, type EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { isInTable } from 'prosemirror-tables';
import { type GraphBlock, defaultGraph } from '../../shared/model';
import { LIST_NODE_NAMES, type ListNodeName, schema } from './schema';

const n = schema.nodes;
const m = schema.marks;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** The nearest ancestor of the selection start with one of the given types. */
export function findAncestor(state: EditorState, types: readonly NodeType[]): { node: PMNode; pos: number; depth: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (types.includes(node.type)) return { node, pos: $from.before(d), depth: d };
  }
  return null;
}

const LIST_TYPES = LIST_NODE_NAMES.map((name) => n[name]!);

/** The innermost list containing the selection, if any. */
export function currentList(state: EditorState): { node: PMNode; pos: number; depth: number } | null {
  return findAncestor(state, LIST_TYPES);
}

export function inNode(state: EditorState, type: NodeType): boolean {
  return findAncestor(state, [type]) !== null;
}

/** True when the selection's text block is a heading of this level (1 = title). */
export function headingActive(state: EditorState, level: number): boolean {
  const { $from, to } = state.selection;
  return to <= $from.end() && $from.parent.type === n.heading && $from.parent.attrs.level === level;
}

export function paragraphActive(state: EditorState): boolean {
  const { $from, to } = state.selection;
  return to <= $from.end() && $from.parent.type === n.paragraph && !currentList(state) && !inNode(state, n.blockquote!);
}

/** The selected graph node and its position, if a graph is selected. */
export function selectedGraph(state: EditorState): { spec: GraphBlock; pos: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type === n.graph) return { spec: sel.node.attrs.spec as GraphBlock, pos: sel.from };
  return null;
}

/** The href of the link at the cursor / covering the selection start, if any. */
export function linkAtSelection(state: EditorState): string | null {
  const { $from, empty } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : ($from.nodeAfter?.marks ?? $from.marks());
  const link = m.link!.isInSet(marks);
  return link ? String(link.attrs.href) : null;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

export const toggleBold: Command = toggleMark(m.strong!);
export const toggleItalic: Command = toggleMark(m.em!);
export const toggleInlineCode: Command = toggleMark(m.code!);

/** Extend an empty selection inside a link to cover the whole link. */
function linkRange(state: EditorState): { from: number; to: number } {
  const { from, to, empty, $from } = state.selection;
  if (!empty) return { from, to };
  const link = m.link!.isInSet($from.marks());
  if (!link) return { from, to };
  const parent = $from.parent;
  const base = $from.start();
  let start = $from.parentOffset;
  let end = $from.parentOffset;
  let offset = 0;
  // collect the contiguous run of children carrying this exact link mark around the cursor
  const spans: { from: number; to: number; linked: boolean }[] = [];
  parent.forEach((child) => {
    spans.push({ from: offset, to: offset + child.nodeSize, linked: link.isInSet(child.marks) !== undefined });
    offset += child.nodeSize;
  });
  const idx = spans.findIndex((s) => s.linked && s.from <= $from.parentOffset && $from.parentOffset <= s.to);
  if (idx < 0) return { from, to };
  let i = idx;
  while (i > 0 && spans[i - 1]!.linked) i--;
  start = spans[i]!.from;
  i = idx;
  while (i < spans.length - 1 && spans[i + 1]!.linked) i++;
  end = spans[i]!.to;
  return { from: base + start, to: base + end };
}

/**
 * Set (or with href === null remove) a link on the selection. With an empty
 * selection inside a link the whole link is updated; with an empty selection
 * elsewhere the href itself is inserted as the link text.
 */
export function setLink(href: string | null): Command {
  return (state, dispatch) => {
    const range = linkRange(state);
    if (href === null || href.trim() === '') {
      if (range.from === range.to) return false;
      dispatch?.(state.tr.removeMark(range.from, range.to, m.link!).scrollIntoView());
      return true;
    }
    const target = href.trim();
    const mark = m.link!.create({ href: target });
    if (range.from === range.to) {
      if (!state.selection.$from.parent.inlineContent || state.selection.$from.parent.type.spec.code) return false;
      dispatch?.(state.tr.replaceSelectionWith(schema.text(target, [mark]), false).scrollIntoView());
      return true;
    }
    dispatch?.(state.tr.removeMark(range.from, range.to, m.link!).addMark(range.from, range.to, mark).scrollIntoView());
    return true;
  };
}

/** Remove bold / italic / code / link from the selection. */
export const clearFormatting: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) {
    if (!state.storedMarks?.length && !state.selection.$from.marks().length) return false;
    dispatch?.(state.tr.setStoredMarks([]));
    return true;
  }
  let tr = state.tr;
  for (const mark of Object.values(m)) tr = tr.removeMark(from, to, mark);
  dispatch?.(tr.scrollIntoView());
  return true;
};

export const insertLineBreak: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) {
    dispatch?.(state.tr.insertText('\n').scrollIntoView());
    return true;
  }
  if (!$from.parent.inlineContent) return false;
  dispatch?.(state.tr.replaceSelectionWith(n.hard_break!.create()).scrollIntoView());
  return true;
};

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

function setTextBlock(type: NodeType, attrs?: Record<string, unknown>): Command {
  return (state, dispatch) => setBlockType(type, attrs)(state, dispatch ? (tr) => dispatch(tr.scrollIntoView()) : undefined);
}

/**
 * Back to a plain paragraph: a heading or code block becomes a paragraph;
 * otherwise the selection is lifted one level out of its list or quote.
 */
export const setParagraph: Command = (state, dispatch) => {
  const parent = state.selection.$from.parent;
  if (parent.type !== n.paragraph && parent.isTextblock) return setTextBlock(n.paragraph!)(state, dispatch);
  if (currentList(state)) return liftListItem(n.list_item!)(state, dispatch);
  if (inNode(state, n.blockquote!)) return lift(state, dispatch);
  return false;
};

/** level 1 = title, 2-4 = subheading 1-3. Applying the active level again reverts to a paragraph. */
export function toggleHeading(level: 1 | 2 | 3 | 4): Command {
  return (state, dispatch) => {
    if (headingActive(state, level)) return setTextBlock(n.paragraph!)(state, dispatch);
    return setTextBlock(n.heading!, { level })(state, dispatch);
  };
}

export const toggleCodeBlock: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type === n.code_block) return setTextBlock(n.paragraph!)(state, dispatch);
  return setTextBlock(n.code_block!, { language: '' })(state, dispatch);
};

export const toggleQuote: Command = (state, dispatch) => {
  if (inNode(state, n.blockquote!)) return lift(state, dispatch);
  return wrapIn(n.blockquote!)(state, dispatch);
};

/**
 * Toggle a list of the given kind: wraps the selection, converts a list of
 * another kind in place, or lifts out of a list of the same kind.
 */
export function toggleList(name: ListNodeName): Command {
  const type = n[name]!;
  return (state, dispatch) => {
    const list = currentList(state);
    if (list) {
      if (list.node.type === type) return liftListItem(n.list_item!)(state, dispatch);
      if (dispatch) {
        let tr = state.tr.setNodeMarkup(list.pos, type);
        if (type !== n.check_list) {
          // "checked" has no meaning outside a checklist
          list.node.forEach((item, offset) => {
            if (item.attrs.checked) tr = tr.setNodeMarkup(list.pos + 1 + offset, undefined, { ...item.attrs, checked: false });
          });
        }
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    return wrapInList(type)(state, dispatch);
  };
}

export const indentListItem: Command = sinkListItem(n.list_item!);
export const outdentListItem: Command = liftListItem(n.list_item!);

/** Toggle the checkbox of the checklist item containing the cursor. */
export const toggleChecked: Command = (state, dispatch) => {
  const item = findAncestor(state, [n.list_item!]);
  if (!item) return false;
  const parent = state.doc.resolve(item.pos).parent;
  if (parent.type !== n.check_list) return false;
  dispatch?.(state.tr.setNodeMarkup(item.pos, undefined, { ...item.node.attrs, checked: !item.node.attrs.checked }));
  return true;
};

// ---------------------------------------------------------------------------
// Inserting blocks
// ---------------------------------------------------------------------------

/**
 * Insert a block node at the selection: replaces an empty top-level paragraph,
 * otherwise goes after the current top-level block. `selectInside` puts the
 * cursor in the new node's first text position (tables), otherwise the node
 * itself is selected (atoms) or the cursor moves after it.
 */
function insertBlock(make: (state: EditorState) => PMNode, selectInside: boolean): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.depth === 0 && !(state.selection instanceof NodeSelection)) return false;
    const node = make(state);
    if (!dispatch) return true;
    const top = $from.depth === 0 ? null : $from.node(1);
    const topStart = $from.depth === 0 ? state.selection.from : $from.before(1);
    const topEnd = $from.depth === 0 ? state.selection.to : $from.after(1);
    const emptyPara = top !== null && $from.depth === 1 && top.type === n.paragraph && top.content.size === 0;
    let tr = state.tr;
    let at: number;
    if (emptyPara) {
      tr = tr.replaceWith(topStart, topEnd, node);
      at = topStart;
    } else {
      tr = tr.insert(topEnd, node);
      at = topEnd;
    }
    // keep a paragraph after the new block so typing can continue
    const end = at + node.nodeSize;
    if (end >= tr.doc.content.size) tr = tr.insert(end, n.paragraph!.create());
    if (selectInside) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
    else if (node.type.spec.atom && node.type.spec.selectable !== false && node.type !== n.horizontal_rule) tr = tr.setSelection(NodeSelection.create(tr.doc, at));
    else tr = tr.setSelection(TextSelection.near(tr.doc.resolve(end), 1));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export const insertDivider: Command = insertBlock(() => n.horizontal_rule!.create(), false);

export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    return insertBlock(() => {
      const makeRow = (header: boolean): PMNode =>
        n.table_row!.create(null, Fragment.fromArray(Array.from({ length: cols }, () => n[header ? 'table_header' : 'table_cell']!.createAndFill()!)));
      return n.table!.create(null, Fragment.fromArray(Array.from({ length: rows }, (_, r) => makeRow(r === 0))));
    }, true)(state, dispatch);
  };
}

export function insertGraph(spec: GraphBlock = defaultGraph()): Command {
  return insertBlock(() => n.graph!.create({ spec }), false);
}

/** In a code block, Tab inserts two spaces. */
export const indentCode: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.type.spec.code) return false;
  dispatch?.(state.tr.insertText('  ').scrollIntoView());
  return true;
};

/**
 * Backspace at the very start of a block: a heading / code block / quote /
 * list item first turns back into ordinary text instead of joining upwards.
 */
export const backspaceAtBlockStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  const parent = $from.parent;
  if (parent.type === n.heading || (parent.type === n.code_block && parent.content.size === 0)) {
    return setBlockType(n.paragraph!)(state, dispatch);
  }
  if (parent.type !== n.paragraph) return false;
  const grand = $from.depth >= 2 ? $from.node($from.depth - 1) : null;
  if (grand?.type === n.list_item && $from.index($from.depth - 1) === 0) {
    return liftListItem(n.list_item!)(state, dispatch);
  }
  if (grand?.type === n.blockquote && $from.index($from.depth - 1) === 0) {
    return lift(state, dispatch);
  }
  return false;
};
