import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SecretProtector } from '../../../src/main/crypto/keystore';
import { type KdfParams, type MasterKey, KDF_SALT_BYTES } from '../../../src/main/crypto/kdf';

/** Cheap Argon2id parameters so the suite stays fast. Real defaults are tested once in kdf.test.ts. */
export const FAST_KDF: KdfParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };

export function randomMasterKey(): MasterKey {
  return { key: randomBytes(32), params: { ...FAST_KDF }, salt: randomBytes(KDF_SALT_BYTES) };
}

/**
 * Stand-in for DPAPI: XORs with a per-"user" pad and adds a marker, so that
 * a blob protected by one fake user cannot be unprotected by another.
 */
export class FakeProtector implements SecretProtector {
  available = true;
  private readonly pad: Buffer;
  constructor(user = 'alice') {
    this.pad = Buffer.alloc(256, user);
  }
  isAvailable(): boolean {
    return this.available;
  }
  protect(plain: Buffer): Buffer {
    const out = Buffer.alloc(plain.length + 4);
    out.write('FAKE', 0, 'ascii');
    for (let i = 0; i < plain.length; i++) out[i + 4] = plain[i]! ^ this.pad[i % this.pad.length]! ^ 0xa5;
    // integrity byte so another user's pad is detected
    return Buffer.concat([out, Buffer.from([this.pad[0]!])]);
  }
  unprotect(blob: Buffer): Buffer {
    if (blob.length < 5 || blob.subarray(0, 4).toString('ascii') !== 'FAKE' || blob[blob.length - 1] !== this.pad[0]) {
      throw new Error('cannot unprotect');
    }
    const body = blob.subarray(4, blob.length - 1);
    const out = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i++) out[i] = body[i]! ^ this.pad[i % this.pad.length]! ^ 0xa5;
    return out;
  }
}

export function makeTempDir(prefix = 'sealpage-test-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
