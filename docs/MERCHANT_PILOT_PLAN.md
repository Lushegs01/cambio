# Merchant pilot plan (testnet)

**Status: planned, not started.** No merchants are enrolled. All targets below are goals.

## Objective

Show, with independently verifiable on-chain evidence, that real merchants can invoice in MUSD and that payers complete payment, including payers who start with only BTC. Measure completion, time to pay and willingness to pay.

## Targets

| Metric | Target | Measured by |
| --- | --- | --- |
| Pilot merchants | 3–5 (consenting) | Signed consent forms |
| Verified signed-request settlements | ≥ 30 across the pilot | `npm run pilot:metrics` |
| Distinct payers | ≥ 15 | `pilot:metrics` |
| Fund & Pay payments | ≥ 5 | Swap tx followed by settlement from the same payer |
| Completion rate | ≥ 70% of opened links paid | Usability log + registry |
| Median time to pay | report | `pilot:metrics` (`medianSecondsToPay`) |
| Willingness to pay | ≥ 3 merchants at ≥ $9/month | Interviews |

## Timeline (solo developer)

| Week | Work |
| --- | --- |
| 0 (now) | Merge and redeploy this branch. Deploy the Firestore index and TTL policies. Record the signed-settlement proof. |
| 1 | Recruit 3–5 merchants (Mezo Discord plus network). Collect consent. Run the onboarding session: claim a username, create the first invoice. |
| 2–3 | Merchants send real testnet invoices to their own payers. Weekly check-in. Run `pilot:metrics` weekly. |
| 4 | Exit interviews (WTP). Publish the aggregate metrics with tx hashes in `submission/evidence/pilot-metrics.json`. |

## Merchant onboarding checklist

1. Wallet on Mezo Testnet; BTC from https://faucet.test.mezo.org
2. Claim a `@username` (free SIWE signature)
3. Request → create an invoice → **Sign in to sync across devices**
4. Send the link or QR to a payer; ask the payer to use **Fund & Pay** if they hold only BTC
5. Confirm "Paid · verified" in Invoices; export CSV at the end of the week

## Payer instructions (to forward)

> Open the link, connect any EVM wallet, and approve the switch to Mezo Testnet. If you don't have enough MUSD, use **Fund this payment with BTC** (two wallet prompts). Then **Review payment → Confirm in wallet**. Send the "payment proof link" back to the merchant.

## Data handling

- Only merchants who ticked the metrics box are added to `pilot/participants.json`. The file is git-ignored, and the example is `pilot/participants.example.json`.
- Published metrics are aggregate. Per-merchant rows use pseudonymous labels.
- Every published number links to transaction hashes that anyone can verify.

## Running the metrics

```bash
cp pilot/participants.example.json pilot/participants.json   # then edit
npm run pilot:metrics -- --out submission/evidence/pilot-metrics.json
```

## Exit criteria

- **Success:** targets met, and at least 3 merchants say they would pay. Proceed to the Merchant Pro billing test (`docs/BUSINESS_MODEL.md`, option A).
- **Learn and iterate:** completion is under 50%. Analyse the drop-off step from session notes and fix it before scaling recruitment.
