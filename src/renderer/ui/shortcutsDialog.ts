/**
 * The keyboard shortcut reference and editor, opened through app.ui.openShortcuts
 * (Help > Keyboard shortcuts, Ctrl+/). Lists every command by category, filters
 * them, and lets the user rebind, remove or reset shortcuts.
 * See docs/ARCHITECTURE.md §5.3 and §5.4.
 */
import '../css/shortcuts.css';
import type { AppSettings } from '../../shared/settings';
import { type Command, type CommandCategory, COMMANDS } from '../app/commands';
import type { AppController } from '../app/controller';
import { formatShortcut, keybindingControl, shortcutConflicts, shortcutFor, shortcutFromEvent } from '../app/keybindings';
import { type DialogHandle, confirmDialog, openDialog } from './dialogs';
import { type Child, clear, h, icon } from './dom';

const CATEGORY_ORDER: readonly CommandCategory[] = ['File', 'Edit', 'Format', 'Insert', 'Table', 'View', 'Help'];

type Shortcuts = AppSettings['shortcuts'];

/** How a row is drawn: normally, while a new key is being recorded, or with a clash awaiting a decision. */
type RowMode = { kind: 'idle' } | { kind: 'recording'; error?: string } | { kind: 'confirm'; combo: string; clashes: Command[] };

const IDLE: RowMode = { kind: 'idle' };

interface RowActions {
  change(command: Command): void;
  remove(command: Command): void;
  reset(command: Command): void;
  assign(command: Command, combo: string, clashes: Command[]): void;
  cancel(command: Command): void;
}

/** A recorded shortcut needs Ctrl or Alt, or be a function key (optionally with Shift). */
function isAllowedCombo(combo: string): boolean {
  if (combo.split('+').some((part) => part === 'Ctrl' || part === 'Alt')) return true;
  return /^(Shift\+)?F([1-9]|1[0-2])$/.test(combo);
}

/** One key cap per key of a canonical shortcut ("Ctrl+Shift+7" gives three caps). */
function keyCaps(shortcut: string): HTMLElement[] {
  return shortcut
    .split('+')
    .filter((key) => key !== '')
    .map((key) => h('kbd', { class: 'sp-kbd' }, formatShortcut(key)));
}

function buildRow(command: Command, mode: RowMode, settings: AppSettings, actions: RowActions): HTMLElement {
  const dataset = { commandId: command.id };
  const name = h('span', { class: 'sp-shortcuts-name' }, command.title);

  // A key the editor handles itself: shown for reference, never rebindable.
  if (!command.shortcut && command.keyHint) {
    return h('div', { class: 'sp-shortcuts-row', dataset }, name, h('span', { class: 'sp-shortcuts-keys' }, keyCaps(command.keyHint)), h('span', { class: 'sp-shortcuts-actions' }));
  }

  let keys: Child[];
  let buttons: Child[] = [];
  let feedback: Child = null;

  if (mode.kind === 'recording') {
    keys = [h('span', { class: 'sp-shortcuts-recording' }, 'Press the new shortcut…')];
    buttons = [h('span', { class: 'sp-hint' }, 'Esc cancels')];
    if (mode.error) feedback = h('p', { class: 'sp-error-text sp-shortcuts-feedback', role: 'alert' }, mode.error);
  } else if (mode.kind === 'confirm') {
    const { combo, clashes } = mode;
    const names = clashes.map((other) => other.title).join(', ');
    keys = keyCaps(combo);
    feedback = h(
      'div',
      { class: 'sp-warning-box sp-shortcuts-feedback' },
      icon('warning'),
      h(
        'div',
        { class: 'sp-shortcuts-confirm' },
        h('span', null, `${formatShortcut(combo)} is already used by ${names}. Assigning it here removes it from ${names}.`),
        h(
          'div',
          { class: 'sp-shortcuts-confirm-actions' },
          h('button', { class: 'sp-btn sp-shortcuts-action', type: 'button', onclick: () => actions.assign(command, combo, clashes) }, 'Assign anyway'),
          h('button', { class: 'sp-btn sp-shortcuts-action', type: 'button', onclick: () => actions.cancel(command) }, 'Cancel'),
        ),
      ),
    );
  } else {
    const effective = shortcutFor(command.id, settings);
    keys = effective ? keyCaps(effective) : [h('span', { class: 'sp-shortcuts-none' }, '—')];
    buttons = [
      h(
        'button',
        { class: 'sp-btn sp-shortcuts-action', type: 'button', 'aria-label': `Change the shortcut for ${command.title}`, onclick: () => actions.change(command) },
        'Change',
      ),
    ];
    if (effective !== '') {
      buttons.push(h('button', { class: 'sp-btn sp-shortcuts-action', type: 'button', onclick: () => actions.remove(command) }, 'Remove'));
    }
    if (effective !== (command.shortcut ?? '')) {
      buttons.push(h('button', { class: 'sp-btn sp-shortcuts-action', type: 'button', onclick: () => actions.reset(command) }, 'Reset'));
    }
  }

  return h(
    'div',
    { class: ['sp-shortcuts-row', mode.kind === 'recording' && 'sp-shortcuts-row-recording'], dataset },
    name,
    h('span', { class: 'sp-shortcuts-keys' }, keys),
    h('span', { class: 'sp-shortcuts-actions' }, buttons),
    feedback,
  );
}

