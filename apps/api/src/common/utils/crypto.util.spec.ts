import { describe, expect, it } from 'vitest';
import { CryptoService, constantTimeEquals, randomToken, sha256 } from './crypto.util.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('CryptoService', () => {
  const crypto = new CryptoService(KEY);

  it('round-trips values, including unicode and empty strings', () => {
    for (const value of ['ACME-BG-IBAN', 'Иван Петров', '', 'a'.repeat(4096), '{"json":"payload"}']) {
      const payload = crypto.encrypt(value);
      expect(payload.startsWith('v1.')).toBe(true);
      expect(payload).toHaveLength(payload.split('.').join('').length + 3);
      expect(crypto.decrypt(payload)).toBe(value);
    }
  });

  it('does not leave the plaintext readable in the payload', () => {
    expect(crypto.encrypt('ACME-CORP-IBAN-BG29RUBB')).not.toContain('ACME-CORP-IBAN-BG29RUBB');
    expect(crypto.encrypt('JBSWY3DPEHPK3PXP')).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('never reuses an IV, so identical plaintext yields different payloads', () => {
    const first = crypto.encrypt('same-value');
    const second = crypto.encrypt('same-value');
    expect(first).not.toBe(second);
    expect(crypto.decrypt(first)).toBe('same-value');
    expect(crypto.decrypt(second)).toBe('same-value');
  });

  it('rejects tampered ciphertext (authenticated encryption)', () => {
    const payload = crypto.encrypt('salary=5000');
    const [version, iv, tag, data] = payload.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0x01;
    const tampered = [version, iv, tag, flipped.toString('base64url')].join('.');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('rejects tampered authentication tags', () => {
    const payload = crypto.encrypt('national-id');
    const [version, iv, tag, data] = payload.split('.');
    const flipped = Buffer.from(tag, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => crypto.decrypt([version, iv, flipped.toString('base64url'), data].join('.'))).toThrow();
  });

  it('rejects malformed and truncated payloads', () => {
    expect(() => crypto.decrypt('not-encrypted')).toThrow(/Malformed/);
    expect(() => crypto.decrypt('v2.a.b.c')).toThrow(/Malformed/);
    expect(() => crypto.decrypt('v1.only.three.parts')).toThrow();
  });

  it('fails closed when a different key is used', () => {
    const other = new CryptoService(Buffer.alloc(32, 9).toString('base64'));
    expect(() => other.decrypt(crypto.encrypt('secret'))).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => new CryptoService(Buffer.alloc(16, 1).toString('base64'))).toThrow(/32 bytes/);
  });

  it('handles optional encryption helpers', () => {
    expect(crypto.encryptOptional(null)).toBeNull();
    expect(crypto.encryptOptional(undefined)).toBeNull();
    expect(crypto.encryptOptional('')).toBeNull();
    const encrypted = crypto.encryptOptional('BG29BANK');
    expect(crypto.decryptOptional(encrypted)).toBe('BG29BANK');
    expect(crypto.decryptOptional(null)).toBeNull();
  });
});

describe('crypto helpers', () => {
  it('hashes deterministically with sha256', () => {
    expect(sha256('token')).toBe(sha256('token'));
    expect(sha256('token')).toHaveLength(64);
    expect(sha256('token')).not.toBe(sha256('token '));
  });

  it('generates unique url-safe tokens of the requested size', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).toHaveLength(43);
    expect(randomToken(16)).toHaveLength(22);
    expect(new Set(Array.from({ length: 50 }, () => randomToken())).size).toBe(50);
  });

  it('compares strings in constant time', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });
});
