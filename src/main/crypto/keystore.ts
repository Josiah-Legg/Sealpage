/**
 * Master key storage.
 *
 * The master key is derived once from the passphrase (Argon2id) and then kept
 * on this machine, wrapped by the operating system's per-user secret
 * protection (Electron safeStorage, which on Windows is backed by DPAPI). The
 * passphrase itself is never stored.
 *
 * On-disk file:  "SLPGKEY1" (8 bytes) | protected blob
 * Blob plaintext (61 bytes): version u8 | memoryKiB u32be | iterations u32be |
 *                            parallelism u32be | salt[16] | key[32]
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { atomicWriteFile } from '../fs/atomic';
import { ContainerError, decryptContainer, parseHeader } from './container';
import {
  type KdfParams,
  type MasterKey,
  DEFAULT_KDF_PARAMS,
  KDF_SALT_BYTES,
  MASTER_KEY_BYTES,
  deriveKey,
  kdfParamsValid,
  zeroize,
} from './kdf';

/** OS-level secret protection. Implemented with Electron safeStorage in the app, faked in tests. */
export interface SecretProtector {
  isAvailable(): boolean;
  protect(plain: Buffer): Buffer;
  /** Throws when the blob was not protected by this user on this machine. */
  unprotect(blob: Buffer): Buffer;
}

export type KeystoreState = 'unset' | 'ready' | 'locked-out' | 'unavailable';

export type KeystoreErrorCode = 'no-key' | 'wrong-passphrase' | 'keystore-unavailable' | 'invalid-argument' | 'cannot-decrypt' | 'bad-format' | 'unsupported-version' | 'already-exists';

export class KeystoreError extends Error {
  constructor(
    readonly code: KeystoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KeystoreError';
  }
}

export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 1024;

const FILE_MAGIC = Buffer.from('SLPGKEY1', 'ascii');
const BLOB_VERSION = 1;
const BLOB_BYTES = 1 + 4 + 4 + 4 + KDF_SALT_BYTES + MASTER_KEY_BYTES;

function encodeBlob(k: MasterKey): Buffer {
  const b = Buffer.alloc(BLOB_BYTES);
  b.writeUInt8(BLOB_VERSION, 0);
  b.writeUInt32BE(k.params.memoryKiB, 1);
  b.writeUInt32BE(k.params.iterations, 5);
  b.writeUInt32BE(k.params.parallelism, 9);
  k.salt.copy(b, 13);
  k.key.copy(b, 13 + KDF_SALT_BYTES);
  return b;
}

function decodeBlob(b: Buffer): MasterKey | null {
  if (b.length !== BLOB_BYTES || b.readUInt8(0) !== BLOB_VERSION) return null;
  const params: KdfParams = { memoryKiB: b.readUInt32BE(1), iterations: b.readUInt32BE(5), parallelism: b.readUInt32BE(9) };
  if (!kdfParamsValid(params)) return null;
  return {
    params,
    salt: Buffer.from(b.subarray(13, 13 + KDF_SALT_BYTES)),
    key: Buffer.from(b.subarray(13 + KDF_SALT_BYTES)),
  };
}

function checkPassphrase(passphrase: unknown): asserts passphrase is string {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new KeystoreError('invalid-argument', `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`);
  }
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
    throw new KeystoreError('invalid-argument', 'The passphrase is too long.');
  }
}

export class Keystore {
  private master: MasterKey | null = null;
  private status: KeystoreState = 'unset';

  constructor(
    private readonly file: string,
    private readonly protector: SecretProtector,
    /** Parameters for newly created keys. Tests pass cheap ones. */
    private readonly newKeyParams: KdfParams = DEFAULT_KDF_PARAMS,
  ) {}

  get state(): KeystoreState {
    return this.status;
  }

  /** The loaded master key, or null. Callers must not retain or copy it. */
  get current(): MasterKey | null {
    return this.master;
  }

