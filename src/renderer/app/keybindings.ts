/**
 * Keyboard shortcuts: one canonical string form, conversion from keyboard
 * events, display formatting, and the global dispatcher that runs commands.
 *
 * Canonical form: modifiers in the order Ctrl, Alt, Shift, then the key, joined
 * by "+":  "Ctrl+B", "Ctrl+Shift+7", "Ctrl+Alt+1", "F3", "Shift+F3", "Ctrl+,".
 * Keys: A-Z, 0-9, F1-F12, punctuation as typed on a US layout, and the names
 * Enter, Tab, Space, Backspace, Delete, Escape, Home, End, PageUp, PageDown,
 * ArrowUp, ArrowDown, ArrowLeft, ArrowRight.
 */
import type { AppSettings } from '../../shared/settings';
import { isDialogOpen } from '../ui/dialogs';
import { COMMANDS, type Command, runCommand } from './commands';
import type { AppController } from './controller';

const CODE_KEYS: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Space: 'Space',
  NumpadAdd: '=',
  NumpadSubtract: '-',
};

const NAMED_KEYS = new Set(['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** The canonical shortcut string for a keydown event, or '' for a bare modifier / unsupported key. */
export function shortcutFromEvent(event: KeyboardEvent): string {
  let key = '';
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = code.slice(6);
  else if (/^F([1-9]|1[0-2])$/.test(code)) key = code;
  else if (code in CODE_KEYS) key = CODE_KEYS[code]!;
  else if (NAMED_KEYS.has(event.key)) key = event.key;
  if (key === '') return '';
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Bring a user-typed or stored shortcut into canonical form ('' if it is not a valid shortcut). */
export function normalizeShortcut(shortcut: string): string {
  const tokens = shortcut
    .split('+')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  // a trailing "+" means the key itself is "+", which we spell "="
  if (/\+\s*\+\s*$/.test(shortcut) || shortcut.trim() === '+') tokens.push('=');
  if (tokens.length === 0) return '';
  const mods = new Set<string>();
  let key = '';
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'mod' || lower === 'meta') mods.add('Ctrl');
    else if (lower === 'alt' || lower === 'option') mods.add('Alt');
    else if (lower === 'shift') mods.add('Shift');
    else if (key !== '') return '';
    else if (/^[a-z]$/i.test(t)) key = t.toUpperCase();
    else if (/^f([1-9]|1[0-2])$/i.test(t)) key = t.toUpperCase();
    else {
      const named = [...NAMED_KEYS, 'Space'].find((n) => n.toLowerCase() === lower);
      key = named ?? (t.length === 1 ? t : '');
      if (key === '') return '';
    }
  }
  if (key === '') return '';
  return [...['Ctrl', 'Alt', 'Shift'].filter((mod) => mods.has(mod)), key].join('+');
}

const DISPLAY_KEYS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  '=': '+',
};

/** Human-readable form for menus and the shortcut reference ("Ctrl+=" is shown as "Ctrl++"). */
export function formatShortcut(shortcut: string): string {
  if (shortcut === '') return '';
  const parts = shortcut.split('+');
  // the key itself may be "+" which split() turned into empty strings
  const key = shortcut.endsWith('+') ? '+' : parts[parts.length - 1]!;
  const mods = shortcut.endsWith('+') ? parts.slice(0, -2) : parts.slice(0, -1);
  return [...mods, DISPLAY_KEYS[key] ?? key].join('+');
}

/** The shortcut that currently triggers a command: the user's override if any, else the default. '' = none. */
export function shortcutFor(id: string, settings: AppSettings): string {
  const override = settings.shortcuts[id];
  if (override !== undefined) return normalizeShortcut(override);
  return COMMANDS.find((c) => c.id === id)?.shortcut ?? '';
}

/** What to show next to a command: its active shortcut, or the editor key that performs it. */
export function displayShortcut(id: string, settings: AppSettings): string {
  const s = shortcutFor(id, settings);
  if (s !== '') return formatShortcut(s);
  const hint = COMMANDS.find((c) => c.id === id)?.keyHint;
  return hint ? formatShortcut(hint) : '';
}

/** Commands that share a shortcut with `id` under the current settings (for the shortcut editor). */
export function shortcutConflicts(id: string, shortcut: string, settings: AppSettings): Command[] {
  const s = normalizeShortcut(shortcut);
  if (s === '') return [];
  return COMMANDS.filter((c) => c.id !== id && shortcutFor(c.id, settings) === s);
}

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // real form controls count wherever they are, including ones embedded in the document (code language field)
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.closest('.sp-document')) return false; // the document itself
  return el.isContentEditable;
}

/** Shortcuts that must keep their native meaning inside text fields. */
const NATIVE_IN_FIELDS = new Set(['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+Shift+V', 'Tab', 'Shift+Tab', 'Enter']);

/**
 * Install the global key handler. Capture phase, so application shortcuts win
 * over ProseMirror's own handling.
 */
export function installKeybindings(app: AppController): () => void {
  let paused = false;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (paused || event.defaultPrevented || event.isComposing) return;
    const combo = shortcutFromEvent(event);
    if (combo === '') return;
    // plain typing never triggers a command
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
    if (!hasModifier && !/^(Shift\+)?F\d+$/.test(combo)) return;

    const inField = isTextField(event.target);
    if (inField && NATIVE_IN_FIELDS.has(combo)) return;
    const dialog = isDialogOpen();

    for (const command of COMMANDS) {
      if (shortcutFor(command.id, app.settings) !== combo) continue;
      if (command.scope === 'editor') {
        // needs the document: not while a dialog is up or while typing in another field
        if (dialog || inField || !app.view) continue;
        // never swallow native clipboard / select-all handling
        if (command.native) return;
      } else if (dialog && !command.allowInDialog) {
        continue;
      }
      event.preventDefault();
      event.stopPropagation();
      runCommand(command.id, app);
      return;
    }
    // Block Chromium shortcuts that make no sense in this app (reload, devtools zoom, print dialog…).
    if (['Ctrl+R', 'Ctrl+Shift+R', 'F5', 'Ctrl+F5', 'Ctrl+G', 'Ctrl+U', 'Ctrl+J', 'F7'].includes(combo)) event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown, true);
  const dispose = (): void => window.removeEventListener('keydown', onKeyDown, true);
  keybindingControl.pause = () => {
    paused = true;
  };
  keybindingControl.resume = () => {
    paused = false;
  };
  return dispose;
}

/** Lets the shortcut editor suspend dispatching while it records a new key combination. */
export const keybindingControl: { pause(): void; resume(): void } = {
  pause: () => undefined,
  resume: () => undefined,
};
