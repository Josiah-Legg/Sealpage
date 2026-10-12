/**
 * The menu bar: one button per top-level menu in MENUS. Mouse, hover
 * switching, arrow keys and Alt mnemonics all go through open() and toggle().
 * See docs/ARCHITECTURE.md §5.5.
 */
import '../css/menubar.css';
import { MENUS } from '../app/commands';
import type { AppController } from '../app/controller';
import { buildPopupItems } from './commandMenu';
import { type PopupItem, closePopup, isDialogOpen, showMenu } from './dialogs';
import { h } from './dom';

/** Make every action in `items` (including inside submenus) call `onRun` before it runs. */
function markRuns(items: PopupItem[], onRun: () => void): void {
  for (const item of items) {
    if (item.type === 'separator') continue;
    if (item.type === 'submenu') {
      markRuns(item.items, onRun);
      continue;
    }
    const select = item.onSelect;
    item.onSelect = () => {
      onRun();
      select();
    };
  }
}

export function mountMenubar(container: HTMLElement, app: AppController): void {
  const buttons: HTMLButtonElement[] = [];
  /** Index into MENUS of the open menu, or null. */
  let openIndex: number | null = null;
  /** Identifies the open menu, so that a menu replaced by another one does not reset the state. */
  let session: object | null = null;
  /** The menu that was open when the current mouse press started. */
  let pressedIndex: number | null = null;

  // Registered before any popup exists, so it runs before the popup closes on this press.
  document.addEventListener(
    'mousedown',
    () => {
      pressedIndex = openIndex;
    },
    true,
  );

  const paint = (): void => {
    buttons.forEach((button, i) => {
      const isOpen = i === openIndex;
      button.classList.toggle('is-open', isOpen);
      button.setAttribute('aria-expanded', String(isOpen));
    });
  };

  const open = (index: number, byKeyboard: boolean): void => {
    const token = {};
    session = token;
    openIndex = index;
    paint();

    let ran = false;
    const items = buildPopupItems(MENUS[index]!.items, app, false);
    markRuns(items, () => {
      ran = true;
    });
    const handle = showMenu(items, buttons[index]!, () => {
      if (session !== token) return; // another menu took over; it owns the state now
      session = null;
      openIndex = null;
      paint();
      // A chosen command runs right after this callback, in the same task; wait for it.
      queueMicrotask(() => {
        if (!ran && openIndex === null && document.hasFocus()) app.focusEditor();
      });
    });
    if (byKeyboard) {
      handle.element.querySelector<HTMLElement>('.sp-popup-menu > .sp-menu-item:not(.is-disabled)')?.classList.add('is-focused');
    }
  };

  const toggle = (index: number, byKeyboard: boolean): void => {
    if (openIndex === index) closePopup();
    else open(index, byKeyboard);
  };

  /**
   * ArrowLeft / ArrowRight while a menu is open: move to the neighbouring menu.
   * Returns false when the popup should handle the key itself (submenus).
   */
  const switchMenu = (delta: 1 | -1): boolean => {
    const current = openIndex;
    if (current === null) return false;
    const menus = document.querySelectorAll<HTMLElement>('.sp-popup-layer > .sp-popup-menu');
    const last = menus[menus.length - 1];
    if (!last) return false;
    // A submenu is open: the popup closes it first.
    if (delta < 0 && menus.length > 1) return false;
    // The focused row is a submenu: the popup opens it.
    if (delta > 0 && last.querySelector(':scope > .sp-menu-item.is-focused[aria-haspopup]')) return false;
    open((current + delta + MENUS.length) % MENUS.length, true);
    return true;
  };

  // Capture phase on document: runs before the popup's own key handler.
  document.addEventListener(
    'keydown',
    (event) => {
      if (openIndex !== null && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        if (switchMenu(event.key === 'ArrowRight' ? 1 : -1)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      // Alt + letter opens the menu whose title starts with that letter. A bare Alt press has no letter and is ignored.
      if (!event.altKey || event.ctrlKey || event.metaKey || !/^[a-z]$/i.test(event.key) || isDialogOpen()) return;
      const letter = event.key.toLowerCase();
      const index = MENUS.findIndex((menu) => menu.title.charAt(0).toLowerCase() === letter);
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      toggle(index, true);
    },
    true,
  );

  MENUS.forEach((menu, index) => {
    const button = h(
      'button',
      {
        class: 'sp-menubar-item',
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        onmousedown: (event: MouseEvent) => {
          event.preventDefault(); // keep the focus in the document
          // The press that closed this menu must not reopen it.
          if (event.button !== 0 || pressedIndex === index) return;
          open(index, false);
        },
        onclick: (event: MouseEvent) => {
          // Mouse clicks are handled on mousedown; a click with no mouse detail came from the keyboard.
          if (event.detail === 0) toggle(index, true);
        },
        onmouseenter: () => {
          if (openIndex !== null && openIndex !== index) open(index, false);
        },
      },
      menu.title,
    );
    buttons.push(button);
    container.appendChild(button);
  });
}
