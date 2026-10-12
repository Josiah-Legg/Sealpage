/**
 * The find and replace panel, shown in #findbar (docs/ARCHITECTURE.md 5.1, 5.4).
 *
 * All matching is done by prosemirror-search: this module builds the query,
 * applies it to the active editor and reads the results back. The search text
 * is user data: it is never logged, never stored, and never written into the
 * DOM as HTML.
 */
import '../css/findReplace.css';
import { SearchQuery, findNext, findPrev, replaceAll, replaceNext, setSearchState } from 'prosemirror-search';
import { type EditorState, Selection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { AppController } from '../app/controller';
import { clear, debounce, h, icon } from './dom';
import type { IconName } from './icons';

/** Counting stops here and the counter shows "10000+". */
const MAX_COUNT = 10000;
/** A selection longer than this is not used as the search text. */
const MAX_PREFILL = 200;
const TYPING_DELAY_MS = 80;

interface Tally {
  total: number;
  /** 1-based index of the match that equals the selection, 0 when the selection is not a match. */
  current: number;
  capped: boolean;
}

/** Count the matches of `query` from the start of the document, numbering the one under the selection. */
function tally(state: EditorState, query: SearchQuery, limit: number): Tally {
  if (!query.valid) return { total: 0, current: 0, capped: false };
  const { from: selFrom, to: selTo } = state.selection;
  const end = state.doc.content.size;
  let total = 0;
  let current = 0;
  let pos = 0;
  while (pos <= end) {
    const result = query.findNext(state, pos);
    if (!result) break;
    total++;
    if (current === 0 && result.from === selFrom && result.to === selTo) current = total;
    if (total >= limit) return { total, current, capped: true };
    // a zero-length match must still move the walk on
    pos = Math.max(result.to, result.from + 1);
  }
  return { total, current, capped: false };
}

/** Apply a query to a view. A view that was destroyed (its tab was closed) is skipped. */
function setQuery(view: EditorView, query: SearchQuery): void {
  if (view.isDestroyed) return;
  try {
    view.dispatch(setSearchState(view.state.tr, query));
  } catch {
    // the view went away between the check and the dispatch
  }
}

/** The text of a non-empty selection inside one text block, if it is short enough to search for. */
function selectedText(view: EditorView | null): string | null {
  if (!view) return null;
  const { selection, doc } = view.state;
  if (selection.empty || !selection.$from.sameParent(selection.$to) || !selection.$from.parent.isTextblock) return null;
  const text = doc.textBetween(selection.from, selection.to);
  return text.length > 0 && text.length <= MAX_PREFILL ? text : null;
}

/** Move to the first match at or after the start of the selection. Focus stays where it is. */
function moveToSelectionStart(view: EditorView): void {
  const { state } = view;
  if (!state.selection.empty) {
    // findNext searches from the end of the selection, so collapse it to the start first
    view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(state.selection.from), 1)));
  }
  findNext(view.state, view.dispatch);
}

function keepFocus(event: MouseEvent): void {
  // clicking a button must not take the caret out of the find or replace field
  event.preventDefault();
}

