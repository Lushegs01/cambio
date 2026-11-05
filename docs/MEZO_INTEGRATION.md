# Mezo integration

Cambio uses Mezo as its settlement layer rather than as an interchangeable EVM chain. Every Mezo touchpoint below is read from, or sent to, an official contract. Each address is checked by `npm run verify:chain`. Mainnet addresses are configured but disabled in this build.

## Contracts used

| Purpose | Testnet (31611) | How Cambio uses it | Source of address |
| --- | --- | --- | --- |
| MUSD token | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | `balanceOf`, `transfer(to, amount) ‖ CMB2 ‖ requestId`, `Transfer` events for proof | Mezo docs: contracts reference |
| BTC (native; ERC-20 precompile) | `0x7b7C000000000000000000000000000000000000` | Gas, balances, exact `approve` for Fund & Pay swaps | Mezo docs |
| Router (Aerodrome-style) | `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9` | `getAmountsOut`, `swapExactTokensForTokens` (BTC→MUSD, MUSD↔mUSDC/mUSDT) | Mezo docs: Mezo Pools |
| PoolFactory | `0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A` | `getFee(pool, stable)`: fees differ per network | Mezo docs |
| MUSD/BTC pool | `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9` | `getReserves`, `token0` for Fund & Pay sizing | On-chain `poolFor` |
| **PriceFeed** | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | `fetchPrice()`, the BTC/USD oracle price with 18 decimals | `mezo-org/musd` `deployments/matsnet/PriceFeed.json` @ `da7888a` |
| Oracle behind PriceFeed | `0x7b7c…0015` | `latestRoundData()` for the round timestamp | `PriceFeed.oracle()` |
| **TroveManager** | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | `getTroveStatus`, `getEntireDebtAndColl`, `getCurrentICR`, `MCR`, `CCR`, `getTCR`, `checkRecoveryMode`, system totals | same repo |
| **BorrowerOperations** | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | `minNetDebt`, `MUSD_GAS_COMPENSATION`, `borrowingRate` (read only) | same repo |
| InterestRateManager | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` | `interestRate()` for new troves | same repo |
| HintHelpers / SortedTroves | `0x4e4c…BCF6` / `0x722E…68fA` | Bytecode checked; reserved for a future borrowing flow | same repo |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Read batching only | bytecode checked on both networks |

`matsnet` is Mezo Testnet's former name. Its `MUSD.json` address equals the testnet MUSD token, which is how the deployment set was matched to chain 31611.

## 1. MUSD payments that can be proven

- A merchant signs an EIP-712 `PaymentRequest{id, recipient, token, amount, memo, createdAt, expiresAt}` under domain `{name: "Cambio", version: "2", chainId}`. Signing is free.
- The payer pays with `MUSD.transfer(recipient, amount)` plus a 20-byte calldata suffix: `0x434d4232` ("CMB2") followed by the 16-byte request ID. The MUSD contract ignores trailing calldata. A test asserts that the wallet is asked to sign exactly this calldata.
- A request is **settled** only if all of the following hold:
  - the transaction's input equals that exact calldata;
  - the receipt status is `success`;
  - the receipt contains the matching MUSD `Transfer` event;
  - the transaction is on chain 31611;
  - the block time is at or after `createdAt`.

  Payments at or after expiry are labelled late.
- The same rule is used in the payer's browser, by the merchant's "Check paid" action, by the server before it records a settlement, and by `npm run verify:evidence`.

## 2. Mezo PriceFeed (oracle) — `src/lib/mezoProtocol.ts`

- `readOraclePrice()` calls `PriceFeed.fetchPrice()`. The contract scales the Chainlink-compatible oracle to 18 decimals and **reverts with "PriceFeed: Oracle is stale."** when the round is older than 60 seconds. Cambio reports that revert as *stale* and an RPC failure as *unavailable*. Neither case is replaced by CoinGecko or any other price.
- The UI labels this value "BTC price · Mezo oracle". It is kept separate from the display-only fiat estimates elsewhere in the app, which come from CoinGecko/Coinbase.
- The card refreshes every 30 s while visible, which is half of the protocol's 60 s staleness window.

## 3. Trove health — `src/lib/mezoProtocol.ts`, `src/components/MezoProtocolCard.tsx`

These rules were taken from the official contracts (`mezo-org/musd` @ `da7888a`), not from Liquity v1 assumptions:

| Rule | Where in the contracts |
| --- | --- |
| ICR = collateral × price / (principal + interest), 18-decimal fixed point | `LiquityMath._computeCR`, `TroveManager.getCurrentICR` |
| Liquidation applies when **ICR < MCR (110%)**, in normal **and** Recovery Mode | `TroveManager._getTotalsFromBatchLiquidate` |
| Recovery Mode is TCR < CCR (150%). It blocks collateral withdrawal; new debt needs ICR ≥ 150% and must improve ICR; opening needs ICR ≥ 150%; no borrowing fee is charged | `BorrowerOperations._requireValidAdjustmentInRecoveryMode`, `openTrove` |
| Opening: net debt = amount + fee must be at least `minNetDebt`; ICR uses composite debt = net debt + gas compensation | `BorrowerOperations.openTrove`, `LiquityBase._getCompositeDebt` |

The dashboard shows:
- trove status (none, active, or closed by owner, liquidation or redemption);
- collateral and debt, including pending redistributions;
- ICR **as returned by `getCurrentICR`**;
- the safety buffer above MCR;
- an estimated liquidation price `⌈MCR × debt / coll⌉`, labelled as derived arithmetic that moves as interest accrues;
- system TCR and a Recovery Mode banner.

Cambio's local `computeCR` equals a live `getCurrentICR` result to the wei (`tests/mezoProtocol.test.ts`).

### Read-only borrowing preview (BorrowerOperations)

`borrowPreview()` mirrors `openTrove`'s checks: fee (waived in Recovery Mode), minimum net debt, gas compensation, MCR/CCR and the new TCR. It shows the fee, total debt, ICR, liquidation price and yearly interest at the live rate. **Cambio sends no BorrowerOperations transaction.** The preview links to the official Mezo app. An executable borrowing flow needs owner approval and a separate review (see `KNOWN_LIMITATIONS.md`).

## 4. Fund & Pay: BTC → MUSD on the invoice — `src/lib/fundAndPay.ts`

When a payer opens a verified signed request without enough MUSD:

1. Shortfall = amount − live MUSD balance.
2. Live `getReserves`/`token0` of the MUSD/BTC pool and `PoolFactory.getFee` give the exact inverse of the pool formula (fee taken from input, `x·y = k`). The target is grossed up so that the **slippage-protected minimum** covers the shortfall.
3. A live `Router.getAmountsOut` quote is authoritative. If its minimum would not cover the shortfall, the input is nudged up in 0.5% steps (at most 4 attempts). Live test result: the router minimum lands about 2×10⁵ wei above the need for 1, 25 and 500 MUSD.
4. The payer sees the BTC in, the guaranteed MUSD out, the fee, the price impact, the slippage limit, the **Mezo oracle value of the BTC** with the pool's spread against it, and the BTC kept for gas.
5. Execution reuses the existing swap path:
   - an exact-amount BTC approval (never unlimited), which is its own wallet prompt;
   - a fresh on-chain re-quote;
   - `simulateContract`;
   - the swap, which is a second wallet prompt;
   - a receipt check that the BTC input left and at least the minimum MUSD arrived.
6. The signed request never leaves the page. Pay unlocks only after balances are re-read from the chain. The payment preflight re-checks chain, account, expiry and balance.

## 5. Verified evidence

| Proof | Transaction | Verdict |
| --- | --- | --- |
| MUSD transfer (@solo → @lushegs, 10 MUSD) | [`0x8e39…065e`](https://explorer.test.mezo.org/tx/0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e) | **PASS** |
| BTC → MUSD swap (0.01 BTC → 786.1477 MUSD) | [`0x4af2…3f6e`](https://explorer.test.mezo.org/tx/0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e) | **PASS** |
| Signed-request settlement | none found with a CMB2 suffix | **PENDING** |

Re-run with `npm run verify:evidence`. Details are in `submission/evidence/`.

## Mezo-specific findings worth knowing

- **The public testnet RPC is inconsistent.** About 25–33% of `eth_getTransactionReceipt` calls for mined transactions returned `null` (measured 2026-11-05). Cambio retries "not found" before concluding absence (`src/lib/rpcRetry.ts`). Integrators who treat one null receipt as "unpaid" will mislabel payments.
- Testnet pool fees (volatile 0.04%) differ from mainnet (0.30%), so fees are always read on-chain.
- The testnet MUSD/mUSDT pool exists but has no liquidity. The MUSD/mUSDC pool is off-peg (test liquidity).
- `fetchPrice()` is a `view` function that reverts when stale. A UI that catches the error and falls back to an off-chain price would display a value the protocol itself refuses.
