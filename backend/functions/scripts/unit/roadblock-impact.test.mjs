import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessRoadblockImpact } from '../../dist/modules/routes/roadblock-impact.js';

const pickup = { lat: 32.4618, lng: 35.3003 };
const dropoff = { lat: 31.9038, lng: 35.2034 };

describe('roadblock route impact', () => {
  it('adds configured delay and surcharge only for checkpoints on the route', () => {
    const result = assessRoadblockImpact(pickup, dropoff, [
      { id: 'near', name: 'Checkpoint', lat: 32.22, lng: 35.255, radiusMeters: 5000, status: 'congested', delayMin: 12, surchargeIls: 3 },
      { id: 'far', name: 'Far away', lat: 31.5, lng: 34.45, radiusMeters: 500, status: 'closed', delayMin: 90, surchargeIls: 50 },
    ]);
    assert.equal(result.affected, true);
    assert.equal(result.delayMin, 12);
    assert.equal(result.surchargeIls, 3);
    assert.deepEqual(result.items.map((item) => item.id), ['near']);
  });

  it('marks a closed checkpoint and applies safe operational defaults', () => {
    const result = assessRoadblockImpact(pickup, dropoff, [
      { id: 'closed', name: 'Closed checkpoint', lat: 32.22, lng: 35.255, radiusMeters: 5000, status: 'closed' },
    ]);
    assert.equal(result.hasClosure, true);
    assert.equal(result.delayMin, 20);
    assert.equal(result.surchargeIls, 0);
  });

  it('ignores malformed coordinates instead of poisoning an estimate', () => {
    const result = assessRoadblockImpact(pickup, dropoff, [
      { id: 'bad', name: 'Bad data', lat: 'x', lng: null, status: 'closed' },
    ]);
    assert.equal(result.affected, false);
  });
});