/** The content and state of one open shortcuts dialog. */
class ShortcutsSession {
  private readonly app: AppController;
  private readonly onClosed: () => void;
  private readonly search: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly rows = new Map<string, HTMLElement>();
  private query = '';
  private recording: { command: Command; stop(): void } | null = null;
  private dialog: DialogHandle | null = null;
  private unsubscribe: () => void = () => undefined;

  private readonly actions: RowActions = {
    change: (command) => this.startRecording(command),
    remove: (command) => void this.saveShortcuts({ ...this.app.settings.shortcuts, [command.id]: '' }),
    reset: (command) => {
      const next: Shortcuts = { ...this.app.settings.shortcuts };
      delete next[command.id];
      void this.saveShortcuts(next);
    },
    assign: (command, combo, clashes) => void this.assign(command, combo, clashes),
    cancel: (command) => this.replaceRow(command, IDLE),
  };

  /** Enter in the search field must not reach the dialog, where it would press "Close". */
  private readonly guardEnter = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && event.target === this.search) event.stopPropagation();
  };

  constructor(app: AppController, onClosed: () => void) {
    this.app = app;
    this.onClosed = onClosed;
    this.search = h('input', {
      class: 'sp-input sp-shortcuts-search',
      type: 'search',
      placeholder: 'Search by name, category or shortcut',
      'aria-label': 'Search keyboard shortcuts',
      spellcheck: false,
      oninput: () => {
        this.query = this.search.value;
        this.renderList();
      },
    });
    this.list = h('div', { class: 'sp-shortcuts-list sp-scroll' });
  }

  open(): void {
    const body = h(
      'div',
      { class: 'sp-shortcuts' },
      this.search,
      this.list,
      h(
        'div',
        { class: 'sp-shortcuts-footer' },
        h('button', { class: 'sp-btn sp-shortcuts-reset-all', type: 'button', onclick: () => void this.resetAll() }, 'Reset all to defaults'),
      ),
    );
    window.addEventListener('keydown', this.guardEnter, true);
    // Shortcuts can also change from elsewhere; keep the list current unless a key is being recorded.
    this.unsubscribe = this.app.on('settings', () => {
      if (!this.recording) this.renderList();
    });
    this.renderList();
    this.dialog = openDialog({
      title: 'Keyboard shortcuts',
      icon: 'keyboard',
      width: 680,
      className: 'sp-shortcuts-dialog',
      body,
      buttons: [{ label: 'Close', kind: 'primary', isDefault: true }],
      onClose: () => this.close(),
    });
  }

  focusSearch(): void {
    this.search.focus();
  }

  private close(): void {
    this.stopRecording();
    this.unsubscribe();
    window.removeEventListener('keydown', this.guardEnter, true);
    this.rows.clear();
    this.onClosed();
  }

  private matches(command: Command, terms: string[]): boolean {
    if (terms.length === 0) return true;
    const shortcut = shortcutFor(command.id, this.app.settings);
    const hint = command.keyHint ?? '';
    const text = [command.title, command.category, shortcut, formatShortcut(shortcut), hint, formatShortcut(hint)].join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  }

  private renderList(): void {
    this.stopRecording();
    clear(this.list);
    this.rows.clear();
    const terms = this.query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term !== '');
    let shown = 0;
    for (const category of CATEGORY_ORDER) {
      const commands = COMMANDS.filter((command) => command.category === category && this.matches(command, terms));
      if (commands.length === 0) continue;
      const group = h('section', { class: 'sp-shortcuts-group' }, h('h3', { class: 'sp-shortcuts-group-title' }, category));
      for (const command of commands) {
        const row = buildRow(command, IDLE, this.app.settings, this.actions);
        this.rows.set(command.id, row);
        group.appendChild(row);
      }
      this.list.appendChild(group);
      shown += commands.length;
    }
    if (shown === 0) {
      this.list.appendChild(h('p', { class: 'sp-hint sp-shortcuts-empty' }, `No shortcuts match “${this.query.trim()}”.`));
    }
  }

  private replaceRow(command: Command, mode: RowMode): void {
    const next = buildRow(command, mode, this.app.settings, this.actions);
    this.rows.get(command.id)?.replaceWith(next);
    this.rows.set(command.id, next);
  }

  private startRecording(command: Command): void {
    this.stopRecording();
    const onKey = (event: KeyboardEvent): void => {
      // Capture on window: the keys belong to the recording, not to the dialog or the editor.
      event.preventDefault();
      event.stopPropagation();
      const combo = shortcutFromEvent(event);
      if (combo === '') return; // only a modifier so far
      if (combo === 'Escape') {
        this.stopRecording();
        return;
      }
      if (!isAllowedCombo(combo)) {
        this.replaceRow(command, { kind: 'recording', error: 'Use Ctrl or Alt with a key, or a function key.' });
        return;
      }
      this.stopRecording();
      this.propose(command, combo);
    };
    window.addEventListener('keydown', onKey, true);
    keybindingControl.pause();
    this.recording = {
      command,
      stop: () => {
        window.removeEventListener('keydown', onKey, true);
        keybindingControl.resume();
      },
    };
    this.replaceRow(command, { kind: 'recording' });
  }

  /** Ends a recording in progress, if any, and shows its row normally again. */
  private stopRecording(): void {
    const recording = this.recording;
    if (!recording) return;
    this.recording = null;
    recording.stop();
    this.replaceRow(recording.command, IDLE);
  }

  private propose(command: Command, combo: string): void {
    const clashes = shortcutConflicts(command.id, combo, this.app.settings);
    if (clashes.length === 0) void this.assign(command, combo, []);
    else this.replaceRow(command, { kind: 'confirm', combo, clashes });
  }

  private async assign(command: Command, combo: string, clashes: Command[]): Promise<void> {
    const shortcuts: Shortcuts = { ...this.app.settings.shortcuts, [command.id]: combo };
    for (const other of clashes) shortcuts[other.id] = '';
    await this.saveShortcuts(shortcuts);
  }

  private async saveShortcuts(shortcuts: Shortcuts): Promise<void> {
    this.stopRecording();
    try {
      await this.app.updateSettings({ shortcuts });
    } catch {
      this.app.toast('The shortcuts could not be saved.', 'error');
    }
    if (this.dialog?.isOpen) this.renderList();
  }

  private async resetAll(): Promise<void> {
    this.stopRecording();
    const confirmed = await confirmDialog({
      title: 'Reset all shortcuts',
      message: 'Every keyboard shortcut goes back to its default.',
      detail: 'Shortcuts you changed or removed are restored. This cannot be undone.',
      confirmLabel: 'Reset all',
      danger: true,
    });
    if (confirmed) await this.saveShortcuts({});
  }
}

export function mountShortcutsDialog(app: AppController): void {
  let session: ShortcutsSession | null = null;
  app.ui.openShortcuts = (): void => {
    if (session) {
      session.focusSearch();
      return;
    }
    const current = new ShortcutsSession(app, () => {
      session = null;
    });
    session = current;
    current.open();
  };
}
