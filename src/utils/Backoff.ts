import type { BackoffStrategy } from '../types';
 
/**
 * Exponential backoff with full jitter.
 *
 * Formula: random(0, min(cap, base * 2^attempt))
 *
 * "Full jitter" prevents thundering-herd reconnects when many clients
 * disconnect simultaneously (e.g. server restart).
 *
 * @see https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function exponentialBackoff(
  baseMs = 1000,
  capMs = 30_000,
): BackoffStrategy {
  return (attempt: number) => {
    const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
    return Math.floor(Math.random() * exp);
  };
}
 
/** Fixed delay between every attempt. Useful for tests or LAN apps. */
export function fixedBackoff(delayMs: number): BackoffStrategy {
  return () => delayMs;
}