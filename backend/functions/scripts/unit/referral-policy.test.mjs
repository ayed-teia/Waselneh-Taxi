/**
 * Unit tests for the pure referral modules - no emulator, no Firestore, no clock.
 *
 * These cover the decisions money correctness rests on: whether a referral has
 * earned its reward, how much, and that a code can never be derived from a uid.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  REFERRAL_ALPHABET,
  REFERRAL_CODE_LENGTH,
  decideReferralReward,
  generateReferralCode,
  isWellFormedReferralCode,
  normalizeReferralCode,
} = require(path.join(dirname, '..', '..', 'dist', 'modules', 'referrals'));

const DAY_MS = 24 * 60 * 60 * 1000;

/** A config with rewards switched on. */
function config(over = {}) {
  return {
    enabled: true,
    inviterCredits: 10,
    inviteeCredits: 5,
    minQualifyingFareIls: 0,
    claimExpiryDays: 0,
    version: 3,
    ...over,
  };
}

/** A pending claim by an invitee. */
function referral(over = {}) {
  return { inviterId: 'inviter-1', status: 'pending', ...over };
}

const baseInput = {
  referral: referral(),
  config: config(),
  passengerId: 'invitee-1',
  finalPriceIls: 25,
  claimedAtMs: 1_000_000,
  nowMs: 1_000_000 + DAY_MS,
};

describe('normalizeReferralCode', () => {
  test('uppercases and strips separators', () => {
    assert.equal(normalizeReferralCode(' wsl-abc123 '), 'WSLABC123');
  });

  test('accepts the legacy hyphenated form a user might still type', () => {
    assert.equal(normalizeReferralCode('WSL-K7M2Q9'), 'WSLK7M2Q9');
  });

  test('strips path characters so a code can never traverse a document path', () => {
    assert.equal(normalizeReferralCode('WSL/../../evil'), 'WSLEVIL');
  });

  test('caps length', () => {
    assert.ok(normalizeReferralCode('W'.repeat(50)).length <= 16);
  });
});

describe('generateReferralCode', () => {
  test('never emits visually ambiguous symbols', () => {
    // I/1, L/1, O/0 and U are excluded on purpose - codes get read aloud.
    for (let index = 0; index < 500; index += 1) {
      const code = generateReferralCode();
      const suffix = code.slice(3);
      for (const character of suffix) {
        assert.ok(
          REFERRAL_ALPHABET.includes(character),
          `generated disallowed character ${character} in ${code}`
        );
      }
      assert.equal(suffix.length, REFERRAL_CODE_LENGTH);
    }
  });

  test('is deterministic under an injected random, so a collision is testable', () => {
    const always = () => 0;
    assert.equal(generateReferralCode(always), generateReferralCode(always));
  });

  test('a random() returning exactly 1 does not index out of the alphabet', () => {
    const code = generateReferralCode(() => 1);
    assert.ok(isWellFormedReferralCode(code), `out-of-range index produced ${code}`);
  });

  test('is NOT derivable from a uid', () => {
    // The old placeholder was a uppercased slice of the uid. Guard against anyone
    // reintroducing that: a generated code must not echo the uid.
    const uid = 'abcdef0123456789';
    const code = generateReferralCode();
    assert.ok(!code.includes(uid.slice(0, 6).toUpperCase()), 'code leaked uid prefix');
  });
});

describe('decideReferralReward - refuses by default', () => {
  test('no referral claim yields nothing', () => {
    const decision = decideReferralReward({ ...baseInput, referral: null });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'no_referral');
  });

  test('MISSING CONFIG yields nothing - the feature ships inert', () => {
    const decision = decideReferralReward({ ...baseInput, config: null });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'no_config');
  });

  test('config present but disabled yields nothing', () => {
    const decision = decideReferralReward({ ...baseInput, config: config({ enabled: false }) });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'disabled');
  });

  test('zero-valued config yields nothing rather than empty ledger rows', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ inviterCredits: 0, inviteeCredits: 0 }),
    });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'zero_reward');
  });
});

describe('decideReferralReward - abuse guards', () => {
  test('an already-qualified referral cannot pay twice', () => {
    const decision = decideReferralReward({
      ...baseInput,
      referral: referral({ status: 'qualified' }),
    });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'already_qualified');
  });

  test('SELF-REFERRAL is refused even if the document somehow exists', () => {
    const decision = decideReferralReward({
      ...baseInput,
      referral: referral({ inviterId: 'invitee-1' }),
      passengerId: 'invitee-1',
    });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'self_referral');
  });

  test('a fare below the minimum does not qualify', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ minQualifyingFareIls: 30 }),
      finalPriceIls: 25,
    });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'below_minimum_fare');
  });

  test('a fare exactly at the minimum DOES qualify (boundary)', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ minQualifyingFareIls: 25 }),
      finalPriceIls: 25,
    });
    assert.ok(decision.plan, 'boundary fare should qualify');
  });

  test('a claim older than the expiry window is refused', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ claimExpiryDays: 7 }),
      claimedAtMs: 0,
      nowMs: 8 * DAY_MS,
    });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'claim_expired');
  });

  test('a claim inside the expiry window still qualifies', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ claimExpiryDays: 7 }),
      claimedAtMs: 0,
      nowMs: 6 * DAY_MS,
    });
    assert.ok(decision.plan, 'claim within the window should qualify');
  });

  test('expiry configured but no claim timestamp is refused, not treated as fresh', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ claimExpiryDays: 7 }),
      claimedAtMs: null,
    });
    assert.equal(decision.plan, null);
    assert.equal(decision.reason, 'claim_expired');
  });

  test('expiry of 0 means no expiry', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ claimExpiryDays: 0 }),
      claimedAtMs: 0,
      nowMs: 9999 * DAY_MS,
    });
    assert.ok(decision.plan, 'zero expiry must mean unlimited');
  });
});

describe('decideReferralReward - the granting case', () => {
  test('returns both sides and the config version', () => {
    const decision = decideReferralReward(baseInput);
    assert.deepEqual(decision.plan, {
      inviterId: 'inviter-1',
      inviterCredits: 10,
      inviteeCredits: 5,
      configVersion: 3,
    });
  });

  test('fractional or junk credit values are floored to safe integers', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ inviterCredits: 10.9, inviteeCredits: -5 }),
    });
    assert.equal(decision.plan.inviterCredits, 10);
    assert.equal(decision.plan.inviteeCredits, 0, 'a negative reward must never be granted');
  });

  test('one-sided rewards are allowed', () => {
    const decision = decideReferralReward({
      ...baseInput,
      config: config({ inviterCredits: 10, inviteeCredits: 0 }),
    });
    assert.ok(decision.plan, 'inviter-only reward should still qualify');
    assert.equal(decision.plan.inviteeCredits, 0);
  });

  test('a NaN fare never qualifies', () => {
    const decision = decideReferralReward({ ...baseInput, finalPriceIls: Number.NaN });
    assert.equal(decision.plan, null, 'NaN fare must not qualify');
  });
});
