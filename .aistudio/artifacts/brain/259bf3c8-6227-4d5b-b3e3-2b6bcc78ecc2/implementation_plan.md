# Cambio — Unique Username System

A secure, non-custodial alias registry that maps unique Cambio usernames (e.g., `@jomi`) to connected Mezo wallet addresses, enabling frictionless payments, intuitive receipts, and seamless cross-device identity without custody or transaction fees.

## User Review & Critical Decisions

> [!IMPORTANT]
> The architectural direction has been aligned with your preferences:
> - **Database & Registry**: Cloud Firestore provides global uniqueness guarantees, atomic reservation transactions, and real-time cross-device synchronization.
> - **Onboarding Flow**: An editorial modal dialog appears immediately when an unregistered wallet connects, prompting the user to claim their `@username`.
> - **Wallet Ownership Verification**: Uses off-chain EIP-191 message signing (`personal_sign`) to cryptographically prove wallet ownership prior to reserving or changing a username, requiring zero gas and zero on-chain transaction fees.

- **Confirmed Decision 1 (Storage Engine)**: Cloud Firestore dual-collection architecture (`/usernames/{normalizedName}` and `/wallets/{walletAddress}`) guaranteeing $O(1)$ bidirectional lookup and atomic uniqueness.
- **Confirmed Decision 2 (Registration Timing)**: Automatic prompt upon wallet connection with dismissible escape hatch, plus accessible entry points in Receive, Send, and Settings.
- **Confirmed Decision 3 (Cryptographic Auth)**: Standard off-chain signature payload (`"Register Cambio alias @<name> for wallet <address>"`), preventing unauthorized registry writes or impersonation.

---

## 1. Overview & Core Concept

### What It Does
Cambio usernames act as trusted, human-readable aliases for complex EVM hex addresses on the Mezo network. Users can send MUSD directly to `@jomi`, receive funds by sharing `@jomi`, and generate branded payment requests without exposing raw hex addresses as their primary identity.

### Target Audience & Persona
- **Mezo Ecosystem Users**: Individuals making frequent peer-to-peer transfers who want quick, error-free counterparty entry.
- **Merchants & Creators**: Users generating payment requests and invoices who want clean branding on receipt pages.

### Key Value
- **Zero Friction**: Replaces 42-character hex strings with memorably short `@aliases`.
- **Accidental Transfer Prevention**: Resolves and visibly displays the verified destination address and recipient identity before any funds are moved.
- **Strict Anti-Collision**: Enforces case-insensitive, globally unique reservation so `@Jomi` and `@jomi` can never belong to separate parties.

---

## 2. User Experience & Visual Design

### Key User Flows

```
[Connect Wallet via AppKit]
             │
             ▼
[Check Registry for Wallet Address]
      ├── Found ──────────────► [Load @username into Header & App State]
      │
      └── Not Found ──────────► [Show "Choose your username" Modal]
                                       │
                                       ├─ Type @alias (Live 3-20 char validation)
                                       ├─ Real-time Availability Check ("Username available")
                                       ├─ Click "Create username"
                                       ├─ Wallet Signs Verification Message (0 gas)
                                       ├─ Atomic Firestore Reservation
                                       └─ Success Toast: "Username created"
```

1. **Onboarding / Claim Flow**:
   - Upon wallet connection, if no username is associated with the address, a minimalist modal presents:
     - Title: **Choose your username**
     - Subtitle: *"Create a username to send and receive MUSD easily."*
     - Input field with `@` affix: `e.g. @jomi` (auto-strips duplicate `@` symbols).
     - Live inline status badge: *"Checking availability..."* → *"Username available"* or *"Username already taken"*.
     - Action: Primary black button **Create username** (triggers wallet signature, then reserves).
     - Secondary subtle action: *"I'll do this later"* (dismisses modal, accessible anytime).

