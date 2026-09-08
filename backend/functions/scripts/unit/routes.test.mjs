import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  LineRouteInputSchema,
  ManagerUpsertCityInputSchema,
} = require('../../../../packages/shared/dist');

describe('city management schema', () => {
  it('accepts a canonical Palestinian city payload', () => {
    const parsed = ManagerUpsertCityInputSchema.safeParse({
      code: 'JENIN',
      nameAr: 'جنين',
      nameEn: 'Jenin',
      center: { lat: 32.4618, lng: 35.3003 },
      serviceRadiusKm: 18,
    });

    assert.equal(parsed.success, true);
  });

  it('rejects invalid coordinates', () => {
    const parsed = ManagerUpsertCityInputSchema.safeParse({
      code: 'BAD',
      nameAr: 'مدينة',
      center: { lat: 120, lng: 35 },
    });

    assert.equal(parsed.success, false);
  });
});

describe('line route invariants', () => {
  const interCity = {
    serviceType: 'inter_city',
    operatorType: 'independent',
    officeId: null,
    originCityId: 'CITY_JENIN',
    destinationCityId: 'CITY_RAMALLAH',
    distanceKm: 73,
    estimatedDurationMin: 95,
    pricingStrategy: 'fixed',
    fixedPriceIls: 35,
    bidirectional: true,
  };

  it('accepts an independent inter-city line with a fixed fare', () => {
    assert.equal(LineRouteInputSchema.safeParse(interCity).success, true);
  });

  it('requires different cities for an inter-city line', () => {
    const parsed = LineRouteInputSchema.safeParse({
      ...interCity,
      destinationCityId: interCity.originCityId,
    });

    assert.equal(parsed.success, false);
  });

  it('requires the same city for an intra-city line', () => {
    const parsed = LineRouteInputSchema.safeParse({
      ...interCity,
      serviceType: 'intra_city',
    });

    assert.equal(parsed.success, false);
  });

  it('requires an office for office-operated lines', () => {
    const parsed = LineRouteInputSchema.safeParse({
      ...interCity,
      operatorType: 'office',
    });

    assert.equal(parsed.success, false);
  });

  it('rejects an office on an independent line', () => {
    const parsed = LineRouteInputSchema.safeParse({
      ...interCity,
      officeId: 'OFFICE_JENIN',
    });

    assert.equal(parsed.success, false);
  });

  it('requires a fixed fare for fixed and hybrid pricing', () => {
    const fixed = LineRouteInputSchema.safeParse({
      ...interCity,
      fixedPriceIls: null,
    });
    const hybrid = LineRouteInputSchema.safeParse({
      ...interCity,
      pricingStrategy: 'hybrid',
      fixedPriceIls: undefined,
    });

    assert.equal(fixed.success, false);
    assert.equal(hybrid.success, false);
  });

  it('keeps legacy lines readable during migration', () => {
    assert.equal(LineRouteInputSchema.safeParse({ officeId: 'OFFICE_LEGACY' }).success, true);
  });
});
