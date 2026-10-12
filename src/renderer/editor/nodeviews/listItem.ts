/**
 * Node view for list items. One view serves bullet, numbered and check lists;
 * the checkbox is only displayed inside a check list (see blocks.css).
 * Clicking the checkbox ticks the item without moving the text cursor.
 */
import '../../css/blocks.css';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { h } from '../../ui/dom';

type ViewMutation = Parameters<NonNullable<NodeView['ignoreMutation']>>[0];

export function listItemView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  let current = node;

  const checkbox = h('span', { class: 'sp-check', contenteditable: 'false', role: 'checkbox', tabIndex: -1 });
  const content = h('div', { class: 'sp-list-item-content' });
  const dom = h('li', { class: 'sp-list-item' }, checkbox, content);

  const syncChecked = (checked: boolean): void => {
    dom.setAttribute('data-checked', checked ? 'true' : 'false');
    checkbox.setAttribute('aria-checked', checked ? 'true' : 'false');
  };
  syncChecked(Boolean(node.attrs.checked));

  // Keep the pointer from moving the text cursor or taking focus away from the text.
  checkbox.addEventListener('mousedown', (event) => event.preventDefault());
  checkbox.addEventListener('click', (event) => {
    event.preventDefault();
    const pos = getPos();
    if (pos === undefined) return;
    const target = view.state.doc.nodeAt(pos);
    if (!target || target.type !== current.type) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...target.attrs, checked: !target.attrs.checked }));
  });

  return {
    dom,
    contentDOM: content,

    update(newNode: PMNode): boolean {
      if (newNode.type !== current.type) return false;
      current = newNode;
      syncChecked(Boolean(newNode.attrs.checked));
      return true;
    },

    stopEvent(event: Event): boolean {
      return event.target instanceof Node && checkbox.contains(event.target);
    },

    ignoreMutation(mutation: ViewMutation): boolean {
      // Attribute changes on the item itself and on its checkbox are ours; content is ProseMirror's.
      return mutation.target === dom || checkbox.contains(mutation.target);
    },
  };
}
