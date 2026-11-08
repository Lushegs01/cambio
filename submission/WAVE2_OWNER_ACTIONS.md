# Owner actions to finish the Wave 2 submission

These steps need the owner's wallets, accounts or people. The implementation agent cannot do them: it has no funded key, it must not broadcast transactions without your approval, and it must never invent users or footage. Do them in this order. Every step ends with a command that proves it is done.

**Deadline:** plan for **2026-11-13 05:30 UTC**. That is the AKINDO `submissionDeadline` field read on 2026-11-05; the announcement text says Nov 15. Confirm the date in the AKINDO UI.

Check progress at any time with this command. It is read-only:

```bash
npm run check:submission
```

It reports PASS, FAIL or BLOCKED. A step below is done only when its line turns PASS.

---

## 0. Merge and deploy (about 10 minutes) — unblocks everything else

1. Review and merge branch `lushegs/focused-goldberg-9ruzxf` into `main`. Vercel redeploys automatically.
2. Deploy the new Firestore index for billing orders. Deploy the rules too; they are unchanged in effect and still default-deny.

   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```

   `.firebaserc` already targets `cambio-717c1`, database `(default)`.
3. Optional, to turn on Merchant Pro billing: in Vercel → Project → Settings → Environment Variables, set `PRO_TREASURY_ADDRESS` to a testnet wallet **you** control. It must not be your merchant wallet. Redeploy. Leave `PRO_PRICE_MUSD` and `PRO_PERIOD_DAYS` unset for 9 MUSD / 30 days.
4. Check the deployment:

   ```bash
   curl -s https://cambio-five.vercel.app/api/health
   ```

   Expect `"invoices":{"available":true,...,"durable":true}`. With step 3 done, also expect `"billing":{"enabled":true}`.

**Done when** `check:submission` shows PASS for "Production serves the current build". If you set the treasury, "Merchant Pro billing enabled in production" also turns PASS.

---

## 1. Record the signed-invoice settlement (about 10 minutes, two wallets) — the P0 judge requirement

This is the one piece of on-chain evidence the judges asked for that does not exist yet. No transaction with Cambio's `CMB2` request-id suffix exists on-chain today. The agent re-scanned @lushegs and @solo on 2026-11-08 and found none.

You need:
- **Merchant wallet A** (for example @lushegs, `0x3c40…FC81`). It needs a little BTC for gas.
- **Payer wallet B**, a different wallet. It needs BTC from https://faucet.test.mezo.org.

To also demonstrate Fund & Pay in the same run, give B **less MUSD than the invoice** (for example 0 MUSD against a 5 MUSD invoice). Cambio will then offer the BTC → MUSD swap first.

Steps:

1. **Browser A** (merchant): open https://cambio-five.vercel.app/app/request and connect A. Enter `5` MUSD and a note. Click **Sign & create request** and sign the free EIP-712 message. Wait for **"Saved to the invoice registry"**. Copy the link.
2. **Browser B** (payer, a separate browser profile or the phone wallet's in-app browser): open the link. The stepper shows **Review invoice ✓ → Connect wallet**. Connect B and switch to Mezo Testnet when asked.
3. If B is short on MUSD: in **Fund this payment with BTC**, click **Swap … BTC for MUSD**. Approve the exact-amount BTC approval, then the swap. These are two wallet prompts. Wait for **Swap confirmed**.
4. Click **Review payment of 5.00 MUSD**, then **Review transfer**, then **Confirm in wallet**. Approve in the wallet.
5. Wait for **"Paid — verified on Mezo Testnet"** and **"Recorded in the merchant's invoice registry"**. Click **View receipt and independent proof**. It must say **Paid — verified on-chain**, with every check green.
6. In this repository, record the evidence automatically. This is read-only: it finds the payment by its on-chain request id, fetches the signed request from the public registry, and re-verifies both the signature and the settlement.

   ```bash
   npm run verify:evidence -- --discover 0x<merchant A address> --write
   npm run verify:evidence -- --write
   ```

   The first command must print `PASS: 0x… settles a signed Cambio request.` The second refreshes all three verdicts. Expect PASS, PASS, PASS.
7. If you did the Fund & Pay swap in step 3, add it as a second swap proof. That gives judges a swap made inside the invoice flow:

   ```bash
   npm run verify:evidence -- --kind btc_to_musd_swap --hash 0x<swap hash>
   ```

   On PASS, copy the `btc-to-musd-swap` entry in `submission/evidence/transaction-proofs.json` under a new id (for example `fund-and-pay-swap`) with the new hash, then run `npm run verify:evidence -- --write`.
8. Update the README evidence table and `submission/WAVE2_JUDGE_RESPONSE.md`: change "PENDING" to the hash and a link to its explorer page. Commit and push.

**Done when** `check:submission` shows PASS for "Real settlement of an EIP-712 signed invoice". The public proof link `https://cambio-five.vercel.app/#proof/<A>/<requestId>` should also verify in a private window, with no wallet connected.