export function mountFindReplace(container: HTMLElement, app: AppController): void {
  container.classList.add('sp-findbar-host');

  let open = false;
  let replaceMode = false;
  let caseSensitive = false;
  let wholeWord = false;
  let regexp = false;
  /** A find-as-you-type change is waiting for its debounce; it also moves to the first match. */
  let moveOnApply = false;
  /** The view that currently holds our query, so the query can be cleared when focus moves elsewhere. */
  let lastView: EditorView | null = null;
  /** Matches counted by the last refresh; enables the Replace buttons. */
  let matches = 0;
  let frame = 0;

  // ------------------------------------------------------------ query & search

  function currentQuery(): SearchQuery {
    return new SearchQuery({ search: findInput.value, replace: replaceInput.value, caseSensitive, wholeWord, regexp });
  }

  /** Put the current fields into the active editor. */
  function applyQuery(moveToFirst: boolean): void {
    const query = currentQuery();
    const invalid = query.search !== '' && !query.valid;
    const view = app.view;
    if (view) {
      // an invalid expression is not searched: an empty query clears the highlights
      setQuery(view, invalid ? new SearchQuery({ search: '' }) : query);
      lastView = view;
      if (moveToFirst && !invalid && query.valid) moveToSelectionStart(view);
    }
    refresh();
  }

  /** Apply the fields now, and cancel any typing that was waiting. */
  function applyNow(): void {
    const move = moveOnApply;
    moveOnApply = false;
    later.cancel();
    applyQuery(move);
  }

  /** Debounced application for typing. */
  const later = debounce(applyNow, TYPING_DELAY_MS);

  /** Update the counter, the invalid marking and the Replace buttons from the active editor. */
  function refresh(): void {
    const view = app.view;
    const search = findInput.value;
    const query = currentQuery();
    const invalid = search !== '' && !query.valid;
    findInput.classList.toggle('is-invalid', invalid);
    counter.classList.toggle('sp-find-count-error', invalid);

    let text = '';
    matches = 0;
    if (view && search !== '') {
      if (invalid) {
        text = 'Invalid expression';
      } else {
        const t = tally(view.state, query, MAX_COUNT);
        matches = t.total;
        if (t.capped) text = '10000+';
        else if (t.total === 0) text = 'No results';
        else if (t.current > 0) text = `${t.current} of ${t.total}`;
        else text = t.total === 1 ? '1 result' : `${t.total} results`;
      }
    }
    counter.textContent = text;

    const canReplace = replaceAllowed();
    replaceBtn.disabled = !canReplace;
    replaceAllBtn.disabled = !canReplace;
  }

  function replaceAllowed(): boolean {
    return findInput.value !== '' && currentQuery().valid && matches > 0;
  }

  function navigate(forward: boolean): void {
    later.flush();
    const view = app.view;
    if (!view) return;
    const found = forward ? findNext(view.state, view.dispatch) : findPrev(view.state, view.dispatch);
    if (found) view.dispatch(view.state.tr.scrollIntoView());
    refresh();
  }

  function replaceOne(): void {
    later.flush();
    const view = app.view;
    if (!view || !replaceAllowed()) return;
    replaceNext(view.state, view.dispatch);
    refresh();
  }

  function replaceEverything(): void {
    later.flush();
    const view = app.view;
    if (!view || !replaceAllowed()) return;
    const count = tally(view.state, currentQuery(), Number.POSITIVE_INFINITY).total;
    replaceAll(view.state, view.dispatch);
    refresh();
    app.toast(count === 0 ? 'Nothing to replace.' : `Replaced ${count} ${count === 1 ? 'occurrence' : 'occurrences'}.`);
  }

  // ---------------------------------------------------------- open and close

  function clearHighlights(): void {
    const views = new Set<EditorView>();
    if (lastView) views.add(lastView);
    if (app.view) views.add(app.view);
    lastView = null;
    for (const view of views) setQuery(view, new SearchQuery({ search: '' }));
    matches = 0;
  }

  function openFind(withReplace: boolean): void {
    replaceMode = withReplace || (open && replaceMode);
    replaceRow.classList.toggle('sp-find-collapsed', !replaceMode);
    open = true;
    container.classList.add('is-open');
    const selected = selectedText(app.view);
    if (selected !== null) findInput.value = selected;
    findInput.focus();
    findInput.select();
    moveOnApply = false;
    applyNow();
  }

  function closeFind(): void {
    if (!open) return;
    open = false;
    later.cancel();
    moveOnApply = false;
    container.classList.remove('is-open');
    clearHighlights();
    app.focusEditor();
  }

  // ---------------------------------------------------------------- the DOM

  function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
    return h('button', { class: 'sp-icon-btn sp-find-btn', type: 'button', title: label, 'aria-label': label, onmousedown: keepFocus, onclick: onClick }, icon(name, '1.15em'));
  }

  function toggleButton(name: IconName, label: string, set: (on: boolean) => void): HTMLButtonElement {
    const button = iconButton(name, label, () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      set(on);
      applyNow();
    });
    button.setAttribute('aria-pressed', 'false');
    return button;
  }

  function onFindKey(event: KeyboardEvent): void {
    if (event.isComposing || event.key !== 'Enter') return;
    event.preventDefault();
    navigate(!event.shiftKey);
  }

  function onReplaceKey(event: KeyboardEvent): void {
    if (event.isComposing || event.key !== 'Enter') return;
    event.preventDefault();
    replaceOne();
  }

  function onPanelKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeFind();
  }

  const findInput = h('input', {
    class: 'sp-input sp-find-input',
    type: 'text',
    placeholder: 'Find',
    autocomplete: 'off',
    'aria-label': 'Find',
    oninput: () => {
      moveOnApply = true;
      later();
    },
    onkeydown: onFindKey,
  });
  findInput.spellcheck = false;

  const replaceInput = h('input', {
    class: 'sp-input sp-find-input',
    type: 'text',
    placeholder: 'Replace with',
    autocomplete: 'off',
    'aria-label': 'Replace with',
    oninput: () => later(),
    onkeydown: onReplaceKey,
  });
  replaceInput.spellcheck = false;

  const counter = h('span', { class: 'sp-find-count', 'aria-live': 'polite' });

  const prevButton = iconButton('arrow-up', 'Previous match (Shift+Enter)', () => navigate(false));
  const nextButton = iconButton('arrow-down', 'Next match (Enter)', () => navigate(true));
  const caseButton = toggleButton('case-sensitive', 'Match case', (on) => {
    caseSensitive = on;
  });
  const wordButton = toggleButton('whole-word', 'Whole word', (on) => {
    wholeWord = on;
  });
  const regexButton = toggleButton('regex', 'Regular expression', (on) => {
    regexp = on;
  });
  const closeButton = iconButton('close', 'Close (Esc)', () => closeFind());

  const replaceBtn = h('button', { class: 'sp-btn', type: 'button', onmousedown: keepFocus, onclick: () => replaceOne() }, 'Replace');
  const replaceAllBtn = h('button', { class: 'sp-btn', type: 'button', onmousedown: keepFocus, onclick: () => replaceEverything() }, 'Replace all');

  const findRow = h(
    'div',
    { class: 'sp-find-row' },
    findInput,
    counter,
    prevButton,
    nextButton,
    h('span', { class: 'sp-find-toggles' }, caseButton, wordButton, regexButton),
    closeButton,
  );
  const replaceRow = h('div', { class: 'sp-find-row sp-find-replace-row sp-find-collapsed' }, replaceInput, replaceBtn, replaceAllBtn);
  const panel = h('div', { class: 'sp-find-panel', role: 'search', onkeydown: onPanelKey }, findRow, replaceRow);

  clear(container);
  container.appendChild(panel);

  // ------------------------------------------------------------- app wiring

  app.ui.openFind = (withReplace: boolean) => openFind(withReplace);
  app.ui.closeFind = () => closeFind();

  // Counts follow edits and selection moves. Coalesced per frame; never re-applies the query,
  // which would dispatch again and loop.
  app.on('editorState', () => {
    if (!open || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (open) refresh();
    });
  });

  app.on('activeTab', () => {
    if (!open) return;
    const view = app.view;
    if (!view) {
      closeFind();
      return;
    }
    if (view === lastView) {
      refresh();
      return;
    }
    if (lastView) setQuery(lastView, new SearchQuery({ search: '' }));
    lastView = null;
    moveOnApply = false;
    later.cancel();
    applyQuery(false);
  });
}
