/**
 * Safe re-encryption of files from a previous key to the current key.
 *
 * For every file: read, authenticate + decrypt in memory with the old key,
 * encrypt under the current key, check in memory that the new ciphertext
 * decrypts to the same bytes, then replace the file atomically (temp file in
 * the same folder, fsync, read-back comparison, rename). A file is therefore
 * always either fully old or fully new; nothing is ever half converted, and
 * a failure on one file never affects another.
 */
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { atomicWriteFile } from '../fs/atomic';
import { ContainerError, decryptContainer, encryptContainer, headerMatchesKey, parseHeader, type ContentType } from './container';
import { type KdfParams, type MasterKey, deriveKey, zeroize } from './kdf';

export const DOCUMENT_EXTENSION = '.slpg';

export type ReencryptStatus = 'converted' | 'already-current' | 'cannot-decrypt' | 'bad-format' | 'io-error';

export interface ReencryptFileResult {
  path: string;
  status: ReencryptStatus;
  message: string;
}

export interface ReencryptReport {
  results: ReencryptFileResult[];
  converted: number;
  alreadyCurrent: number;
  failed: number;
  cancelled: boolean;
}

export interface ReencryptOptions {
  /** Files to convert (use collectDocumentFiles to expand folders). */
  files: string[];
  /** The passphrase the files are currently encrypted with. */
  passphrase: string;
  /** The key to re-encrypt under. */
  current: MasterKey;
  onProgress?: (p: { done: number; total: number; current: string | null }) => void;
  isCancelled?: () => boolean;
}

const MESSAGES: Record<ReencryptStatus, string> = {
  converted: 'Re-encrypted with the current key.',
  'already-current': 'Already encrypted with the current key.',
  'cannot-decrypt': 'Cannot decrypt with the passphrase given. File left unchanged.',
  'bad-format': 'Not a valid Sealpage file. File left unchanged.',
  'io-error': 'Could not be read or written. File left unchanged.',
};

/** Expand a mix of files and folders into a sorted, de-duplicated list of .slpg files. */
export async function collectDocumentFiles(paths: string[], maxFiles = 100000): Promise<string[]> {
  const found = new Set<string>();
  const walk = async (p: string, depth: number): Promise<void> => {
    if (found.size >= maxFiles || depth > 64) return;
    let st;
    try {
      st = await fs.lstat(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return; // never follow links out of the chosen tree
    if (st.isFile()) {
      if (extname(p).toLowerCase() === DOCUMENT_EXTENSION) found.add(p);
      return;
    }
    if (!st.isDirectory()) return;
    let names: string[];
    try {
      names = await fs.readdir(p);
    } catch {
      return;
    }
    for (const name of names) await walk(join(p, name), depth + 1);
  };
  for (const p of paths) await walk(p, 0);
  return [...found].sort((a, b) => a.localeCompare(b));
}

function cacheId(params: KdfParams, salt: Buffer): string {
  return `${params.memoryKiB}:${params.iterations}:${params.parallelism}:${salt.toString('hex')}`;
}

export async function reencryptFiles(opts: ReencryptOptions): Promise<ReencryptReport> {
  const { files, passphrase, current } = opts;
  const results: ReencryptFileResult[] = [];
  /** Old keys derived so far, one per distinct (salt, parameters) seen in file headers. */
  const oldKeys = new Map<string, Buffer>();
  let cancelled = false;

  const record = (path: string, status: ReencryptStatus, detail?: string): void => {
    results.push({ path, status, message: detail ?? MESSAGES[status] });
  };

  try {
    for (let i = 0; i < files.length; i++) {
      if (opts.isCancelled?.()) {
        cancelled = true;
        break;
      }
      const path = files[i]!;
      opts.onProgress?.({ done: i, total: files.length, current: path });

      let data: Buffer;
      try {
        data = await fs.readFile(path);
      } catch {
        record(path, 'io-error');
        continue;
      }

      let header;
      try {
        header = parseHeader(data);
      } catch (err) {
        record(path, 'bad-format', err instanceof ContainerError ? err.message + ' File left unchanged.' : undefined);
        continue;
      }
      const contentType = header.contentType as ContentType;

      if (headerMatchesKey(header, current)) {
        try {
          zeroize(decryptContainer(data, current, contentType));
          record(path, 'already-current');
        } catch {
          record(path, 'cannot-decrypt', 'Marked as using the current key but cannot be decrypted (damaged?). File left unchanged.');
        }
        continue;
      }

      const id = cacheId(header.params, header.kdfSalt);
      let oldKey = oldKeys.get(id);
      if (!oldKey) {
        try {
          oldKey = await deriveKey(passphrase, header.kdfSalt, header.params);
        } catch {
          record(path, 'bad-format');
          continue;
        }
        oldKeys.set(id, oldKey);
      }

      let plain: Buffer | null = null;
      try {
        try {
          plain = decryptContainer(data, { key: oldKey, params: header.params, salt: header.kdfSalt }, contentType);
        } catch {
          record(path, 'cannot-decrypt');
          continue;
        }
        const fresh = encryptContainer(plain, current, contentType);
        // Belt and braces: prove the new ciphertext opens to the same bytes before touching the file.
        const check = decryptContainer(fresh, current, contentType);
        const same = Buffer.compare(check, plain) === 0;
        zeroize(check);
        if (!same) {
          record(path, 'io-error', 'Internal verification failed. File left unchanged.');
          continue;
        }
        try {
          await atomicWriteFile(path, fresh, { verify: true });
          record(path, 'converted');
        } catch {
          record(path, 'io-error');
        }
      } finally {
        zeroize(plain);
      }
    }
  } finally {
    for (const k of oldKeys.values()) zeroize(k);
    oldKeys.clear();
  }

  opts.onProgress?.({ done: results.length, total: files.length, current: null });
  const converted = results.filter((r) => r.status === 'converted').length;
  const alreadyCurrent = results.filter((r) => r.status === 'already-current').length;
  return { results, converted, alreadyCurrent, failed: results.length - converted - alreadyCurrent, cancelled };
}
