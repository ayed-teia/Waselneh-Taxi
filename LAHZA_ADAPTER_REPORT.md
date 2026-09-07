# Lahza Payment Adapter — Report

**Branch:** `feat/lahza-payment-adapter` (off `main` @ `bf3b49d`)
**Flag:** `ONLINE_PAYMENTS_ENABLED` — **still default OFF, unchanged**
**⚠️ No real or sandbox Lahza API call was made from this branch.**

---

## What was built

A concrete `LahzaProvider` implementing the existing `PaymentProvider` interface from
PR #11. **The payments core was not redesigned** — the interface, the state machine
and `decidePaymentTransition` are untouched. The adapter plugs into them.

| Piece | File |
|---|---|
| `LahzaProvider` (createCharge / parseAndVerifyWebhook / refund) | `backend/functions/src/modules/payments/lahza-provider.ts` |
| Fail-safe provider selection | `payment-core.service.ts` → `getPaymentProvider` |
| Webhook misconfiguration handling | `api/http/paymentWebhook.http.ts` |
| Client init path + the documented client step | `api/callable/startOnlinePayment.callable.ts` |
| Env placeholders (no keys) | `backend/functions/.env.example` |
| Human setup steps | `docs/LAHZA_SETUP.md` |

### Written against the real documentation, not guesswork

Read September 2026:

| Fact | Source |
|---|---|
| Base `https://api.lahza.io`, `Authorization: Bearer <secret>` | api-docs.lahza.io |
| `POST /transaction/initialize` → `data.authorization_url`, `data.access_code`, `data.reference` | api-docs.lahza.io/api-endpoints/transactions |
| `POST /refund` `{transaction, amount?, currency?}` → queued, `status: "pending"` | api-docs.lahza.io/api-endpoints/refunds |
| Webhook: `x-lahza-signature`, **HMAC-SHA256 of the raw body, hex**, keyed with the secret | docs.lahza.io/payments/webhooks |
| Events: `charge.success`, `refund.processed/failed/pending/processing` | docs.lahza.io/payments/webhooks |
| ILS amounts are in **agora** (minor units) | api-docs.lahza.io |

**Money:** Lahza's ILS unit is agora — the same minor unit `CreateChargeInput.amountMinorUnits`
already uses. **No conversion in either direction**, so there is no rounding step to
drift. A test asserts the amount passes through unmultiplied.

### Two design decisions worth review

1. **The Lahza `reference` carries the trip identity.** Lahza lets the caller supply
   a reference and echoes it back on the webhook, so `payment-<tripId>` resolves a
   webhook to a trip deterministically — no lookup table, nothing trusted from a
   client. Lahza also rejects a duplicate reference, which is exactly what we want
   from a retried charge.
   *Constraint honoured:* Lahza documents the charset as `-`, `.`, `=` and
   alphanumerics. Our internal key is `payment_<tripId>` and **the underscore is not
   allowed**, so the wire format uses a hyphen. A test asserts the charset.

2. **In-flight refund events map to nothing.** `refund.pending` and
   `refund.processing` mean the money has *not* moved back yet; treating them as
   `refunded` would tell a passenger they had been repaid before they had been. And
   `refund.failed` maps to nothing rather than `failed` — a failed refund means the
   charge is *still paid*, so mapping it to `failed` would mark a paid trip unpaid.

---

## Fail-safe selection

With the flag ON, `lahza` is the **default** — so a deployment cannot land on the
stub by forgetting to set `PAYMENT_PROVIDER`.

- **No `LAHZA_SECRET_KEY` → throws.** It does **not** fall back to the StubProvider.
  The stub marks trips paid without taking any money, so a silent fallback in a
  would-be production path is the worst available failure mode.
- **`PAYMENT_PROVIDER=stub` is refused unless `FUNCTIONS_EMULATOR` is set**, so the
  stub cannot be selected in a deployed environment even deliberately.
- The webhook now catches a selection throw and returns **500** (our fault, Lahza
  should retry) rather than crashing with an unhandled rejection.

---

## Test evidence

