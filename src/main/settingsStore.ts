/**
 * Persistent app state.
 *
 *   settings.json  plain JSON, non-sensitive preferences only
 *   session.bin    open folder / tabs: reveals what the user works on, so it
 *                  is encrypted with the master key (container content type 2)
 */
import { promises as fs } from 'node:fs';
import { type AppSettings, type SessionState, DEFAULT_SETTINGS, EMPTY_SESSION, sanitizeSession, sanitizeSettings } from '../shared/settings';
import { CONTENT_APP_STATE, decryptContainer, encryptContainer } from './crypto/container';
import type { MasterKey } from './crypto/kdf';
import { atomicWriteFile } from './fs/atomic';

export class SettingsStore {
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly settingsFile: string,
    private readonly sessionFile: string,
  ) {}

  async load(): Promise<AppSettings> {
    try {
      this.settings = sanitizeSettings(JSON.parse(await fs.readFile(this.settingsFile, 'utf8')));
    } catch {
      this.settings = structuredClone(DEFAULT_SETTINGS);
    }
    return this.get();
  }

  get(): AppSettings {
    return structuredClone(this.settings);
  }

  /** Merge a patch, validate the result and persist it. Writes are serialised. */
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = sanitizeSettings({ ...this.settings, ...(typeof patch === 'object' && patch !== null ? patch : {}) });
    const snapshot = JSON.stringify(this.settings, null, 2);
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => atomicWriteFile(this.settingsFile, Buffer.from(snapshot, 'utf8')));
    await this.writing.catch(() => undefined);
    return this.get();
  }

  async readSession(key: MasterKey | null): Promise<SessionState> {
    if (!key) return structuredClone(EMPTY_SESSION);
    let plain: Buffer | null = null;
    try {
      plain = decryptContainer(await fs.readFile(this.sessionFile), key, CONTENT_APP_STATE);
      return sanitizeSession(JSON.parse(plain.toString('utf8')));
    } catch {
      return structuredClone(EMPTY_SESSION);
    } finally {
      plain?.fill(0);
    }
  }

  async writeSession(key: MasterKey | null, state: SessionState): Promise<void> {
    if (!key) return;
    const plain = Buffer.from(JSON.stringify(sanitizeSession(state)), 'utf8');
    try {
      await atomicWriteFile(this.sessionFile, encryptContainer(plain, key, CONTENT_APP_STATE));
    } catch {
      /* losing the session list is harmless */
    } finally {
      plain.fill(0);
    }
  }

  async clearSession(): Promise<void> {
    await fs.unlink(this.sessionFile).catch(() => undefined);
  }
}
