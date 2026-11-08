/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merchant Pro billing — a testnet proof of concept of Cambio's subscription revenue model.
 *
 * How a merchant pays, without Cambio holding any key:
 *  1. A signed-in merchant asks for an order. The server fixes the price, the treasury (configured by the
 *     operator in PRO_TREASURY_ADDRESS), the period and a random 16-byte order id.
 *  2. The merchant's own wallet sends MUSD.transfer(treasury, price) ‖ "CMB2" ‖ orderId — exactly the
 *     calldata format of a Cambio invoice payment.
 *  3. The merchant submits only the transaction hash. The server re-reads the transaction, receipt and
 *     block and accepts it only through verifyPaymentTx(): exact calldata (treasury, price, order id),
 *     successful receipt, matching MUSD Transfer event, block time after the order was created, and the
 *     configured confirmations. Then it extends proUntil by one period, atomically and at most once.
 *
 * Nothing is charged automatically and no fee is taken from invoice payments. With no treasury
 * configured, billing is disabled and every merchant feature stays free.
 */

import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { MEZO_TESTNET, explorerTxUrl, getKnownChainConfig } from '../../src/config/chains.js';
import { parseTokenAmount, formatUnitsExact } from '../../src/lib/amounts.js';
import { csvCell } from '../../src/lib/csv.js';
import { randomRequestId, REQUEST_VERSION, type SignedPaymentRequest } from '../../src/lib/paymentRequest.js';
import { verifyPaymentTx } from '../../src/lib/requestSettlement.js';
import { InvoiceError, type ChainReader } from '../invoices/service.js';
import type { InvoiceRecord } from '../invoices/store.js';
import { type BillingOrder, type BillingStore, type Subscription } from './store.js';

export const ORDER_TTL_SECONDS = 60 * 60;
/** An open order is reused while it has at least this long left, so repeated clicks do not create orders. */
const REUSE_MIN_REMAINING_SECONDS = 15 * 60;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ID_RE = /^0x[0-9a-f]{32}$/;

export interface BillingConfig {
  treasury: Address | null;
  /** Base units. */
  amount: bigint;
  periodDays: number;
  chainId: number;
}

/** Reads PRO_TREASURY_ADDRESS, PRO_PRICE_MUSD (default 9) and PRO_PERIOD_DAYS (default 30). Throws on invalid values. */
export function billingConfigFromEnv(env: NodeJS.ProcessEnv): BillingConfig {
  const chain = MEZO_TESTNET;
  const rawTreasury = env.PRO_TREASURY_ADDRESS?.trim();
  let treasury: Address | null = null;
  if (rawTreasury) {
    if (!isAddress(rawTreasury, { strict: false }) || /^0x0{40}$/i.test(rawTreasury)) throw new Error('PRO_TREASURY_ADDRESS must be a non-zero 0x address.');
    treasury = getAddress(rawTreasury);
  }
  const price = parseTokenAmount(env.PRO_PRICE_MUSD?.trim() || '9', chain.tokens.MUSD.decimals);
  if (!price.ok || price.value <= 0n) throw new Error('PRO_PRICE_MUSD must be a positive MUSD amount.');
  const periodDays = Number(env.PRO_PERIOD_DAYS?.trim() || '30');
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 366) throw new Error('PRO_PERIOD_DAYS must be a whole number of days between 1 and 366.');
  return { treasury, amount: price.value, periodDays, chainId: chain.chainId };
}

export interface PublicBillingStatus {
  enabled: boolean;
  chainId: number;
  isTestnet: boolean;
  priceMusd: string;
  amount: string;
  periodDays: number;
  treasury: string | null;
  active: boolean;
  proUntil: number | null;
  orders: BillingOrder[];
}

