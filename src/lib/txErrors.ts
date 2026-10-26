/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maps wallet, viem and RPC errors onto a small set of outcomes the UI can act on.
 */

export type TxErrorCode =
  | 'rejected' // the user declined in the wallet; nothing was broadcast
  | 'wrong_chain'
  | 'not_connected'
  | 'insufficient_token'
  | 'insufficient_gas'
  | 'reverted'
  | 'rpc_unavailable'
  | 'timeout'
  | 'invalid_input'
  | 'unknown';

export interface ClassifiedError {
  code: TxErrorCode;
  message: string;
}

/** Thrown by Cambio's own preflight checks so the UI can show a precise reason. */
export class TxPreflightError extends Error {
  readonly code: TxErrorCode;
  constructor(code: TxErrorCode, message: string) {
    super(message);
    this.name = 'TxPreflightError';
    this.code = code;
  }
}

interface ErrorLike {
  name?: string;
  code?: number | string;
  message?: string;
  shortMessage?: string;
  details?: string;
  cause?: unknown;
}

function chain(err: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let current: unknown = err;
  for (let depth = 0; current && typeof current === 'object' && depth < 8; depth++) {
    out.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return out;
}

const MESSAGES: Record<TxErrorCode, string> = {
  rejected: 'You declined the request in your wallet. Nothing was sent.',
  wrong_chain: 'Your wallet is on a different network. Switch networks and try again.',
  not_connected: 'Connect a wallet to continue.',
  insufficient_token: 'Your balance is too low for this amount.',
  insufficient_gas: 'Not enough BTC on this network to pay the network fee.',
  reverted: 'The contract rejected this transaction.',
  rpc_unavailable: 'The network RPC did not respond. Check your connection and try again.',
  timeout: 'The network did not respond in time.',
  invalid_input: 'Some of the transaction details are invalid.',
  unknown: 'Something went wrong while preparing the transaction.',
};

export function classifyTxError(err: unknown): ClassifiedError {
  if (err instanceof TxPreflightError) return { code: err.code, message: err.message };

  const links = chain(err);
  const text = links
    .map((e) => `${e.name ?? ''} ${e.shortMessage ?? ''} ${e.message ?? ''} ${e.details ?? ''}`)
    .join(' ')
    .toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));
  const codes = links.map((e) => e.code);

  if (codes.includes(4001) || codes.includes('ACTION_REJECTED') || has('userrejectedrequesterror', 'user rejected', 'user denied', 'rejected the request', 'request rejected')) {
    return { code: 'rejected', message: MESSAGES.rejected };
  }
  if (has('chainmismatcherror', 'does not match the target chain', 'chain mismatch', 'switchchainnotsupported')) {
    return { code: 'wrong_chain', message: MESSAGES.wrong_chain };
  }
  if (has('connectornotconnectederror', 'connector not connected', 'no connector', 'account not found')) {
    return { code: 'not_connected', message: MESSAGES.not_connected };
  }
  if (has('insufficientfundserror', 'insufficient funds for gas', 'insufficient funds')) {
    return { code: 'insufficient_gas', message: MESSAGES.insufficient_gas };
  }
  if (has('transfer amount exceeds balance', 'exceeds balance', 'insufficient balance')) {
    return { code: 'insufficient_token', message: MESSAGES.insufficient_token };
  }
  if (has('execution reverted', 'contractfunctionrevertederror', 'reverted')) {
    const reason = links.map((e) => e.shortMessage).find((m) => m && /reverted/i.test(m));
    return { code: 'reverted', message: reason ? `${MESSAGES.reverted} (${reason.split('\n')[0]})` : MESSAGES.reverted };
  }
  if (has('timeouterror', 'timed out', 'waitfortransactionreceipttimeouterror')) {
    return { code: 'timeout', message: MESSAGES.timeout };
  }
  if (has('httprequesterror', 'failed to fetch', 'network error', 'fetch failed', 'rpc request failed', 'econnrefused')) {
    return { code: 'rpc_unavailable', message: MESSAGES.rpc_unavailable };
  }
  return { code: 'unknown', message: MESSAGES.unknown };
}

export function isUserRejection(err: unknown): boolean {
  return classifyTxError(err).code === 'rejected';
}