  /** Read and unprotect the stored key, if any. */
  async load(): Promise<KeystoreState> {
    this.lock();
    if (!this.protector.isAvailable()) return (this.status = 'unavailable');
    let data: Buffer;
    try {
      data = await fs.readFile(this.file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return (this.status = 'unset');
      return (this.status = 'locked-out');
    }
    if (data.length <= FILE_MAGIC.length || !data.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
      return (this.status = 'locked-out');
    }
    let blob: Buffer | null = null;
    try {
      blob = this.protector.unprotect(data.subarray(FILE_MAGIC.length));
      const key = decodeBlob(blob);
      if (!key) return (this.status = 'locked-out');
      this.master = key;
      return (this.status = 'ready');
    } catch {
      return (this.status = 'locked-out');
    } finally {
      zeroize(blob);
    }
  }

  private async persist(key: MasterKey): Promise<void> {
    if (!this.protector.isAvailable()) {
      throw new KeystoreError('keystore-unavailable', 'Windows secret storage is not available, so the key cannot be stored.');
    }
    const blob = encodeBlob(key);
    try {
      const wrapped = this.protector.protect(blob);
      await atomicWriteFile(this.file, Buffer.concat([FILE_MAGIC, wrapped]), { verify: true });
    } finally {
      zeroize(blob);
    }
  }

  private adopt(key: MasterKey): void {
    const old = this.master;
    this.master = key;
    this.status = 'ready';
    if (old && old !== key) zeroize(old.key);
  }

  /** First launch: create a brand-new key from a passphrase. Refuses to overwrite a usable key. */
  async setup(passphrase: string): Promise<void> {
    checkPassphrase(passphrase);
    if (this.status === 'ready') throw new KeystoreError('already-exists', 'A key is already set. Use "Change key" instead.');
    const salt = randomBytes(KDF_SALT_BYTES);
    const key: MasterKey = { key: await deriveKey(passphrase, salt, this.newKeyParams), params: { ...this.newKeyParams }, salt };
    try {
      await this.persist(key);
    } catch (err) {
      zeroize(key.key);
      throw err;
    }
    this.adopt(key);
  }

  /**
   * Recreate an existing key on this machine from its passphrase plus any
   * file that was encrypted with it. The file supplies the salt and KDF
   * parameters; successfully decrypting it proves the passphrase is right.
   */
  async restore(passphrase: string, sampleFile: Uint8Array): Promise<void> {
    checkPassphrase(passphrase);
    if (this.status === 'ready') throw new KeystoreError('already-exists', 'A key is already set. Use "Change key" instead.');
    let header;
    try {
      header = parseHeader(sampleFile);
    } catch (err) {
      const e = err as ContainerError;
      throw new KeystoreError(e.code === 'unsupported-version' ? 'unsupported-version' : 'bad-format', e.message);
    }
    const key: MasterKey = { key: await deriveKey(passphrase, header.kdfSalt, header.params), params: header.params, salt: header.kdfSalt };
    try {
      zeroize(decryptContainer(sampleFile, key, header.contentType === 2 ? 2 : 1));
    } catch {
      zeroize(key.key);
      throw new KeystoreError('cannot-decrypt', 'Cannot decrypt this file.');
    }
    try {
      await this.persist(key);
    } catch (err) {
      zeroize(key.key);
      throw err;
    }
    this.adopt(key);
  }

  /** Constant-time check of a passphrase against the stored key. */
  async verify(passphrase: string): Promise<boolean> {
    const cur = this.master;
    if (!cur) throw new KeystoreError('no-key', 'No key has been set up.');
    if (typeof passphrase !== 'string' || passphrase.length === 0 || passphrase.length > MAX_PASSPHRASE_LENGTH) return false;
    const candidate = await deriveKey(passphrase, cur.salt, cur.params);
    try {
      return timingSafeEqual(candidate, cur.key);
    } finally {
      zeroize(candidate);
    }
  }

  /**
   * Replace the master key. Requires the current passphrase. The new key gets
   * a fresh salt; the keystore file is replaced atomically, so after a crash
   * either the old or the new key is stored, never neither.
   *
   * Existing files stay encrypted under the old key until they are
   * re-encrypted (reencrypt.ts) using the old passphrase.
   */
  async change(currentPassphrase: string, newPassphrase: string): Promise<void> {
    if (!this.master) throw new KeystoreError('no-key', 'No key has been set up.');
    if (!(await this.verify(currentPassphrase))) {
      throw new KeystoreError('wrong-passphrase', 'The current passphrase is not correct.');
    }
    checkPassphrase(newPassphrase);
    const salt = randomBytes(KDF_SALT_BYTES);
    const key: MasterKey = { key: await deriveKey(newPassphrase, salt, this.newKeyParams), params: { ...this.newKeyParams }, salt };
    try {
      await this.persist(key);
    } catch (err) {
      zeroize(key.key);
      throw err;
    }
    this.adopt(key);
  }

  /** Wipe the in-memory key (on quit). The stored blob is untouched. */
  lock(): void {
    if (this.master) zeroize(this.master.key);
    this.master = null;
    if (this.status === 'ready') this.status = 'unset';
  }
}