2. **Send Flow with Username Resolution**:
   - In the **Send Modal**, the recipient field accepts either a 42-char hex address or `@username`.
   - As the user types `@jomi`:
     - Resolves the canonical username against the registry.
     - Displays the verified resolution card:
       ```
       Sending to @jomi
       0x71C...92FA  · Verified Mezo Address
       ```
     - Validates that the user cannot send to their own alias.
     - If not found: shows clear message *"Username not found"*.

3. **Receive Flow**:
   - The **Receive Modal** showcases the user's primary identity:
     - Prominent `@username` display with a dedicated **Copy username** button.
     - Shortened wallet address with a **Copy address** button.
     - Instructional copy: *"Share your username to receive MUSD."*
     - QR code encoding the address / alias.
     - If the user has not claimed an alias yet: shows a clean prompt with a **Create username** button.

4. **Request MUSD Flow**:
   - Payment requests automatically incorporate the creator's username:
     - In the generation form: *"Requesting as @jomi"*.
     - On the shared payment link page (`/pay?req=...`):
       - Header: *"@jomi is requesting 25.00 MUSD"*
       - Retains the underlying verified receiving wallet address for cryptographic settlement.

5. **Settings & Profile Management**:
   - Dedicated **Username Profile** card in Settings:
     - Displays active username, registration timestamp, and linked wallet address.
     - **Change username** button: checks new alias availability, verifies new ownership signature, transfers the alias atomically, and frees the previous name.

### Visual Identity & Theme
- **Monochrome Editorial Language**: Pure whites, warm off-white `#F5F5F3`, deep charcoal `#111111`, and razor-thin `#E2E2E0` borders.
- **Zero-Pill Discipline**: Metadata is formatted as quiet inline typography with typographic separators (`·`).
- **Input Design**: Crisp monospace typography for the `@` handle, high-contrast borders, instant validation feedback without harsh neon colors.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual-Key Firestore Storage Architecture**
  - *Chosen Approach*: Two collections:
    1. `/usernames/{canonical_name}`: Document ID is the lowercased username. Prevents race conditions via Firestore `create()` rules (cannot overwrite an existing document ID).
    2. `/wallets/{wallet_address}`: Document ID is the lowercased wallet address. Allows immediate $O(1)$ lookup whenever any wallet connects.
  - *Why*: Eliminates expensive full-collection scans and guarantees atomic uniqueness across concurrent registration attempts without server race hazards.
  - *Alternatives Considered*: Single collection with query `where('username', '==', ...)` rejected because Firestore queries cannot enforce document ID collision atomicity during simultaneous writes.

- **Decision 2: Off-Chain EIP-191 Signature Verification**
  - *Chosen Approach*: The user's wallet signs a human-readable text challenge:
    `"Sign to claim Cambio alias @jomi for wallet 0x123... on Mezo"`.
  - *Why*: Authenticates that the client actually controls the private key of the connected address, preventing malicious actors from registering aliases on behalf of arbitrary addresses. Zero gas, zero on-chain cost.

- **Decision 3: Case-Insensitive Normalization & Strict Character Rules**
  - *Chosen Approach*: Enforce `^[a-z0-9_]{3,20}$`. Strip leading `@`, convert all characters to lowercase prior to database read/write.
  - *Why*: Prevents homograph attacks, spoofing, and duplicate registrations such as `@Jomi` vs `@jomi`.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Cambio Client (React + Vite)                    │
