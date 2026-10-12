/**
 * IPC handlers: the implementation of SealpageApi (src/shared/ipc.ts).
 *
 * Security notes
 *  - The master key stays in this process. Nothing here returns key material.
 *  - Document plaintext is received / returned over IPC only and is never
 *    written to disk; the only plaintext written by this module is an export
 *    the user explicitly asked for, to a path chosen in a system dialog.
 *  - Every path coming from the renderer is validated before use.
 *  - Nothing is logged.
 */
import { type BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { type FSWatcher, promises as fs, watch } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path';
import {
  type DirEntry,
  type ErrorCode,
  type InvokeChannel,
  type KeyState,
  type PrintOptions,
  type ReencryptReport,
  type Result,
  type SealpageApi,
  EVENT_CHANNELS,
  FILE_EXTENSION,
  IPC_PREFIX,
  fail,
  ok,
} from '../shared/ipc';
import type { AppSettings, SessionState } from '../shared/settings';
import { CONTENT_DOCUMENT, ContainerError, decryptContainer, encryptContainer } from './crypto/container';
import type { MasterKey } from './crypto/kdf';
import { type Keystore, KeystoreError } from './crypto/keystore';
import { collectDocumentFiles, reencryptFiles } from './crypto/reencrypt';
import { atomicWriteFile, cleanStaleTempFiles, isTempFileName } from './fs/atomic';
import type { SettingsStore } from './settingsStore';

export interface IpcContext {
  window(): BrowserWindow | null;
  keystore: Keystore;
  store: SettingsStore;
  /** Files queued for opening (command line / double-click) before the UI was ready. */
  takePendingPaths(): string[];
  /** Called when the renderer agrees the window may close. */
  allowClose(): void;
  markRendererReady(): void;
}

type Handlers = { [K in InvokeChannel]: (...args: Parameters<SealpageApi[K]>) => ReturnType<SealpageApi[K]> };

const NO_KEY = (): { ok: false; code: ErrorCode; message: string } => fail('no-key', 'No key has been set up.');
const EMPTY_DOCUMENT = '~sealpage 1\n';
const MAX_NAME_LENGTH = 120;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/** An absolute, normalised path with no NUL bytes, or null. */
function cleanPath(p: unknown): string | null {
  if (!isString(p) || p.length === 0 || p.length > 32000 || p.includes('\0') || !isAbsolute(p)) return null;
  return normalize(p);
}

function documentPath(p: unknown): string | null {
  const c = cleanPath(p);
  return c && extname(c).toLowerCase() === FILE_EXTENSION ? c : null;
}

/** A single file or folder name the user typed: no separators, no reserved characters. */
function cleanName(name: unknown): string | null {
  if (!isString(name)) return null;
  const n = name.trim().replace(/[. ]+$/, '');
  // eslint-disable-next-line no-control-regex
  if (n === '' || n.length > MAX_NAME_LENGTH || /[<>:"/\\|?*\u0000-\u001f]/.test(n) || n === '.' || n === '..' || RESERVED_NAMES.test(n)) {
    return null;
  }
  return n;
}

function ioFail(err: unknown, fallback: string): { ok: false; code: ErrorCode; message: string } {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return fail('not-found', 'The file or folder no longer exists.');
  if (code === 'EEXIST') return fail('already-exists', 'Something with that name already exists.');
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return fail('io-error', 'Access was denied, or the file is in use by another program.');
  if (code === 'ENOSPC') return fail('io-error', 'The disk is full.');
  return fail('io-error', fallback);
}

function containerFail(err: unknown): { ok: false; code: ErrorCode; message: string } {
  if (err instanceof ContainerError) return fail(err.code, err.message);
  return fail('io-error', 'The file could not be read.');
}

function keystoreFail(err: unknown): { ok: false; code: ErrorCode; message: string } {
  if (err instanceof KeystoreError) return fail(err.code, err.message);
  return fail('io-error', 'The key could not be stored.');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export function registerIpc(ctx: IpcContext): void {
  const { keystore, store } = ctx;
  const cleanedDirs = new Set<string>();
  /** Serialises writes per file so an autosave and a manual save never interleave. */
  const writeQueues = new Map<string, Promise<unknown>>();
  let watcher: FSWatcher | null = null;
  let watchTimer: NodeJS.Timeout | null = null;
  let reencryptRunning = false;
  let reencryptCancelled = false;

  const send = (channel: string, ...args: unknown[]): void => {
    const win = ctx.window();
    if (win && !win.isDestroyed()) win.webContents.send(IPC_PREFIX + channel, ...args);
  };

  const tidy = (dir: string): void => {
    if (cleanedDirs.has(dir)) return;
    cleanedDirs.add(dir);
    void cleanStaleTempFiles(dir);
  };

  const keyState = (): KeyState => keystore.state;

  const encryptAndWrite = (path: string, markup: string, key: MasterKey): Promise<void> => {
    const run = async (): Promise<void> => {
      const plain = Buffer.from(markup, 'utf8');
      try {
        await atomicWriteFile(path, encryptContainer(plain, key, CONTENT_DOCUMENT));
      } finally {
        plain.fill(0);
      }
    };
    const next = (writeQueues.get(path) ?? Promise.resolve()).catch(() => undefined).then(run);
    writeQueues.set(path, next);
    void next.finally(() => {
      if (writeQueues.get(path) === next) writeQueues.delete(path);
    }).catch(() => undefined);
    return next;
  };

  const dialogParent = (): BrowserWindow => {
    const win = ctx.window();
    if (!win) throw new Error('No window');
    return win;
  };

  const withExtension = (p: string, ext: string): string => (extname(p).toLowerCase() === ext ? p : p + ext);

  const handlers: Handlers = {
    // ------------------------------------------------------------------ key
    async keyState() {
      return keyState();
    },

    async keySetup(passphrase) {
      try {
        await keystore.setup(passphrase);
        return ok();
      } catch (err) {
        return keystoreFail(err);
      }
    },

    async keyRestore(passphrase) {
      const res = await dialog.showOpenDialog(dialogParent(), {
        title: 'Choose a Sealpage file encrypted with this passphrase',
        filters: [{ name: 'Sealpage documents', extensions: ['slpg'] }],
        properties: ['openFile', 'dontAddToRecent'],
      });
      const path = res.canceled ? null : documentPath(res.filePaths[0]);
      if (!path) return fail('cancelled', 'No file was chosen.');
      let sample: Buffer;
      try {
        sample = await fs.readFile(path);
      } catch (err) {
        return ioFail(err, 'The file could not be read.');
      }
      try {
        await keystore.restore(passphrase, sample);
        return ok();
      } catch (err) {
        return keystoreFail(err);
      }
    },

    async keyVerify(passphrase) {
      try {
        return (await keystore.verify(passphrase)) ? ok() : fail('wrong-passphrase', 'The passphrase is not correct.');
      } catch (err) {
        return keystoreFail(err);
      }
    },

    async keyChange(currentPassphrase, newPassphrase) {
      if (reencryptRunning) return fail('invalid-argument', 'Wait for the current re-encryption to finish.');
      try {
        await keystore.change(currentPassphrase, newPassphrase);
        // The session list was encrypted with the old key; rewrite it lazily.
        await store.clearSession();
        return ok();
      } catch (err) {
        return keystoreFail(err);
      }
    },

    async pickReencryptFiles() {
      const res = await dialog.showOpenDialog(dialogParent(), {
        title: 'Choose files to re-encrypt',
        filters: [{ name: 'Sealpage documents', extensions: ['slpg'] }],
        properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      });
      return res.canceled ? [] : res.filePaths.map(documentPath).filter(isString);
    },

    async pickReencryptFolder() {
      const res = await dialog.showOpenDialog(dialogParent(), {
        title: 'Choose a folder to re-encrypt',
        properties: ['openDirectory', 'dontAddToRecent'],
      });
      return res.canceled ? null : cleanPath(res.filePaths[0]);
    },

    async reencrypt(passphrase, paths) {
      const key = keystore.current;
      if (!key) return NO_KEY();
      if (reencryptRunning) return fail('invalid-argument', 'A re-encryption is already running.');
      if (!isString(passphrase) || passphrase === '' || !Array.isArray(paths)) return fail('invalid-argument', 'Nothing to re-encrypt.');
      const roots = paths.map(cleanPath).filter(isString);
      reencryptRunning = true;
      reencryptCancelled = false;
      try {
        const files = await collectDocumentFiles(roots);
        const report: ReencryptReport = await reencryptFiles({
          files,
          passphrase,
          current: key,
          onProgress: (p) => send(EVENT_CHANNELS.onReencryptProgress, p),
          isCancelled: () => reencryptCancelled,
        });
        return ok(report);
      } catch {
        return fail('io-error', 'Re-encryption stopped unexpectedly. Files already processed are complete; the rest are unchanged.');
      } finally {
        reencryptRunning = false;
      }
    },

    async reencryptCancel() {
      reencryptCancelled = true;
    },

    // ------------------------------------------------------------ documents
    async pickOpenFiles() {
      const res = await dialog.showOpenDialog(dialogParent(), {
        title: 'Open',
        filters: [{ name: 'Sealpage documents', extensions: ['slpg'] }],
        properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      });
      return res.canceled ? [] : res.filePaths.map(documentPath).filter(isString);
    },

    async pickSavePath(suggestedName) {
      const name = cleanName(suggestedName) ?? 'Untitled';
      const res = await dialog.showSaveDialog(dialogParent(), {
        title: 'Save',
        defaultPath: withExtension(name, FILE_EXTENSION),
        filters: [{ name: 'Sealpage documents', extensions: ['slpg'] }],
        properties: ['dontAddToRecent', 'showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return null;
      return documentPath(withExtension(res.filePath, FILE_EXTENSION));
    },

    async pickFolder() {
      const res = await dialog.showOpenDialog(dialogParent(), {
        title: 'Open folder',
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
      });
      return res.canceled ? null : cleanPath(res.filePaths[0]);
    },

    async readDocument(path) {
      const key = keystore.current;
      if (!key) return NO_KEY();
      const p = documentPath(path);
      if (!p) return fail('invalid-argument', 'Not a Sealpage document path.');
      tidy(dirname(p));
      let data: Buffer;
      try {
        data = await fs.readFile(p);
      } catch (err) {
        return ioFail(err, 'The file could not be read.');
      }
      let plain: Buffer | null = null;
      try {
        plain = decryptContainer(data, key, CONTENT_DOCUMENT);
        // A document is always valid UTF-8; anything else is not ours.
        return ok(new TextDecoder('utf-8', { fatal: true }).decode(plain));
      } catch (err) {
        if (err instanceof ContainerError) return containerFail(err);
        return fail('bad-format', 'This is not a Sealpage file, or it is damaged.');
      } finally {
        plain?.fill(0);
      }
    },

    async writeDocument(path, markup) {
      const key = keystore.current;
      if (!key) return NO_KEY();
      const p = documentPath(path);
      if (!p || !isString(markup)) return fail('invalid-argument', 'Not a Sealpage document path.');
      tidy(dirname(p));
      try {
        await encryptAndWrite(p, markup, key);
        return ok();
      } catch (err) {
        return ioFail(err, 'The file could not be saved.');
      }
    },

    async listFolder(path) {
      const dir = cleanPath(path);
      if (!dir) return fail('invalid-argument', 'Not a folder.');
      tidy(dir);
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const out: DirEntry[] = [];
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name.startsWith('$') || isTempFileName(e.name)) continue;
          if (e.isDirectory()) out.push({ name: e.name, path: join(dir, e.name), kind: 'folder' });
          else if (e.isFile() && extname(e.name).toLowerCase() === FILE_EXTENSION) out.push({ name: e.name, path: join(dir, e.name), kind: 'file' });
        }
        out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'folder' ? -1 : 1));
        return ok(out);
      } catch (err) {
        return ioFail(err, 'The folder could not be read.');
      }
    },

    async createDocument(folder, name) {
      const key = keystore.current;
      if (!key) return NO_KEY();
      const dir = cleanPath(folder);
      const n = cleanName(isString(name) ? name.replace(/\.slpg$/i, '') : name);
      if (!dir || !n) return fail('invalid-argument', 'That name cannot be used.');
      const p = join(dir, n + FILE_EXTENSION);
      if (await exists(p)) return fail('already-exists', 'A document with that name already exists.');
      try {
        await encryptAndWrite(p, EMPTY_DOCUMENT, key);
        return ok(p);
      } catch (err) {
        return ioFail(err, 'The document could not be created.');
      }
    },

    async createFolder(parent, name) {
      const dir = cleanPath(parent);
      const n = cleanName(name);
      if (!dir || !n) return fail('invalid-argument', 'That name cannot be used.');
      const p = join(dir, n);
      try {
        await fs.mkdir(p);
        return ok(p);
      } catch (err) {
        return ioFail(err, 'The folder could not be created.');
      }
    },

    async renameEntry(path, newName) {
      const from = cleanPath(path);
      if (!from) return fail('invalid-argument', 'Nothing to rename.');
      let st;
      try {
        st = await fs.lstat(from);
      } catch (err) {
        return ioFail(err, 'The item could not be found.');
      }
      const isDoc = st.isFile() && extname(from).toLowerCase() === FILE_EXTENSION;
      if (!isDoc && !st.isDirectory()) return fail('invalid-argument', 'Only Sealpage documents and folders can be renamed.');
      const n = cleanName(isDoc && isString(newName) ? newName.replace(/\.slpg$/i, '') : newName);
      if (!n) return fail('invalid-argument', 'That name cannot be used.');
      const to = join(dirname(from), isDoc ? n + FILE_EXTENSION : n);
      if (to === from) return ok(to);
      // Allow case-only renames; otherwise never overwrite.
      if (to.toLowerCase() !== from.toLowerCase() && (await exists(to))) return fail('already-exists', 'Something with that name already exists.');
      try {
        await fs.rename(from, to);
        return ok(to);
      } catch (err) {
        return ioFail(err, 'The item could not be renamed.');
      }
    },

    async trashEntry(path) {
      const p = cleanPath(path);
      if (!p) return fail('invalid-argument', 'Nothing to delete.');
      try {
        const st = await fs.lstat(p);
        if (!st.isDirectory() && !(st.isFile() && extname(p).toLowerCase() === FILE_EXTENSION)) {
          return fail('invalid-argument', 'Only Sealpage documents and folders can be deleted here.');
        }
        await shell.trashItem(p);
        return ok();
      } catch (err) {
        return ioFail(err, 'The item could not be moved to the Recycle Bin.');
      }
    },

    async revealInExplorer(path) {
      const p = cleanPath(path);
      if (p) shell.showItemInFolder(p);
    },

    async watchFolder(path) {
      watcher?.close();
      watcher = null;
      const dir = path === null ? null : cleanPath(path);
      if (!dir) return;
      try {
        watcher = watch(dir, { recursive: true, persistent: false }, (_event, filename) => {
          if (typeof filename === 'string' && isTempFileName(basename(filename))) return;
          if (watchTimer) clearTimeout(watchTimer);
          watchTimer = setTimeout(() => send(EVENT_CHANNELS.onFolderChanged), 250);
        });
        watcher.on('error', () => {
          watcher?.close();
          watcher = null;
        });
      } catch {
        watcher = null;
      }
    },

    async rendererReady() {
      ctx.markRendererReady();
      const pending = ctx.takePendingPaths();
      if (pending.length > 0) send(EVENT_CHANNELS.onOpenPaths, pending);
    },

    // ------------------------------------------------ unencrypted exports
    async exportMarkdown(suggestedName, markdown) {
      if (!isString(markdown)) return fail('invalid-argument', 'Nothing to export.');
      const res = await dialog.showSaveDialog(dialogParent(), {
        title: 'Export as Markdown (not encrypted)',
        defaultPath: withExtension(cleanName(suggestedName) ?? 'Untitled', '.md'),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        properties: ['dontAddToRecent', 'showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return fail('cancelled', 'Export cancelled.');
      const target = withExtension(res.filePath, '.md');
      try {
        // Deliberately plaintext: the user confirmed an unencrypted export to this location.
        await fs.writeFile(target, markdown, 'utf8');
        return ok(target);
      } catch (err) {
        return ioFail(err, 'The export could not be written.');
      }
    },

    async exportPdf(suggestedName, options: PrintOptions) {
      const win = dialogParent();
      const res = await dialog.showSaveDialog(win, {
        title: 'Export as PDF (not encrypted)',
        defaultPath: withExtension(cleanName(suggestedName) ?? 'Untitled', '.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['dontAddToRecent', 'showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return fail('cancelled', 'Export cancelled.');
      const target = withExtension(res.filePath, '.pdf');
      let pdf: Buffer | null = null;
      try {
        // Rendered entirely in memory; the only file written is the one the user chose.
        pdf = await win.webContents.printToPDF({
          printBackground: options?.background !== false,
          pageSize: 'A4',
          preferCSSPageSize: true,
        });
        await fs.writeFile(target, pdf);
        return ok(target);
      } catch (err) {
        return ioFail(err, 'The PDF could not be created.');
      } finally {
        pdf?.fill(0);
      }
    },

    async print(options: PrintOptions) {
      const win = dialogParent();
      return new Promise<Result>((resolve) => {
        win.webContents.print({ silent: false, printBackground: options?.background !== false }, (success, reason) => {
          if (success) resolve(ok());
          else if (reason === 'cancelled' || reason === '') resolve(fail('cancelled', 'Printing was cancelled.'));
          else resolve(fail('io-error', 'Printing failed.'));
        });
      });
    },

    async exportGraph(suggestedName, format, data) {
      const svg = format === 'svg';
      if ((svg && !isString(data)) || (!svg && !(data instanceof Uint8Array)) || (format !== 'svg' && format !== 'png')) {
        return fail('invalid-argument', 'Nothing to export.');
      }
      const ext = svg ? '.svg' : '.png';
      const res = await dialog.showSaveDialog(dialogParent(), {
        title: `Export graph as ${svg ? 'SVG' : 'PNG'} (not encrypted)`,
        defaultPath: withExtension(cleanName(suggestedName) ?? 'Graph', ext),
        filters: [{ name: svg ? 'SVG image' : 'PNG image', extensions: [ext.slice(1)] }],
        properties: ['dontAddToRecent', 'showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return fail('cancelled', 'Export cancelled.');
      const target = withExtension(res.filePath, ext);
      try {
        await fs.writeFile(target, svg ? Buffer.from(data as string, 'utf8') : Buffer.from(data as Uint8Array));
        return ok(target);
      } catch (err) {
        return ioFail(err, 'The export could not be written.');
      }
    },

    // ------------------------------------------------ settings and session
    async getSettings() {
      return store.get();
    },

    async updateSettings(patch: Partial<AppSettings>) {
      return store.update(patch);
    },

    async getSession() {
      return store.readSession(keystore.current);
    },

    async setSession(state: SessionState) {
      await store.writeSession(keystore.current, state);
    },

    // --------------------------------------------------------------- window
    async setChrome(chrome) {
      const win = ctx.window();
      if (!win || typeof chrome !== 'object' || chrome === null) return;
      const hex = /^#[0-9a-fA-F]{6}$/;
      if (!hex.test(chrome.color) || !hex.test(chrome.symbolColor)) return;
      const height = Math.round(Math.min(80, Math.max(24, Number(chrome.height) || 36)));
      try {
        win.setTitleBarOverlay({ color: chrome.color, symbolColor: chrome.symbolColor, height });
        win.setBackgroundColor(chrome.color);
      } catch {
        /* not supported on this platform */
      }
    },

    async fontData(file) {
      // Bundled, public assets only: a plain relative path inside the fonts folder.
      if (!isString(file) || !/^[a-z0-9-]+\/[A-Za-z0-9_.-]+\.(woff2|woff|ttf)$/.test(file) || file.includes('..')) return null;
      try {
        return new Uint8Array(await fs.readFile(join(__dirname, '..', 'renderer', 'fonts', file)));
      } catch {
        return null;
      }
    },

    async editAction(action) {
      const wc = ctx.window()?.webContents;
      if (!wc) return;
      if (action === 'cut') wc.cut();
      else if (action === 'copy') wc.copy();
      else if (action === 'paste') wc.paste();
      else if (action === 'pastePlain') wc.pasteAndMatchStyle();
      else if (action === 'selectAll') wc.selectAll();
    },

    async openExternal(url) {
      if (!isString(url) || url.length > 4096) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        await shell.openExternal(parsed.toString());
      }
    },

    async confirmClose() {
      ctx.allowClose();
    },

    async appInfo() {
      return {
        version: app.getVersion(),
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node,
        dataDir: app.getPath('userData'),
      };
    },
  };

  for (const [name, handler] of Object.entries(handlers) as [InvokeChannel, (...a: unknown[]) => unknown][]) {
    ipcMain.handle(IPC_PREFIX + name, async (event, ...args) => {
      // Only our own window's main frame may call in.
      const win = ctx.window();
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
        throw new Error('Forbidden');
      }
      return handler(...args);
    });
  }
}
