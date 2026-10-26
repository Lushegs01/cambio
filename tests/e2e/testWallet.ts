/**
 * Test-only injected wallet (EIP-1193 provider announced via EIP-6963) for Playwright.
 *
 *  - Signs personal_sign and eth_signTypedData_v4 with a real secp256k1 key held in the Node test
 *    process (exposed to the page as a function), so signatures are genuine and server-verifiable.
 *  - Forwards every read (eth_call, eth_getBalance, eth_estimateGas, …) to the real Mezo Testnet RPC.
 *  - ALWAYS declines eth_sendTransaction with EIP-1193 code 4001. End-to-end tests therefore exercise
 *    the real preflight against live chain state up to the wallet prompt, but can never broadcast.
 *
 * In "watch" mode the wallet reports an address it holds no key for (e.g. a public pool contract
 * that holds MUSD), which lets the UI run real balance and fee checks; signing is refused in that mode.
 */
import type { Page } from '@playwright/test';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface TestWalletOptions {
  privateKey?: Hex;
  watchAddress?: string;
  chainId?: number;
  rpcUrl?: string;
  rejectSignatures?: boolean;
}

export async function installTestWallet(page: Page, opts: TestWalletOptions) {
  const account = opts.privateKey ? privateKeyToAccount(opts.privateKey) : null;
  const address = (opts.watchAddress ?? account?.address)!;
  await page.exposeFunction('__cambioTestSign', async (method: string, params: unknown[]) => {
    if (!account || opts.rejectSignatures) return { error: { code: 4001, message: 'User rejected the request.' } };
    if (method === 'personal_sign') {
      const [msg] = params as [Hex];
      return { result: await account.signMessage({ message: { raw: msg } }) };
    }
    if (method === 'eth_signTypedData_v4') {
      const [, json] = params as [string, string];
      const td = JSON.parse(json);
      delete td.types.EIP712Domain;
      return { result: await account.signTypedData(td) };
    }
    return { error: { code: 4200, message: `Unsupported method ${method}` } };
  });

  await page.addInitScript(
    ({ address, chainIdHex, rpcUrl }) => {
      let chainId = chainIdHex;
      // Like a real wallet, expose no accounts until the site asks for them.
      let authorized = false;
      const listeners: Record<string, Array<(arg: unknown) => void>> = {};
      const emit = (ev: string, arg: unknown) => (listeners[ev] || []).forEach((fn) => fn(arg));
      let rpcId = 0;
      const provider = {
        isCambioTestWallet: true,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case 'eth_requestAccounts':
              authorized = true;
              emit('accountsChanged', [address]);
              return [address];
            case 'eth_accounts':
              return authorized ? [address] : [];
            case 'eth_chainId':
              return chainId;
            case 'net_version':
              return String(parseInt(chainId, 16));
            case 'wallet_requestPermissions':
              authorized = true;
              return [{ parentCapability: 'eth_accounts' }];
            case 'wallet_getPermissions':
              return authorized ? [{ parentCapability: 'eth_accounts' }] : [];
            case 'wallet_revokePermissions':
              authorized = false;
              return null;
            case 'wallet_switchEthereumChain': {
              chainId = (params as [{ chainId: string }])[0].chainId;
              emit('chainChanged', chainId);
              return null;
            }
            case 'wallet_addEthereumChain':
              return null;
            case 'personal_sign':
            case 'eth_signTypedData_v4': {
              const r = await (window as any).__cambioTestSign(method, params);
              if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
              return r.result;
            }
            case 'eth_sendTransaction':
            case 'eth_signTransaction':
            case 'eth_sendRawTransaction':
              throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
            default: {
              const res = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params ?? [] }),
              });
              const body = await res.json();
              if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
              return body.result;
            }
          }
        },
        on(ev: string, fn: (arg: unknown) => void) {
          (listeners[ev] ||= []).push(fn);
          return provider;
        },
        removeListener(ev: string, fn: (arg: unknown) => void) {
          listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
          return provider;
        },
      };
      // Lets a test change networks "in the wallet" after connecting, like a user would.
      (window as any).__cambioTestWallet = {
        setChain(hex: string) {
          chainId = hex;
          emit('chainChanged', hex);
        },
      };
      const info = {
        uuid: '6b1c4b5e-0000-4000-8000-cambi0test000',
        name: 'Cambio Test Wallet',
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz48L3N2Zz4=',
        rdns: 'org.cambio.testwallet',
      };
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    },
    { address, chainIdHex: `0x${(opts.chainId ?? 31611).toString(16)}`, rpcUrl: opts.rpcUrl ?? 'https://rpc.test.mezo.org' }
  );
  return { address };
}

/** Opens the AppKit modal and connects the injected test wallet. */
export async function connectTestWallet(page: Page) {
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('Cambio Test Wallet').first().click({ timeout: 30_000 });
}

/** Closes the first-run "choose your username" prompt if it opened. */
export async function dismissUsernamePrompt(page: Page) {
  const later = page.getByRole('button', { name: /i’ll do this later/i });
  try {
    await later.waitFor({ state: 'visible', timeout: 5_000 });
    await later.click();
  } catch {
    // prompt not shown (e.g. the wallet already has a username)
  }
}
