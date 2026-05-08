import { describe, it, expect } from 'vitest';
import { parseTurnCount } from './fleet.js';

describe('parseTurnCount', () => {
  it('accepts a positive integer string', () => {
    expect(parseTurnCount('1')).toBe(1);
    expect(parseTurnCount('50')).toBe(50);
    expect(parseTurnCount('999')).toBe(999);
  });

  it('accepts whitespace-padded integer (Number-style coercion)', () => {
    // Number(' 5 ') === 5 — explicitly aligned with PLAN assumptions
    expect(parseTurnCount(' 5 ')).toBe(5);
  });

  it('rejects non-numeric input', () => {
    expect(() => parseTurnCount('abc')).toThrow(/positive integer/);
    expect(() => parseTurnCount('5abc')).toThrow(/positive integer/);
  });

  it('rejects zero', () => {
    expect(() => parseTurnCount('0')).toThrow(/positive integer/);
  });

  it('rejects negative numbers', () => {
    expect(() => parseTurnCount('-1')).toThrow(/positive integer/);
    expect(() => parseTurnCount('-3')).toThrow(/positive integer/);
  });

  it('rejects fractional numbers', () => {
    expect(() => parseTurnCount('5.5')).toThrow(/positive integer/);
    expect(() => parseTurnCount('1.0001')).toThrow(/positive integer/);
  });

  it('rejects empty string', () => {
    expect(() => parseTurnCount('')).toThrow(/positive integer/);
    expect(() => parseTurnCount('   ')).toThrow(/positive integer/);
  });
});
