# Online Payments Core — Report

**Branch:** `feat/online-payments-core` (off `main` @ `526f22f`)
**Flag:** `ONLINE_PAYMENTS_ENABLED` — **default OFF**, verified OFF
**No PSP was chosen, and no PSP SDK was added.**

---

## What this is

A provider-agnostic online-payments core: the state machine, the adapter interface,
the webhook and the idempotency guarantees — everything that does *not* depend on
which processor you eventually pick. Plus a deterministic stub adapter so the whole
thing is genuinely testable today rather than merely reviewable.

**With the flag off, nothing changes.** No charge is created, the webhook answers
404, and cash remains the only route to `paid`.

## Why no processor was picked

Because that is not an engineering decision. The binding constraint is **settlement
in ILS to West Bank accounts** — Stripe does not support Palestinian entities, and
the Israeli/regional processors differ in KYC, settlement terms and fees. Choosing
one for you would be choosing your banking relationship. The adapter checklist is in
`docs/REMAINING_PLAN.md` §2.

---

## What was built

| Piece | File |
|---|---|
| Payment state machine | `backend/functions/src/modules/payments/payment-state-machine.ts` |
| `PaymentProvider` interface + `StubProvider` | `.../payment-provider.ts` |
| Transactional idempotent advance | `.../payment-core.service.ts` |
| Webhook (`onRequest`) | `backend/functions/src/api/http/paymentWebhook.http.ts` |
| Charge entry point (`onCall`) | `backend/functions/src/api/callable/startOnlinePayment.callable.ts` |
| Flag | `packages/shared/src/config/auth-flags.config.ts` |
| States | `packages/shared/src/enums/payment-status.enum.ts` (extended additively) |

### The state machine

```
pending ──► awaiting_payment ──► paid ──► refunded
   │               │  │           │
   │               │  └► failed   └► (terminal)
   │               └────► cancelled
   ├► paid      (CASH — the driver confirms collection)
   ├► failed
   └► cancelled
```

Two decisions worth flagging for review:

- **`pending → paid` is still legal.** That is exactly what `confirmCashPayment`
  does, and it predates this module. Removing it would have broken the cash path.
  Cash never enters `awaiting_payment`.
- **`paid` is not terminal**, because a refund has to be representable.
  `paid → refunded` is its only exit, and `refunded` *is* terminal — you cannot
  un-refund; you would create a new charge.

### Idempotency

`decidePaymentTransition` returns **three** outcomes, not two: *apply*,
*alreadyApplied*, *illegal*. Collapsing the middle one into either of the others is
precisely how double-charge bugs happen — treat a replay as an error and the
processor retries forever; treat it as legal and you apply it twice.

Two deliberately overlapping guards, both **inside** the Firestore transaction:

1. a processed-event-id set, which catches a byte-identical replay;
2. the state machine's `from === to` check, which catches a re-delivery carrying a
   different event id.

A check outside the transaction is a narrower race, not the absence of one.

### Security posture

- **The client is never the source of truth.** There is no "the app says it paid"
  entry point. `startOnlinePayment` can only reach `awaiting_payment`; `paid` arrives
  over the webhook, from the provider.
- **The signature is the authentication.** The webhook has no Firebase identity to
  lean on, so `parseAndVerifyWebhook` verifies *before* anything is interpreted, and
  returns `null` for anything unverifiable.
- **Raw bytes are verified**, not a re-serialised body — re-serialising changes key
  order and would break against a real processor.
- `payments/{id}` remains `allow write: if false`. **`firestore.rules` is unchanged.**
- No card data is accepted anywhere; `createCharge` returns a URL for the provider's
  own UI. That is what keeps this out of PCI scope.

---

## Verification

| Check | Result |
|---|---|
| Typecheck (6 projects) | PASS |
| Lint | **0 errors**, 157 warnings — identical to baseline |
| Unit tests | **64/64** (was 35; +29 new) |
| Emulator QA suites | **14/14** (was 13; +1 new, 10/10 within it) |

Full log: `payments-core.log`.

### Negative controls

Positive results alone would not be evidence, so each behaviour has a control that
fails without the fix:

- **Unguarded idempotency double-applies** — `payments.test.mjs` models the naive
  "is the target reachable or equal?" check and asserts it writes **twice** for one
  duplicated event, where the real function writes once.
- **Replay does not re-stamp `paidAt`** — asserted by timestamp equality against
  Firestore, not by return value. A second stamp is a second payment in the ledger.
- **Re-delivery with a new event id** still does not re-apply — proves guard (2)
  independently of guard (1).
- **Tampered body with a valid signature for the original** is rejected.
- **Unsigned payload** is rejected — otherwise the endpoint is an open "mark paid" API.
- **Signed payload with a status we do not accept** (`pending`, `hacked`, …) is rejected.
- **Terminal state rejects a later `paid` event**, and state is verified unchanged.
- **Unknown payment creates no document** — a webhook alone cannot conjure a payment.
- **Flag OFF**: the deployed webhook returns 404 for a *correctly signed* event, and
  `getPaymentProvider` returns `null` for absent/`"false"`/`"yes"`.

### Where the tests run, and why

The flag-off cases run against the **real deployed webhook** in the functions
emulator — which is exactly the state that must keep being true. The flag-on cases
drive the compiled service directly against the **same Firestore emulator**, rather
than enabling a payments flag in a shared emulator (which the mandate forbids, and
which would have weakened the flag-off evidence). The transaction, the guards and the
state machine exercised are the real ones; only the HTTP hop is skipped, and that hop
is covered separately by the 404 case and the signature unit tests.

---

## Limits — read this before enabling anything

- **This is not bug-free, and I have not proven it correct.** It is typechecked,
  linted, and covered by 64 unit tests and 14 emulator suites with negative controls.
  That is evidence, not a guarantee.
- **Enabling the flag today would mark trips paid for free**, because the only
  adapter is the stub. The flag must not be turned on before a real adapter exists.
- **The stub's "secret" is in the source.** It is shaped like real verification and
  does reject tampering, but it is not a secret. Emulator only.
- **No reconciliation against a processor's settlement report** — that cannot be
  written without knowing the processor's report format.
- **No refund callable or UI.** `paid → refunded` is representable and tested at the
  service level; who may trigger it, and until when, is decision #4 in
  `docs/REMAINING_PLAN.md` §2.
- **`amountMinorUnits` is computed as `round(amount * 100)`** from the existing
  `amount` field. If fares ever carry sub-agora precision this needs revisiting —
  I did not change any fare maths, since that is a pricing decision.
- The webhook returns **200 for duplicates and for illegal transitions**, by design:
  neither is the processor's fault and a retry cannot fix either. Both are logged.

## Not touched

`confirmCashPayment.callable.ts`, `firestore.rules`, all fare/pricing logic, every
other feature flag (all still OFF), and the two working-tree `MapView.tsx` files.
