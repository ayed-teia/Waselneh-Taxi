import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { distanceToRouteSegmentKm, readGeoPoint } = require('../../dist/modules/routes/route-proximity');

describe('route proximity matching', () => {
  const jenin = { lat: 32.4618, lng: 35.3003 };
  const ramallah = { lat: 31.9038, lng: 35.2034 };

  it('matches a passenger close to the inter-city path', () => {
    const distance = distanceToRouteSegmentKm(
      { lat: 32.22, lng: 35.255 },
      jenin,
      ramallah
    );
    assert.ok(distance < 3, `expected a close route match, received ${distance}km`);
  });

  it('does not match a passenger far away from the path', () => {
    const distance = distanceToRouteSegmentKm(
      { lat: 31.5, lng: 34.45 },
      jenin,
      ramallah
    );
    assert.ok(distance > 50, `expected a distant point, received ${distance}km`);
  });

  it('validates denormalized Firestore points safely', () => {
    assert.deepEqual(readGeoPoint({ lat: 32.2, lng: 35.2 }), { lat: 32.2, lng: 35.2 });
    assert.equal(readGeoPoint({ lat: '32.2', lng: 35.2 }), null);
    assert.equal(readGeoPoint(null), null);
  });
});
