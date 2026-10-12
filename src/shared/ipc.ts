/**
 * The contract between the renderer and the main process.
 *
 * The renderer never touches the file system, the key or any Node API. It
 * talks to the main process only through `window.sealpage`, an object of type
 * SealpageApi installed by the preload script. Every method maps to one IPC
 * channel named after it (see CHANNELS).
 *
 * Rules that hold for every call:
 *  - The master key never crosses this boundary.
 *  - Document text crosses it only in memory (IPC), never via disk.
 *  - Failures are returned as { ok: false, code, message }, not thrown.
 */
import type { AppSettings, SessionState } from './settings';

export const FILE_EXTENSION = '.slpg';

export type ErrorCode =
  /** Authentication failed: wrong key or modified file. Deliberately indistinguishable. */
  | 'cannot-decrypt'
  /** Not a Sealpage file, truncated, or an unknown container version. */
  | 'bad-format'
  /** The file was written by a newer version of Sealpage. */
  | 'unsupported-version'
  | 'not-found'
  | 'io-error'
  /** No master key has been set up yet. */
  | 'no-key'
  /** The supplied passphrase is not the current one. */
  | 'wrong-passphrase'
  /** OS-level secret storage (DPAPI) is unavailable. */
  | 'keystore-unavailable'
  | 'invalid-argument'
  | 'cancelled'
  | 'already-exists';

export type Result<T = void> = ({ ok: true } & (T extends void ? object : { value: T })) | { ok: false; code: ErrorCode; message: string };

export type KeyState =
  /** No key stored: show the first-launch setup screen. */
  | 'unset'
  /** Key loaded and ready. */
  | 'ready'
  /** A key blob exists but cannot be unprotected (different Windows account or machine). */
  | 'locked-out'
  /** The OS secret store is unavailable. */
  | 'unavailable';

export interface DirEntry {
  name: string;
  path: string;
  kind: 'folder' | 'file';
}

export type ReencryptStatus =
  /** Re-encrypted under the current key. */
  | 'converted'
  /** Already encrypted under the current key; left untouched. */
  | 'already-current'
  /** Could not be decrypted with the supplied passphrase; left untouched. */
  | 'cannot-decrypt'
  /** Not a valid Sealpage file; left untouched. */
  | 'bad-format'
  /** Read or write failed; the original file is intact. */
  | 'io-error';

export interface ReencryptFileResult {
  path: string;
  status: ReencryptStatus;
  message: string;
}

export interface ReencryptProgress {
  /** Files finished so far. */
  done: number;
  total: number;
  /** File currently being processed, or null when finished. */
  current: string | null;
}

export interface ReencryptReport {
  results: ReencryptFileResult[];
  converted: number;
  alreadyCurrent: number;
  failed: number;
  cancelled: boolean;
}

export interface PrintOptions {
  /** Print the style's background colours (true) or ink-friendly white paper (false). */
  background: boolean;
}

export interface SealpageApi {
  // --- key management -----------------------------------------------------
  keyState(): Promise<KeyState>;
  /** First launch: derive a master key from a new passphrase and store it. */
  keySetup(passphrase: string): Promise<Result>;
  /**
   * First launch on a new machine: recreate an existing key from its
   * passphrase and any file encrypted with it (the file supplies the salt and
   * KDF parameters and proves the passphrase is right). Shows a file picker.
   */
  keyRestore(passphrase: string): Promise<Result>;
  /** Check a passphrase against the stored key. */
  keyVerify(passphrase: string): Promise<Result>;
  /**
   * Replace the master key. Requires the current passphrase. Files are not
   * touched; use reencrypt() afterwards with the old passphrase.
   */
  keyChange(currentPassphrase: string, newPassphrase: string): Promise<Result>;
  /** Let the user choose .slpg files (multi-select). Returns absolute paths. */
  pickReencryptFiles(): Promise<string[]>;
  /** Let the user choose a folder; returns it, or null. */
  pickReencryptFolder(): Promise<string | null>;
  /**
   * Re-encrypt files (and folders, recursively) under the current key.
   * `passphrase` is the passphrase the files are currently encrypted with.
   * Each file is replaced atomically or left untouched.
   */
  reencrypt(passphrase: string, paths: string[]): Promise<Result<ReencryptReport>>;
  /** Ask a running reencrypt() to stop after the current file. */
  reencryptCancel(): Promise<void>;
  onReencryptProgress(cb: (p: ReencryptProgress) => void): () => void;

