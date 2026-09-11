# Auth Rollout — Phone/OTP and Manager Login

> **Status: SCAFFOLDED, NOT ENABLED.** The feature flag
> `EXPO_PUBLIC_ENABLE_PHONE_AUTH` defaults to **false**, the existing dev sign-in is
> untouched, and no console setting has been changed. Nothing here has been tested
> against a real phone, a real SMS, or a real device — that is exactly why it is off.
>
> Everything in this document is either a Firebase console action, a decision only you
> can make, or server work that must land **before** the flag is flipped.

---

## Why this is not simply "turned on"

Enabling phone auth without the pieces below is actively dangerous:

- **SMS is billed per message and is a well-known abuse target.** An unprotected
  `signInWithPhoneNumber` endpoint is a way for someone to spend your money and get
  your number range flagged by carriers. Rate limiting is not optional.
- **Firebase's own per-project SMS quotas are low by default**, so a launch day
  without raised quotas fails silently for real users.
- **Store review needs test numbers**, or Apple/Google reviewers cannot log in and the
  build is rejected.
- Once it is on, **the dev login must be gone in production builds**, or you have
  shipped exactly the bypass R2 was about.

---

## 1. Firebase console steps (a human with project access)

Project: `waselneh-prod-414e2`.

1. **Authentication → Sign-in method → Phone → Enable.**
2. **Authentication → Settings → SMS region policy.** Allow only the countries you
   actually serve. Leaving it open to all regions is the single most common way to get
   billed for SMS-pumping fraud. For the West Bank you want Palestine (`+970`) and
   Israel (`+972`); confirm which of these your users' numbers actually use — see
   Decisions below.
3. **App Check** — register both mobile apps:
   - Android: Play Integrity
   - iOS: App Attest (or DeviceCheck for older devices)
   Start in **monitoring mode**, watch the metrics for at least a few days of real
   traffic, and only then **enforce** for Auth and Firestore. Enforcing immediately
   locks out any client that isn't attesting yet, including your own test builds.
4. **reCAPTCHA** — web/manager only. Phone auth on the web requires a reCAPTCHA
   verifier; the native SDKs use silent APNs / Play Integrity instead.
5. **Android SHA certificate fingerprints** — Project settings → your Android app →
   add the **SHA-1 and SHA-256** for every keystore that signs a build: debug, internal
   test, and the Play App Signing key (Play Console → Setup → App signing). Missing the
   Play App Signing SHA is why phone auth typically works in testing and fails in
   production. Re-download `google-services.json` afterwards.
6. **iOS APNs** — upload an APNs auth key (.p8) under Cloud Messaging. Phone auth on
   iOS uses a silent push to verify the device; without it every sign-in falls back to
   reCAPTCHA in a web view, which reviewers often flag.
7. **Raise the SMS quota** if the default is below your expected launch volume, and set
   a **billing budget alert** so runaway sends are noticed within hours, not on the
   invoice.
8. **Test phone numbers** — Authentication → Sign-in method → Phone → "Phone numbers
   for testing". Add at least one number/code pair for store review and for automated
   testing. These never send a real SMS.

---

## 2. Server-side work that must land FIRST

**This has now SHIPPED** (`modules/auth/otp-rate-limit.ts`, `requestOtpPermission`,
`reportOtpResult`). Client-side limits are not limits, so the counters live in
Firestore and are enforced server-side. What follows is the contract it implements,
kept here because the rollout still depends on the console steps above.

One correction worth recording: `reportOtpResult` originally accepted
`outcome: 'success'` from an UNAUTHENTICATED caller, and a success clears the
lockout. Anyone could therefore erase any number's lockout on demand, which made the
throttle decorative against a targeted brute force. A success report now requires a
Firebase Auth token whose reserved `phone_number` claim matches the number being
cleared. A failure report stays unauthenticated on purpose - it only ever tightens,
and requiring a credential there would let an attacker avoid lockout by simply never
reporting.

Add a callable (say `requestOtp`) that owns the send, so the app never calls
`signInWithPhoneNumber` against an unmetered endpoint:

- Enforce `OTP_LIMITS` from `packages/shared/src/config/auth-flags.config.ts`:
  5 sends per number per hour, 10 per device/IP per hour, 5 wrong attempts then a
  15-minute lockout, 60s resend cooldown.
- Keep counters in Firestore keyed by **both** phone number and device/install id, with
  a TTL. Keying on the number alone lets one device cycle numbers; keying on the device
  alone lets a number be targeted from many devices.
