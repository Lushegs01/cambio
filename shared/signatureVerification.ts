import { isErc6492Signature, isErc8010Signature, type Hex } from 'viem';

/** Match ordinary wallet signatures locally; reserve RPC verification for actual smart accounts. */
export async function verifyWalletSignature(input: {
  signature: Hex;
  verifyEoa: () => Promise<boolean>;
  getCode: () => Promise<Hex | undefined>;
  verifyContract: () => Promise<boolean>;
}): Promise<boolean> {
  try { if (await input.verifyEoa()) return true; } catch { /* A contract signature need not have ECDSA shape. */ }
  // Wrapped counterfactual/delegation signatures may be valid before the account has bytecode.
  if (!isErc6492Signature(input.signature) && !isErc8010Signature(input.signature)) {
    const code = await input.getCode();
    if (!code || code === '0x') return false;
  }
  return input.verifyContract();
}
