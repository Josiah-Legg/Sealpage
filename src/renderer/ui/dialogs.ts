/**
 * Shared overlay primitives: modal dialogs, confirm / prompt / choice
 * dialogs, popup menus and toasts. Everything is mounted in #overlay-root.
 */
import { type Child, clear, h, icon } from './dom';
import type { IconName } from './icons';

function overlayRoot(): HTMLElement {
  return document.getElementById('overlay-root') ?? document.body;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export interface DialogButton {
  label: string;
  kind?: 'primary' | 'danger' | 'default';
  /** Return false (or a promise of false) to keep the dialog open. */
  onClick?: () => boolean | void | Promise<boolean | void>;
  /** Pressing Enter in the dialog triggers this button. */
  isDefault?: boolean;
  disabled?: boolean;
}

export interface DialogOptions {
  title: string;
  body: HTMLElement;
  /** Width in px (default 480). The dialog never exceeds the window. */
  width?: number;
  buttons?: DialogButton[];
  /** Called once when the dialog closes, however it closes. */
  onClose?: () => void;
  /** Escape / backdrop click / the close button close the dialog (default true). */
  dismissable?: boolean;
  className?: string;
  icon?: IconName;
}

export interface DialogHandle {
  readonly element: HTMLElement;
  close(): void;
  /** Replace the footer buttons. */
  setButtons(buttons: DialogButton[]): void;
  setTitle(title: string): void;
  readonly isOpen: boolean;
}

const openDialogs: DialogHandle[] = [];

/** True while any modal dialog is open (key bindings use this). */
export function isDialogOpen(): boolean {
  return openDialogs.length > 0;
}

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
}

export function openDialog(opts: DialogOptions): DialogHandle {
  const dismissable = opts.dismissable !== false;
  const previouslyFocused = document.activeElement as HTMLElement | null;
  let open = true;

  const titleEl = h('h2', { class: 'sp-dialog-title' }, opts.title);
  const footer = h('div', { class: 'sp-dialog-footer' });
  const closeBtn = dismissable
    ? h('button', { class: 'sp-icon-btn sp-dialog-close', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => handle.close() }, icon('close'))
    : null;
  const panel = h(
    'div',
    {
      class: ['sp-dialog', opts.className],
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.title,
      style: { '--sp-dialog-width': `${opts.width ?? 480}px` },
    },
    h('div', { class: 'sp-dialog-header' }, opts.icon ? h('span', { class: 'sp-dialog-icon' }, icon(opts.icon)) : null, titleEl, closeBtn),
    h('div', { class: 'sp-dialog-body sp-scroll' }, opts.body),
    footer,
  );
  const backdrop = h('div', { class: 'sp-dialog-backdrop' }, panel);

  let defaultButton: HTMLButtonElement | null = null;
  const renderButtons = (buttons: DialogButton[]): void => {
    clear(footer);
    defaultButton = null;
    footer.style.display = buttons.length === 0 ? 'none' : '';
    for (const b of buttons) {
      const el = h(
        'button',
        {
          class: ['sp-btn', b.kind === 'primary' && 'sp-btn-primary', b.kind === 'danger' && 'sp-btn-danger'],
          type: 'button',
          disabled: b.disabled === true,
          onclick: async () => {
            const result = b.onClick ? await b.onClick() : undefined;
            if (result !== false) handle.close();
          },
        },
        b.label,
      );
      if (b.isDefault) defaultButton = el;
      footer.appendChild(el);
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (openDialogs[openDialogs.length - 1] !== handle) return;
    if (event.key === 'Escape' && dismissable) {
      event.preventDefault();
      event.stopPropagation();
      handle.close();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      const target = event.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' || target.tagName === 'SELECT' || target.isContentEditable) return;
      if (defaultButton && !defaultButton.disabled) {
        event.preventDefault();
        defaultButton.click();
      }
    } else if (event.key === 'Tab') {
      // keep focus inside the dialog
      const items = focusable(panel);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handle: DialogHandle = {
    element: panel,
    get isOpen() {
      return open;
    },
    close() {
      if (!open) return;
      open = false;
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      const i = openDialogs.indexOf(handle);
      if (i >= 0) openDialogs.splice(i, 1);
      opts.onClose?.();
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    },
    setButtons: renderButtons,
    setTitle(title: string) {
      titleEl.textContent = title;
      panel.setAttribute('aria-label', title);
    },
  };

  renderButtons(opts.buttons ?? []);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop && dismissable) handle.close();
  });
  document.addEventListener('keydown', onKeyDown, true);
  openDialogs.push(handle);
  overlayRoot().appendChild(backdrop);

  // focus the first field, else the default button, else the panel
  requestAnimationFrame(() => {
    if (!open) return;
    const field = panel.querySelector<HTMLElement>('.sp-dialog-body input, .sp-dialog-body textarea, .sp-dialog-body select');
    (field ?? defaultButton ?? focusable(panel)[0] ?? panel).focus();
  });
  return handle;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Extra explanation shown smaller under the message. */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Show the message in a prominent warning box. */
  warning?: boolean;
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const body = h(
      'div',
      { class: 'sp-dialog-message' },
      opts.warning ? h('div', { class: 'sp-warning-box' }, icon('warning'), h('span', null, opts.message)) : h('p', null, opts.message),
      opts.detail ? h('p', { class: 'sp-hint' }, opts.detail) : null,
    );
    openDialog({
      title: opts.title,
      body,
      width: 440,
      onClose: () => resolve(result),
      buttons: [
        { label: opts.cancelLabel ?? 'Cancel' },
        {
          label: opts.confirmLabel ?? 'OK',
          kind: opts.danger ? 'danger' : 'primary',
          isDefault: true,
          onClick: () => {
            result = true;
          },
        },
      ],
    });
  });
}