- Normalize numbers to E.164 **before** counting, or `0599...`, `+972599...` and
  `972599...` are three separate buckets for one person.
- Log every send and failed verify with the number **hashed, not in plaintext** —
  phone numbers are exactly the PII this branch just moved out of `drivers/{id}`.
- Reject numbers outside the allowed country prefixes server-side too, not only in the
  console policy.

Then, in the same release:

- **Remove the dev sign-in path from production builds.** `devCustomToken` /
  `devIssueDriverToken` / `devIssueManagerToken` are already emulator-gated
  (`isEmulatorEnvironment()`), so confirm that gate holds and that the app's dev button
  is compiled out when the flag is on.
- Decide what happens to **existing dev-provisioned accounts** — are they migrated to
  real phone identities, or wiped?

---

## 3. Manager login

Separate problem, and it should **not** be phone/OTP.

Managers hold RBAC over the whole fleet, so the account that can deactivate drivers and
change pricing should not be recoverable by whoever holds a SIM. Recommended:
email + password with **enforced MFA**, or SSO if you have an identity provider.

The first manager is seeded out-of-band by `scripts/bootstrap-first-manager.mjs` — see
`docs/PROD_DEPLOY_RUNBOOK.md`. That is deliberate and unchanged by this document:
after the R1 fix, no client can mint the first manager.

`apps/manager-web` currently signs in via the emulator-only `devIssueManagerToken`, so
it has **no production login at all** today. That is a launch blocker for the dashboard,
independent of the mobile apps.

---

## 4. Device QA checklist (cannot be done in the emulator)

Run all of this on real hardware before the flag goes on for users:

- [ ] Real SMS arrives on a real Palestinian number, on both a Jawwal/Ooredoo SIM and at
      least one Israeli carrier, within ~30s.
- [ ] Android **release** build signed with the Play App Signing key (not just debug).
- [ ] iOS build on a physical device — silent APNs path works, no reCAPTCHA web view.
- [ ] Wrong code 5× → lockout message is correct and in Arabic.
- [ ] Resend is refused before the 60s cooldown; the countdown is visible.
- [ ] Airplane mode / no signal → a clear error, not a spinner that never ends.
- [ ] Number already registered → signs in, does not create a duplicate account.
- [ ] Store-review test number works end to end.
- [ ] App Check in monitoring shows the real apps passing before you enforce.
- [ ] Sign-in works with the phone's language set to both Arabic and English (RTL).

---

## 5. Decisions I need from you

1. **Which country codes are allowed?** `+970` only, or `+970` and `+972`? This
   determines the SMS region policy and the server-side prefix check. Getting it wrong
   locks out real users or opens the fraud surface.
2. **SMS budget and expected daily sign-in volume**, so quotas and the billing alert can
   be set to real numbers.
3. **Manager login method** — email+password with MFA, or SSO?
4. **Do existing dev-provisioned driver and passenger accounts get migrated or wiped?**
5. **Is a passenger allowed to change their phone number later**, and if so who
   authorises it? (Account takeover usually enters through number change, not sign-in.)
6. **App Check enforcement date** — how long do you want to watch monitoring before
   enforcing?

---

## 6. What is actually in the repo right now

- `packages/shared/src/config/auth-flags.config.ts` — the flag (default **false**,
  verified to stay false for unset/empty/`false`/`0`/`no`) and the `OTP_LIMITS`
  constants the server work must enforce.
- `backend/functions/src/modules/auth/otp-rate-limit.ts` — E.164 normalisation that
  REFUSES ambiguous national numbers rather than guessing a country, SHA-256 hashed
  counters (never the raw number), dual phone+device keying, cooldown, hourly caps
  and lockout. Both transactions read before they write.
- `backend/functions/src/api/callable/otpRateLimit.callable.ts` —
  `requestOtpPermission` and `reportOtpResult`.
- `backend/functions/scripts/qa-otp-auth-e2e.mjs` — the full sign-in round trip
  against the Auth emulator, the wrong-code path, every limit, and a check that no
  raw phone number is ever stored.
- **App Check is still absent repo-wide.** It is a console action plus an
  enforcement-date decision (§1, §5), not something that can be landed here.
- **No client OTP UI has been built**, because building a sign-in screen
  that cannot be tested against a real SMS on a real device would be guesswork shaped
  like progress. The flag and the limits exist so the server work and the UI can be
  written against a fixed contract once the decisions above are made.
