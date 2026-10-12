/**
 * Creates the ProseMirror editor for one document tab: plugins, key map,
 * input rules and node views.
 *
 * Formatting shortcuts (Ctrl+B and friends) are NOT bound here; they are
 * application commands dispatched by src/renderer/app/keybindings.ts. This key
 * map only holds the structural editing keys (Enter, Tab, Backspace…).
 */
import { baseKeymap, chainCommands, exitCode, newlineInCode } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { search } from 'prosemirror-search';
import { type Command, EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { goToNextCell, tableEditing } from 'prosemirror-tables';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import type { Doc } from '../../shared/model';
import type { AppController } from '../app/controller';
import { backspaceAtBlockStart, indentCode, insertLineBreak, toggleChecked } from './commands';
import { docToPm, pmToDoc } from './convert';
import { highlightPlugin } from './highlight';
import { codeBlockView } from './nodeviews/codeBlock';
import { createGraphView } from './nodeviews/graph';
import { listItemView } from './nodeviews/listItem';
import { schema } from './schema';
import { slashMenuPlugin } from './slashMenu';

const n = schema.nodes;

export interface EditorHooks {
  /** The document content changed. */
  onDocChange(): void;
  /** Any transaction was applied (selection moved, content changed…). */
  onStateChange(): void;
}

export interface EditorHandle {
  view: EditorView;
  /** The current document as a normalised model. */
  getDoc(): Doc;
  destroy(): void;
}

/** Markdown-style typing shortcuts. Optional conveniences: nothing requires them. */
function buildInputRules(): Plugin {
  const divider = new InputRule(/^---$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type !== n.paragraph || $start.depth !== 1) return null;
    const from = $start.before();
    const tr = state.tr.replaceWith(from, $start.after(), [n.horizontal_rule!.create(), n.paragraph!.create()]);
    void end;
    return tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2)));
  });
  return inputRules({
    rules: [
      wrappingInputRule(/^\s*([-*])\s$/, n.bullet_list!),
      wrappingInputRule(/^(\d+)[.)]\s$/, n.ordered_list!),
      wrappingInputRule(/^\s*\[( |x|X)?\]\s$/, n.check_list!),
      wrappingInputRule(/^\s*>\s$/, n.blockquote!),
      textblockTypeInputRule(/^```$/, n.code_block!, { language: '' }),
      textblockTypeInputRule(/^(#{1,4})\s$/, n.heading!, (match) => ({ level: match[1]!.length })),
      divider,
    ],
  });
}

const placeholderKey = new PluginKey('sp-placeholder');

/** Hint text in an otherwise empty document. */
function placeholderPlugin(): Plugin {
  return new Plugin({
    key: placeholderKey,
    props: {
      decorations(state) {
        const doc = state.doc;
        const first = doc.firstChild;
        if (doc.childCount !== 1 || !first || first.type !== n.paragraph || first.content.size !== 0) return null;
        return DecorationSet.create(doc, [
          Decoration.node(0, first.nodeSize, { class: 'sp-placeholder', 'data-placeholder': 'Start writing, or type / for blocks' }),
        ]);
      },
    },
  });
}

/** Keep a paragraph at the end of the document after blocks the caret cannot leave by typing. */
function trailingParagraphPlugin(): Plugin {
  const needsTrailer = new Set([n.horizontal_rule, n.graph, n.table, n.code_block]);
  return new Plugin({
    appendTransaction(_trs, _old, state) {
      const last = state.doc.lastChild;
      if (!last || !needsTrailer.has(last.type)) return null;
      return state.tr.insert(state.doc.content.size, n.paragraph!.create()).setMeta('addToHistory', false);
    },
  });
}

/** Ctrl+click (or middle click) opens a link in the default browser. */
function linkClickPlugin(app: AppController): Plugin {
  const open = (event: MouseEvent): boolean => {
    const el = (event.target as HTMLElement | null)?.closest?.('a.sp-link');
    const href = el?.getAttribute('data-href');
    if (!href) return false;
    event.preventDefault();
    void app.api.openExternal(href);
    return true;
  };
  return new Plugin({
    props: {
      handleDOMEvents: {
        click: (_view, event) => (event.ctrlKey || event.metaKey ? open(event) : false),
        auxclick: (_view, event) => (event.button === 1 ? open(event) : false),
      },
    },
  });
}

const li = n.list_item!;

function buildKeymap(): Plugin {
  const tab: Command = chainCommands(goToNextCell(1), sinkListItem(li), indentCode, () => true);
  const shiftTab: Command = chainCommands(goToNextCell(-1), liftListItem(li), () => true);
  return keymap({
    // a new list item always starts unticked
    Enter: chainCommands(newlineInCode, splitListItem(li, { checked: false }), baseKeymap.Enter!),
    'Shift-Enter': chainCommands(exitCode, insertLineBreak),
    'Mod-Enter': chainCommands(toggleChecked, exitCode),
    Tab: tab,
    'Shift-Tab': shiftTab,
    Backspace: chainCommands(undoInputRule, backspaceAtBlockStart, baseKeymap.Backspace!),
    // undo / redo are also application commands; these cover the alternative chord
    'Mod-z': undo,
    'Mod-y': redo,
    'Shift-Mod-z': redo,
  });
}

export function createEditor(mount: HTMLElement, doc: Doc, app: AppController, hooks: EditorHooks): EditorHandle {
  const state = EditorState.create({
    doc: docToPm(doc),
    plugins: [
      buildInputRules(),
      slashMenuPlugin(app),
      buildKeymap(),
      keymap(baseKeymap),
      history({ depth: 300, newGroupDelay: 600 }),
      dropCursor({ class: 'sp-dropcursor' }),
      gapCursor(),
      tableEditing(),
      search(),
      highlightPlugin(),
      placeholderPlugin(),
      trailingParagraphPlugin(),
      linkClickPlugin(app),
    ],
  });

  const view = new EditorView(mount, {
    state,
    attributes: { class: 'sp-document', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' },
    nodeViews: {
      code_block: codeBlockView,
      list_item: listItemView,
      graph: createGraphView(app),
    },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (tr.docChanged) hooks.onDocChange();
      hooks.onStateChange();
    },
    // Never let the browser treat dropped files as navigation or content.
    handleDrop: (_view, event) => (event.dataTransfer?.files.length ?? 0) > 0,
    transformPastedHTML: (html) => html,
  });

  return {
    view,
    getDoc: () => pmToDoc(view.state.doc),
    destroy: () => view.destroy(),
  };
}

/** Plain text of a ProseMirror document, blocks separated by newlines (for counts). */
export function plainText(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, '\n', ' ');
}