export interface ChoiceOptions {
  title: string;
  message: string;
  detail?: string;
  choices: { id: string; label: string; kind?: 'primary' | 'danger' | 'default'; isDefault?: boolean }[];
}

/** A dialog with several answers. Resolves to the chosen id, or null when dismissed. */
export function choiceDialog(opts: ChoiceOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    openDialog({
      title: opts.title,
      body: h('div', { class: 'sp-dialog-message' }, h('p', null, opts.message), opts.detail ? h('p', { class: 'sp-hint' }, opts.detail) : null),
      width: 460,
      onClose: () => resolve(result),
      buttons: opts.choices.map((c) => ({
        label: c.label,
        kind: c.kind,
        isDefault: c.isDefault,
        onClick: () => {
          result = c.id;
        },
      })),
    });
  });
}

export interface PromptOptions {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to refuse the value, or null to accept it. */
  validate?: (value: string) => string | null;
  /** Extra buttons shown before Cancel (e.g. "Remove link"); resolving value is their id prefixed with "\0". */
  extra?: { id: string; label: string; kind?: 'danger' | 'default' }[];
}

export const PROMPT_EXTRA_PREFIX = '\0';

/** Ask for one line of text. Resolves to the text, or null when cancelled. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const error = h('div', { class: 'sp-error-text', role: 'alert' });
    const input = h('input', { class: 'sp-input', type: 'text', value: opts.value ?? '', placeholder: opts.placeholder ?? '', spellcheck: false });
    input.addEventListener('input', () => {
      error.textContent = '';
    });
    openDialog({
      title: opts.title,
      body: h('label', { class: 'sp-field' }, h('span', { class: 'sp-label' }, opts.label), input, error),
      width: 440,
      onClose: () => resolve(result),
      buttons: [
        ...(opts.extra ?? []).map((e) => ({
          label: e.label,
          kind: e.kind,
          onClick: () => {
            result = PROMPT_EXTRA_PREFIX + e.id;
          },
        })),
        { label: 'Cancel' },
        {
          label: opts.confirmLabel ?? 'OK',
          kind: 'primary' as const,
          isDefault: true,
          onClick: () => {
            const problem = opts.validate?.(input.value) ?? null;
            if (problem) {
              error.textContent = problem;
              input.focus();
              return false;
            }
            result = input.value;
            return true;
          },
        },
      ],
    });
    requestAnimationFrame(() => input.select());
  });
}

/** Show a plain error message. */
export function alertDialog(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    openDialog({
      title,
      body: h('div', { class: 'sp-dialog-message' }, h('p', null, message)),
      width: 420,
      onClose: () => resolve(),
      buttons: [{ label: 'OK', kind: 'primary', isDefault: true }],
    });
  });
}

