/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { executeMusdTransfer, previewTransfer, receiptHasTransfer, type TransferDeps, type TransferParams, type TransferPreview } from '../lib/musdTransfer';
import { classifyTxError } from '../lib/txErrors';
import { isBusy, phaseFromReceipt, summarizeReceipt, type TxPhase } from '../lib/transactions';
import { createTransferDeps, getReceiptOrNull, getBlockTimestamp } from '../lib/wagmiDeps';
import { updateLedgerEntry } from '../lib/transactions';

export function useMusdTransfer(depsOverride?: TransferDeps) {
  const depsRef = useRef<TransferDeps | null>(depsOverride ?? null);
  const getDeps = () => (depsRef.current ??= createTransferDeps());

  const [phase, setPhase] = useState<TxPhase>({ phase: 'idle' });
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const lastParams = useRef<TransferParams | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const safeSet = (p: TxPhase) => {
    if (mounted.current) setPhase(p);
  };

  /** Runs every preflight check (chain, account, balances, gas) without asking the wallet to sign. */
  const prepare = useCallback(async (params: TransferParams) => {
    setPreviewError(null);
    setPreview(null);
    try {
      const p = await previewTransfer(getDeps(), params);
      if (mounted.current) setPreview(p);
      return p;
    } catch (err) {
      if (mounted.current) setPreviewError(classifyTxError(err).message);
      return null;
    }
  }, []);

  const send = useCallback(async (params: TransferParams) => {
    // Synchronous lock: a double click cannot start a second wallet prompt.
    if (lock.current) return null;
    lock.current = true;
    lastParams.current = params;
    try {
      return await executeMusdTransfer(getDeps(), params, safeSet);
    } finally {
      lock.current = false;
    }
  }, []);

  /** For an "unknown" outcome: look the hash up again instead of guessing. */
  const recheck = useCallback(async (chainId: number, hash: Hex) => {
    try {
      const receipt = await getReceiptOrNull(chainId, hash);
      if (!receipt) {
        safeSet({ phase: 'unknown', hash, message: 'Still not included in a block. It may be pending; check again shortly.' });
        return;
      }
      let ts: number | null = null;
      try {
        ts = await getBlockTimestamp({ chainId, blockNumber: receipt.blockNumber });
      } catch {
        ts = null;
      }
      const summary = summarizeReceipt(receipt, ts);
      const params = lastParams.current;
      const from = params?.from;
      if (summary.status === 'success' && (!params || params.chain.chainId !== chainId || !receiptHasTransfer(receipt, params.chain.tokens.MUSD.address, params.from, params.recipient as `0x${string}`, params.amount))) {
        safeSet({ phase: 'unknown', hash, message: 'No matching MUSD Transfer event could be verified. Check the explorer.' });
        return;
      }
      if (from) {
        updateLedgerEntry(chainId, from, hash, {
          status: summary.status === 'success' ? 'confirmed' : 'reverted',
          blockNumber: summary.blockNumber,
          blockTimestamp: ts,
        });
      }
      safeSet(phaseFromReceipt(hash, summary));
    } catch {
      safeSet({ phase: 'unknown', hash, message: 'The network RPC is not responding. Your transaction may still be processing.' });
    }
  }, []);

  const reset = useCallback(() => {
    if (lock.current) return;
    setPhase({ phase: 'idle' });
    setPreview(null);
    setPreviewError(null);
  }, []);

  return { phase, busy: isBusy(phase) || lock.current, preview, previewError, prepare, send, recheck, reset };
}
