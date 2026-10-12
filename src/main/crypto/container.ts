/**
 * The Sealpage encrypted container (docs/FORMAT.md, part 2).
 *
 *   header (88 bytes, authenticated as AAD) | ciphertext | 16-byte GCM tag
 *
 * Primitives, all from Node's built-in crypto module:
 *   - per-file key = HKDF-SHA-256(ikm = master key, salt = 32 random bytes,
 *                                 info = "sealpage/file-key/v1" || content type)
 *   - AES-256-GCM with a fresh random 96-bit nonce per encryption
 *   - the entire header is the additional authenticated data
 *
 * A fresh file salt AND a fresh nonce are drawn for every save, so no
 * (key, nonce) pair is ever reused even across billions of saves.
 *
 * Decryption is all-or-nothing: plaintext is only returned after the tag has
 * been verified.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { type KdfParams, type MasterKey, KDF_ID_ARGON2ID, KDF_SALT_BYTES, MASTER_KEY_BYTES, kdfParamsValid, sameKdf } from './kdf';

/** \x89 S L P G \r \n \x1a - the PNG trick: detects text-mode mangling early. */
export const MAGIC = Buffer.from([0x89, 0x53, 0x4c, 0x50, 0x47, 0x0d, 0x0a, 0x1a]);
export const CONTAINER_VERSION = 1;
export const CIPHER_ID_AES256GCM_HKDF_SHA256 = 1;

export const FILE_SALT_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const HEADER_BYTES = 88;
/** Smallest possible container: header + tag around an empty plaintext. */
export const MIN_CONTAINER_BYTES = HEADER_BYTES + TAG_BYTES;
/** Refuse absurdly large inputs instead of exhausting memory. */
export const MAX_CONTAINER_BYTES = 512 * 1024 * 1024;

/** What the plaintext is. Bound into the key derivation and the AAD. */
export const CONTENT_DOCUMENT = 1;
export const CONTENT_APP_STATE = 2;
export type ContentType = typeof CONTENT_DOCUMENT | typeof CONTENT_APP_STATE;

const OFF = {
  magic: 0,
  version: 8,
  kdfId: 9,
  cipherId: 10,
  contentType: 11,
  headerLength: 12,
  reserved: 14,
  memoryKiB: 16,
  iterations: 20,
  parallelism: 24,
  kdfSalt: 28,
  fileSalt: 44,
  nonce: 76,
} as const;

const HKDF_INFO_PREFIX = Buffer.from('sealpage/file-key/v1', 'ascii');

export type ContainerErrorCode = 'bad-format' | 'unsupported-version' | 'cannot-decrypt';

export class ContainerError extends Error {
  constructor(
    readonly code: ContainerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ContainerError';
  }
}

/** The single message shown for any authentication failure. No hints, by design. */
export const CANNOT_DECRYPT_MESSAGE = 'Cannot decrypt this file.';
export const BAD_FORMAT_MESSAGE = 'This is not a Sealpage file, or it is damaged.';
export const UNSUPPORTED_VERSION_MESSAGE = 'This file was created by a newer version of Sealpage.';

export interface ContainerHeader {
  version: number;
  kdfId: number;
  cipherId: number;
  contentType: number;
  params: KdfParams;
  kdfSalt: Buffer;
  fileSalt: Buffer;
  nonce: Buffer;
}

function fileKey(master: Buffer, fileSalt: Buffer, contentType: number): Buffer {
  const info = Buffer.concat([HKDF_INFO_PREFIX, Buffer.from([contentType])]);
  return Buffer.from(hkdfSync('sha256', master, fileSalt, info, MASTER_KEY_BYTES));
}

function buildHeader(key: MasterKey, contentType: ContentType, fileSalt: Buffer, nonce: Buffer): Buffer {
  const h = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(h, OFF.magic);
  h.writeUInt8(CONTAINER_VERSION, OFF.version);
  h.writeUInt8(KDF_ID_ARGON2ID, OFF.kdfId);
  h.writeUInt8(CIPHER_ID_AES256GCM_HKDF_SHA256, OFF.cipherId);
  h.writeUInt8(contentType, OFF.contentType);
  h.writeUInt16BE(HEADER_BYTES, OFF.headerLength);
  h.writeUInt16BE(0, OFF.reserved);
  h.writeUInt32BE(key.params.memoryKiB, OFF.memoryKiB);
  h.writeUInt32BE(key.params.iterations, OFF.iterations);
  h.writeUInt32BE(key.params.parallelism, OFF.parallelism);
  key.salt.copy(h, OFF.kdfSalt);
  fileSalt.copy(h, OFF.fileSalt);
  nonce.copy(h, OFF.nonce);
  return h;
}

