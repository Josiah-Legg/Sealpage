/**
 * Node view for code blocks: a slim header with a language label and a copy
 * button above the code. The header is outside the editable content (the
 * <code> element is the content DOM), so typing in the label never reaches the
 * document text. See docs/ARCHITECTURE.md §5.6 and §6.
 */
import '../../css/blocks.css';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { h, icon } from '../../ui/dom';

/** Suggestions for the language label. Any other label is accepted too. */
const LANGUAGE_SUGGESTIONS = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'kotlin',
  'lua',
  'markdown',
  'php',
  'powershell',
  'python',
  'ruby',
  'rust',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
];

/** How long the copy button shows the check mark. */
const COPIED_FEEDBACK_MS = 1200;

let suggestionListCount = 0;

type ViewMutation = Parameters<NonNullable<NodeView['ignoreMutation']>>[0];

function languageOf(node: PMNode): string {
  return String(node.attrs.language ?? '');
}

export function codeBlockView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  let current = node;
  let destroyed = false;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const listId = `sp-code-languages-${++suggestionListCount}`;
  const input = h('input', {
    class: 'sp-code-language',
    type: 'text',
    placeholder: 'plain text',
    list: listId,
    value: languageOf(node),
    'aria-label': 'Code language',
  });
  input.spellcheck = false;
  const suggestions = h('datalist', { id: listId }, ...LANGUAGE_SUGGESTIONS.map((name) => h('option', { value: name })));

  const copyButton = h('button', { class: 'sp-icon-btn sp-code-copy', type: 'button', title: 'Copy code', 'aria-label': 'Copy code' }, icon('copy'));

  const header = h('div', { class: 'sp-code-header sp-no-print', contenteditable: 'false' }, input, suggestions, copyButton);
  const code = h('code');
  const pre = h('pre', { class: 'sp-code', dataset: { language: languageOf(node) } }, code);
  const dom = h('div', { class: 'sp-code-block' }, header, pre);

  /** Store the label as the block's language. Only dispatches when the label really changed. */
  const commit = (): void => {
    if (destroyed) return;
    const language = input.value.trim();
    if (language === languageOf(current)) return;
    const pos = getPos();
    if (pos === undefined) return;
    const target = view.state.doc.nodeAt(pos);
    if (!target || target.type !== current.type) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...target.attrs, language }));
  };

  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      commit();
      view.focus();
    }
  });

  const showCopied = (): void => {
    copyButton.replaceChildren(icon('check'));
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyTimer = null;
      if (!destroyed) copyButton.replaceChildren(icon('copy'));
    }, COPIED_FEEDBACK_MS);
  };

  copyButton.addEventListener('click', () => {
    try {
      void navigator.clipboard.writeText(current.textContent).then(showCopied, () => undefined);
    } catch {
      /* no clipboard available: nothing to copy to */
    }
  });

  return {
    dom,
    contentDOM: code,

    update(newNode: PMNode): boolean {
      if (newNode.type !== current.type) return false;
      current = newNode;
      const language = languageOf(newNode);
      pre.dataset.language = language;
      // Do not overwrite what the user is typing; only sync when the label is not being edited.
      if (document.activeElement !== input && input.value !== language) input.value = language;
      return true;
    },

    stopEvent(event: Event): boolean {
      return event.target instanceof Node && header.contains(event.target);
    },

    ignoreMutation(mutation: ViewMutation): boolean {
      return header.contains(mutation.target);
    },

    destroy(): void {
      destroyed = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = null;
    },
  };
}
