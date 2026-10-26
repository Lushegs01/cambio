/**
 * Demo-mode fixtures. Everything here is fictional and typed as simulated:
 * mode 'demo', status 'simulated', no transaction hash. It can never be merged into real history,
 * because real history only accepts chain-derived items (see lib/activity.ts).
 */
import type { NotificationItem } from '../types';
import type { ActivityItem } from '../lib/activity';

export const DEMO_MUSD_BALANCE = 12_450n * 10n ** 18n;
export const DEMO_BTC_BALANCE = 45n * 10n ** 16n; // 0.45 BTC

const day = 24 * 60 * 60 * 1000;
const demo = (n: number, kind: ActivityItem['kind'], musd: number, name: string, note: string, ago: number): ActivityItem => ({
  key: `demo-${n}`,
  mode: 'demo',
  kind,
  status: 'simulated',
  amount: BigInt(Math.round(musd * 100)) * 10n ** 16n,
  decimals: 18,
  symbol: 'MUSD',
  counterparty: null,
  counterpartyName: `${name} (demo)`,
  hash: null,
  chainId: null,
  timestamp: Date.now() - ago,
  memo: note,
  source: 'demo',
});

export function createDemoActivity(): ActivityItem[] {
  return [
    demo(1, 'receive', 1250, 'Elena', 'Consulting invoice', 2 * 60 * 60 * 1000),
    demo(2, 'send', 320, 'Marcus', 'Team lunch split', day),
    demo(3, 'receive', 4500, 'Design studio', 'Milestone payment', 8 * day),
    demo(4, 'send', 85.5, 'Hosting provider', 'Subscription', 10 * day),
  ];
}

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-welcome',
    title: 'Welcome to Cambio',
    message: 'Connect a wallet on Mezo Testnet to send, request and receive MUSD. Every transfer is approved in your own wallet.',
    timestamp: 'Just now',
    read: false,
    type: 'system',
  },
];