  // --- documents ----------------------------------------------------------
  /** Show the open dialog; returns chosen .slpg paths (empty when cancelled). */
  pickOpenFiles(): Promise<string[]>;
  /** Show the save dialog; returns the chosen path (always ending .slpg) or null. */
  pickSavePath(suggestedName: string): Promise<string | null>;
  /** Show the folder picker for the sidebar. */
  pickFolder(): Promise<string | null>;
  /** Read and decrypt a document; returns its markup text. */
  readDocument(path: string): Promise<Result<string>>;
  /** Encrypt markup text and atomically replace the file at `path`. */
  writeDocument(path: string, markup: string): Promise<Result>;
  /** List sub-folders and .slpg files of a folder, folders first, sorted by name. */
  listFolder(path: string): Promise<Result<DirEntry[]>>;
  /** Create a new empty document file in `folder`; returns its path. */
  createDocument(folder: string, name: string): Promise<Result<string>>;
  createFolder(parent: string, name: string): Promise<Result<string>>;
  /** Rename a file or folder within its parent; returns the new path. */
  renameEntry(path: string, newName: string): Promise<Result<string>>;
  /** Move a file or folder to the Recycle Bin (it stays encrypted there). */
  trashEntry(path: string): Promise<Result>;
  revealInExplorer(path: string): Promise<void>;
  /** Start watching a folder tree; onFolderChanged fires (debounced) on changes. */
  watchFolder(path: string | null): Promise<void>;
  onFolderChanged(cb: () => void): () => void;
  /** Files passed on the command line or by double-click, delivered once the UI is ready. */
  onOpenPaths(cb: (paths: string[]) => void): () => void;
  /** Tell main the UI is ready to receive onOpenPaths. */
  rendererReady(): Promise<void>;

  // --- unencrypted exports (caller must have shown the warning first) -------
  /** Save plain Markdown to a location the user picks. */
  exportMarkdown(suggestedName: string, markdown: string): Promise<Result<string>>;
  /** Render the current window's print layout to PDF and save where the user picks. */
  exportPdf(suggestedName: string, options: PrintOptions): Promise<Result<string>>;
  /** Open the system print dialog for the current window's print layout. */
  print(options: PrintOptions): Promise<Result>;
  /** Save a graph as SVG (text) or PNG (bytes) to a location the user picks. */
  exportGraph(suggestedName: string, format: 'svg' | 'png', data: string | Uint8Array): Promise<Result<string>>;

  // --- settings and session -------------------------------------------------
  getSettings(): Promise<AppSettings>;
  /** Merge a partial update into the settings and persist them. */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** Encrypted session state (open folder and tabs). Empty when none or unreadable. */
  getSession(): Promise<SessionState>;
  setSession(state: SessionState): Promise<void>;

  // --- window ---------------------------------------------------------------
  /** Recolour the native caption buttons to match the active style. */
  setChrome(chrome: { color: string; symbolColor: string; height: number }): Promise<void>;
  /**
   * Bytes of a bundled font file (a FontFaceDef.file such as "inter/inter-latin-wght-normal.woff2"),
   * or null. Used to embed fonts when a graph is exported as an image.
   */
  fontData(file: string): Promise<Uint8Array | null>;
  /** Clipboard actions on the focused field, for menu items (keyboard shortcuts work natively). */
  editAction(action: 'cut' | 'copy' | 'paste' | 'pastePlain' | 'selectAll'): Promise<void>;
  /** Open an http(s) or mailto link in the default browser / mail client. */
  openExternal(url: string): Promise<void>;
  /** Main asks the renderer to save or discard before the window closes. */
  onCloseRequested(cb: () => void): () => void;
  /** Renderer confirms the window may close now. */
  confirmClose(): Promise<void>;
  /** App version and environment info for the About dialog. */
  appInfo(): Promise<{ version: string; electron: string; chrome: string; node: string; dataDir: string }>;
}

/** Request/response channels: one per SealpageApi method that returns a value. */
export const INVOKE_CHANNELS = [
  'keyState',
  'keySetup',
  'keyRestore',
  'keyVerify',
  'keyChange',
  'pickReencryptFiles',
  'pickReencryptFolder',
  'reencrypt',
  'reencryptCancel',
  'pickOpenFiles',
  'pickSavePath',
  'pickFolder',
  'readDocument',
  'writeDocument',
  'listFolder',
  'createDocument',
  'createFolder',
  'renameEntry',
  'trashEntry',
  'revealInExplorer',
  'watchFolder',
  'rendererReady',
  'exportMarkdown',
  'exportPdf',
  'print',
  'exportGraph',
  'getSettings',
  'updateSettings',
  'getSession',
  'setSession',
  'setChrome',
  'editAction',
  'fontData',
  'openExternal',
  'confirmClose',
  'appInfo',
] as const satisfies readonly (keyof SealpageApi)[];
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

/** Main -> renderer event channels. */
export const EVENT_CHANNELS = {
  onReencryptProgress: 'reencryptProgress',
  onFolderChanged: 'folderChanged',
  onOpenPaths: 'openPaths',
  onCloseRequested: 'closeRequested',
} as const;

export const IPC_PREFIX = 'sealpage:';

export function ok(): Result<void>;
export function ok<T>(value: T): Result<T>;
export function ok<T>(value?: T): Result<T> | Result<void> {
  return (arguments.length === 0 ? { ok: true } : { ok: true, value }) as Result<T>;
}

export function fail(code: ErrorCode, message: string): { ok: false; code: ErrorCode; message: string } {
  return { ok: false, code, message };
}

declare global {
  interface Window {
    sealpage: SealpageApi;
  }
}