│                                                                        │
│   ┌────────────────────┐     ┌──────────────────┐     ┌──────────────┐ │
│   │ UsernameModal      │     │ SendModal        │     │ ReceiveModal │ │
│   │ Claim & Change UI  │     │ Alias Resolution │     │ Copy Alias   │ │
│   └─────────┬──────────┘     └────────┬─────────┘     └──────┬───────┘ │
│             │                         │                      │         │
│             ▼                         ▼                      ▼         │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │               usernameService (Hooks & Context)                  │ │
│   │  - checkAvailability()      - resolveUsername()                  │ │
│   │  - registerUsername()       - changeUsername()                   │ │
│   │  - verifyWalletSignature()  - getUsernameForWallet()             │ │
│   └───────────────────────────────────┬──────────────────────────────┘ │
│                                       │ (EIP-191 Personal Sign)        │
│                                       ▼                                │
│                        ┌──────────────────────────────┐                │
│                        │ Reown AppKit / WalletConnect │                │
│                        └──────────────┬───────────────┘                │
└───────────────────────────────────────┼────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Google Cloud Firestore                          │
│                                                                        │
│   ┌─────────────────────────────────┐ ┌──────────────────────────────┐ │
│   │ /usernames/{canonicalName}      │ │ /wallets/{walletAddress}     │ │
│   │ {                               │ │ {                            │ │
│   │   username: "jomi",             │ │   username: "jomi",          │ │
│   │   ownerAddress: "0x71c...fa",   │ │   walletAddress: "0x71c...", │ │
│   │   createdAt: timestamp,         │ │   updatedAt: timestamp       │ │
│   │   signature: "0xabc..."         │ │ }                            │ │
│   │ }                               │ └──────────────────────────────┘ │
│   └─────────────────────────────────┘                                  │
│                                                                        │
│   firestore.rules: Default deny, strict schema validation,             │
│   owner-only update, atomic create-only on /usernames/{id}             │
└────────────────────────────────────────────────────────────────────────┘
```

### Firestore Data Model

1. **Collection `/usernames/{canonicalName}`**:
   - `id`: Lowercase username (3–20 alphanumeric + underscore characters, no `@`).
   - `username`: Formatted display username (e.g., `"jomi"`).
   - `ownerAddress`: Lowercase 42-char EVM address.
   - `createdAt`: Server timestamp.
   - `signature`: EIP-191 signature string verifying intent.

2. **Collection `/wallets/{walletAddress}`**:
   - `id`: Lowercase 42-char EVM address.
   - `username`: Associated canonical username.
   - `updatedAt`: Server timestamp.

### Interactive State Transitions

| Component | Trigger | Action / Transition |
|---|---|---|
| **App.tsx** | Wallet connects & status becomes `'connected'` | Query `/wallets/{address}`. If empty, open `<UsernameModal mode="create" />`. |
| **UsernameModal** | Input changes (`@handle`) | Debounce 300ms → Validate regex → Check `/usernames/{handle}` → Show available/taken state. |
| **UsernameModal** | Click **Create username** | Request signature via provider `personal_sign` → Run Firestore batch write to `/usernames/{name}` & `/wallets/{address}` → Toast "Username created". |
| **SendModal** | User types `@handle` in Recipient | Debounce 250ms → Fetch `/usernames/{handle}` → Render recipient confirmation card with resolved address. |
| **ReceiveModal** | Open dialog | Display `@username` prominently with 1-click clipboard copy. If no username, provide **Create username** button. |
| **SettingsView** | Click **Change username** | Open `<UsernameModal mode="change" currentUsername={user} />` with atomic migration. |

---

## 5. Implementation Phases & Milestones

1. **Firebase Provisioning & Security Schema**:
   - Initialize Firestore via `show_aistudio_ui` and `ProvisionFirebase` RPC.
   - Author `firebase-blueprint.json` and hardened `firestore.rules` enforcing atomic reservation and schema limits.
2. **Core Username Service (`src/services/usernameService.ts`)**:
   - Validation math, canonical normalization, debounced availability lookup, off-chain EIP-191 signature generation, and atomic batch writes.
3. **Username Onboarding Modal (`src/components/UsernameModal.tsx`)**:
   - Apple-inspired editorial dialog with live status feedback, error handling, and wallet signing states.
4. **Integration with App Flow & Components**:
   - **Header & Sidebar**: Display `@username` alongside address badge.
   - **SendModal**: Dual alias/address resolver with verified destination preview.
   - **ReceiveModal**: Dedicated username copy badge and receive instructions.
   - **RequestView & PaymentRequestPage**: Personalize payment requests with `@username`.
   - **SettingsView**: Profile management card with copy and change options.
5. **Verification & Testing**:
   - Compile and lint validation, end-to-end testing of alias resolution and collision handling.
