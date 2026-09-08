import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectSmartRoute } from '../../dist/modules/routes/smart-route-selection.js';

const base = { distanceMeters: 10000, durationSeconds: 1200, distanceKm: 10, durationMin: 20 };
describe('smart route selection', () => {
  it('chooses an alternative that avoids a closed checkpoint', () => {
    const result = selectSmartRoute([
      { ...base, coordinates: [{ lat: 32, lng: 35 }, { lat: 32, lng: 35.2 }] },
      { ...base, durationMin: 25, coordinates: [{ lat: 32.1, lng: 35 }, { lat: 32.1, lng: 35.2 }] },
    ], [{ id: 'closed', lat: 32, lng: 35.1, radiusMeters: 800, status: 'closed', name: 'Checkpoint' }]);
    assert.equal(result.selectedIndex, 1);
    assert.equal(result.reason, 'avoids_closed_checkpoint');
    assert.equal(result.blocked, false);
  });
  it('requires driver confirmation only when every route is closed', () => {
    const result = selectSmartRoute([
      { ...base, coordinates: [{ lat: 32, lng: 35 }, { lat: 32, lng: 35.2 }] },
    ], [{ id: 'closed', lat: 32, lng: 35.1, radiusMeters: 800, status: 'closed', name: 'Checkpoint' }]);
    assert.equal(result.requiresDriverConfirmation, true);
    assert.equal(result.blocked, true);
  });
});
