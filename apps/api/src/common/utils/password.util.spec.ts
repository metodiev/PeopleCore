import { describe, expect, it } from 'vitest';
import { hashPassword, validatePasswordPolicy, verifyPassword } from './password.util.js';

describe('password hashing', () => {
  it('produces a versioned, algorithm-tagged hash', async () => {
    const hash = await hashPassword('Str0ng!Passphrase');
    const parts = hash.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBe(1 << 16);
    expect(parts[2]).toBe('8');
    expect(parts[3]).toBe('1');
    expect(hash).not.toContain('Str0ng!Passphrase');
  });

  it('salts each hash so identical passwords differ', async () => {
    const [a, b] = await Promise.all([hashPassword('SamePassword!123'), hashPassword('SamePassword!123')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('SamePassword!123', a)).resolves.toBe(true);
    await expect(verifyPassword('SamePassword!123', b)).resolves.toBe(true);
  });

  it('verifies only the correct password', async () => {
    const hash = await hashPassword('CorrectHorse1!');
    await expect(verifyPassword('CorrectHorse1!', hash)).resolves.toBe(true);
    await expect(verifyPassword('CorrectHorse1', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('normalises unicode passwords consistently', async () => {
    const hash = await hashPassword('Ünïcode-Päss1!');
    await expect(verifyPassword('Ünïcode-Päss1!', hash)).resolves.toBe(true);
  });

  it('returns false for absent, empty or malformed stored hashes', async () => {
    await expect(verifyPassword('x', null)).resolves.toBe(false);
    await expect(verifyPassword('x', undefined)).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
    await expect(verifyPassword('x', 'plaintext-password')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$1$2$3$4$5')).resolves.toBe(false);
  });
});

describe('password policy', () => {
  it('accepts a strong passphrase', () => {
    expect(validatePasswordPolicy('Str0ng!Passphrase')).toEqual({ valid: true, problems: [] });
  });

  it('reports every violated rule at once', () => {
    const result = validatePasswordPolicy('password');
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        'Password must be at least 12 characters long',
        'Password must contain an uppercase letter',
        'Password must contain a digit',
        'Password must contain a symbol',
        'Password contains a commonly used word',
      ]),
    );
  });

  it('requires 12 characters, mixed case, a digit and a symbol', () => {
    expect(validatePasswordPolicy('Sh0rt!')).toHaveProperty('valid', false);
    expect(validatePasswordPolicy('alllowercase1!')).toHaveProperty('valid', false);
    expect(validatePasswordPolicy('ALLUPPERCASE1!')).toHaveProperty('valid', false);
    expect(validatePasswordPolicy('NoDigitsHere!!')).toHaveProperty('valid', false);
    expect(validatePasswordPolicy('NoSymbols12345')).toHaveProperty('valid', false);
  });

  it('rejects common words regardless of casing', () => {
    expect(validatePasswordPolicy('Admin!Password1')).toHaveProperty('valid', false);
    expect(validatePasswordPolicy('QwErTy!1234abcd')).toHaveProperty('valid', false);
    expect(validatePasswordPolicy('PeopleCore!2026')).toHaveProperty('valid', false);
  });
});
