# Demo recording guide

## Before recording (owner actions)

1. **Deploy the Wave 2 build.** Merge the branch, let Vercel deploy, and deploy the Firestore index:

   ```bash
   npx firebase deploy --only firestore:indexes --project <project>
   ```

   Then open `https://cambio-five.vercel.app/api/health` and confirm `invoices.available: true`.
2. **Two wallets** on Mezo Testnet (chain 31611), for example two MetaMask profiles or MetaMask plus a phone wallet:
   - **Merchant (A):** a little BTC for gas, and a username claimed.
   - **Payer (B):** about 0.002 BTC from https://faucet.test.mezo.org and **less MUSD than the invoice**, so Fund & Pay appears. Swap a small amount first if B has no MUSD, or leave it at 0.
3. Close unrelated tabs. Use 1920×1080, browser zoom 110%, light theme. Hide bookmarks and extensions.
4. Dry-run once without recording, so wallet prompts appear quickly.

## Recording

- Tool: OBS, or QuickTime on macOS (screen plus microphone). Record each scene separately; it's easier to cut out block-confirmation waits.
- Follow `DEMO_SCRIPT.md`. Keep wallet popups visible: judges want to see the explicit approvals.
- After the payment confirms, copy the transaction hash and the **payment proof link** immediately.

## Right after recording: turn it into evidence

```bash
npm run verify:evidence -- --kind signed_request_settlement --hash 0x<payment hash> --link '<proof link>'
npm run verify:evidence -- --kind btc_to_musd_swap --hash 0x<funding swap hash>
```

If both return PASS:
1. Add them to `submission/evidence/transaction-proofs.json`. The signed-settlement entry needs `hash` and `paymentLink`. Add the swap as an extra `btc_to_musd_swap` proof.
2. Run `npm run verify:evidence -- --write`.
3. Update `signed-payment-settlement.md` and the README evidence table.

## Editing

- Target 1:55–2:00. Cut block-confirmation waits but keep the "Confirmed on-chain" frame and the explorer frame.
- Add captions for the transaction hash and "Mezo Testnet · test funds".
- Do not speed up or crop in a way that hides the network name or the transaction hash.
- Export 1080p MP4. Upload unlisted to YouTube, or as the AKINDO form requires, and check it plays logged out.

## Checklist before submitting

- [ ] The video shows only real transactions, and every cited hash returns PASS
- [ ] It names the solo developer and Track 2
- [ ] No claims of customers, revenue, an audit or mainnet
- [ ] The deck, README and form use the same hashes and links
