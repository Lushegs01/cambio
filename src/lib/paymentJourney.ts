/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The payer's journey on a signed request, as pure functions the page renders from:
 *
 *   Review invoice → Connect wallet → Fund with BTC (only if short) → Confirm payment → Verify settlement
 *
 * Plus two reliability pieces:
 *  - recovering a payment this device already submitted for the request (so a refresh while the
 *    transaction is pending resumes watching that hash instead of offering to pay again);
 *  - telling the merchant's registry about a verified payment, retrying while the chain or the API is
 *    catching up. The server re-verifies everything; this only supplies the hash.
 */

import type { Hex } from 'viem';
import type { LedgerEntry } from './transactions';
import type { SignedPaymentRequest } from './paymentRequest';

export type StepKey = 'review' | 'connect' | 'fund' | 'confirm' | 'verify';
export type StepStatus = 'done' | 'current' | 'upcoming' | 'blocked';

export interface JourneyStep {
  key: StepKey;
  label: string;
  status: StepStatus;
}

export interface JourneyInput {
  /** Signature check of the request: only a valid one can be paid. */
  signature: 'verifying' | 'valid' | 'invalid' | 'unsigned';
  /** The request cannot be paid (expired, not yet active, unsupported network). */
  closed: boolean;
  walletConnected: boolean;
  /** Connected to the request's chain. */
  rightChain: boolean;
  /** The wallet lacks MUSD for this request (null = balances unknown). */
  needsFunding: boolean | null;
  /** Funding was needed at some point during this visit (keeps the step visible once done). */
  fundingUsed: boolean;
  /** A payment transaction exists for this request (submitted here or found on-chain). */
  paymentSubmitted: boolean;
  /** The chain confirms that payment settles this request. */
  settled: boolean;
}

const LABELS: Record<StepKey, string> = {
  review: 'Review invoice',
  connect: 'Connect wallet',
  fund: 'Fund with BTC',
  confirm: 'Confirm payment',
  verify: 'Verify settlement',
};

/** Steps to show and their state. The funding step appears only when it is, or was, needed. */
export function journeySteps(s: JourneyInput): JourneyStep[] {
  const keys: StepKey[] = ['review', 'connect', ...(s.needsFunding || s.fundingUsed ? (['fund'] as StepKey[]) : []), 'confirm', 'verify'];
  const reviewOk = s.signature === 'valid' || s.signature === 'unsigned';
  const done: Record<StepKey, boolean> = {
    review: reviewOk && !s.closed,
    connect: s.walletConnected && s.rightChain,
    fund: s.needsFunding === false,
    confirm: s.paymentSubmitted,
    verify: s.settled,
  };
  // A paid request is complete whatever the wallet state: every step is done.
  if (s.settled) return keys.map((key) => ({ key, label: LABELS[key], status: 'done' }));
  if (s.paymentSubmitted) {
    return keys.map((key) => ({ key, label: LABELS[key], status: key === 'verify' ? 'current' : 'done' }));
  }
  let currentAssigned = false;
  return keys.map((key) => {
    if (key === 'review' && (s.signature === 'invalid' || s.closed)) {
      currentAssigned = true;
      return { key, label: LABELS[key], status: 'blocked' };
    }
    if (done[key] && !currentAssigned) return { key, label: LABELS[key], status: 'done' };
    if (!currentAssigned) {
      currentAssigned = true;
      return { key, label: LABELS[key], status: 'current' };
    }
    return { key, label: LABELS[key], status: 'upcoming' };
  });
}

/**
 * The most recent payment this device submitted for `request` that has not reverted. Matching uses the
 * request id, recipient and exact amount recorded at submission time; the chain still has the final say.
 */
export function findSubmittedPayment(ledger: readonly LedgerEntry[], request: SignedPaymentRequest): LedgerEntry | null {
  const matches = ledger.filter(
    (e) =>
      e.kind === 'transfer' &&
      e.chainId === request.chainId &&
      e.status !== 'reverted' &&
      typeof e.requestId === 'string' &&
      e.requestId.toLowerCase() === request.id.toLowerCase() &&
      e.to.toLowerCase() === request.recipient.toLowerCase() &&
      e.token.toLowerCase() === request.token.toLowerCase() &&
      e.amount === request.amount
  );
  return matches.sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
}

export type RegistrySync =
  | { state: 'idle' }
  | { state: 'syncing'; attempt: number }
  | { state: 'recorded' }
  /** The server read the chain and disagreed (it is not a settlement of this request). */
  | { state: 'rejected'; message: string }
  /** The registry could not be reached or is not configured. The payment itself is unaffected. */
  | { state: 'unavailable'; message: string };

export interface ApiErrorLike {
  status: number;
  code: string;
  message: string;
}

const isApiError = (e: unknown): e is ApiErrorLike =>
  !!e && typeof (e as ApiErrorLike).status === 'number' && typeof (e as ApiErrorLike).code === 'string';

/** Retry delays while the chain or the registry catches up (tx not yet visible, confirmations, 503). */
export const REGISTRY_SYNC_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 15_000, 30_000];

/**
 * Asks the merchant's registry to verify and record `hash`. Stores the signed request first when the
 * registry does not have it yet. Retries only conditions that can resolve by waiting.
 */
export async function syncSettlementToRegistry(
  deps: {
    save: () => Promise<unknown>;
    submit: () => Promise<unknown>;
    sleep?: (ms: number) => Promise<void>;
    onProgress?: (s: RegistrySync) => void;
  },
  delays: readonly number[] = REGISTRY_SYNC_DELAYS_MS
): Promise<RegistrySync> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let saved = false;
  for (let attempt = 0; ; attempt++) {
    deps.onProgress?.({ state: 'syncing', attempt: attempt + 1 });
    try {
      await deps.submit();
      return { state: 'recorded' };
    } catch (err) {
      if (!isApiError(err)) return { state: 'unavailable', message: 'The invoice registry could not be reached.' };
      if (err.status === 404 && err.code === 'not_found' && !saved) {
        // The merchant's registry has not seen this request: store it (the server checks the signature), then retry now.
        saved = true;
        try {
          await deps.save();
        } catch (saveErr) {
          if (isApiError(saveErr) && saveErr.status === 401) return { state: 'rejected', message: 'The registry refused the request signature.' };
          if (!isApiError(saveErr) || saveErr.status >= 500 || saveErr.status === 0) return { state: 'unavailable', message: 'The invoice registry is unavailable.' };
        }
        attempt--; // saving is not a wait; do not consume a retry
        continue;
      }
      if (err.status === 422 || err.status === 400 || err.status === 401) return { state: 'rejected', message: err.message };
      const transient = err.status === 0 || err.status === 503 || err.status === 429 || (err.status === 404 && err.code === 'tx_not_found') || (err.status === 409 && err.code === 'awaiting_confirmations');
      if (!transient || attempt >= delays.length) {
        return { state: 'unavailable', message: transient ? 'The registry has not confirmed it yet. The merchant can still reconcile it from the chain.' : err.message };
      }
      await sleep(delays[attempt]);
    }
  }
}

/** Re-check cadence for a submitted payment whose receipt is not visible yet. */
export const PENDING_RECHECK_MS = 5_000;
export const PENDING_RECHECK_MAX = 36; // ≈ 3 minutes, then the page asks the user to check back

export const shortHash = (h: Hex) => `${h.slice(0, 10)}…${h.slice(-6)}`;
