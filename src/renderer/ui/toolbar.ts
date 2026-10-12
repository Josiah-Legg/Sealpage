/**
 * The formatting toolbar, built once from TOOLBAR. Application events only
 * update the existing buttons (state, tooltip, drop-down label); the DOM is
 * never rebuilt. See docs/ARCHITECTURE.md §5.3 and §5.5.
 */
import '../css/toolbar.css';
import { TOOLBAR, commandState, getCommand, runCommand } from '../app/commands';
import type { AppController } from '../app/controller';
import { displayShortcut } from '../app/keybindings';
import { buildPopupItems } from './commandMenu';
import { closePopup, showMenu } from './dialogs';
import { h, icon } from './dom';

type Refresh = () => void;

export function mountToolbar(container: HTMLElement, app: AppController): void {
  container.classList.add('sp-toolbar');
  const refreshers: Refresh[] = [];
  /** The drop-down whose menu is open, if any. */
  let openDropdown: HTMLElement | null = null;
  /** The drop-down whose menu was open when the current mouse press started. */
  let pressedDropdown: HTMLElement | null = null;

  // Registered before any popup exists, so it runs before the popup closes on this press.
  document.addEventListener(
    'mousedown',
    () => {
      pressedDropdown = openDropdown;
    },
    true,
  );

  const commandButton = (id: string): HTMLButtonElement | null => {
    const command = getCommand(id);
    if (!command) return null;
    const button = h(
      'button',
      {
        class: ['sp-icon-btn', 'sp-toolbar-btn', !command.icon && 'sp-toolbar-btn-text'],
        type: 'button',
        dataset: { command: id },
        'aria-label': command.title,
        onmousedown: (event: MouseEvent) => event.preventDefault(), // do not take focus from the editor
        onclick: () => runCommand(id, app),
      },
      command.icon ? icon(command.icon) : command.title,
    );
    refreshers.push(() => {
      const state = commandState(id, app);
      button.disabled = !state.enabled;
      button.classList.toggle('is-active', state.active);
      if (command.isActive) button.setAttribute('aria-pressed', String(state.active));
      else button.removeAttribute('aria-pressed');
      const shortcut = displayShortcut(id, app.settings);
      button.title = shortcut ? `${command.title} (${shortcut})` : command.title;
    });
    return button;
  };

  const dropdown = (title: string, choices: string[]): HTMLButtonElement => {
    const label = h('span', { class: 'sp-toolbar-dropdown-label' });
    const openMenu = (): void => {
      openDropdown = button;
      button.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
      showMenu(buildPopupItems(choices, app, false), button, () => {
        if (openDropdown === button) openDropdown = null;
        button.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
      });
    };
    const button: HTMLButtonElement = h(
      'button',
      {
        class: 'sp-toolbar-dropdown',
        type: 'button',
        title,
        'aria-label': title,
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        onmousedown: (event: MouseEvent) => {
          event.preventDefault();
          // The press that closed this menu must not reopen it.
          if (event.button !== 0 || pressedDropdown === button) return;
          openMenu();
        },
        onclick: (event: MouseEvent) => {
          // Mouse clicks are handled on mousedown; a click with no mouse detail came from the keyboard.
          if (event.detail !== 0) return;
          if (openDropdown === button) closePopup();
          else openMenu();
        },
      },
      label,
      icon('chevron-down', '0.9em'),
    );
    refreshers.push(() => {
      // The label names the first active choice, or the drop-down's own title.
      let activeTitle: string | null = null;
      let anyEnabled = false;
      for (const id of choices) {
        const state = commandState(id, app);
        if (state.enabled) anyEnabled = true;
        if (state.active && activeTitle === null) activeTitle = getCommand(id)?.title ?? null;
      }
      label.textContent = activeTitle ?? title;
      button.disabled = !anyEnabled;
    });
    return button;
  };

  for (const entry of TOOLBAR) {
    if (entry === '-') {
      container.appendChild(h('span', { class: 'sp-toolbar-sep', role: 'separator', 'aria-orientation': 'vertical' }));
    } else if (typeof entry === 'string') {
      const button = commandButton(entry);
      if (button) container.appendChild(button);
    } else {
      container.appendChild(dropdown(entry.title, entry.choices));
    }
  }

  // Several events in one frame cause one refresh.
  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const refresh of refreshers) refresh();
    });
  };
  app.on('editorState', schedule);
  app.on('activeTab', schedule);
  app.on('tabs', schedule);
  app.on('settings', schedule);
  app.on('style', schedule);
  for (const refresh of refreshers) refresh();
}
