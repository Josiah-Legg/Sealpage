import { describe, expect, it } from 'vitest';
import { DEFAULT_KDF_PARAMS, deriveKey, kdfParamsValid, passphraseBytes, zeroize } from '../../../src/main/crypto/kdf';
import { FAST_KDF } from './helpers';

const hex = (b: Buffer): string => b.toString('hex');
const SALT = Buffer.from('somesalt', 'ascii');

describe('Argon2id key derivation', () => {
  // Vectors from the Argon2 reference implementation's test suite
  // (phc-winner-argon2, src/test.c, Argon2id, version 0x13).
  it.each([
    [{ memoryKiB: 65536, iterations: 2, parallelism: 1 }, 'password', '09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7'],
    [{ memoryKiB: 256, iterations: 2, parallelism: 1 }, 'password', '9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe'],
    [{ memoryKiB: 256, iterations: 2, parallelism: 2 }, 'password', '6d093c501fd5999645e0ea3bf620d7b8be7fd2db59c20d9fff9539da2bf57037'],
    [{ memoryKiB: 65536, iterations: 1, parallelism: 1 }, 'password', 'f6a5adc1ba723dddef9b5ac1d464e180fcd9dffc9d1cbf76cca2fed795d9ca98'],
    [{ memoryKiB: 65536, iterations: 4, parallelism: 1 }, 'password', '9025d48e68ef7395cca9079da4c4ec3affb3c8911fe4f86d1a2520856f63172c'],
    [{ memoryKiB: 65536, iterations: 2, parallelism: 1 }, 'differentpassword', '0b84d652cf6b0c4beaef0dfe278ba6a80df6696281d7e0d2891b817d8c458fde'],
  ])('matches the reference implementation for %o / %s', async (params, password, expected) => {
    expect(hex(await deriveKey(password, SALT, params))).toBe(expected);
  });

  it('matches the reference vector with a different salt', async () => {
    const key = await deriveKey('password', Buffer.from('diffsalt', 'ascii'), { memoryKiB: 65536, iterations: 2, parallelism: 1 });
    expect(hex(key)).toBe('bdf32b05ccc42eb15d58fd19b1f856b113da1e9a5874fdcc544308565aa8141c');
  });

  it('uses strong default parameters', () => {
    expect(DEFAULT_KDF_PARAMS).toEqual({ memoryKiB: 262144, iterations: 3, parallelism: 4 });
    expect(kdfParamsValid(DEFAULT_KDF_PARAMS)).toBe(true);
  });

  it('derives a 32-byte key with the default parameters', async () => {
    const salt = Buffer.alloc(16, 7);
    const a = await deriveKey('correct horse battery staple', salt, DEFAULT_KDF_PARAMS);
    const b = await deriveKey('correct horse battery staple', salt, DEFAULT_KDF_PARAMS);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });

  it('is sensitive to passphrase, salt and every parameter', async () => {
    const salt = Buffer.alloc(16, 1);
    const base = hex(await deriveKey('passphrase-1', salt, FAST_KDF));
    expect(hex(await deriveKey('passphrase-2', salt, FAST_KDF))).not.toBe(base);
    expect(hex(await deriveKey('passphrase-1', Buffer.alloc(16, 2), FAST_KDF))).not.toBe(base);
    expect(hex(await deriveKey('passphrase-1', salt, { ...FAST_KDF, memoryKiB: 128 }))).not.toBe(base);
    expect(hex(await deriveKey('passphrase-1', salt, { ...FAST_KDF, iterations: 2 }))).not.toBe(base);
    expect(hex(await deriveKey('passphrase-1', salt, { ...FAST_KDF, parallelism: 2 }))).not.toBe(base);
  });

  it('normalises the passphrase to NFC so equivalent Unicode spellings give the same key', async () => {
    const composed = 'café-passphrase';
    const decomposed = 'café-passphrase';
    expect(composed).not.toBe(decomposed);
    expect(passphraseBytes(composed).equals(passphraseBytes(decomposed))).toBe(true);
    const salt = Buffer.alloc(16, 3);
    expect(hex(await deriveKey(composed, salt, FAST_KDF))).toBe(hex(await deriveKey(decomposed, salt, FAST_KDF)));
  });

  it('rejects out-of-range parameters', async () => {
    const salt = Buffer.alloc(16, 1);
    for (const bad of [
      { memoryKiB: 4, iterations: 1, parallelism: 1 },
      { memoryKiB: 64, iterations: 0, parallelism: 1 },
      { memoryKiB: 64, iterations: 1, parallelism: 0 },
      { memoryKiB: 64, iterations: 1, parallelism: 17 },
      { memoryKiB: 64, iterations: 65, parallelism: 1 },
      { memoryKiB: 2 ** 21, iterations: 1, parallelism: 1 },
      { memoryKiB: 16, iterations: 1, parallelism: 4 },
      { memoryKiB: 64.5, iterations: 1, parallelism: 1 },
    ]) {
      expect(kdfParamsValid(bad)).toBe(false);
      await expect(deriveKey('some passphrase', salt, bad)).rejects.toThrow();
    }
    await expect(deriveKey('some passphrase', Buffer.alloc(4), FAST_KDF)).rejects.toThrow();
  });

  it('zeroize wipes buffers', () => {
    const b = Buffer.from('secret secret secret');
    zeroize(b, null, undefined);
    expect(b.every((x) => x === 0)).toBe(true);
  });
});
