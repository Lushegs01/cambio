# Evidence: BTC → MUSD swap through the Mezo Router

**Verdict: PASS** — independently re-verified from `https://rpc.test.mezo.org` on 2026-11-05 with `npm run verify:evidence`.

| Field | Value |
| --- | --- |
| Approval | [`0xb44cabdc4f5d28c8023a5b13ea5b397a38e6d77c2edac54363006b09a6c46d79`](https://explorer.test.mezo.org/tx/0xb44cabdc4f5d28c8023a5b13ea5b397a38e6d77c2edac54363006b09a6c46d79) — `approve(Router, 0.01 BTC)`, an exact amount rather than an unlimited approval |
| Swap | [`0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e`](https://explorer.test.mezo.org/tx/0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e) |
| Network | Mezo Testnet, chain 31611 |
| Block / time | 16382064 · 2026-10-26 13:45:26 UTC |
| Trader and recipient | `0x3c40e5aaf9716254cCC8305aD648C5c08841FC81` (**@lushegs**) |
| Contract called | Mezo Router `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9` · `swapExactTokensForTokens` |
| Route | BTC `0x7b7C…0000` → MUSD `0x1189…C503`, volatile, PoolFactory `0x4947…Ce1A` |
| Pool | MUSD/BTC `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9` |
| Input | 0.01 BTC (`10000000000000000`) |
| Router minimum output | 782.216968954080478421 MUSD (signed by the wallet in `amountOutMin`) |
| **Actual output** | **786.147707491538169268 MUSD**, read from the receipt's MUSD `Transfer(pool → trader)` |
| Pool fee leg | 0.000004 BTC, 0.04% of input. This matches the testnet volatile-pool fee read from `PoolFactory.getFee`. |

## What the verifier checked

1. Hash, chain 31611, `success` status and a readable block timestamp.
2. The transaction targets the configured Mezo Router.
3. The input decodes with the Router ABI as `swapExactTokensForTokens(amountIn, amountOutMin, routes, to, deadline)`.
4. The route starts at BTC, ends at MUSD and uses the configured PoolFactory.
5. The receipt contains a BTC Transfer of exactly `amountIn` from the trader into the configured MUSD/BTC pool.
6. The MUSD received by `to`, summed from receipt Transfer events, is positive and at least `amountOutMin`.
7. The trader and recipient match the claim.

## Limits

- **Testnet liquidity is not a market price.** 786 MUSD per 0.01 BTC means about 78,600 MUSD/BTC. The Mezo PriceFeed oracle read on 2026-11-05 was about 80,300 USD/BTC. Use these values only as evidence that the swap executed.
- This proves the swap executed. It does not prove which front end submitted it. The calldata pattern matches Cambio's swap path: exact approval first, a 20-minute deadline, and a single-hop verified pool.

## Reproduce

```bash
npm run verify:evidence -- --kind btc_to_musd_swap --hash 0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e
```
