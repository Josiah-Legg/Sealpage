/**
 * Passphrase -> master key derivation (Argon2id, RFC 9106).
 *
 * The implementation is hash-wasm's Argon2id (the reference algorithm
 * compiled to WebAssembly); it is checked against the reference test vectors
 * in tests/unit/crypto/kdf.test.ts. Nothing here is home-made cryptography.
 */
import { argon2id } from 'hash-wasm';

export const KDF_ID_ARGON2ID = 1;
export const MASTER_KEY_BYTES = 32;
export const KDF_SALT_BYTES = 16;

export interface KdfParams {
  /** Memory cost in KiB. */
  memoryKiB: number;
  /** Time cost (passes over memory). */
  iterations: number;
  /** Degree of parallelism (lanes). */
  parallelism: number;
}

/**
 * Parameters used for every new key: 256 MiB, 3 passes, 4 lanes.
 * This exceeds RFC 9106's second recommended option (64 MiB, t=3, p=4) and
 * OWASP's minimum (19 MiB, t=2, p=1); it costs roughly 0.7 s on a 2024 laptop,
 * which is paid only when a key is set up, verified, changed or restored.
 */
export const DEFAULT_KDF_PARAMS: Readonly<KdfParams> = Object.freeze({
  memoryKiB: 262144,
  iterations: 3,
  parallelism: 4,
});

/** Bounds accepted when reading parameters from a file header (denial-of-service guard). */
export const KDF_LIMITS = Object.freeze({
  minMemoryKiB: 8,
  maxMemoryKiB: 1048576, // 1 GiB
  minIterations: 1,
  maxIterations: 64,
  minParallelism: 1,
  maxParallelism: 16,
});

export function kdfParamsValid(p: KdfParams): boolean {
  return (
    Number.isInteger(p.memoryKiB) &&
    Number.isInteger(p.iterations) &&
    Number.isInteger(p.parallelism) &&
    p.parallelism >= KDF_LIMITS.minParallelism &&
    p.parallelism <= KDF_LIMITS.maxParallelism &&
    p.iterations >= KDF_LIMITS.minIterations &&
    p.iterations <= KDF_LIMITS.maxIterations &&
    p.memoryKiB >= Math.max(KDF_LIMITS.minMemoryKiB, 8 * p.parallelism) &&
    p.memoryKiB <= KDF_LIMITS.maxMemoryKiB
  );
}

/** A master key together with the public parameters that reproduce it from the passphrase. */
export interface MasterKey {
  /** 32 secret bytes. */
  key: Buffer;
  params: KdfParams;
  /** 16 random bytes. Public; stored in every file header; identifies the key. */
  salt: Buffer;
}

/** The exact bytes fed to the KDF for a passphrase: its NFC-normalised UTF-8 encoding. */
export function passphraseBytes(passphrase: string): Buffer {
  return Buffer.from(passphrase.normalize('NFC'), 'utf8');
}

/** Derive the 32-byte master key. Throws on invalid parameters. */
export async function deriveKey(passphrase: string, salt: Uint8Array, params: KdfParams): Promise<Buffer> {
  if (!kdfParamsValid(params)) throw new Error('Invalid key derivation parameters');
  if (salt.length < 8) throw new Error('Invalid key derivation salt');
  const password = passphraseBytes(passphrase);
  try {
    const out = await argon2id({
      password,
      salt,
      parallelism: params.parallelism,
      iterations: params.iterations,
      memorySize: params.memoryKiB,
      hashLength: MASTER_KEY_BYTES,
      outputType: 'binary',
    });
    const key = Buffer.from(out);
    out.fill(0);
    return key;
  } finally {
    password.fill(0);
  }
}

export function sameKdf(a: { params: KdfParams; salt: Uint8Array }, b: { params: KdfParams; salt: Uint8Array }): boolean {
  return (
    a.params.memoryKiB === b.params.memoryKiB &&
    a.params.iterations === b.params.iterations &&
    a.params.parallelism === b.params.parallelism &&
    Buffer.compare(a.salt, b.salt) === 0
  );
}

/** Overwrite secret bytes. Safe to call on an already-zeroed or undefined buffer. */
export function zeroize(...buffers: (Uint8Array | null | undefined)[]): void {
  for (const b of buffers) b?.fill(0);
}
