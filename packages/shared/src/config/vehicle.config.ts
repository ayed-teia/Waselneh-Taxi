export const VEHICLE_TYPES = {
  TAXI_STANDARD: 'taxi_standard',
  FAMILY_VAN: 'family_van',
  MINIBUS: 'minibus',
  PREMIUM: 'premium',
} as const;

export type VehicleType = (typeof VEHICLE_TYPES)[keyof typeof VEHICLE_TYPES];

export const VEHICLE_TYPE_VALUES = Object.values(VEHICLE_TYPES) as VehicleType[];

export const VEHICLE_MIN_CAPACITY = 1;
export const VEHICLE_MAX_CAPACITY = 14;

export const VEHICLE_DEFAULT_CAPACITY: Record<VehicleType, number> = {
  [VEHICLE_TYPES.TAXI_STANDARD]: 4,
  [VEHICLE_TYPES.FAMILY_VAN]: 6,
  [VEHICLE_TYPES.MINIBUS]: 12,
  [VEHICLE_TYPES.PREMIUM]: 4,
};

export const VEHICLE_PRICE_MULTIPLIER: Record<VehicleType, number> = {
  [VEHICLE_TYPES.TAXI_STANDARD]: 1,
  [VEHICLE_TYPES.FAMILY_VAN]: 1.1,
  [VEHICLE_TYPES.MINIBUS]: 1.2,
  [VEHICLE_TYPES.PREMIUM]: 1.35,
};

export function normalizeVehicleType(value: unknown): VehicleType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim() as VehicleType;
  return VEHICLE_TYPE_VALUES.includes(trimmed) ? trimmed : null;
}

export function getDefaultSeatCapacityForVehicleType(
  vehicleType: VehicleType | null | undefined
): number {
  if (!vehicleType) {
    return VEHICLE_DEFAULT_CAPACITY[VEHICLE_TYPES.TAXI_STANDARD];
  }

  return VEHICLE_DEFAULT_CAPACITY[vehicleType] ?? VEHICLE_DEFAULT_CAPACITY[VEHICLE_TYPES.TAXI_STANDARD];
}

export function normalizeSeatCapacity(
  value: unknown,
  fallbackVehicleType?: VehicleType | null
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return Math.min(Math.max(rounded, VEHICLE_MIN_CAPACITY), VEHICLE_MAX_CAPACITY);
  }

  return getDefaultSeatCapacityForVehicleType(fallbackVehicleType ?? null);
}
