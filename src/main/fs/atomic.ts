/**
 * Atomic file replacement and temp-file hygiene.
 *
 * A file is replaced by writing the new bytes to a temp file in the same
 * folder, flushing it to disk (fsync / FlushFileBuffers) and renaming it over
 * the target. A crash or power loss at any point leaves either the complete
 * old file or the complete new file, never a mixture.
 *
 * NO-TRACE RULE: callers pass only ciphertext (or non-sensitive settings)
 * here. This module never sees document plaintext, so the temp files it
 * creates never contain any.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const TEMP_SUFFIX = '.sealpage-tmp';
/** ".<target name>.<16 hex>.sealpage-tmp" */
const TEMP_RE = /^\..+\.[0-9a-f]{16}\.sealpage-tmp$/;

/** Temp files this process is writing right now (never treated as stale). */
const inFlight = new Set<string>();

export function isTempFileName(name: string): boolean {
  return TEMP_RE.test(name);
}

export function tempPathFor(target: string): string {
  return join(dirname(target), `.${basename(target)}.${randomBytes(8).toString('hex')}${TEMP_SUFFIX}`);
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Windows refuses to replace a file another process has open (indexer, antivirus); retry briefly. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const delays = [10, 25, 50, 100, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= delays.length || !RETRYABLE.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export interface AtomicWriteOptions {
  /** Read the temp file back and compare it with `data` before renaming. */
  verify?: boolean;
}

/**
 * Atomically replace `target` with `data`.
 * On any failure the target is untouched and the temp file is removed.
 */
export async function atomicWriteFile(target: string, data: Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  const tmp = tempPathFor(target);
  inFlight.add(tmp);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (options.verify) {
      const written = await fs.readFile(tmp);
      if (Buffer.compare(written, data) !== 0) throw new Error('Verification of the written file failed');
    }
    await renameWithRetry(tmp, target);
  } catch (err) {
    await handle?.close().catch(() => undefined);
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  } finally {
    inFlight.delete(tmp);
  }
}

/**
 * Delete leftover temp files in `dir` (from a crash or power loss mid-save).
 * They only ever contain ciphertext, but they are clutter. Returns the number removed.
 */
export async function cleanStaleTempFiles(dir: string): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!isTempFileName(name)) continue;
    const full = join(dir, name);
    if (inFlight.has(full)) continue;
    try {
      const st = await fs.lstat(full);
      if (!st.isFile()) continue;
      await fs.unlink(full);
      removed++;
    } catch {
      /* in use or already gone */
    }
  }
  return removed;
}
