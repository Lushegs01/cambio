# Preferred Currency Feature

Empower Cambio users to select their preferred fiat currency (USD, EUR, GBP, CAD, NGN, GHS, KES, ZAR) and view real-time estimated fiat values for their MUSD, BTC, tBTC, and USDC balances across the entire application using live market prices and foreign exchange rates.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions incorporate your confirmed answers from Phase 1:
> - **FX Rate Provider**: Open Exchange Rates API (`open.er-api.com`) with USD base, complemented by fallback providers (Frankfurter ECB and Coinbase FX) for resilient uptime.
> - **Display Presentation**: Subtitle estimates (`≈ ₦...`, `≈ €...`) alongside the primary native token amounts to preserve transaction precision while providing instantaneous local fiat clarity.
> - **Auto-Refresh Interval**: Configured for 60 seconds with an interactive manual refresh trigger and timestamp display.

- **Confirmed Decision 1**: Open Exchange Rates real-time feed with multi-tier fallback (Frankfurter / Coinbase).
- **Confirmed Decision 2**: Subtitle estimate hierarchy to never obscure exact token quantities.
- **Confirmed Decision 3**: 60-second periodic polling with clear staleness indicator and manual refresh button.
- **Persistence Strategy**: Dual persistence — instant `localStorage` caching with cross-device Firestore synchronization when an active wallet session is detected.

---

## 1. Overview & Core Concept

### What It Does
Cambio is an editorial financial interface for the Mezo network. While MUSD is the primary settlement medium, users operate in varied international fiat economies (e.g., Nigerian Naira, Euros, British Pounds, Ghanaian Cedis, Kenyan Shillings, South African Rand). 

The **Preferred Currency** feature introduces:
1. An Apple-style Settings row and searchable modal for selecting preferred fiat currencies.
2. A shared FX rates service that converts real token market prices into the user's chosen fiat denomination.
3. Subtitle fiat estimates throughout **Overview (Balance Card)**, **Send Modal**, **Receive Modal**, **Swap View**, and **Activity View**.
4. Real-time rate status indicators (live status, last updated timestamp, loading spinners, and offline cache notice).

### Target Audience
Global crypto and fintech users transacting on Mezo who need immediate context on their purchasing power in their home currency without manual calculations.

### Key Value
- Zero guesswork on fiat value.
- Clear separation between executable token amounts and informational fiat estimates.
- Seamless persistence across browser visits and devices.

---

## 2. User Experience & Visual Design

### Key User Flows

#### Flow 1: Selecting Preferred Currency in Settings
1. User navigates to **Settings** tab.
2. Under a new **Regional & Currency** section, user sees a clean Apple-inspired row:
   - Currency icon inside a subtle square container.
   - Title: **"Preferred currency"**.
   - Subtitle: "Choose the fiat currency used to display estimated portfolio values."
   - Right side: Current selection badge (e.g., `🇺🇸 USD ($)`) with chevron indicator.
3. Clicking the row opens the **Currency Selection Modal**:
   - Clean, high-contrast modal with subtle border (`border-[#E2E2E0] dark:border-[#26262B]`).
   - Sticky search input to instantly filter by currency code, country name, or symbol.
   - List of 8 initial currencies with national/regional flags (`🇳🇬`, `🇺🇸`, `🇪🇺`, `🇬🇧`, `🇨🇦`, `🇬🇭`, `🇰🇪`, `🇿🇦`), full names, ISO codes, and symbols.
   - Checkmark next to the active currency.
4. User clicks a currency (e.g. `NGN - Nigerian Naira ₦`):
   - Active state animates smoothly.
   - Preference saves immediately to `localStorage` and syncs to Firestore if wallet is connected.
   - Modal closes, and all balances across the app immediately update to NGN estimates.

#### Flow 2: Live Rate Status & Manual Refresh
1. In Settings and next to balance displays, a quiet rate pill shows:
   - Green indicator when live (`Rates live · Updated 14s ago`).
   - Refresh button with spin animation on click.
   - Stale label if network is interrupted (`Cached · Updated 5m ago`).

#### Flow 3: Unified Balance Display Across Views
- **Balance Card (Overview)**: Primary `1,250.00 MUSD` with subtitle `≈ ₦1,925,000.00` (masked as `••••••••` when privacy mode is active).
- **Send Modal**: Under the token amount input field, real-time conversion updates dynamically as the user types (e.g., typing `50` shows `≈ ₦77,000.00`).
- **Receive Modal**: Shows the fiat estimate of the requested payment link amount.
- **Swap View**: Input and output token cards show fiat values under amounts, and the swap review modal displays exact token figures alongside fiat context.
- **Activity / Transaction Rows**: Each historical transfer displays its fiat equivalent at current rates.

### Visual Identity & Theme Tokens
- Follows Cambio's existing monochrome editorial aesthetic:
  - Surface: `#FFFFFF` (light), `#141416` (dark)
  - Subtle backgrounds: `#F0F0EE` (light), `#1A1A1D` (dark)
  - Borders: `#E2E2E0` (light), `#26262B` (dark)
  - Typography: `Inter` with tabular numerals (`tabular-nums`) and clean undotted zeros.
  - Zero-pill discipline: No candy badges; clean typography with subtle dot separators.

