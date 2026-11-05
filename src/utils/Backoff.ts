import type { BackoffStrategy } from '../core/coreTypes';
 
/**
 * Exponential backoff with full jitter.
 *
 * For a one-based attempt, the delay is a random integer from zero up to
 * (but excluding) min(capMs, baseMs * 2^(attempt - 1)).
 *
 * "Full jitter" prevents thundering-herd reconnects when many clients
 * disconnect simultaneously (e.g. server restart).
 *
 * @param baseMs - Initial upper delay bound in milliseconds. Defaults to 1000.
 * @param capMs - Maximum upper delay bound in milliseconds. Defaults to 30000.
 * @returns A strategy for one-based retry attempts.
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
 
/**
 * Uses the same delay for every retry attempt.
 * @param delayMs - Delay in milliseconds.
 * @returns A strategy that always returns delayMs.
 */
export function fixedBackoff(delayMs: number): BackoffStrategy {
  return () => delayMs;
}