// ---------------------------------------------------------------------------
// Popup menus
// ---------------------------------------------------------------------------

export type PopupItem =
  | { type?: 'item'; label: string; icon?: IconName; shortcut?: string; checked?: boolean; disabled?: boolean; danger?: boolean; onSelect: () => void }
  | { type: 'separator' }
  | { type: 'submenu'; label: string; icon?: IconName; items: PopupItem[] };

export interface PopupHandle {
  close(): void;
  readonly element: HTMLElement;
}

let activePopup: PopupHandle | null = null;

export function closePopup(): void {
  activePopup?.close();
}

function place(menu: HTMLElement, anchor: { x: number; y: number } | DOMRect, side: 'below' | 'right'): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = menu.offsetWidth;
  const hgt = menu.offsetHeight;
  let x: number;
  let y: number;
  if (anchor instanceof DOMRect) {
    if (side === 'below') {
      x = anchor.left;
      y = anchor.bottom + 2;
      if (y + hgt > vh - 4) y = Math.max(4, anchor.top - hgt - 2);
    } else {
      x = anchor.right - 2;
      y = anchor.top - 4;
      if (x + w > vw - 4) x = Math.max(4, anchor.left - w + 2);
    }
  } else {
    x = anchor.x;
    y = anchor.y;
  }
  if (x + w > vw - 4) x = Math.max(4, vw - w - 4);
  if (y + hgt > vh - 4) y = Math.max(4, vh - hgt - 4);
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
}

/**
 * Show a popup menu at a point (context menu) or below an element (dropdown).
 * Keyboard: arrows move, Enter / Space select, Right / Left open / close
 * submenus, Escape closes. Returns a handle; `onClose` fires when it goes away.
 */
