export const DEFAULT_COMMISSION_BPS = 1_000; // 10%

export interface TripCommission {
  grossFareIls: number;
  commissionBps: number;
  commissionIls: number;
  driverNetIls: number;
}

function roundIls(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveCommissionBps(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(10_000, Math.round(value)))
    : DEFAULT_COMMISSION_BPS;
}

export function calculateTripCommission(
  grossFareIls: number,
  configuredCommissionBps: unknown
): TripCommission {
  const gross = roundIls(Math.max(0, Number.isFinite(grossFareIls) ? grossFareIls : 0));
  const commissionBps = resolveCommissionBps(configuredCommissionBps);
  const commissionIls = roundIls((gross * commissionBps) / 10_000);

  return {
    grossFareIls: gross,
    commissionBps,
    commissionIls,
    driverNetIls: roundIls(gross - commissionIls),
  };
}