---

## 3. Key Product Decisions & Trade-Offs

### Rate Source Architecture
- **Decision**: Primary fetch from `https://open.er-api.com/v6/latest/USD`, fallback to Frankfurter ECB API (`https://api.frankfurter.app/latest?from=USD`) and Coinbase Exchange API.
- **Why**: Zero API key dependencies, instant client-side execution, high reliability, covers all requested African, European, and North American currencies.
- **Outage Safeguard**: Strict rule that if rates cannot be fetched and no cache exists, the UI renders `"Price unavailable"` instead of fabricating fake rates.

### Pricing Calculation Chain
$$\text{Fiat Estimate} = \text{Token Balance} \times \text{Token USD Price} \times \text{USD-to-Fiat FX Rate}$$
- For MUSD: USD price = $1.00 (from Mezo Oracle).
- For BTC: USD price = Live BTC/USD rate from `liveRatesService.ts`.
- For USDC: USD price = Live USDC/USD rate.
- Locale-aware formatting: NGN uses `₦`, EUR uses `€`, GBP uses `£`, CAD uses `C$`, GHS uses `GH₵`, KES uses `KSh`, ZAR uses `R`, USD uses `$`.

---

## 4. Technical Architecture & Component Hierarchy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CurrencyContext & Provider                      │
│  - preferredCurrency: 'USD' | 'EUR' | 'NGN' | 'GBP' | ...              │
│  - fxRates: Record<string, number> (USD base)                          │
│  - rateStatus: 'idle' | 'loading' | 'live' | 'stale' | 'error'         │
│  - lastUpdated: number | null                                          │
│  - refreshRates(): Promise<void>                                       │
│  - formatFiatEstimate(tokenAmount, tokenSymbol): string                │
│  - selectCurrency(currencyCode): void                                  │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
                   ▼                                 ▼
┌────────────────────────────────────┐ ┌─────────────────────────────────┐
│        Storage & Persistence       │ │          Network Fetcher        │
│  - localStorage ('cambio_currency')│ │  - open.er-api.com (Primary)    │
│  - Firestore (users/{address})     │ │  - api.frankfurter.app (Backup) │
└────────────────────────────────────┘ └─────────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Subscribed Components & Views                    │
│  ├─ SettingsView (Preferred Currency Row & CurrencySelectionModal)     │
│  ├─ BalanceCard (Subtitle fiat estimate under hero balance)            │
│  ├─ SendModal (Dynamic fiat conversion under amount input)             │
│  ├─ ReceiveModal (Fiat conversion for request amounts)                 │
│  ├─ SwapView & SwapReviewModal (Input/Output fiat values)              │
│  └─ TransactionRow & ActivityView (Historical fiat equivalent)         │
└────────────────────────────────────────────────────────────────────────┘
```

### Supported Currencies Specification

| Code | Name | Symbol | Flag | Locale Format |
|---|---|---|---|---|
| **USD** | US Dollar | `$` | 🇺🇸 | `en-US` |
| **NGN** | Nigerian Naira | `₦` | 🇳🇬 | `en-NG` |
| **EUR** | Euro | `€` | 🇪🇺 | `de-DE` / `fr-FR` |
| **GBP** | British Pound | `£` | 🇬🇧 | `en-GB` |
| **CAD** | Canadian Dollar | `C$` | 🇨🇦 | `en-CA` |
| **GHS** | Ghanaian Cedi | `GH₵` | 🇬🇭 | `en-GH` |
| **KES** | Kenyan Shilling | `KSh` | 🇰🇪 | `en-KE` |
| **ZAR** | South African Rand | `R` | 🇿🇦 | `en-ZA` |

---

## 5. Implementation Steps (Planned for Execution Phase)

1. **FX & Currency Service (`src/services/fxRatesService.ts`)**:
   - Define supported currencies array and metadata.
   - Implement resilient multi-tier fetch with timeout and caching.
   - Implement formatting utility with currency symbols and two-decimal precision.
2. **Currency Context (`src/context/CurrencyContext.tsx`)**:
   - Global React context providing `preferredCurrency`, `fxRates`, `lastUpdated`, `status`, `setCurrency`, and `formatFiatEstimate`.
   - Auto-refresh timer (60s) with visibility awareness (cleans up when tab inactive).
   - Sync with Firestore when wallet address is present.
3. **Currency Selection Modal (`src/components/CurrencyModal.tsx`)**:
   - Searchable filter by name, code, and symbol.
   - Polished Apple-inspired design matching existing modal standards (`SendModal`, `ReceiveModal`).
4. **Settings Page Integration (`src/components/SettingsView.tsx`)**:
   - Add new "Preferences & Currency" section with currency selector row and live rate status pill.
5. **App-Wide Balance Updates**:
   - Integrate `formatFiatEstimate` into `BalanceCard`, `SendModal`, `ReceiveModal`, `SwapView`, `SwapReviewModal`, and `TransactionRow`.
6. **Verification & Testing**:
   - Test offline cache resilience and loading states.
   - Verify zero layout shift and undotted `0` formatting across all currencies.
   - Run `lint_applet` and `compile_applet`.
