# Lahza setup — the human steps

> **Nothing in this document has been performed.** No Lahza account was created, no
> credentials exist in this repository, and **no real or sandbox Lahza API call was
> ever made from this branch.** The adapter was written against the published
> documentation. Everything below is a step *you* must carry out, and the first
> sandbox charge is the point at which the integration is genuinely proven rather
> than merely implemented.

The adapter is `backend/functions/src/modules/payments/lahza-provider.ts`. It stays
completely inert until `ONLINE_PAYMENTS_ENABLED=true`.

---

## What the code already does

| Step | Where |
|---|---|
| Create a checkout (`POST /transaction/initialize`) | `LahzaProvider.createCharge` |
| Verify the webhook signature and map the event | `LahzaProvider.parseAndVerifyWebhook` |
| Refund (`POST /refund`) | `LahzaProvider.refund` |
| Choose the adapter, fail safe without keys | `getPaymentProvider` |
| Return the checkout URL to the app | `startOnlinePayment` callable |

Money units: Lahza's ILS amounts are in **agora**, which is the same minor unit the
payments core already uses. **No conversion is applied in either direction**, so
there is no rounding step that could drift.

---

## Part 1 — Test mode

### 1. Create the account and get TEST keys

1. Sign up at <https://lahza.io> and complete merchant onboarding.
2. In the dashboard, open **Settings → API Keys**.
3. Copy the **test** secret and public keys.

> The secret key both signs API calls and verifies webhook signatures. Treat it as a
> production credential from day one — anyone holding it can forge a webhook that
> marks trips paid.

### 2. Configure the backend

Local development (`backend/functions/.env`, which is gitignored):

```
ONLINE_PAYMENTS_ENABLED=true
PAYMENT_PROVIDER=lahza
LAHZA_SECRET_KEY=<your TEST secret key>
LAHZA_PUBLIC_KEY=<your TEST public key>
```

For anything deployed, use Secret Manager rather than a `.env` file:

```bash
firebase functions:secrets:set LAHZA_SECRET_KEY
```

**Never commit a key.** `.env` is gitignored; `.env.example` holds placeholders only.

If the flag is on and `LAHZA_SECRET_KEY` is missing, the code **refuses to start a
payment and throws**. That is deliberate: the alternative is falling back to the
StubProvider, which marks trips paid without taking any money.

### 3. Register the webhook URL

In the dashboard, set the webhook to your deployed function:

```
https://<region>-<project>.cloudfunctions.net/paymentWebhook
```

Locally, the emulator's function is not publicly reachable, so use a tunnel
(`ngrok http 5001`) and register the forwarding URL.

Lahza retries a non-200 every 3 minutes for the first 4 attempts, then hourly for up
to 72 hours. The endpoint is idempotent, so retries are safe.

### 4. Run one sandbox charge end to end

1. Complete a trip so a payment document exists at `payments/payment_<tripId>` in
   state `pending`.
