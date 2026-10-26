// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MEZO_TESTNET } from '../src/config/chains';
import { ALICE, BOB, HASH, receipt } from './helpers';
import type { TransferDeps } from '../src/lib/musdTransfer';

const mocks = vi.hoisted(() => ({ quote: vi.fn(), explorer: vi.fn(), getReceipt: vi.fn() }));
vi.mock('../src/config/walletConnect', () => ({ appKit: { setThemeMode: vi.fn() } }));
vi.mock('../src/lib/wagmiDeps', () => ({ publicClientFor: () => ({}), getReceiptOrNull: mocks.getReceipt, getBlockTimestamp: async () => 1000, createTransferDeps: vi.fn() }));
vi.mock('../src/lib/swap', async (original) => ({ ...await original<typeof import('../src/lib/swap')>(), fetchSwapQuote: mocks.quote }));
vi.mock('../src/lib/activity', async (original) => ({ ...await original<typeof import('../src/lib/activity')>(), fetchExplorerActivity: mocks.explorer }));
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';
import { useSwapQuote } from '../src/hooks/useSwap';
import { useActivity } from '../src/hooks/useActivity';
import { useMusdTransfer } from '../src/hooks/useMusdTransfer';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  localStorage.clear();
});

function ThemeProbe() { const t = useTheme(); return <button onClick={t.toggleTheme}>{t.theme}:{t.resolvedTheme}</button>; }

describe('optional browser storage', () => {
  it('renders and changes theme even when reading and writing storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('dark:dark');
  });
  it('restores the system preference and resolves it against the OS theme', () => {
    localStorage.setItem('cambio_theme', 'system');
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    expect(screen.getByRole('button').textContent).toBe('system:dark');
  });
});

describe('outdated async data cannot return after inputs change', () => {
  it('discards an in-flight quote when the amount is cleared', async () => {
    let release!: (q: unknown) => void;
    mocks.quote.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result, rerender } = renderHook(({ amount }) => useSwapQuote(MEZO_TESTNET, 'MUSD', 'BTC', amount, 50), { initialProps: { amount: 100n as bigint | null } });
    await waitFor(() => expect(mocks.quote).toHaveBeenCalled());
    rerender({ amount: null });
    await act(async () => release({ amountIn: 100n }));
    expect(result.current.quote).toBeNull();
  });
  it('discards the previous wallet history after disconnect', async () => {
    let release!: (items: unknown[]) => void;
    mocks.explorer.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result, rerender } = renderHook(({ connected }) => useActivity(connected ? ALICE : null, MEZO_TESTNET, connected), { initialProps: { connected: true } });
    await waitFor(() => expect(mocks.explorer).toHaveBeenCalled());
    rerender({ connected: false });
    await act(async () => release([{ key: 'old-wallet-data' }]));
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

it('a transfer recheck never confirms a successful receipt without the matching event', async () => {
  const deps: TransferDeps = {
    getConnection: () => ({ address: ALICE, chainId: 31611 }), readTokenBalance: async () => 100n,
    readNativeBalance: async () => 100n, estimateFee: async () => ({ gas: 1n, fee: 1n }), sendTransfer: async () => HASH,
    waitForReceipt: async () => { throw new Error('timeout'); }, getBlockTimestamp: async () => 1000,
  };
  mocks.getReceipt.mockResolvedValue(receipt('success'));
  const { result } = renderHook(() => useMusdTransfer(deps));
  await act(async () => { await result.current.send({ chain: MEZO_TESTNET, from: ALICE, recipient: BOB, amount: 5n }); });
  expect(result.current.phase.phase).toBe('unknown');
  await act(async () => { await result.current.recheck(31611, HASH); });
  expect(result.current.phase.phase).toBe('unknown');
});
