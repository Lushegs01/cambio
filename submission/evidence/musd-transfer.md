# Evidence: wallet-approved MUSD transfer

**Verdict: PASS** — independently re-verified from `https://rpc.test.mezo.org` on 2026-11-05 with `npm run verify:evidence`.

| Field | Value |
| --- | --- |
| Transaction | [`0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e`](https://explorer.test.mezo.org/tx/0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e) |
| Network | Mezo Testnet, chain 31611 |
| Block / time | 16390715 · 2026-10-26 23:45:36 UTC |
| Sender | `0x62632B9a1A54C2Ae9d242DdecB080b05EEB16BF3` — registered as **@solo** in Cambio's live registry |
| Recipient | `0x3c40e5aaf9716254cCC8305aD648C5c08841FC81` — registered as **@lushegs** |
| Token contract | MUSD `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| Amount | 10 MUSD (`10000000000000000000` base units) |
| Calldata | `transfer(0x3c40…FC81, 10e18)` — selector `0xa9059cbb`, no trailing bytes |
| Receipt | `status = success`, one `Transfer(from=@solo, to=@lushegs, value=10e18)` log emitted by MUSD |

## What the verifier checked

1. The RPC returned this exact hash for both the transaction and its receipt.
2. The transaction reports chain 31611.
3. The receipt status is `success`.
4. The block timestamp was readable.
5. The transaction targets the verified MUSD contract.
6. The calldata decodes as ERC-20 `transfer(to, amount)`.
7. The receipt contains a MUSD `Transfer` event with exactly the sender, recipient and amount from the calldata.
8. Sender, recipient and amount match the claim in `transaction-proofs.json`.

Usernames were resolved through the public read API:
`GET https://cambio-five.vercel.app/api/identity/username/lushegs` and `/api/identity/address/0x62632B9a1A54C2Ae9d242DdecB080b05EEB16BF3`. Those records were created by server-verified EIP-4361 signatures.

## What this does **not** prove

- The calldata has **no** Cambio `CMB2` request-id suffix, so this is a plain MUSD transfer. It does **not** settle a signed payment request. See [signed-payment-settlement.md](signed-payment-settlement.md).
- The transfer itself does not show which interface sent it. The recipient is a Cambio-verified username, but the on-chain data cannot show that the sender used Cambio's Send screen rather than another wallet interface.

## Reproduce

```bash
npm ci
npm run verify:evidence -- --kind musd_transfer --hash 0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e
```

Or read the raw receipt yourself:

```bash
curl -s -X POST https://rpc.test.mezo.org -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e"]}'
```

The public testnet RPC is load-balanced, and about one read in four returned `null` for mined receipts during this review. The verifier retries "not found" before reporting `INCONCLUSIVE`. If a raw `curl` returns `"result":null`, repeat it.
