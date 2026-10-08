import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

// OWASP-recommended scrypt parameters (N=2^16, r=8, p=1 → ~64 MiB, ~150 ms).
const PARAMS = { N: 1 << 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;

/**
 * Password hashing with scrypt. No native build step is required and the
 * parameters follow current OWASP guidance. Hashes are stored as
 * `scrypt$N$r$p$salt$hash` so parameters can be rotated transparently.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltPart, hashPart] = parts;
  const salt = Buffer.from(saltPart, 'base64url');
  const expected = Buffer.from(hashPart, 'base64url');
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface PasswordPolicyResult {
  valid: boolean;
  problems: string[];
}

/** Baseline password policy (12+ chars, mixed character classes). */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < 12) problems.push('Password must be at least 12 characters long');
  if (!/[a-z]/.test(password)) problems.push('Password must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('Password must contain an uppercase letter');
  if (!/\d/.test(password)) problems.push('Password must contain a digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Password must contain a symbol');
  const common = ['password', 'qwerty', '123456', 'peoplecore', 'admin', 'letmein'];
  if (common.some((entry) => password.toLowerCase().includes(entry))) {
    problems.push('Password contains a commonly used word');
  }
  return { valid: problems.length === 0, problems };
}