| Check | Result |
|---|---|
| Typecheck (6 projects) | PASS |
| Lint | **0 errors**, 157 warnings — unchanged from baseline |
| Unit tests | **98/98** (was 64; **+34 Lahza**) |
| Emulator QA suites | **14/14**, all green |

Full log: `lahza-adapter.log`.

### The negative controls actually fail against broken code

Passing tests prove little on their own, so I sabotaged the compiled output and
confirmed the controls catch it:

**Sabotage 1 — removed the signature comparison** (making the webhook parse-first):

```
not ok 3 - NEGATIVE CONTROL: a tampered body with the original signature is REJECTED
```

**Sabotage 2 — made a missing key fall back to the StubProvider:**

```
not ok 2 - NEGATIVE CONTROL: flag ON with no Lahza key THROWS, never falls back to the stub
```

5 of 34 failed under sabotage; **34/34 pass with the sabotage reverted.** These are
real controls, not tautologies.

The tampering control specifically: the body is altered to a larger amount while
keeping the signature valid for the *original* body, and the test first asserts that
the original **does** verify — so it cannot pass merely because verification rejects
everything.

Other covered cases: wrong secret, unsigned, empty/short/overlong signature (the
length check must precede `timingSafeEqual`, which throws on a mismatch),
case-insensitive header, signed-but-non-JSON, unknown event names, a reference that
isn't ours, non-numeric amounts, `status:false` in an HTTP 200 envelope, and a queued
refund reported as **not** settled.

`createCharge` and `refund` are driven against a **stubbed global `fetch`** — that
verifies the request *we* build and how we read a documented response. It is a real
assertion about our code; it is **not** evidence about Lahza's.

---

## Flag and cash path

- `ONLINE_PAYMENTS_ENABLED` remains **OFF**. No flag value was changed anywhere.
- `confirmCashPayment` is **untouched** — the cash QA suite passes unchanged.
- `firestore.rules` unchanged; `payments/{id}` stays `allow write: if false`.
- The StubProvider and all its tests remain intact; the stub is still the default
  adapter under the emulator.
- **One existing assertion was updated, not weakened:** the QA suite previously
  asserted "flag on ⇒ a provider is returned". That is now correct only *with* a key,
  so it asserts both halves — throws without a key, selects `lahza` with one, and the
  stub still works under the emulator. Strictly more coverage than before.

---

## What could NOT be verified here

Read this as the limits of the evidence, not as a list of known-good things.

- **No Lahza account, no credentials, no API call — real or sandbox.** Every claim
  about Lahza's behaviour traces to its documentation. If the docs are wrong or
  stale, the adapter is wrong in the same way, and the first sandbox charge is what
  will reveal it.
- **The webhook has never received a real Lahza delivery.** Signature verification is
  proven against the *documented* scheme, using a known secret and a payload we
  construct.
- **Lahza's exact webhook JSON is not fully documented.** The docs list event names
  but no complete payload example. The adapter reads `event`, `data.reference` and
  `data.amount` — consistent with the verify-endpoint shape, but **unconfirmed against
  a live delivery**.
- **No event id in Lahza's payload**, so `eventId` is derived as
  `<event>:<reference>`. Stable across a retry of the same event, and distinct
  between charge and refund (both tested) — but if Lahza redelivers a *different*
  charge event under one reference, the core's replay guard would treat it as a
  duplicate.
- **No UI.** The in-app checkout screen is not built and not verified; it needs a
  device. The callable returns the checkout URL and reference only.
- **Nothing deployed**, no flag enabled, no production write, no merge.
- **Test/live key prefixes are not documented**, so the code cannot warn you that a
  live key is in a test environment.
- **Passenger email is a placeholder** at the reserved `.invalid` domain, so Lahza
  cannot email a receipt. Flagged as a `TODO` in the adapter and an open question in
  the setup doc — it is a product decision.
- **No reconciliation** against Lahza's settlement report (format unknown), and **no
  refund UI or manager callable**.

**This code is not bug-free and I have not proven it correct.** It is typechecked,
linted, and covered by 98 unit tests and 14 emulator suites with negative controls
that demonstrably fail against broken implementations. That is evidence, not a
guarantee — and no amount of it substitutes for the first sandbox charge.
