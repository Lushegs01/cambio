// @vitest-environment jsdom
/**
 * UI behaviour of the payment surfaces. Chain access is replaced by test doubles (vi.mock) so the
 * tests are deterministic; the production hooks themselves are covered in musdTransfer.test.ts.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WalletState } from '../src/types';
import type { TxPhase } from '../src/lib/transactions';
import { MEZO_TESTNET } from '../src/config/chains';
import { demoBalance, type WalletBalances } from '../src/lib/balances';
import { ALICE, BOB, HASH } from './helpers';
import { buildPaymentRequest } from '../src/lib/paymentRequest';

const hook = {
  phase: { phase: 'idle' } as TxPhase,
  busy: false,
  preview: { recipient: BOB, amount: 0n, gas: 34_000n, estimatedFee: 5_100_000n, musdBalance: 0n, btcBalance: 0n } as unknown,
  previewError: null as string | null,
  prepare: vi.fn(async () => hook.preview),
  send: vi.fn(async () => hook.phase),
  recheck: vi.fn(),
  reset: vi.fn(),
};
vi.mock('../src/hooks/useMusdTransfer', () => ({ useMusdTransfer: () => hook }));
vi.mock('../src/context/CurrencyContext', () => ({
  useCurrency: () => ({ preferredCurrency: 'USD', formatTokenFiat: (n: number) => ({ amount: n, formatted: `$${n.toFixed(2)}` }), rateStatus: 'live' }),
}));
vi.mock('../src/components/NetworkGuard', () => ({
  NetworkGuard: ({ wallet }: { wallet: WalletState }) => (wallet.isConnected && !wallet.isSupportedNetwork ? <div role="alert">Unsupported network</div> : null),
}));
vi.mock('../src/services/identityClient', () => ({
  lookupAddress: vi.fn(async () => null),
  resolveUsername: vi.fn(async (u: string) => (u === 'bob' ? { username: 'bob', display: '@bob', address: BOB, verified: true } : null)),
  IdentityApiError: class extends Error {},
}));

const { SendModal } = await import('../src/components/SendModal');
const { BalanceCard } = await import('../src/components/BalanceCard');
const { TxStatusPanel } = await import('../src/components/TxStatusPanel');

const ready = (asset: 'MUSD' | 'BTC', value: bigint) => ({ asset, status: 'ready' as const, value, decimals: 18, updatedAt: Date.now(), source: asset === 'BTC' ? ('native-rpc' as const) : ('erc20-balanceOf' as const), simulated: false });
function wallet(over: Partial<WalletState> = {}): WalletState {
  const balances: WalletBalances = { musd: ready('MUSD', 100n * 10n ** 18n), btc: ready('BTC', 5n * 10n ** 15n) } as WalletBalances;
  return { isConnected: true, status: 'connected', address: ALICE, walletName: 'Test', chainId: 31611, networkName: 'Mezo Testnet', chain: MEZO_TESTNET, isSupportedNetwork: true, balances, username: null, dataMode: 'real', ...over };
}

beforeEach(() => {
  hook.phase = { phase: 'idle' };
  hook.busy = false;
  hook.previewError = null;
  hook.prepare.mockClear();
  hook.send.mockClear();
});
afterEach(cleanup);

const renderSend = (w: WalletState, extra: Partial<React.ComponentProps<typeof SendModal>> = {}) =>
  render(<SendModal isOpen onClose={() => undefined} wallet={w} onOpenConnectWallet={extra.onOpenConnectWallet ?? (() => undefined)} {...extra} />);

async function fillAndReview(recipient = BOB, amount = '5') {
  fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: recipient } });
  fireEvent.change(screen.getByLabelText(/amount \(musd\)/i), { target: { value: amount } });
  await waitFor(() => expect(screen.getByText('Valid address')).toBeTruthy(), { timeout: 2000 });
  fireEvent.click(screen.getByRole('button', { name: /review transfer/i }));
  await screen.findByText(/review transfer/i, { selector: 'h2' });
}

describe('SendModal', () => {
  it('requires another review after the payer account changes', async () => {
    const onClose = () => undefined; const onConnect = () => undefined;
    const { rerender } = render(<SendModal isOpen onClose={onClose} onOpenConnectWallet={onConnect} wallet={wallet()} />);
    await fillAndReview();
    rerender(<SendModal isOpen onClose={onClose} onOpenConnectWallet={onConnect} wallet={wallet({ address: BOB })} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm in wallet/i }));
    expect(await screen.findByText(/account or network changed/i)).toBeTruthy();
    expect(hook.send).not.toHaveBeenCalled();
  });

  it('publishes a request proof when rechecking an unknown payment confirms it', async () => {
    const lockedRequest = { request: buildPaymentRequest({ chain: MEZO_TESTNET, recipient: BOB, amount: 5n * 10n ** 18n, memo: '', lifetimeSeconds: 3600 }), recipientLabel: '@bob' };
    const onRequestPaid = vi.fn(); const onClose = () => undefined; const onConnect = () => undefined;
    const props = { isOpen: true, onClose, onOpenConnectWallet: onConnect, wallet: wallet(), lockedRequest, onRequestPaid };
    const { rerender } = render(<SendModal {...props} />);
    await waitFor(() => expect(screen.getByText('Valid address')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /review transfer/i }));
    await screen.findByText(/review transfer/i, { selector: 'h2' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /confirm in wallet/i })));
    hook.phase = { phase: 'unknown', hash: HASH, message: 'Pending' }; rerender(<SendModal {...props} />);
    expect(onRequestPaid).not.toHaveBeenCalled();
    hook.phase = { phase: 'confirmed', hash: HASH, receipt: { status: 'success', blockNumber: '42', gasUsed: '1', effectiveGasPrice: null, blockTimestamp: null } };
    rerender(<SendModal {...props} />);
    expect(onRequestPaid).toHaveBeenCalledExactlyOnceWith(HASH);
  });
  it('asks a disconnected user to connect instead of showing a form that cannot work', () => {
    const onConnect = vi.fn();
    renderSend(wallet({ isConnected: false, address: null, chain: null, isSupportedNetwork: false }), { onOpenConnectWallet: onConnect });
    expect(screen.getByText(/wallet disconnected/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /connect wallet to send/i }));
    expect(onConnect).toHaveBeenCalled();
  });

  it('shows an RPC balance failure as "Unavailable", never as 0.00, and blocks review', async () => {
    const w = wallet();
    w.balances = { ...w.balances, musd: { asset: 'MUSD', status: 'error', error: 'fetch failed' } };
    renderSend(w);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText(/0\.00 MUSD/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: BOB } });
    fireEvent.change(screen.getByLabelText(/amount \(musd\)/i), { target: { value: '5' } });
    await waitFor(() => screen.getByText('Valid address'));
    const review = screen.getByRole('button', { name: /review transfer/i }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    fireEvent.click(review);
    expect(hook.prepare).not.toHaveBeenCalled();
  });

  it('disables review on an unsupported network', () => {
    renderSend(wallet({ chainId: 1, chain: null, isSupportedNetwork: false }));
    expect(screen.getByRole('alert').textContent).toMatch(/unsupported network/i);
    expect((screen.getByRole('button', { name: /review transfer/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('rejects amounts above the balance and excess precision before contacting the wallet', async () => {
    renderSend(wallet());
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: BOB } });
    fireEvent.change(screen.getByLabelText(/amount \(musd\)/i), { target: { value: '1.0000000000000000001' } });
    expect(screen.getByText(/at most 18 decimal places/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/amount \(musd\)/i), { target: { value: '101' } });
    await waitFor(() => screen.getByText('Valid address'));
    fireEvent.click(screen.getByRole('button', { name: /review transfer/i }));
    expect(await screen.findByText(/exceeds your balance/i)).toBeTruthy();
    expect(hook.prepare).not.toHaveBeenCalled();
  });

  it('reviews network, token contract and RPC fee estimate, then submits exactly once', async () => {
    renderSend(wallet());
    await fillAndReview();
    expect(hook.prepare).toHaveBeenCalledWith(expect.objectContaining({ recipient: BOB, amount: 5n * 10n ** 18n }));
    expect(screen.getByText(/Mezo Testnet \(chain 31611\)/)).toBeTruthy();
    expect(screen.getByText(/0x1189…c503/i)).toBeTruthy();
    expect(screen.getByText(/≈ 0\.0000000000*51 BTC \(estimate\)/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: /confirm in wallet/i });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(hook.send).toHaveBeenCalledTimes(1);
  });

  it('shows a wallet rejection as cancelled with a way back, not as an error or success', async () => {
    const { rerender } = renderSend(wallet());
    await fillAndReview();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /confirm in wallet/i })));
    hook.phase = { phase: 'rejected', message: 'You declined the request in your wallet. Nothing was sent.' };
    rerender(<SendModal isOpen onClose={() => undefined} wallet={wallet()} onOpenConnectWallet={() => undefined} />);
    expect(screen.getByText('Cancelled in wallet')).toBeTruthy();
    expect(screen.getByText(/nothing was sent/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /back to review/i })).toBeTruthy();
    expect(screen.queryByText(/confirmed on-chain/i)).toBeNull();
  });

  it('keeps a pending transfer visibly pending and cannot be closed mid-flight', async () => {
    const { rerender } = renderSend(wallet());
    await fillAndReview();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /confirm in wallet/i })));
    hook.phase = { phase: 'pending', hash: HASH, submittedAt: Date.now() };
    hook.busy = true;
    rerender(<SendModal isOpen onClose={() => undefined} wallet={wallet()} onOpenConnectWallet={() => undefined} />);
    expect(screen.getByText(/submitted — waiting for confirmation/i)).toBeTruthy();
    expect(screen.queryByText(/confirmed on-chain/i)).toBeNull();
    expect((screen.getByLabelText(/close dialog/i) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(HASH)).toBeTruthy();
  });

  it('resolves @usernames only through the registry', async () => {
    renderSend(wallet());
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: '@nobody' } });
    expect(await screen.findByText(/no verified wallet is registered as @nobody/i, {}, { timeout: 2000 })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: '@bob' } });
    expect(await screen.findByText('Verified username', {}, { timeout: 2000 })).toBeTruthy();
  });
});

describe('BalanceCard', () => {
  it('shows MUSD and native BTC as separate assets', () => {
    render(<BalanceCard wallet={wallet()} isMasked={false} onToggleMask={() => undefined} onSend={() => undefined} onReceive={() => undefined} onConnectWallet={() => undefined} />);
    expect(screen.getByText('100.00')).toBeTruthy();
    expect(screen.getByText(/BTC for fees/)).toBeTruthy();
    expect(screen.getByText('0.005')).toBeTruthy();
  });

  it('labels demo balances as simulated', () => {
    const w = wallet({ dataMode: 'demo' });
    w.balances = { musd: demoBalance('MUSD', 12_450n * 10n ** 18n), btc: demoBalance('BTC', 10n ** 17n) };
    render(<BalanceCard wallet={w} isMasked={false} onToggleMask={() => undefined} onSend={() => undefined} onReceive={() => undefined} onConnectWallet={() => undefined} />);
    expect(screen.getByText(/demo musd balance \(simulated\)/i)).toBeTruthy();
  });
});

describe('TxStatusPanel', () => {
  it('links real hashes to the matching network explorer', () => {
    render(<TxStatusPanel chain={MEZO_TESTNET} phase={{ phase: 'confirmed', hash: HASH, receipt: { status: 'success', blockNumber: '42', gasUsed: '1', effectiveGasPrice: null, blockTimestamp: null } }} />);
    expect(screen.getByText('Confirmed on-chain')).toBeTruthy();
    expect((screen.getByRole('link', { name: /view on mezo testnet explorer/i }) as HTMLAnchorElement).href).toBe(`https://explorer.test.mezo.org/tx/${HASH}`);
  });

  it('says a reverted transaction moved no funds', () => {
    render(<TxStatusPanel chain={MEZO_TESTNET} phase={{ phase: 'reverted', hash: HASH, receipt: { status: 'reverted', blockNumber: '42', gasUsed: '1', effectiveGasPrice: null, blockTimestamp: null } }} />);
    expect(screen.getByText(/reverted — no funds moved/i)).toBeTruthy();
  });
});