export function showMenu(items: PopupItem[], anchor: { x: number; y: number } | HTMLElement, onClose?: () => void): PopupHandle {
  closePopup();
  const layer = h('div', { class: 'sp-popup-layer' });
  const menus: HTMLElement[] = [];
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    layer.remove();
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    if (activePopup === handle) activePopup = null;
    onClose?.();
  };

  const closeFrom = (depth: number): void => {
    while (menus.length > depth) menus.pop()!.remove();
  };

  const build = (list: PopupItem[], depth: number, at: { x: number; y: number } | DOMRect, side: 'below' | 'right'): HTMLElement => {
    closeFrom(depth);
    const menu = h('div', { class: 'sp-menu sp-popup-menu', role: 'menu', tabIndex: -1 });
    for (const item of list) {
      if (item.type === 'separator') {
        menu.appendChild(h('div', { class: 'sp-menu-separator', role: 'separator' }));
        continue;
      }
      const isSub = item.type === 'submenu';
      const disabled = !isSub && item.disabled === true;
      const row = h(
        'div',
        {
          class: ['sp-menu-item', disabled && 'is-disabled', !isSub && item.danger && 'is-danger'],
          role: isSub ? 'menuitem' : item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem',
          'aria-disabled': disabled ? 'true' : undefined,
          'aria-checked': !isSub && item.checked !== undefined ? String(item.checked) : undefined,
          'aria-haspopup': isSub ? 'menu' : undefined,
          tabIndex: -1,
        },
        h('span', { class: 'sp-menu-item-icon' }, !isSub && item.checked ? icon('check') : item.icon ? icon(item.icon) : null),
        h('span', { class: 'sp-menu-item-label' }, item.label),
        isSub ? h('span', { class: 'sp-menu-item-arrow' }, icon('chevron-right')) : item.shortcut ? h('span', { class: 'sp-menu-item-shortcut' }, item.shortcut) : null,
      );
      const activate = (): void => {
        if (disabled) return;
        if (isSub) {
          build(item.items, depth + 1, row.getBoundingClientRect(), 'right');
        } else {
          close();
          item.onSelect();
        }
      };
      row.addEventListener('mouseenter', () => {
        for (const el of Array.from(menu.querySelectorAll('.is-focused'))) el.classList.remove('is-focused');
        row.classList.add('is-focused');
        if (isSub) build(item.items, depth + 1, row.getBoundingClientRect(), 'right');
        else closeFrom(depth + 1);
      });
      row.addEventListener('click', activate);
      (row as HTMLElement & { spActivate?: () => void; spIsSub?: boolean }).spActivate = activate;
      (row as HTMLElement & { spIsSub?: boolean }).spIsSub = isSub;
      menu.appendChild(row);
    }
    layer.appendChild(menu);
    menus.push(menu);
    place(menu, at, side);
    return menu;
  };

  const rows = (menu: HTMLElement): HTMLElement[] => Array.from(menu.querySelectorAll<HTMLElement>(':scope > .sp-menu-item:not(.is-disabled)'));
  const move = (delta: number): void => {
    const menu = menus[menus.length - 1]!;
    const list = rows(menu);
    if (list.length === 0) return;
    const cur = list.findIndex((r) => r.classList.contains('is-focused'));
    const next = list[(cur + delta + list.length) % list.length] ?? list[0]!;
    for (const r of list) r.classList.remove('is-focused');
    next.classList.add('is-focused');
    next.scrollIntoView({ block: 'nearest' });
  };

  const onKey = (event: KeyboardEvent): void => {
    const menu = menus[menus.length - 1];
    if (!menu) return;
    const focused = menu.querySelector<HTMLElement & { spActivate?: () => void; spIsSub?: boolean }>(':scope > .sp-menu-item.is-focused');
    switch (event.key) {
      case 'Escape':
        close();
        break;
      case 'ArrowDown':
        move(focused ? 1 : 0);
        if (!focused) rows(menu)[0]?.classList.add('is-focused');
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'ArrowRight':
        if (focused?.spIsSub) {
          focused.spActivate?.();
          rows(menus[menus.length - 1]!)[0]?.classList.add('is-focused');
        } else return;
        break;
      case 'ArrowLeft':
        if (menus.length > 1) closeFrom(menus.length - 1);
        else return;
        break;
      case 'Enter':
      case ' ':
        focused?.spActivate?.();
        if (focused?.spIsSub) rows(menus[menus.length - 1]!)[0]?.classList.add('is-focused');
        break;
      case 'Tab':
        close();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onDocMouseDown = (event: MouseEvent): void => {
    if (!layer.contains(event.target as Node)) close();
  };

  const handle: PopupHandle = { close, element: layer };
  overlayRoot().appendChild(layer);
  build(items, 0, anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor, 'below');
  activePopup = handle;
  // listeners are attached after the current event finishes, so the opening click does not close it
  setTimeout(() => {
    if (closed) return;
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
  }, 0);
  return handle;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

/** A short, self-dismissing message at the bottom of the window. */
export function showToast(text: string, kind: 'info' | 'error' = 'info'): void {
  let host = document.getElementById('sp-toasts');
  if (!host) {
    host = h('div', { id: 'sp-toasts', class: 'sp-toasts', 'aria-live': 'polite' });
    overlayRoot().appendChild(host);
  }
  const toast = h('div', { class: ['sp-toast', kind === 'error' && 'is-error'], role: kind === 'error' ? 'alert' : 'status' }, icon(kind === 'error' ? 'alert' : 'info'), h('span', null, text));
  host.appendChild(toast);
  const ttl = kind === 'error' ? 7000 : 3200;
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 220);
  }, ttl);
}

/** Convenience for building dialog bodies. */
export function field(label: string, control: HTMLElement, hint?: Child): HTMLElement {
  return h('label', { class: 'sp-field' }, h('span', { class: 'sp-label' }, label), control, hint ? h('span', { class: 'sp-hint' }, hint) : null);
}
