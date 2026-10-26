import { describe, expect, it } from 'vitest';
import { ChainMismatchError, InsufficientFundsError, UserRejectedRequestError, ContractFunctionRevertedError, HttpRequestError, BaseError } from 'viem';
import { mezoTestnetLike } from './helpers';
import { normalizeUsername, validateUsername } from '../shared/username';
import { classifyTxError, TxPreflightError } from '../src/lib/txErrors';

describe('username rules', () => {
  it('normalizes consistently', () => {
    expect(normalizeUsername('  @@Alice_01 ')).toBe('alice_01');
    expect(validateUsername('@JOMI')).toEqual({ valid: true, username: 'jomi' });
  });

  it('rejects malformed names', () => {
    for (const bad of ['ab', 'a'.repeat(21), 'al ice', 'alice!', '_alice', 'alice_', 'a__b', 'аlice' /* Cyrillic а */, '']) {
      expect(validateUsername(bad).valid, bad).toBe(false);
    }
  });

  it('blocks impersonation of the platform and staff', () => {
    for (const bad of ['cambio', 'mezo', 'mezo_support', 'support', 'cambio_team1', 'realmezo', 'admin', 'official_1', 'treasury', 'musd']) {
      expect(validateUsername(bad).valid, bad).toBe(false);
    }
  });

  it('does not block ordinary names that merely contain a common word', () => {
    for (const fine of ['bankole', 'badminton', 'helper_jo', 'teamwork', 'walletless', 'mod_squad']) {
      expect(validateUsername(fine).valid, fine).toBe(true);
    }
  });
});

describe('classifyTxError', () => {
  it('recognises a wallet rejection as "rejected", not a failure', () => {
    const err = new UserRejectedRequestError(new Error('User rejected the request.'));
    expect(classifyTxError(err).code).toBe('rejected');
    expect(classifyTxError({ code: 4001, message: 'denied' }).code).toBe('rejected');
    // wrapped several levels deep, as wagmi does
    expect(classifyTxError(new BaseError('Write failed', { cause: err })).code).toBe('rejected');
  });

  it('distinguishes wrong chain, gas, reverts and RPC outages', () => {
    expect(classifyTxError(new ChainMismatchError({ chain: mezoTestnetLike, currentChainId: 1 })).code).toBe('wrong_chain');
    expect(classifyTxError(new InsufficientFundsError()).code).toBe('insufficient_gas');
    expect(classifyTxError(new ContractFunctionRevertedError({ abi: [], functionName: 'transfer', message: 'execution reverted' })).code).toBe('reverted');
    expect(classifyTxError(new HttpRequestError({ url: 'https://rpc.test.mezo.org', details: 'fetch failed' })).code).toBe('rpc_unavailable');
  });

  it('passes through Cambio preflight errors verbatim', () => {
    expect(classifyTxError(new TxPreflightError('insufficient_token', 'Insufficient MUSD'))).toEqual({ code: 'insufficient_token', message: 'Insufficient MUSD' });
  });
});
