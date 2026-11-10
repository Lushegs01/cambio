# Evidence: payment settling an EIP-712 signed Cambio request

**Verdict: INCONCLUSIVE (pending). Do not cite this proof as complete.**

> **Update 2026-11-08.** A re-scan of @lushegs and @solo still finds no CMB2-suffixed payment. Two @solo transfers that the first scan could not read were fetched directly: both are plain 68-byte `transfer` calls. The current procedure is `submission/WAVE2_OWNER_ACTIONS.md` §1. After paying a signed invoice in the app, run `npm run verify:evidence -- --discover <merchant> --write`. It finds the payment by its on-chain request id, fetches the signed request from the public registry, re-verifies the signature and the settlement, and records both the hash and the link. The manual steps below still work.

## What Cambio requires for "settled"

A signed request is settled only by a transaction whose calldata is exactly:

```
transfer(recipient, amount) ‖ 0x434d4232 ("CMB2") ‖ requestId (16 bytes)
```

The transaction must also have a successful receipt, a matching MUSD `Transfer` event, chain 31611 and a block time at or after the request's `createdAt`. The request itself must carry a valid EIP-712 signature from the recipient. `verifySettlement()` in `src/lib/paymentRequest.ts` and `checkSignedSettlement()` in `src/lib/evidence.ts` implement this. Both are covered by unit tests, including a test that a plain transfer of the same amount to the same merchant is **not** a settlement.

## What was found (2026-11-05)

`npm run verify:evidence -- --scan <address>` read the complete explorer history of these wallets:

| Wallet | Registry name | Sent txs scanned | Incoming MUSD transfers scanned | CMB2-suffixed payments |
| --- | --- | --- | --- | --- |
| `0x3c40e5aaf9716254cCC8305aD648C5c08841FC81` | @lushegs | 3 | 2 | **0** |
| `0x62632B9a1A54C2Ae9d242DdecB080b05EEB16BF3` | @solo | 4 | 6 | **0** |
| `0xA76Ee770458928260F6541685D87F707cbb9958B` | @blurize | 14 | 9 | **0** |
| `0xB7717e57196E9866De08d5FB4177D8B09F375BFC` | — | 1 | 2 | **0** |

Every MUSD transfer from these wallets has 138-character calldata (`selector + to + amount`) with no suffix. These transfers are real MUSD payments, but none is cryptographically bound to a signed request.

The live deployment bundle `assets/appEntry-fWG1mgwV.js` contains the suffix logic (`0x434d4232`, `dataSuffix` on `MUSD.transfer`). A payment made from a signed link on the live app would therefore carry the suffix. The likely explanations are that the payment was made from Send or an unsigned Receive link, or that it came from a wallet not listed above.

## How to complete this proof (about 5 minutes, two wallets)

1. In browser A, connect the **merchant** wallet. Go to **Request**, enter for example 5 MUSD, then choose **Sign & create request** and sign the free EIP-712 message. Copy the link. It contains `#pay?r=…&s=…`.
2. In browser B, or in a wallet's in-app browser, connect a **different funded** wallet and open the link. Confirm that it shows "Signed by the recipient's wallet". Choose **Review payment**, then **Confirm in wallet**.
3. Wait for **Confirmed on-chain**. Copy the **payment proof link**, which ends with `&tx=0x…`.
4. Open the proof link in browser A or a private window. It must show **"Paid — verified on Mezo Testnet"**.
5. Verify it independently:

   ```bash
   npm run verify:evidence -- --kind signed_request_settlement --hash 0x<payment hash> --link '<proof or request link>'
   ```

6. Put the hash and the link into the `signed-payment-settlement` entry of `transaction-proofs.json`. The link holds only the public request and signature, never a key. Then run `npm run verify:evidence -- --write` and update this file with the verdict.

On the explorer, the payment transaction's input must end with `434d4232` followed by the 32 hex characters of the request id.

## Why this was not done here

Completing the proof requires broadcasting a wallet-approved transaction. This environment has no funded key, and the brief prohibits executing transactions without explicit owner approval and a real wallet signature. Nothing was simulated or substituted.
