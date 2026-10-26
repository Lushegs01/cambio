import { describe, expect, it, vi } from 'vitest';
import { verifyMessage, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyWalletSignature } from '../shared/signatureVerification';

describe('ordinary and contract wallet verification boundaries', () => {
  it('verifies a genuine ordinary-wallet signature without requiring a working RPC', async () => {
    const account = privateKeyToAccount(generatePrivateKey()); const message = 'Cambio ownership proof';
    const signature = await account.signMessage({ message });
    const getCode = vi.fn().mockRejectedValue(new Error('RPC offline')); const verifyContract = vi.fn();
    expect(await verifyWalletSignature({ signature, verifyEoa: () => verifyMessage({ address: account.address, message, signature }), getCode, verifyContract })).toBe(true);
    expect(getCode).not.toHaveBeenCalled(); expect(verifyContract).not.toHaveBeenCalled();
  });
  it('rejects a signature from another key at a code-free address without contract simulation', async () => {
    const owner = privateKeyToAccount(generatePrivateKey()); const attacker = privateKeyToAccount(generatePrivateKey());
    const message = 'Unaltered authorization'; const signature = await attacker.signMessage({ message });
    const verifyContract = vi.fn().mockImplementation(() => { throw new Error('expensive simulation should not run'); });
    expect(await verifyWalletSignature({ signature, verifyEoa: () => verifyMessage({ address: owner.address, message, signature }), getCode: async () => undefined, verifyContract })).toBe(false);
    expect(verifyContract).not.toHaveBeenCalled();
  });
  it('requires an affirmative contract check for deployed smart accounts', async () => {
    for (const result of [false, true]) {
      const verifyContract = vi.fn().mockResolvedValue(result);
      expect(await verifyWalletSignature({ signature: '0x1234', verifyEoa: async () => false, getCode: async () => '0x6000', verifyContract })).toBe(result);
      expect(verifyContract).toHaveBeenCalledOnce();
    }
  });
  it('keeps wrapped undeployed-wallet signatures subject to real contract verification', async () => {
    const signature = `0x1234${'6492'.repeat(16)}` as Hex;
    const getCode = vi.fn(); const verifyContract = vi.fn().mockResolvedValue(false);
    expect(await verifyWalletSignature({ signature, verifyEoa: async () => { throw new Error('not an ECDSA signature'); }, getCode, verifyContract })).toBe(false);
    expect(getCode).not.toHaveBeenCalled(); expect(verifyContract).toHaveBeenCalledOnce();
  });
  it('does not turn unavailable RPC verification into successful ownership', async () => {
    await expect(verifyWalletSignature({ signature: '0x1234', verifyEoa: async () => false, getCode: async () => { throw new Error('RPC offline'); }, verifyContract: async () => true })).rejects.toThrow('RPC offline');
  });
});