export class BillingService {
  constructor(
    readonly store: BillingStore,
    private readonly config: BillingConfig,
    private readonly reader: (chainId: number) => ChainReader,
    private readonly opts: { now?: () => number; minConfirmations?: number; retryDelays?: readonly number[] } = {}
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  get enabled() {
    return this.config.treasury !== null;
  }

  private chain() {
    return getKnownChainConfig(this.config.chainId) ?? MEZO_TESTNET;
  }

  isActive(sub: Subscription | null) {
    return !!sub && sub.proUntil > this.now();
  }

  async status(merchant: string): Promise<PublicBillingStatus> {
    const chain = this.chain();
    const [sub, orders] = await Promise.all([this.store.getSubscription(merchant), this.store.listOrders(merchant, 10)]);
    return {
      enabled: this.enabled,
      chainId: chain.chainId,
      isTestnet: chain.isTestnet,
      priceMusd: formatUnitsExact(this.config.amount, chain.tokens.MUSD.decimals),
      amount: this.config.amount.toString(),
      periodDays: this.config.periodDays,
      treasury: this.config.treasury,
      active: this.isActive(sub),
      proUntil: sub?.proUntil ?? null,
      orders,
    };
  }

  async createOrder(merchant: string): Promise<BillingOrder> {
    if (!this.config.treasury) throw new InvoiceError(503, 'billing_disabled', 'Merchant Pro billing is not enabled on this deployment.');
    if (merchant === this.config.treasury.toLowerCase()) throw new InvoiceError(400, 'treasury_is_merchant', 'The treasury wallet cannot subscribe to itself.');
    const nowS = Math.floor(this.now() / 1000);
    const chain = this.chain();
    const reusable = (await this.store.listOrders(merchant, 10)).find(
      (o) => o.status === 'open' && o.expiresAt - nowS >= REUSE_MIN_REMAINING_SECONDS && o.amount === this.config.amount.toString() && o.treasury === this.config.treasury!.toLowerCase() && o.periodDays === this.config.periodDays
    );
    if (reusable) return reusable;
    const order: BillingOrder = {
      id: randomRequestId().toLowerCase(),
      merchant,
      chainId: chain.chainId,
      token: chain.tokens.MUSD.address.toLowerCase(),
      treasury: this.config.treasury.toLowerCase(),
      amount: this.config.amount.toString(),
      periodDays: this.config.periodDays,
      createdAt: nowS,
      expiresAt: nowS + ORDER_TTL_SECONDS,
      status: 'open',
      payment: null,
    };
    await this.store.saveOrder(order);
    return order;
  }

  /** The order as the payment-request shape the wallet pays and verifyPaymentTx() checks. */
  static paymentRequestFor(order: BillingOrder): SignedPaymentRequest {
    return {
      v: REQUEST_VERSION,
      id: order.id as Hex,
      chainId: order.chainId,
      token: getAddress(order.token),
      recipient: getAddress(order.treasury),
      amount: order.amount,
      memo: '',
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
    };
  }

  async submitPayment(merchant: string, rawId: unknown, body: { txHash?: unknown }) {
    if (typeof rawId !== 'string' || !ID_RE.test(rawId.toLowerCase())) throw new InvoiceError(400, 'invalid_id', 'Invalid order id.');
    if (typeof body.txHash !== 'string' || !HASH_RE.test(body.txHash)) throw new InvoiceError(400, 'invalid_tx', 'A 32-byte transaction hash is required.');
    const id = rawId.toLowerCase();
    const txHash = body.txHash.toLowerCase() as Hex;
    const order = await this.store.getOrder(id);
    // Orders are private to the merchant who created them.
    if (!order || order.merchant !== merchant) throw new InvoiceError(404, 'not_found', 'This order does not exist.');
    if (order.status === 'paid') {
      if (order.payment?.txHash === txHash) return this.status(merchant);
      throw new InvoiceError(409, 'order_paid', 'This order was already paid by another transaction.');
    }

    const reader = this.reader(order.chainId);
    const check = await verifyPaymentTx(reader, BillingService.paymentRequestFor(order), txHash, this.opts.retryDelays);
    if (check.state === 'not_found') throw new InvoiceError(404, 'tx_not_found', 'The transaction was not found on the network yet. It may still be pending.');
    if (check.state === 'error') throw new InvoiceError(503, 'rpc_unavailable', 'The network could not be read. Try again shortly.');
    if (check.state === 'invalid') {
      const reason = check.result.status === 'reverted' ? 'The transaction reverted.' : check.result.status === 'mismatch' ? check.result.reason : 'Not a payment of this order.';
      throw new InvoiceError(422, 'not_a_payment', reason);
    }
    let head: bigint;
    try {
      head = await reader.getBlockNumber();
    } catch {
      throw new InvoiceError(503, 'rpc_unavailable', 'The network could not be read. Try again shortly.');
    }
    const min = BigInt(Math.max(1, this.opts.minConfirmations ?? 1));
    const confirmations = head - BigInt(check.result.blockNumber) + 1n;
    if (confirmations < min) throw new InvoiceError(409, 'awaiting_confirmations', `The payment has ${confirmations} of ${min} confirmations. Try again shortly.`);

    const result = await this.store.activateOrder(
      id,
      {
        txHash,
        payer: check.result.payer.toLowerCase(),
        blockNumber: check.result.blockNumber,
        paidAt: check.result.paidAt ?? 0,
        verifiedAt: this.now(),
        late: check.result.status === 'settled_after_expiry',
      },
      this.now()
    );
    if (result.status === 'missing') throw new InvoiceError(404, 'not_found', 'This order does not exist.');
    if (result.status === 'tx_used') throw new InvoiceError(409, 'tx_used', 'This transaction already paid another order.');
    if (result.status === 'already_paid' && result.order.payment?.txHash !== txHash) throw new InvoiceError(409, 'order_paid', 'This order was already paid by another transaction.');
    return this.status(merchant);
  }

  /** Pro gate. With billing disabled (no treasury), every feature is free. */
  async requirePro(merchant: string) {
    if (!this.enabled) return;
    if (!this.isActive(await this.store.getSubscription(merchant))) {
      throw new InvoiceError(402, 'pro_required', `This report is part of Merchant Pro (${formatUnitsExact(this.config.amount, 18)} MUSD per ${this.config.periodDays} days, testnet).`);
    }
  }

  /**
   * Server-verified reconciliation report: one row per stored invoice. Status comes only from settlements
   * the server verified on-chain itself; nothing is inferred from the client.
   */
  reconciliationCsv(invoices: readonly InvoiceRecord[], origin: string): string {
    const chain = this.chain();
    const nowS = Math.floor(this.now() / 1000);
    const header = ['request_id', 'created_at', 'expires_at', 'amount_musd', 'note', 'status', 'settlement_tx', 'payer', 'block', 'paid_at', 'server_verified_at', 'duplicate_payments', 'explorer_url', 'proof_url'];
    const iso = (ms: number) => new Date(ms).toISOString();
    const rows = invoices.map((r) => {
      const s = r.settlement;
      const status = s ? (s.late ? 'paid_late' : 'paid') : nowS >= r.expiresAt ? 'expired_unpaid' : 'awaiting_payment';
      return [
        r.id,
        iso(r.createdAt * 1000),
        iso(r.expiresAt * 1000),
        formatUnitsExact(BigInt(r.request.amount), chain.tokens.MUSD.decimals),
        r.request.memo,
        status,
        s?.txHash ?? '',
        s ? getAddress(s.payer) : '',
        s?.blockNumber ?? '',
        s ? iso(s.paidAt) : '',
        s ? iso(s.verifiedAt) : '',
        r.duplicatePayments.join(' '),
        s ? explorerTxUrl(chain, s.txHash) : '',
        `${origin.replace(/\/+$/, '')}/#proof/${getAddress(r.recipient)}/${r.id}`,
      ];
    });
    return [header, ...rows].map((row) => row.map((c) => csvCell(String(c))).join(',')).join('\r\n') + '\r\n';
  }
}

