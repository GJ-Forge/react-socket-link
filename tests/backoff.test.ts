import { afterEach, describe, expect, it, vi } from 'vitest';
import { exponentialBackoff, fixedBackoff } from '../src';

afterEach(() => { vi.restoreAllMocks(); });

describe('fixedBackoff', () => {
  it('returns the same delay for every attempt', () => {
    const backoff = fixedBackoff(250);
    expect([1, 2, 50].map(backoff)).toEqual([250, 250, 250]);
  });
});

describe('exponentialBackoff', () => {
  it('doubles the upper bound each attempt and applies full jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const backoff = exponentialBackoff();
    expect([1, 2, 3, 4].map(backoff)).toEqual([500, 1000, 2000, 4000]);
  });

  it('never exceeds the cap', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const backoff = exponentialBackoff(100, 1000);
    expect(backoff(10)).toBe(999);
    expect(backoff(1000)).toBe(999);
  });

  it('can return zero at the bottom of the jitter range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(exponentialBackoff()(5)).toBe(0);
  });
});
