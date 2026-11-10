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

/** Errors that say nothing about the chain itself: transport failures, timeouts and overloaded nodes. */
export function isTransientRpcError(err: unknown): boolean {
  const e = err as { name?: string; status?: number; cause?: unknown; details?: string; shortMessage?: string } | null;
  if (!e) return false;
  if (/^(HttpRequestError|TimeoutError|WebSocketRequestError|SocketClosedError|LimitExceededRpcError)$/.test(e.name ?? '')) return true;
  if (typeof e.status === 'number' && (e.status === 429 || e.status >= 500)) return true;
  if (/rate limit|too many requests|timed? ?out|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(`${e.details ?? ''} ${e.shortMessage ?? ''}`)) return true;
  return e.cause !== undefined && e.cause !== err ? isTransientRpcError(e.cause) : false;
}

/** Longer schedule for offline tooling (evidence verification, CI), where latency matters less than a false "not found". */
export const EVIDENCE_RETRY_DELAYS_MS: readonly number[] = [400, 1000, 2000, 3500, 5000, 8000];

/**
 * Retries `fn` while it throws a not-found or transient RPC error. A result that IS returned is
 * authoritative. Contract reverts and malformed requests propagate immediately.
 */
export async function retryRead<T>(
  fn: () => Promise<T>,
  delays: readonly number[] = NOT_FOUND_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(isNotFoundError(err) || isTransientRpcError(err)) || attempt >= delays.length) throw err;
      await sleep(delays[attempt]);
    }
  }
}
