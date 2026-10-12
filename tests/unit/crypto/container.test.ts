import { createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_APP_STATE,
  CONTENT_DOCUMENT,
  ContainerError,
  HEADER_BYTES,
  MAGIC,
  MIN_CONTAINER_BYTES,
  TAG_BYTES,
  decryptContainer,
  encryptContainer,
  headerMatchesKey,
  parseHeader,
} from '../../../src/main/crypto/container';
import { randomMasterKey } from './helpers';

const utf8 = (s: string): Buffer => Buffer.from(s, 'utf8');

function expectContainerError(fn: () => unknown, codes: string[]): void {
  let result: unknown;
  let error: unknown;
  try {
    result = fn();
  } catch (e) {
    error = e;
  }
  expect(result, 'must not return any output').toBeUndefined();
  expect(error).toBeInstanceOf(ContainerError);
  expect(codes).toContain((error as ContainerError).code);
}

describe('encrypted container', () => {
  it('round trips plaintext of many shapes', () => {
    const key = randomMasterKey();
    const samples = [
      Buffer.alloc(0),
      utf8('a'),
      utf8('~sealpage 1\n\n= Title\n\nHello, world.\n'),
      utf8('Unicode: 漢字 مرحبا 😀 é \u0000 \u2028'),
      randomBytes(15),
      randomBytes(16),
      randomBytes(17),
      randomBytes(1024 * 1024 + 3),
    ];
    for (const plain of samples) {
      const box = encryptContainer(plain, key);
      expect(box.length).toBe(HEADER_BYTES + plain.length + TAG_BYTES);
      expect(decryptContainer(box, key).equals(plain)).toBe(true);
    }
  });

  it('writes the documented header layout', () => {
    const key = randomMasterKey();
    const box = encryptContainer(utf8('layout'), key);
    expect(box.subarray(0, 8).equals(Buffer.from([0x89, 0x53, 0x4c, 0x50, 0x47, 0x0d, 0x0a, 0x1a]))).toBe(true);
    expect(box.subarray(0, 8).equals(MAGIC)).toBe(true);
    expect(box[8]).toBe(1); // container version
    expect(box[9]).toBe(1); // KDF: Argon2id
    expect(box[10]).toBe(1); // cipher: AES-256-GCM + HKDF-SHA-256
    expect(box[11]).toBe(CONTENT_DOCUMENT);
    expect(box.readUInt16BE(12)).toBe(88);
    expect(box.readUInt16BE(14)).toBe(0);
    expect(box.readUInt32BE(16)).toBe(key.params.memoryKiB);
    expect(box.readUInt32BE(20)).toBe(key.params.iterations);
    expect(box.readUInt32BE(24)).toBe(key.params.parallelism);
    expect(box.subarray(28, 44).equals(key.salt)).toBe(true);
    const header = parseHeader(box);
    expect(header.fileSalt.equals(box.subarray(44, 76))).toBe(true);
    expect(header.nonce.equals(box.subarray(76, 88))).toBe(true);
    expect(headerMatchesKey(header, key)).toBe(true);
    expect(headerMatchesKey(header, randomMasterKey())).toBe(false);
  });

  it('can be decrypted by an independent implementation that follows docs/FORMAT.md', () => {
    const key = randomMasterKey();
    const plain = utf8('independent reader check ✓');
    const box = encryptContainer(plain, key);
    // --- everything below uses only the published layout and Node primitives
    const header = box.subarray(0, 88);
    const fileSalt = box.subarray(44, 76);
    const nonce = box.subarray(76, 88);
    const ciphertext = box.subarray(88, box.length - 16);
    const tag = box.subarray(box.length - 16);
    const info = Buffer.concat([Buffer.from('sealpage/file-key/v1', 'ascii'), Buffer.from([box[11]!])]);
    const fileKey = Buffer.from(hkdfSync('sha256', key.key, fileSalt, info, 32));
    const d = createDecipheriv('aes-256-gcm', fileKey, nonce);
    d.setAAD(header);
    d.setAuthTag(tag);
    const out = Buffer.concat([d.update(ciphertext), d.final()]);
    expect(out.equals(plain)).toBe(true);
  });

  it('does not contain the plaintext or the key', () => {
    const key = randomMasterKey();
    const secret = 'THIS-IS-THE-SECRET-DOCUMENT-CONTENT-0123456789';
    const box = encryptContainer(utf8(secret.repeat(20)), key);
    expect(box.includes(utf8(secret))).toBe(false);
    expect(box.includes(utf8(secret.slice(0, 12)))).toBe(false);
    expect(box.includes(key.key)).toBe(false);
  });

  it('fails with "cannot-decrypt" for a wrong key and reveals nothing else', () => {
    const key = randomMasterKey();
    const box = encryptContainer(utf8('top secret'), key);
    // a completely different key
    expectContainerError(() => decryptContainer(box, randomMasterKey()), ['cannot-decrypt']);
    // same salt and parameters, different key bytes
    expectContainerError(() => decryptContainer(box, { ...key, key: randomBytes(32) }), ['cannot-decrypt']);
    try {
      decryptContainer(box, randomMasterKey());
    } catch (e) {
      expect((e as Error).message).toBe('Cannot decrypt this file.');
    }
  });

  it('rejects every single-bit modification anywhere in the file', () => {
    const key = randomMasterKey();
    const box = encryptContainer(utf8('tamper evident payload'), key);
    for (let i = 0; i < box.length; i++) {
      for (const bit of [0x01, 0x80]) {
        const copy = Buffer.from(box);
        copy[i] = copy[i]! ^ bit;
        expectContainerError(() => decryptContainer(copy, key), ['cannot-decrypt', 'bad-format', 'unsupported-version']);
      }
    }
  });

  it('authenticates the header: fields that parse fine but were changed still fail', () => {
    const key = randomMasterKey();
    const box = encryptContainer(utf8('aad check'), key);
    // change the Argon2 iteration count to another valid value
    const a = Buffer.from(box);
    a.writeUInt32BE(key.params.iterations + 1, 20);
    expect(() => parseHeader(a)).not.toThrow();
    expectContainerError(() => decryptContainer(a, key), ['cannot-decrypt']);
    // change one byte of the KDF salt
    const b = Buffer.from(box);
    b[30] = b[30]! ^ 0xff;
    expect(() => parseHeader(b)).not.toThrow();
    expectContainerError(() => decryptContainer(b, { ...key }), ['cannot-decrypt']);
    // change the content type to the other valid value
    const c = Buffer.from(box);
    c[11] = CONTENT_APP_STATE;
    expectContainerError(() => decryptContainer(c, key, CONTENT_APP_STATE), ['cannot-decrypt']);
  });

  it('rejects truncation at every possible length', () => {
    const key = randomMasterKey();
    const box = encryptContainer(utf8('truncate me please, at any point'), key);
    for (let len = 0; len < box.length; len++) {
      expectContainerError(() => decryptContainer(box.subarray(0, len), key), ['cannot-decrypt', 'bad-format']);
    }
  });

  it('rejects appended, prepended and spliced data', () => {
    const key = randomMasterKey();
    const one = encryptContainer(utf8('first document'), key);
    const two = encryptContainer(utf8('other document'), key);
    expectContainerError(() => decryptContainer(Buffer.concat([one, Buffer.from([0])]), key), ['cannot-decrypt']);
    expectContainerError(() => decryptContainer(Buffer.concat([one, one]), key), ['cannot-decrypt']);
    expectContainerError(() => decryptContainer(Buffer.concat([Buffer.from([0]), one]), key), ['bad-format']);
    // header of one file on the body of another
    const spliced = Buffer.concat([one.subarray(0, HEADER_BYTES), two.subarray(HEADER_BYTES)]);
    expectContainerError(() => decryptContainer(spliced, key), ['cannot-decrypt']);
    // body of one with the tag of another
    const retagged = Buffer.concat([one.subarray(0, one.length - TAG_BYTES), two.subarray(two.length - TAG_BYTES)]);
    expectContainerError(() => decryptContainer(retagged, key), ['cannot-decrypt']);
  });

  it('distinguishes garbage, old/new versions and non-files', () => {
    const key = randomMasterKey();
    expectContainerError(() => decryptContainer(Buffer.alloc(0), key), ['bad-format']);
    expectContainerError(() => decryptContainer(utf8('just some text, not a container at all'.repeat(5)), key), ['bad-format']);
    expectContainerError(() => decryptContainer(randomBytes(500), key), ['bad-format']);
    const box = encryptContainer(utf8('v'), key);
    const newer = Buffer.from(box);
    newer[8] = 2;
    expectContainerError(() => decryptContainer(newer, key), ['unsupported-version']);
    const zero = Buffer.from(box);
    zero[8] = 0;
    expectContainerError(() => decryptContainer(zero, key), ['bad-format']);
    expect(MIN_CONTAINER_BYTES).toBe(104);
  });

  it('binds the content type: a document cannot be opened as app state or vice versa', () => {
    const key = randomMasterKey();
    const doc = encryptContainer(utf8('doc'), key, CONTENT_DOCUMENT);
    const state = encryptContainer(utf8('state'), key, CONTENT_APP_STATE);
    expect(decryptContainer(state, key, CONTENT_APP_STATE).toString()).toBe('state');
    expectContainerError(() => decryptContainer(doc, key, CONTENT_APP_STATE), ['cannot-decrypt']);
    expectContainerError(() => decryptContainer(state, key, CONTENT_DOCUMENT), ['cannot-decrypt']);
  });

  it('never reuses a nonce or file salt, even for identical plaintext', () => {
    const key = randomMasterKey();
    const plain = utf8('same plaintext every time');
    const nonces = new Set<string>();
    const salts = new Set<string>();
    const bodies = new Set<string>();
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const box = encryptContainer(plain, key);
      const h = parseHeader(box);
      expect(h.nonce.length).toBe(12);
      expect(h.fileSalt.length).toBe(32);
      nonces.add(h.nonce.toString('hex'));
      salts.add(h.fileSalt.toString('hex'));
      bodies.add(box.subarray(HEADER_BYTES).toString('hex'));
    }
    expect(nonces.size).toBe(N);
    expect(salts.size).toBe(N);
    expect(bodies.size).toBe(N);
  });

  it('refuses malformed keys', () => {
    const key = randomMasterKey();
    expect(() => encryptContainer(utf8('x'), { ...key, key: randomBytes(16) })).toThrow();
    expect(() => encryptContainer(utf8('x'), { ...key, salt: randomBytes(8) })).toThrow();
    expect(() => encryptContainer(utf8('x'), { ...key, params: { memoryKiB: 1, iterations: 1, parallelism: 1 } })).toThrow();
    const box = encryptContainer(utf8('x'), key);
    expect(() => decryptContainer(box, { ...key, key: randomBytes(31) })).toThrow();
  });
});
