/**
 * Sidebar: a lazily loaded tree of the sidebar folder's documents and
 * sub-folders. Document state lives in AppController; this module only keeps
 * its view state (expanded folders, the keyboard cursor).
 */
import '../css/sidebar.css';
import type { DirEntry } from '../../shared/ipc';
import type { AppController } from '../app/controller';
import { type PopupItem, confirmDialog, promptDialog, showMenu } from './dialogs';
import { clear, debounce, displayName, h, icon } from './dom';
import type { IconName } from './icons';

/** The listing of one folder, or why it could not be read. */
type Listing = { entries: DirEntry[] } | { error: string };

/** A visible document or folder row. Notes (messages) are not rows. */
interface TreeRow {
  /** Comparison key of the path (see keyOf). */
  key: string;
  path: string;
  /** Folder name, or the document name without .slpg. */
  name: string;
  kind: 'folder' | 'file';
  depth: number;
  /** Key of the folder this row sits in, or null at the top level. */
  parentKey: string | null;
  el: HTMLElement;
}

const INVALID_NAME = /[<>:"/\\|?*]/;

/** Comparison key for a path: case-insensitive, backslashes only, no trailing separator. */
function keyOf(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** The last segment of a folder path (the whole path for a drive root). */
function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.replace(/^.*[\\/]/, '') || trimmed;
}

/** null when the name is usable, otherwise the reason. */
function validateName(value: string): string | null {
  const name = value.trim();
  if (name === '') return 'Enter a name.';
  if (INVALID_NAME.test(name)) return 'A name cannot contain < > : " / \\ | ? *';
  if (name === '.' || name === '..' || /[. ]$/.test(name)) return 'That name cannot be used.';
  return null;
}

export function mountSidebar(container: HTMLElement, app: AppController): void {
  /** Expanded folders: key -> path. */
  const expanded = new Map<string, string>();
  /** Listings of the expanded folders, by key (rebuilt by every load). */
  const children = new Map<string, Listing>();
  /** Listing of the sidebar folder, and the folder it belongs to. */
  let rootListing: Listing | null = null;
  let loadedRoot: string | null = null;
  /** The visible rows, in display order, from the last render. */
  let rows: TreeRow[] = [];
  let cursorKey: string | null = null;
  let loadSeq = 0;

  const header = h('div', { class: 'sp-sidebar-header' });
  const emptyEl = h('div', { class: 'sp-sidebar-empty' });
  const tree = h('div', { class: 'sp-tree sp-scroll', role: 'tree', tabIndex: 0, 'aria-label': 'Documents' });
  const root = h('div', { class: 'sp-sidebar-root' }, header, tree, emptyEl);
  clear(container);
  container.appendChild(root);

  const iconButton = (name: IconName, label: string, onClick: () => void): HTMLElement =>
    h('button', { class: 'sp-icon-btn', type: 'button', title: label, 'aria-label': label, onclick: onClick }, icon(name));

  // ------------------------------------------------------------------ render

  /** The header, and whether the tree or the empty / error block is shown. */
  function renderShell(): void {
    const folder = app.folder;
    clear(header);
    clear(emptyEl);
    if (folder === null) {
      header.hidden = true;
      tree.hidden = true;
      emptyEl.hidden = false;
      emptyEl.append(
        h('p', { class: 'sp-hint' }, 'Open a folder to browse your documents.'),
        h('button', { class: 'sp-btn', type: 'button', onclick: () => void app.chooseFolder() }, icon('folder-open'), 'Open folder…'),
      );
      return;
    }
    const listing = loadedRoot === folder ? rootListing : null;
    const failed = listing !== null && 'error' in listing;
    header.hidden = false;
    header.append(
      h('span', { class: 'sp-sidebar-title', title: folder }, folderName(folder)),
      ...(failed
        ? []
        : [iconButton('file-plus', 'New document', () => void newDocument(folder)), iconButton('folder-plus', 'New folder', () => void newFolder(folder))]),
      iconButton('folder-open', 'Open another folder', () => void app.chooseFolder()),
      iconButton('refresh', 'Refresh', () => void load()),
    );
    if (listing && 'error' in listing) {
      tree.hidden = true;
      emptyEl.hidden = false;
      emptyEl.append(
        h('p', { class: 'sp-error-text', role: 'alert' }, listing.error),
        h('button', { class: 'sp-btn', type: 'button', onclick: () => void app.chooseFolder() }, icon('folder-open'), 'Choose another folder'),
      );
    } else {
      tree.hidden = false;
      emptyEl.hidden = true;
    }
  }

  /** The rows of the tree, from the loaded listings. Cheap: no I/O. */
  function renderTree(): void {
    const folder = app.folder;
    const listing = folder !== null && loadedRoot === folder ? rootListing : null;
    const activeKey = app.activeTab?.path ? keyOf(app.activeTab.path) : null;
    const openKeys = new Set(app.tabs.flatMap((t) => (t.path ? [keyOf(t.path)] : [])));
    const nodes: Node[] = [];
    const next: TreeRow[] = [];

    const addNote = (text: string, depth: number): void => {
      nodes.push(h('div', { class: 'sp-tree-note', style: { '--sp-tree-depth': String(depth) } }, text));
    };

    const walk = (entries: DirEntry[], depth: number, parentKey: string | null): void => {
      for (const entry of entries) {
        const key = keyOf(entry.path);
        const isFolder = entry.kind === 'folder';
        const isOpen = isFolder && expanded.has(key);
        const isActive = !isFolder && key === activeKey;
        const isOpenFile = !isFolder && !isActive && openKeys.has(key);
        const name = isFolder ? entry.name : displayName(entry.path);
        const el = h(
          'div',
          {
            class: ['sp-tree-row', isActive && 'is-active', isOpenFile && 'is-open', key === cursorKey && 'is-cursor'],
            role: 'treeitem',
            'aria-level': String(depth + 1),
            'aria-expanded': isFolder ? String(isOpen) : undefined,
            'aria-selected': String(key === cursorKey),
            title: name,
            style: { '--sp-tree-depth': String(depth) },
          },
          h('span', { class: 'sp-tree-chevron' }, isFolder ? icon(isOpen ? 'chevron-down' : 'chevron-right', '0.9em') : null),
          h('span', { class: 'sp-tree-icon' }, icon(isFolder ? (isOpen ? 'folder-open' : 'folder') : 'file-text')),
          h('span', { class: 'sp-tree-name' }, name),
        );
        next.push({ key, path: entry.path, name, kind: entry.kind, depth, parentKey, el });
        nodes.push(el);
        if (!isOpen) continue;
        const child = children.get(key);
        if (child === undefined) continue;
        if ('error' in child) addNote(child.error, depth + 1);
        else if (child.entries.length === 0) addNote('Empty', depth + 1);
        else walk(child.entries, depth + 1, key);
      }
    };

    if (listing && 'entries' in listing) {
      if (listing.entries.length === 0) addNote('No documents or folders yet. Use the buttons above to add one.', 0);
      else walk(listing.entries, 0, null);
    }
    rows = next;
    tree.replaceChildren(...nodes);
  }

  /** Move the keyboard cursor to a row, optionally scrolling it into view. */
  function setCursor(key: string | null, reveal: boolean): void {
    cursorKey = key;
    for (const row of rows) {
      const on = row.key === key;
      row.el.classList.toggle('is-cursor', on);
      row.el.setAttribute('aria-selected', String(on));
    }
    if (reveal) rows.find((r) => r.key === key)?.el.scrollIntoView({ block: 'nearest' });
  }

  /** Read the folder and every expanded folder, then draw. Stale results are dropped. */
  async function load(): Promise<void> {
    const seq = ++loadSeq;
    const folder = app.folder;
    if (folder === null) {
      rootListing = null;
      loadedRoot = null;
      children.clear();
      renderShell();
      renderTree();
      return;
    }
    const rootRes = await app.api.listFolder(folder);
    const next = new Map<string, Listing>();
    if (rootRes.ok) {
      await Promise.all(
        [...expanded].map(async ([key, path]) => {
          const res = await app.api.listFolder(path);
          if (res.ok) next.set(key, { entries: res.value });
          else if (res.code === 'not-found') expanded.delete(key);
          else next.set(key, { error: res.message });
        }),
      );
    }
    if (seq !== loadSeq || app.folder !== folder) return;
    rootListing = rootRes.ok ? { entries: rootRes.value } : { error: rootRes.message };
    loadedRoot = folder;
    children.clear();
    for (const [key, listing] of next) children.set(key, listing);
    renderShell();
    renderTree();
  }

  // ----------------------------------------------------------- tree changes

  async function setFolderOpen(row: TreeRow, open: boolean): Promise<void> {
    if (open) {
      expanded.set(row.key, row.path);
    } else {
      expanded.delete(row.key);
      // the cursor may sit in a child that is about to be hidden
      if (cursorKey !== null && cursorKey.startsWith(row.key + '\\')) cursorKey = row.key;
    }
    await load();
  }

  function activate(row: TreeRow): void {
    if (row.kind === 'folder') void setFolderOpen(row, !expanded.has(row.key));
    else void app.openPath(row.path);
  }

  /** Expand a folder below the sidebar root so items created in it stay visible. */
  function revealFolder(folder: string): void {
    const root = app.folder;
    if (root !== null && keyOf(folder) !== keyOf(root)) expanded.set(keyOf(folder), folder);
  }

  /** Keep expansion and cursor pointing at a path after it was renamed. */
  function remapPath(oldPath: string, newPath: string): void {
    const oldKey = keyOf(oldPath);
    const newKey = keyOf(newPath);
    const moved = (key: string): string | null => {
      if (key === oldKey) return newKey;
      if (key.startsWith(oldKey + '\\')) return newKey + key.slice(oldKey.length);
      return null;
    };
    const entries = [...expanded];
    expanded.clear();
    for (const [key, path] of entries) {
      const nextKey = moved(key);
      if (nextKey === null) expanded.set(key, path);
      else expanded.set(nextKey, newPath + path.slice(oldPath.length));
    }
    if (cursorKey !== null) cursorKey = moved(cursorKey) ?? cursorKey;
  }

  /** Drop expansion and cursor for a path that was deleted. */
  function forgetPath(path: string): void {
    const key = keyOf(path);
    const isUnder = (k: string): boolean => k === key || k.startsWith(key + '\\');
    for (const k of [...expanded.keys()]) if (isUnder(k)) expanded.delete(k);
    if (cursorKey !== null && isUnder(cursorKey)) cursorKey = null;
  }

  // ---------------------------------------------------------------- actions

  async function newDocument(folder: string): Promise<void> {
    const name = await promptDialog({
      title: 'New document',
      label: 'Name',
      value: 'Untitled',
      confirmLabel: 'Create',
      validate: validateName,
    });
    if (name === null) return;
    const res = await app.api.createDocument(folder, name.trim());
    if (!res.ok) {
      app.toast(res.message, 'error');
      return;
    }
    revealFolder(folder);
    await load();
    await app.openPath(res.value);
  }

  async function newFolder(parent: string): Promise<void> {
    const name = await promptDialog({
      title: 'New folder',
      label: 'Name',
      value: 'New folder',
      confirmLabel: 'Create',
      validate: validateName,
    });
    if (name === null) return;
    const res = await app.api.createFolder(parent, name.trim());
    if (!res.ok) {
      app.toast(res.message, 'error');
      return;
    }
    revealFolder(parent);
    await load();
  }

  async function renameItem(row: TreeRow): Promise<void> {
    const value = await promptDialog({
      title: 'Rename',
      label: 'Name',
      value: row.name,
      confirmLabel: 'Rename',
      validate: validateName,
    });
    if (value === null) return;
    const newName = value.trim();
    if (newName === row.name) return;
    const res = await app.api.renameEntry(row.path, newName);
    if (!res.ok) {
      app.toast(res.message, 'error');
      return;
    }
    app.pathRenamed(row.path, res.value);
    remapPath(row.path, res.value);
    await load();
  }

  async function deleteItem(row: TreeRow): Promise<void> {
    const confirmed = await confirmDialog({
      title: 'Move to Recycle Bin',
      message: `"${row.name}" will be moved to the Recycle Bin.`,
      detail: 'It stays encrypted there.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    await app.pathRemoved(row.path);
    const res = await app.api.trashEntry(row.path);
    if (!res.ok) {
      app.toast(res.message, 'error');
      return;
    }
    forgetPath(row.path);
    await load();
  }

  // ---------------------------------------------------------------- menus

  function rowMenuItems(row: TreeRow): PopupItem[] {
    const rename: PopupItem = { label: 'Rename…', icon: 'pencil', onSelect: () => void renameItem(row) };
    const remove: PopupItem = { label: 'Delete', icon: 'trash', danger: true, onSelect: () => void deleteItem(row) };
    const reveal: PopupItem = { label: 'Show in Explorer', icon: 'folder-open', onSelect: () => void app.api.revealInExplorer(row.path) };
    if (row.kind === 'file') {
      return [{ label: 'Open', icon: 'file-text', onSelect: () => void app.openPath(row.path) }, rename, remove, { type: 'separator' }, reveal];
    }
    return [
      { label: 'New document here…', icon: 'file-plus', onSelect: () => void newDocument(row.path) },
      { label: 'New folder here…', icon: 'folder-plus', onSelect: () => void newFolder(row.path) },
      { type: 'separator' },
      rename,
      remove,
      { type: 'separator' },
      reveal,
    ];
  }

  function emptyMenuItems(folder: string): PopupItem[] {
    return [
      { label: 'New document…', icon: 'file-plus', onSelect: () => void newDocument(folder) },
      { label: 'New folder…', icon: 'folder-plus', onSelect: () => void newFolder(folder) },
      { type: 'separator' },
      { label: 'Refresh', icon: 'refresh', onSelect: () => void load() },
    ];
  }

  // ----------------------------------------------------------- input events

  /** The row under an event target, if it is a document or folder row. */
  function rowAt(target: EventTarget | null): TreeRow | undefined {
    const el = target instanceof Element ? target.closest<HTMLElement>('.sp-tree-row') : null;
    return el ? rows.find((r) => r.el === el) : undefined;
  }

  tree.addEventListener('click', (event) => {
    const row = rowAt(event.target);
    if (!row) return;
    setCursor(row.key, false);
    activate(row);
  });

  tree.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const folder = app.folder;
    if (folder === null) return;
    const row = rowAt(event.target);
    if (row) {
      setCursor(row.key, false);
      showMenu(rowMenuItems(row), { x: event.clientX, y: event.clientY });
    } else {
      showMenu(emptyMenuItems(folder), { x: event.clientX, y: event.clientY });
    }
  });

  tree.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const index = rows.findIndex((r) => r.key === cursorKey);
    const current = index >= 0 ? rows[index] : undefined;
    const go = (i: number): void => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (target) setCursor(target.key, true);
    };
    let handled = true;
    switch (event.key) {
      case 'ArrowDown':
        go(index + 1);
        break;
      case 'ArrowUp':
        go(index < 0 ? 0 : index - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(rows.length - 1);
        break;
      case 'ArrowRight':
        if (current && current.kind === 'folder') {
          if (!expanded.has(current.key)) {
            void setFolderOpen(current, true);
          } else {
            const first = rows[index + 1];
            if (first && first.parentKey === current.key) setCursor(first.key, true);
          }
        }
        break;
      case 'ArrowLeft':
        if (current && current.kind === 'folder' && expanded.has(current.key)) void setFolderOpen(current, false);
        else if (current && current.parentKey !== null) setCursor(current.parentKey, true);
        break;
      case 'Enter':
        if (current) activate(current);
        break;
      case 'F2':
        if (current) void renameItem(current);
        break;
      case 'Delete':
        if (current) void deleteItem(current);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  });

  // ------------------------------------------------------------ app events

  app.on(
    'folder',
    () => {
      expanded.clear();
      cursorKey = null;
      rootListing = null;
      loadedRoot = null;
      children.clear();
      tree.scrollTop = 0;
      renderShell();
      renderTree();
      void load();
    },
  );
  app.on('folderContent', debounce(() => void load(), 150));
  app.on('tabs', () => renderTree());
  app.on('activeTab', () => renderTree());

  renderShell();
  renderTree();
  void load();
}
