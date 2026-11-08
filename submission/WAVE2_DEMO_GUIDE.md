# Demo guide: recording the Wave 2 video and live demo

This supersedes `submission/DEMO_SCRIPT.md` and `submission/DEMO_RECORDING_GUIDE.md`. The narration is in `submission/WAVE2_PITCH_SCRIPT.md`.

The demo is the flagship journey, recorded live on Mezo Testnet. **The recording itself produces the signed-settlement proof** (owner action §1), so do both at once.

## Prerequisites

1. **The current build is deployed.** Do owner action §0, then check:

   ```bash
   npm run check:submission
   ```

   The deployment rows must be PASS.
2. **Two wallets** on Mezo Testnet (chain 31611), each in its own browser profile:
   - **A, merchant:** a little BTC for gas, and a `@username` claimed.
   - **B, payer:** about 0.003 BTC from https://faucet.test.mezo.org and **less MUSD than the invoice**. 0 MUSD works best, because then Fund & Pay appears.
3. For the Merchant Pro scene, `PRO_TREASURY_ADDRESS` must be set. If it isn't, show the card's "billing not enabled" state and say so.
4. Screen: 1920×1080, browser zoom 110%, light theme, bookmarks and extensions hidden, notifications off.
5. Dry-run once without recording.

## Scene list

| # | Browser | Action | Must be visible |
| --- | --- | --- | --- |
| 1 | — | Landing page | Title, "non-custodial", Mezo |
| 2 | A | Request → `5` → note → **Sign & create request** → sign | Wallet signature prompt saying "no transaction"; "Saved to the invoice registry"; QR; WhatsApp/Telegram/Email |
| 3 | B | Paste the link | Stepper (Review ✓, Connect current); "Signed by the recipient's wallet" |
| 4 | B | **Connect wallet**, switch network | Stepper advances; Fund panel |
| 5 | B | **Swap … BTC for MUSD** → approve → swap | Guaranteed minimum, fee, price impact, oracle value; **two** wallet prompts; "Swap confirmed" |
| 6 | B | **Review payment** → **Review transfer** → **Confirm in wallet** | Locked recipient and amount; gas estimate; "Waiting for your wallet", then "Submitted — waiting for confirmation", then "Paid — verified" |
| 7 | B | Open the explorer link | `Input` ends with `434d4232` + request id |
| 8 | B | **View receipt and independent proof** | All checks green; no wallet needed |
| 9 | A | Invoices | "Paid · verified"; totals; proof icon |
| 10 | A | Overview → Mezo position | PriceFeed price; trove card (or "no trove" — never invented); borrowing preview labelled read-only |
| 11 | A | Merchant Pro card | Price, "Testnet pilot" |
| 12 | Terminal | `npm run verify:evidence -- --discover 0x<A> --write`, then `npm run verify:evidence` | `PASS: … settles a signed Cambio request`, then PASS ×3 |

Copy the payment hash and swap hash as soon as they confirm.

## Recording and export

- Use OBS, or QuickTime on macOS, with the microphone on. Record each scene separately and cut block-confirmation waits, but **keep** the "Paid — verified" frame and the explorer frame.
- Do not speed up, crop or blur anything in a way that hides the network name or a transaction hash. Add captions for the hashes and "Mezo Testnet · test funds".
- Target length is 1:55–2:00. Export 1080p MP4.
- Upload unlisted, check that it plays logged out, then put the URL in `submission/submission-fields.json` → `demoVideoUrl`.

## Live demo fallback (if a judge asks to see it live)

- **Proof without any wallet:** open a proof link. To see a forged claim rejected, open `#proof/<merchant>/<stored request id>?tx=0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e`. The real plain transfer is shown as a real, successful MUSD transfer, but **not** a settlement of that invoice.
- **Calldata proof without broadcasting:** run `npm run test:e2e -- -g "respects a wallet rejection"`. It asserts the exact `transfer ‖ CMB2 ‖ id` the wallet is asked to sign.

## After recording

```bash
npm run verify:evidence -- --discover 0x<merchant A> --write
npm run verify:evidence -- --write
npm run check:submission -- --write
```

Then:
1. Update the README evidence table and the evidence slide.
2. Run `npm run deck`.
3. Commit.
