import { describe, expect, it } from 'vitest';
import { formatDate, formatMinutes, formatMoney, initials, toDateInputValue } from './utils.js';

describe('formatMinutes', () => {
  it('renders hours and minutes', () => {
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(605)).toBe('10h 05m');
  });

  it('falls back to zero for empty values', () => {
    expect(formatMinutes(0)).toBe('0h 00m');
    expect(formatMinutes(null)).toBe('0h 00m');
    expect(formatMinutes(undefined)).toBe('0h 00m');
  });
});

describe('formatMoney', () => {
  it('formats numbers and numeric strings', () => {
    expect(formatMoney(1234.5, 'EUR')).toContain('1');
    expect(formatMoney('99.99', 'EUR')).toContain('99');
  });

  it('renders a dash for missing amounts', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('')).toBe('—');
  });
});

describe('dates', () => {
  it('formats iso dates', () => {
    expect(formatDate('2026-03-18')).not.toBe('—');
  });

  it('renders a dash for invalid input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('builds date input values from dates', () => {
    expect(toDateInputValue(new Date('2026-03-18T10:00:00.000Z'))).toBe('2026-03-18');
    expect(toDateInputValue(null)).toBe('');
  });
});

describe('initials', () => {
  it('uses the first letters of both names', () => {
    expect(initials('Ivan', 'Petrov')).toBe('IP');
    expect(initials(null, 'Petrova')).toBe('P');
    expect(initials()).toBe('?');
  });
});
