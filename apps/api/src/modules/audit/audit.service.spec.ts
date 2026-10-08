import { describe, expect, it } from 'vitest';
import { redact } from './audit.service.js';

/** Stand-in for a Prisma Decimal (only `toJSON` matters to the redactor). */
class FakeDecimal {
  constructor(private readonly value: string) {}
  toJSON(): string {
    return this.value;
  }
}

describe('audit redaction', () => {
  it('redacts credential-like keys at any depth and in any casing', () => {
    const result = redact({
      email: 'ada@acme.test',
      Password: 'Str0ng!Passphrase',
      nested: { refreshToken: 'abc', deep: { mfaRecoveryCode: 'code', newPassword: 'x' } },
      list: [{ accessToken: 't' }, { safe: 'keep' }],
    }) as Record<string, unknown>;

    expect(result.email).toBe('ada@acme.test');
    expect(result.Password).toBe('[redacted]');
    const nested = result.nested as Record<string, unknown>;
    expect(nested.refreshToken).toBe('[redacted]');
    expect((nested.deep as Record<string, unknown>).mfaRecoveryCode).toBe('[redacted]');
    expect((nested.deep as Record<string, unknown>).newPassword).toBe('[redacted]');
    expect((result.list as Record<string, unknown>[])[0].accessToken).toBe('[redacted]');
    expect((result.list as Record<string, unknown>[])[1].safe).toBe('keep');
  });

  it('redacts partial matches such as encrypted columns', () => {
    const result = redact({ nationalIdEnc: 'v1.a.b.c', ibanEnc: 'v1.d.e.f', ibanOn: true }) as Record<
      string,
      unknown
    >;
    expect(result.nationalIdEnc).toBe('[redacted]');
    expect(result.ibanEnc).toBe('[redacted]');
    expect(result.ibanOn).toBe('[redacted]');
  });

  it('serialises dates, decimals, bigints and functions without failing', () => {
    const result = redact({
      at: new Date('2026-01-02T03:04:05.000Z'),
      amount: new FakeDecimal('1234.50'),
      big: 9_007_199_254_740_993n,
      fn: () => 'nope',
      sym: Symbol('nope'),
      map: new Map([['a', 1]]),
    }) as Record<string, unknown>;

    expect(result.at).toBe('2026-01-02T03:04:05.000Z');
    expect(result.amount).toBe('1234.50');
    expect(result.big).toBe('9007199254740993');
    expect(result).not.toHaveProperty('fn');
    expect(result).not.toHaveProperty('sym');
    expect(result.map).toBe('[object Map]');
  });

  it('breaks cycles instead of throwing', () => {
    const node: Record<string, unknown> = { id: 'employee-1' };
    node.self = node;
    node.children = [node];
    const result = redact(node) as Record<string, unknown>;
    expect(result.id).toBe('employee-1');
    expect(result.self).toBe('[circular]');
    expect(Array.isArray(result.children)).toBe(true);
  });

  it('skips constructor keys (Prisma objects carry them)', () => {
    const value = Object.create(Object.prototype) as Record<string, unknown>;
    Object.defineProperty(value, 'constructor', { value: 'Prisma', enumerable: true });
    value.name = 'Ada';
    expect(redact(value)).toEqual({ name: 'Ada' });
  });

  it('caps long strings, long arrays and deep nesting', () => {
    const longString = redact('x'.repeat(3000)) as string;
    expect(longString.endsWith('…[truncated]')).toBe(true);
    expect(longString.length).toBe(2000 + '…[truncated]'.length);

    const manyItems = redact(Array.from({ length: 500 }, (_, index) => index)) as number[];
    expect(manyItems).toHaveLength(200);
    expect(manyItems.at(-1)).toBe(199);

    let deep: Record<string, unknown> = { leaf: 1 };
    for (let index = 0; index < 10; index += 1) deep = { level: deep };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });

  it('passes primitives and null through unchanged', () => {
    expect(redact('text')).toBe('text');
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
  });
});
