import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { getSubscriptionBlockReason } = require(path.join(dirname, '..', '..', 'dist', 'modules', 'billing', 'subscription-access.js'));
const now = Date.parse('2026-09-09T12:00:00.000Z');
const timestamp = (millis) => ({ toMillis: () => millis });

describe('subscription operational access', () => {
  test('allows legacy drivers without an assigned subscription', () => {
    assert.equal(getSubscriptionBlockReason({}, now), null);
  });
  test('allows active and trialing subscriptions inside their dates', () => {
    for (const status of ['active', 'trialing']) {
      assert.equal(getSubscriptionBlockReason({ subscriptionStatus: status, subscriptionStartsAt: timestamp(now - 1), subscriptionEndsAt: timestamp(now + 1) }, now), null);
    }
  });
  test('blocks billing and lifecycle failures', () => {
    assert.equal(getSubscriptionBlockReason({ subscriptionStatus: 'past_due' }, now), 'subscription_not_active');
    assert.equal(getSubscriptionBlockReason({ subscriptionStatus: 'active', subscriptionStartsAt: timestamp(now + 1) }, now), 'subscription_not_started');
    assert.equal(getSubscriptionBlockReason({ subscriptionStatus: 'active', subscriptionEndsAt: timestamp(now) }, now), 'subscription_expired');
  });
});
