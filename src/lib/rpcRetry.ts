/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The public Mezo Testnet RPC is load-balanced across nodes that do not always agree. Measured on
 * 2026-11-05: 8-9 of every 12 eth_getTransactionReceipt calls for already-mined transactions returned
 * the receipt; the rest returned null. A single "not found" is therefore not evidence of absence.
 *
 * These helpers retry not-found reads a few times before concluding absence. A receipt that IS
 * returned is authoritative (it is tied to a block), so one success is enough.
 */

export const NOT_FOUND_RETRY_DELAYS_MS: readonly number[] = [300, 800, 1500];

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isNotFoundError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  return /NotFound/i.test(name);
}

/** Retries `fn` while it throws a viem *NotFoundError. Other errors propagate immediately. */
export async function retryNotFound<T>(
  fn: () => Promise<T>,
  delays: readonly number[] = NOT_FOUND_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isNotFoundError(err) || attempt >= delays.length) throw err;
      await sleep(delays[attempt]);
    }
  }
}

/** Same, for readers that return null instead of throwing when nothing is found. */
export async function retryNull<T>(
  fn: () => Promise<T | null>,
  delays: readonly number[] = NOT_FOUND_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const value = await fn();
    if (value !== null || attempt >= delays.length) return value;
    await sleep(delays[attempt]);
  }
}
