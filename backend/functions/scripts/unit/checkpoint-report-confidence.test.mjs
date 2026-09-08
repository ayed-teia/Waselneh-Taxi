import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateCheckpointConfidence } from '../../dist/modules/routes/checkpoint-report-confidence.js';

const report = { driverId: 'd1', lat: 32.22, lng: 35.255, status: 'closed' };

describe('checkpoint report confidence', () => {
  it('counts unique nearby drivers with the same status', () => {
    const result = calculateCheckpointConfidence(report, [
      report,
      { driverId: 'd2', lat: 32.221, lng: 35.255, status: 'closed' },
      { driverId: 'd2', lat: 32.222, lng: 35.255, status: 'closed' },
      { driverId: 'd3', lat: 32.221, lng: 35.255, status: 'open' },
    ]);
    assert.equal(result.corroboratingDrivers, 2);
    assert.equal(result.confidence, 0.65);
  });

  it('ignores matching reports outside the cluster radius', () => {
    const result = calculateCheckpointConfidence(report, [
      { driverId: 'd2', lat: 31.9, lng: 35.2, status: 'closed' },
    ]);
    assert.equal(result.corroboratingDrivers, 1);
    assert.equal(result.confidence, 0.45);
  });
});