function assertKey(key: MasterKey): void {
  if (key.key.length !== MASTER_KEY_BYTES) throw new Error('Master key must be 32 bytes');
  if (key.salt.length !== KDF_SALT_BYTES) throw new Error('KDF salt must be 16 bytes');
  if (!kdfParamsValid(key.params)) throw new Error('Invalid key derivation parameters');
}

/**
 * Encrypt `plaintext` into a new container. Every call draws a new random
 * file salt and nonce.
 */
export function encryptContainer(plaintext: Uint8Array, key: MasterKey, contentType: ContentType = CONTENT_DOCUMENT): Buffer {
  assertKey(key);
  const fileSalt = randomBytes(FILE_SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const header = buildHeader(key, contentType, fileSalt, nonce);
  const k = fileKey(key.key, fileSalt, contentType);
  try {
    const cipher = createCipheriv('aes-256-gcm', k, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(header);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([header, body, cipher.getAuthTag()]);
  } finally {
    k.fill(0);
  }
}

/**
 * Parse and validate a container header without decrypting anything.
 * Throws ContainerError('bad-format' | 'unsupported-version').
 */
export function parseHeader(data: Uint8Array): ContainerHeader {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new ContainerError('bad-format', BAD_FORMAT_MESSAGE);
  }
  if (buf.length < OFF.version + 1) throw new ContainerError('bad-format', BAD_FORMAT_MESSAGE);
  const version = buf.readUInt8(OFF.version);
  if (version > CONTAINER_VERSION) throw new ContainerError('unsupported-version', UNSUPPORTED_VERSION_MESSAGE);
  if (version !== CONTAINER_VERSION) throw new ContainerError('bad-format', BAD_FORMAT_MESSAGE);
  if (buf.length < MIN_CONTAINER_BYTES || buf.length > MAX_CONTAINER_BYTES) {
    throw new ContainerError('bad-format', BAD_FORMAT_MESSAGE);
  }
  const header: ContainerHeader = {
    version,
    kdfId: buf.readUInt8(OFF.kdfId),
    cipherId: buf.readUInt8(OFF.cipherId),
    contentType: buf.readUInt8(OFF.contentType),
    params: {
      memoryKiB: buf.readUInt32BE(OFF.memoryKiB),
      iterations: buf.readUInt32BE(OFF.iterations),
      parallelism: buf.readUInt32BE(OFF.parallelism),
    },
    kdfSalt: Buffer.from(buf.subarray(OFF.kdfSalt, OFF.kdfSalt + KDF_SALT_BYTES)),
    fileSalt: Buffer.from(buf.subarray(OFF.fileSalt, OFF.fileSalt + FILE_SALT_BYTES)),
    nonce: Buffer.from(buf.subarray(OFF.nonce, OFF.nonce + NONCE_BYTES)),
  };
  if (
    header.kdfId !== KDF_ID_ARGON2ID ||
    header.cipherId !== CIPHER_ID_AES256GCM_HKDF_SHA256 ||
    (header.contentType !== CONTENT_DOCUMENT && header.contentType !== CONTENT_APP_STATE) ||
    buf.readUInt16BE(OFF.headerLength) !== HEADER_BYTES ||
    buf.readUInt16BE(OFF.reserved) !== 0 ||
    !kdfParamsValid(header.params)
  ) {
    throw new ContainerError('bad-format', BAD_FORMAT_MESSAGE);
  }
  return header;
}

/** True when the container says it was encrypted under this master key (same KDF salt and parameters). */
export function headerMatchesKey(header: ContainerHeader, key: MasterKey): boolean {
  return sameKdf({ params: header.params, salt: header.kdfSalt }, key);
}

/**
 * Decrypt a container. Returns the plaintext only if the whole file
 * authenticates; otherwise throws ContainerError and returns nothing.
 *
 *   'bad-format'           not a container, truncated below the minimum, malformed header
 *   'unsupported-version'  written by a newer Sealpage
 *   'cannot-decrypt'       wrong key, wrong content type, or any modification / truncation
 */
export function decryptContainer(data: Uint8Array, key: MasterKey, expectedType: ContentType = CONTENT_DOCUMENT): Buffer {
  assertKey(key);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const header = parseHeader(buf);
  if (header.contentType !== expectedType) throw new ContainerError('cannot-decrypt', CANNOT_DECRYPT_MESSAGE);
  const aad = buf.subarray(0, HEADER_BYTES);
  const body = buf.subarray(HEADER_BYTES, buf.length - TAG_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const k = fileKey(key.key, header.fileSalt, header.contentType);
  let plain: Buffer | null = null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', k, header.nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    // update() yields unauthenticated bytes; they stay private to this
    // function until final() has verified the tag.
    plain = decipher.update(body);
    decipher.final();
    const out = plain;
    plain = null;
    return out;
  } catch {
    throw new ContainerError('cannot-decrypt', CANNOT_DECRYPT_MESSAGE);
  } finally {
    k.fill(0);
    plain?.fill(0);
  }
}
