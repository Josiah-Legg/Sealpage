/**
 * Non-sensitive application settings, persisted as plain JSON in the app data
 * folder. Nothing in here may ever contain document content, file names,
 * folder paths or key material (see the no-trace policy in the README).
 */

export interface WindowBounds {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
}

/** Share of the editor pane the text column grows to, per page width setting. */
export const PAGE_WIDTH_FILL = { narrow: 0, medium: 62, wide: 80, full: 100 } as const;
export type PageWidth = keyof typeof PAGE_WIDTH_FILL;

export interface AppSettings {
  /** Id of the active style definition. */
  styleId: string;
  /** Per-style option values: styleId -> optionId -> value. */
  styleOptions: Record<string, Record<string, boolean | string>>;
  /** Autosave documents that already have a file. */
  autosave: boolean;
  /** Idle time after the last edit before autosaving, in milliseconds. */
  autosaveDelayMs: number;
  sidebarVisible: boolean;
  sidebarWidth: number;
  toolbarVisible: boolean;
  statusBarVisible: boolean;
  /** Editor zoom factor applied to the document only (1 = 100%). */
  zoom: number;
  /** How much of a wide window the text column fills; 'narrow' keeps the style's own width. */
  pageWidth: PageWidth;
  /** Remember the open folder and tabs between launches (stored encrypted). */
  restoreSession: boolean;
  /** Shortcut overrides: command id -> shortcut string ("" disables the shortcut). */
  shortcuts: Record<string, string>;
  window: WindowBounds;
}

export const DEFAULT_SETTINGS: AppSettings = {
  styleId: 'warm-grey',
  styleOptions: {},
  autosave: true,
  autosaveDelayMs: 1500,
  sidebarVisible: true,
  sidebarWidth: 260,
  toolbarVisible: true,
  statusBarVisible: true,
  zoom: 1,
  pageWidth: 'medium',
  restoreSession: true,
  shortcuts: {},
  window: { width: 1240, height: 820, x: null, y: null, maximized: false },
};

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Validate untrusted JSON into a complete AppSettings object. Never throws. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const d = DEFAULT_SETTINGS;
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const w = (typeof r.window === 'object' && r.window !== null ? r.window : {}) as Record<string, unknown>;

  const styleOptions: AppSettings['styleOptions'] = {};
  if (typeof r.styleOptions === 'object' && r.styleOptions !== null) {
    for (const [styleId, opts] of Object.entries(r.styleOptions as Record<string, unknown>)) {
      if (typeof opts !== 'object' || opts === null || !/^[a-z0-9-]{1,64}$/.test(styleId)) continue;
      const clean: Record<string, boolean | string> = {};
      for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) continue;
        if (typeof v === 'boolean') clean[k] = v;
        else if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)) clean[k] = v;
      }
      styleOptions[styleId] = clean;
    }
  }

  const shortcuts: Record<string, string> = {};
  if (typeof r.shortcuts === 'object' && r.shortcuts !== null) {
    for (const [k, v] of Object.entries(r.shortcuts as Record<string, unknown>)) {
      if (/^[a-zA-Z0-9.-]{1,64}$/.test(k) && typeof v === 'string' && /^[A-Za-z0-9+ \-=[\]\\;',./`]{0,40}$/.test(v)) {
        shortcuts[k] = v;
      }
    }
  }

  return {
    styleId: typeof r.styleId === 'string' && /^[a-z0-9-]{1,64}$/.test(r.styleId) ? r.styleId : d.styleId,
    styleOptions,
    autosave: bool(r.autosave, d.autosave),
    autosaveDelayMs: Math.round(clamp(r.autosaveDelayMs, 300, 60000, d.autosaveDelayMs)),
    sidebarVisible: bool(r.sidebarVisible, d.sidebarVisible),
    sidebarWidth: Math.round(clamp(r.sidebarWidth, 160, 600, d.sidebarWidth)),
    toolbarVisible: bool(r.toolbarVisible, d.toolbarVisible),
    statusBarVisible: bool(r.statusBarVisible, d.statusBarVisible),
    zoom: clamp(r.zoom, 0.5, 2.5, d.zoom),
    pageWidth: typeof r.pageWidth === 'string' && Object.hasOwn(PAGE_WIDTH_FILL, r.pageWidth) ? (r.pageWidth as PageWidth) : d.pageWidth,
    restoreSession: bool(r.restoreSession, d.restoreSession),
    shortcuts,
    window: {
      width: Math.round(clamp(w.width, 640, 10000, d.window.width)),
      height: Math.round(clamp(w.height, 420, 10000, d.window.height)),
      x: typeof w.x === 'number' && Number.isFinite(w.x) ? Math.round(w.x) : null,
      y: typeof w.y === 'number' && Number.isFinite(w.y) ? Math.round(w.y) : null,
      maximized: bool(w.maximized, false),
    },
  };
}

/**
 * Session state. Unlike AppSettings this reveals which files the user works
 * on, so it is only ever stored encrypted with the master key.
 */
export interface SessionState {
  /** Folder shown in the sidebar, or null. */
  folder: string | null;
  /** Paths of the open tabs, in order. */
  openFiles: string[];
  /** Path of the active tab, or null. */
  activeFile: string | null;
}

export const EMPTY_SESSION: SessionState = { folder: null, openFiles: [], activeFile: null };

export function sanitizeSession(raw: unknown): SessionState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const openFiles = Array.isArray(r.openFiles) ? r.openFiles.filter((p): p is string => typeof p === 'string').slice(0, 64) : [];
  return {
    folder: typeof r.folder === 'string' && r.folder !== '' ? r.folder : null,
    openFiles,
    activeFile: typeof r.activeFile === 'string' && openFiles.includes(r.activeFile) ? r.activeFile : null,
  };
}