If anything fails, **do not pay again** while a payment may be pending. The payment page tells you when it is safe. To check a hash directly, run `npm run verify:evidence -- --kind signed_request_settlement --hash 0x… --link '<link>'`. It explains exactly which check failed.

---

## 2. Record the two-minute video (about 1 hour)

Follow `submission/WAVE2_DEMO_GUIDE.md`, using the narration in `submission/WAVE2_PITCH_SCRIPT.md`. Record step 1 above **while** you do it: it is the core of the video.

Upload the video unlisted and check that it plays while logged out. Then set `demoVideoUrl` in `submission/submission-fields.json`.

**Done when** `check:submission` shows PASS for "Two-minute demo video".

---

## 3. Real users (as many as the time allows; never invent any)

Judges asked for "some evidence of real users". Nothing has been done here yet, and nothing may be claimed until it has. The kit is in `docs/WAVE2_PRODUCT_VALIDATION.md`.

Minimum credible target before the deadline: 3 merchants or freelancers, each with at least one real testnet invoice paid by a payer they recruited, and 5 short usability sessions.

1. Recruit via the Mezo Discord and your network, using the post template in the validation doc.
2. Send the consent form **before** any session, and keep the replies.
3. For each consenting merchant who ticked "include my address": copy `pilot/participants.example.json` to `pilot/participants.json`. That file is git-ignored. Add `{ "label": "merchant-01", "address": "0x…" }`.
4. After sessions, run:

   ```bash
   npm run pilot:metrics -- --out submission/evidence/pilot-metrics.json
   ```

   Every number comes from verifiable transactions.
5. Fill in the results tables in `docs/WAVE2_PRODUCT_VALIDATION.md` with real, anonymised data. Write "0" or "not run" wherever true.

**Done when** `check:submission` shows PASS for "Real pilot participants with consent" (at least 3 listed).

---

## 4. Submit on AKINDO

1. Run `npm run check:submission -- --write` and commit `submission/WAVE2_FINAL_READINESS.md`.
2. Copy the form fields from `SUBMISSION_PACKAGE.md` and `submission/submission-fields.json`. Add your X or LinkedIn link to the team field if you want it.
3. Attach `submission/CAMBIO_FINAL_PITCH_DECK.pdf`. If step 1 produced the settlement proof, first update the evidence slide and run `npm run deck`.
4. Submit before the deadline, and keep a screenshot of the confirmation.

## Decisions only you can make

- **Treasury address** for Merchant Pro (step 0.3). Without one, billing stays off and everything stays free. That is a valid, honest state.
- **Executable borrowing (BorrowerOperations `openTrove`)** was deliberately **not** built. It would let payers take on liquidatable debt, and it needs a risk review and hint computation (see `docs/WAVE2_IMPLEMENTATION_AUDIT.md`, item G). The read-only preview stays. Approve it explicitly if you want it in Wave 3.
- **A checkout contract** for enforced single-use invoices and in-payment fees needs an audit budget. It has not been started.
