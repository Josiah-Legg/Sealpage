/**
 * Builds popup-menu items from command ids, so every menu (menu bar, context
 * menus, drop-downs) shows the same titles, icons, shortcuts and states.
 */
import { type MenuEntry, commandState, getCommand, runCommand } from '../app/commands';
import type { AppController } from '../app/controller';
import { displayShortcut } from '../app/keybindings';
import type { PopupItem } from './dialogs';

/**
 * Turn menu entries (command ids, '-' separators, submenus) into PopupItems
 * reflecting the current state. Leading / trailing / doubled separators are
 * dropped. With `hideDisabledSubmenus` a submenu whose commands are all
 * disabled is left out (used for context menus).
 */
export function buildPopupItems(entries: readonly MenuEntry[], app: AppController, hideDisabledSubmenus = true): PopupItem[] {
  const items: PopupItem[] = [];
  for (const entry of entries) {
    if (entry === '-') {
      if (items.length > 0 && items[items.length - 1]!.type !== 'separator') items.push({ type: 'separator' });
    } else if (typeof entry === 'string') {
      const command = getCommand(entry);
      if (!command) continue;
      const state = commandState(entry, app);
      items.push({
        label: command.title,
        icon: command.icon,
        shortcut: displayShortcut(entry, app.settings),
        checked: command.isActive ? state.active : undefined,
        disabled: !state.enabled,
        onSelect: () => runCommand(entry, app),
      });
    } else {
      const sub = buildPopupItems(entry.items, app, hideDisabledSubmenus);
      const anyEnabled = sub.some((i) => i.type === 'submenu' || (i.type !== 'separator' && !i.disabled));
      if (sub.length > 0 && (anyEnabled || !hideDisabledSubmenus)) items.push({ type: 'submenu', label: entry.title, items: sub });
    }
  }
  while (items.length > 0 && items[items.length - 1]!.type === 'separator') items.pop();
  return items;
}