2. Call `startOnlinePayment` with that `tripId`. It returns `clientActionUrl`
   (Lahza's hosted checkout) and `providerChargeId`, and moves the payment to
   `awaiting_payment`.
3. Open that URL and pay with a documented test card:
   - **Success:** `4111 1111 1111 1111`, CVV `004`, expiry `03/30`
   - **Insufficient funds:** `4000 0000 0000 9995`
   - **Do not honour:** `4000 0000 0000 9979`
4. **Verify the trip reaches `paid` via the webhook, not via the app.** Check that
   `payments/payment_<tripId>` has `status: "paid"`, a `paidAt`, `provider: "lahza"`
   and the event id recorded in `processedEventIds`.
5. Re-send the same webhook from the dashboard. The payment must stay `paid` and
   `paidAt` must **not** move — that is the idempotency guard doing its job.
6. Refund from the dashboard and confirm the `refund.processed` webhook moves the
   payment to `refunded`.

### 5. The mobile checkout step — NOT BUILT

Opening the checkout in the app is UI that needs a real device, so it is out of
scope here and **is not verified**. What remains:

- Open `clientActionUrl` in an in-app browser / WebView
  (<https://docs.lahza.io/guide/checkout-in-a-mobile-webview>).
- Close it on redirect and poll the payment document.
- **The app must never treat the redirect as proof of payment.** It is a UI event,
  not a money event. `paid` only ever arrives over the webhook.

---

## Part 2 — Going live

1. Complete Lahza's [go-live checklist](https://docs.lahza.io/guide/go-live-checklist)
   — valid site URL, SSL, privacy and refund policies, contact details, receipts.
2. Swap the test keys for **live** keys in Secret Manager and redeploy.
3. Re-register the webhook against the production URL. **Test and live webhooks are
   configured separately** — this is the step most easily forgotten, and missing it
   means live payments succeed at Lahza while every trip stays unpaid in the app.
4. Run one small **real** charge and refund it.
5. Only then set `ONLINE_PAYMENTS_ENABLED=true` in production.

### Reconciliation — built, but not yet connected

The comparison logic now exists and is tested:

- `backend/functions/src/modules/reconciliation/settlement-mismatch.ts` — the
  mismatch taxonomy: paid at the provider but pending internally (a lost webhook),
  paid internally but absent from the report, amount and currency mismatches,
  refund disagreements, duplicated provider references, and orphan settlement rows.
- `managerReconcileSettlement` — an on-demand run for a global manager with
  `manage_payments`.
- `reconcileSettlementDaily` — scheduled 03:00 Asia/Hebron; raises the
  `settlement_mismatch` ops alert and writes an auditable run record.

**What is still missing is the provider call itself.** `fetchSettlement` is an
OPTIONAL method on `PaymentProvider`, and `LahzaProvider` does not implement it,
because the real settlement report format cannot be known without live credentials.
Writing a parser against a guessed format — and then scheduling it to raise
financial alerts — would be a control that looks real and proves nothing.

While it is unimplemented, both entry points report
`providerAvailable: false` with a reason and null totals. This is deliberate: an
empty report reading "0 mismatches" would tell an operator that the books agree,
when in fact nothing was compared. **"We checked and found nothing" and "we could
not check" must never look alike.**

**To finish it**, once test credentials exist:

1. Obtain one real settlement report from the Lahza dashboard and record its actual
   shape — do not infer it from the transactions API.
2. Implement `fetchSettlement(fromIso, toIso): Promise<SettlementRow[]>` on
   `LahzaProvider`, normalising status to `paid | refunded | failed` and amounts to
   agorot (minor units).
3. Add fixtures from that real report to
   `backend/functions/scripts/unit/settlement-mismatch.test.mjs`.
4. Run `managerReconcileSettlement` manually over a known-good day before trusting
   the schedule.
---

## Open questions

1. **Passenger email.** Lahza requires an `email` on initialize, but a
   phone-registered passenger may not have one. The adapter currently sends a
   placeholder at the reserved `.invalid` domain, which means **Lahza cannot email a
   receipt**. Decide: collect an email at checkout, or confirm with Lahza that a
   placeholder is acceptable. Marked as a `TODO` in the adapter.
2. **Who bears the processing fee** — passenger, driver, or platform? This changes
   the fare calculation, not just the payment call.
3. **Refund policy** — who may refund, up to when, and does a cancelled trip
   auto-refund? There is no refund UI or manager callable yet.
4. **Are drivers paid out through the platform**, or do they settle separately? A
   marketplace/split arrangement is materially more Lahza paperwork.

---

## Sources

Read September 2026. If Lahza changes its API, these are the pages to re-check.

- <https://api-docs.lahza.io/api-endpoints/transactions> — initialize
- <https://api-docs.lahza.io/api-endpoints/refunds> — refund
- <https://docs.lahza.io/payments/webhooks> — signature scheme and events
- <https://docs.lahza.io/payments/verify-payments> — verify
- <https://docs.lahza.io/payments/test-payments> — test cards
- <https://docs.lahza.io/guide/checkout-in-a-mobile-webview> — mobile checkout
- <https://docs.lahza.io/guide/go-live-checklist> — go-live
