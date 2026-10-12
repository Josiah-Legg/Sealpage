/**
 * The slash menu: typing "/" at the start of a paragraph opens a list of block
 * types at the caret; further typing filters it. Choosing one removes the
 * "/query" text and runs the matching command. The query is only used for
 * filtering and is never written anywhere else. See docs/ARCHITECTURE.md §5.3.
 */
import '../css/slashMenu.css';
import { type EditorState, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { type Command, SLASH_COMMANDS, commandState, runCommand } from '../app/commands';
import type { AppController } from '../app/controller';
import { displayShortcut } from '../app/keybindings';
import { h, icon } from '../ui/dom';

/** "/" followed by the query so far: no spaces or slashes, at most 24 characters. */
const TRIGGER = /^\/([^\s/]{0,24})$/;
/** Paragraphs in these containers may open the menu (not table cells, code blocks or headings). */
const TRIGGER_CONTAINERS = new Set(['doc', 'list_item', 'blockquote']);
/** Stands in for inline nodes (hard breaks) so they never match the query. */
const LEAF_TEXT = '￼';
/** Gap between the caret and the menu, and the minimum distance from the window edges (px). */
const GAP = 4;
const EDGE = 8;
/** A mousedown on the menu must still work after the editor has lost focus. */
const BLUR_DELAY_MS = 150;

interface Trigger {
  /** The text typed after the slash. */
  query: string;
  /** The whole "/query" text (remembered when the menu is dismissed). */
  text: string;
  /** Position of the paragraph node. */
  paragraph: number;
  /** Position where the "/query" text starts. */
  start: number;
  /** Position of the caret. */
  caret: number;
}

/** The trigger for the current selection, or null when the menu should not be open. */
function readTrigger(state: EditorState): Trigger | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const parent = $from.parent;
  if (parent.type.name !== 'paragraph' || $from.depth < 1) return null;
  if (!TRIGGER_CONTAINERS.has($from.node($from.depth - 1).type.name)) return null;
  // The paragraph must consist of just "/query": nothing may follow the caret.
  const before = parent.textBetween(0, $from.parentOffset, undefined, LEAF_TEXT);
  const whole = parent.textBetween(0, parent.content.size, undefined, LEAF_TEXT);
  if (before !== whole) return null;
  const match = TRIGGER.exec(before);
  if (!match) return null;
  return { query: match[1] ?? '', text: before, paragraph: $from.before(), start: $from.start(), caret: selection.from };
}

/** Words of a title, lower-cased ("Numbered list" gives "numbered", "list"). */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}

/** The query is a prefix of a word of the title or a keyword, or is contained in the title. */
function matchesQuery(command: Command, query: string): boolean {
  const q = query.toLowerCase();
  if (q === '') return true;
  if (command.title.toLowerCase().includes(q)) return true;
  const words = [...wordsOf(command.title), ...(command.slash?.keywords ?? []).map((keyword) => keyword.toLowerCase())];
  return words.some((word) => word.startsWith(q));
}

class SlashMenu {
  private open = false;
  private query = '';
  private trigger: Trigger | null = null;
  private items: Command[] = [];
  private index = 0;
  /** Set by Escape: the menu stays closed until this "/query" text or its paragraph changes. */
  private dismissed: { paragraph: number; text: string } | null = null;
  private element: HTMLElement | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly app: AppController,
  ) {
    view.dom.addEventListener('blur', this.onBlur);
  }

  /** Called after every state change. */
  update(): void {
    const trigger = readTrigger(this.view.state);
    if (!trigger) {
      this.dismissed = null;
      this.close();
      return;
    }
    if (this.dismissed && this.dismissed.paragraph === trigger.paragraph && this.dismissed.text === trigger.text) {
      this.close();
      return;
    }
    this.dismissed = null;
    this.trigger = trigger;
    if (!this.open || trigger.query !== this.query) this.index = 0;
    this.query = trigger.query;
    this.show();
  }

  /** Keys while the menu is open. Returns true when the key was handled. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.open) return false;
    switch (event.key) {
      case 'ArrowDown':
        this.move(1);
        return true;
      case 'ArrowUp':
        this.move(-1);
        return true;
      case 'Enter':
      case 'Tab': {
        if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
        const command = this.items[this.index];
        // With no matching block there is nothing to choose: let Enter and Tab behave as usual.
        if (!command) return false;
        this.choose(command);
        return true;
      }
      case 'Escape':
        this.dismiss();
        return true;
      default:
        return false;
    }
  }

  destroy(): void {
    this.close();
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = null;
    this.view.dom.removeEventListener('blur', this.onBlur);
  }

  private readonly onBlur = (): void => {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      if (!this.view.hasFocus()) this.close();
    }, BLUR_DELAY_MS);
  };

  /** Window resize, or scrolling anywhere except inside the menu itself. */
  private readonly onWindowChange = (event: Event): void => {
    if (this.element && event.target instanceof Node && this.element.contains(event.target)) return;
    this.close();
  };

  private show(): void {
    this.items = SLASH_COMMANDS.filter((command) => matchesQuery(command, this.query) && commandState(command.id, this.app).enabled);
    this.index = Math.min(this.index, Math.max(0, this.items.length - 1));
    if (!this.open) {
      this.open = true;
      window.addEventListener('resize', this.onWindowChange);
      window.addEventListener('scroll', this.onWindowChange, true);
    }
    const element = this.ensureElement();
    this.render(element);
    if (!this.position()) this.close();
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('resize', this.onWindowChange);
    window.removeEventListener('scroll', this.onWindowChange, true);
    this.element?.remove();
    this.element = null;
    this.items = [];
  }

  private dismiss(): void {
    if (this.trigger) this.dismissed = { paragraph: this.trigger.paragraph, text: this.trigger.text };
    this.close();
  }

  private ensureElement(): HTMLElement {
    if (!this.element) {
      const element = h('div', { class: ['sp-menu', 'sp-slash-menu'], role: 'listbox', 'aria-label': 'Insert block' });
      // The editor keeps focus while the pointer is on the menu.
      element.addEventListener('mousedown', (event) => event.preventDefault());
      (document.getElementById('overlay-root') ?? document.body).appendChild(element);
      this.element = element;
    }
    return this.element;
  }

  private render(element: HTMLElement): void {
    const rows =
      this.items.length > 0
        ? this.items.map((command, index) => this.row(command, index))
        : [h('div', { class: ['sp-menu-item', 'is-disabled', 'sp-slash-empty'], role: 'option', 'aria-disabled': 'true' }, 'No matching blocks')];
    element.replaceChildren(...rows);
  }

  private row(command: Command, index: number): HTMLElement {
    const focused = index === this.index;
    const shortcut = displayShortcut(command.id, this.app.settings);
    return h(
      'div',
      {
        class: ['sp-menu-item', 'sp-slash-item', focused && 'is-focused'],
        role: 'option',
        'aria-selected': String(focused),
        dataset: { command: command.id },
        onmousedown: (event: MouseEvent) => {
          event.preventDefault();
          this.choose(command);
        },
        onmouseenter: () => this.highlight(index),
      },
      h('span', { class: 'sp-menu-item-icon' }, command.icon ? icon(command.icon) : null),
      h(
        'span',
        { class: 'sp-menu-item-label sp-slash-label' },
        h('span', { class: 'sp-slash-title' }, command.title),
        command.slash ? h('span', { class: 'sp-slash-desc' }, command.slash.description) : null,
      ),
      shortcut ? h('span', { class: 'sp-menu-item-shortcut' }, shortcut) : null,
    );
  }

  private highlight(index: number): void {
    if (!this.element || index === this.index) return;
    this.index = index;
    this.element.querySelectorAll('.sp-slash-item').forEach((row, rowIndex) => {
      const focused = rowIndex === index;
      row.classList.toggle('is-focused', focused);
      row.setAttribute('aria-selected', String(focused));
    });
  }

  private move(delta: 1 | -1): void {
    const count = this.items.length;
    if (count === 0) return;
    this.highlight((this.index + delta + count) % count);
    this.element?.querySelector('.is-focused')?.scrollIntoView({ block: 'nearest' });
  }

  /** Below the caret, or above it when the menu would run off the bottom of the window. */
  private position(): boolean {
    const element = this.element;
    if (!element) return false;
    let caret: { left: number; top: number; bottom: number };
    try {
      caret = this.view.coordsAtPos(this.view.state.selection.from);
    } catch {
      return false;
    }
    // Measure at the origin so the current position does not constrain the width.
    element.style.left = '0px';
    element.style.top = '0px';
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let top = caret.bottom + GAP;
    if (top + rect.height > viewportHeight - EDGE) top = caret.top - GAP - rect.height;
    top = Math.max(EDGE, top);
    const left = Math.max(EDGE, Math.min(caret.left, viewportWidth - rect.width - EDGE));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    return true;
  }

  private choose(command: Command): void {
    const trigger = readTrigger(this.view.state);
    this.close();
    if (!trigger) return;
    const { view } = this;
    view.dispatch(view.state.tr.delete(trigger.start, trigger.caret));
    runCommand(command.id, this.app);
    view.focus();
  }
}

/** The menus of the open editors, so handleKeyDown can reach the right one. */
const menus = new WeakMap<EditorView, SlashMenu>();

export function slashMenuPlugin(app: AppController): Plugin {
  return new Plugin({
    view(view) {
      const menu = new SlashMenu(view, app);
      menus.set(view, menu);
      return {
        update: () => menu.update(),
        destroy: () => {
          menus.delete(view);
          menu.destroy();
        },
      };
    },
    props: {
      handleKeyDown: (view, event) => menus.get(view)?.handleKey(event) ?? false,
    },
  });
}
