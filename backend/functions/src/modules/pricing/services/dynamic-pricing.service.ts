import {
  LatLng,
  PRICING_CONFIG,
  VEHICLE_PRICE_MULTIPLIER,
  VehicleType,
  calculateRidePrice,
  normalizeRequestedSeats,
  normalizeVehicleType,
} from '@taxi-line/shared';
import { getFirestore } from '../../../core/config';
import { logger } from '../../../core/logger';

const OPS_TIMEZONE = 'Asia/Hebron';
const DEFAULT_PRICING_PROFILE_ID = 'default';
const PRICING_CACHE_TTL_MS = 30_000;

interface PricingPeakWindow {
  id: string;
  label?: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  multiplier: number;
}

interface PricingProfileDoc {
  profileId: string;
  status: 'active' | 'inactive';
  baseRatePerKm: number;
  minimumFareIls: number;
  seatSurchargePerSeat: number;
  peakWindows: PricingPeakWindow[];
  vehicleMultipliers: Record<string, number>;
  officeMultipliers: Record<string, number>;
  lineMultipliers: Record<string, number>;
}

interface PricingZoneDoc {
  zoneId: string;
  status: 'active' | 'inactive';
  officeId?: string | null;
  lineId?: string | null;
  center?: {
    lat: number;
    lng: number;
  };
  radiusKm?: number;
  multiplier?: number;
  flatSurchargeIls?: number;
  appliesTo?: 'pickup' | 'dropoff' | 'both';
}

interface DynamicPricingCacheEntry<T> {
  value: T;
  expiresAtMs: number;
}

const profileCache = new Map<string, DynamicPricingCacheEntry<PricingProfileDoc>>();
const lineProfileCache = new Map<string, DynamicPricingCacheEntry<string>>();
let zonesCache: DynamicPricingCacheEntry<PricingZoneDoc[]> | null = null;

export interface DynamicPricingInput {
  distanceKm: number;
  pickup?: LatLng;
  dropoff?: LatLng;
  rideOptions?: {
    requiredSeats?: number;
    vehicleType?: VehicleType | null;
    officeId?: string | null;
    lineId?: string | null;
  };
  officeId?: string | null;
  lineId?: string | null;
  now?: Date;
}

export interface DynamicPricingBreakdown {
  profileId: string;
  baseRatePerKm: number;
  minimumFareIls: number;
  roundedDistanceKm: number;
  baseFareIls: number;
  seatSurchargeIls: number;
  zoneFlatSurchargeIls: number;
  vehicleMultiplier: number;
  peakMultiplier: number;
  officeMultiplier: number;
  lineMultiplier: number;
  zoneMultiplier: number;
  combinedMultiplier: number;
  rawFareIls: number;
  appliedZoneIds: string[];
  appliedPeakWindowIds: string[];
}

export interface DynamicPricingResult {
  priceIls: number;
  breakdown: DynamicPricingBreakdown;
}

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeMultiplier(value: unknown, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function sanitizeNonNegative(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

function isCacheValid<T>(
  entry: DynamicPricingCacheEntry<T> | null | undefined
): entry is DynamicPricingCacheEntry<T> {
  return !!entry && entry.expiresAtMs > Date.now();
}

function getFallbackPricingProfile(): PricingProfileDoc {
  return {
    profileId: DEFAULT_PRICING_PROFILE_ID,
    status: 'active',
    baseRatePerKm: PRICING_CONFIG.RATE_PER_KM,
    minimumFareIls: PRICING_CONFIG.MINIMUM_PRICE_ILS,
    seatSurchargePerSeat: 2,
    peakWindows: [],
    vehicleMultipliers: { ...VEHICLE_PRICE_MULTIPLIER },
    officeMultipliers: {},
    lineMultipliers: {},
  };
}

function sanitizePeakWindows(value: unknown): PricingPeakWindow[] {
  if (!Array.isArray(value)) return [];
  const windows: PricingPeakWindow[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (!Array.isArray(candidate.daysOfWeek)) continue;
    const daysOfWeek = candidate.daysOfWeek
      .filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6);
    if (daysOfWeek.length === 0) continue;
    const startMinute = sanitizeNonNegative(candidate.startMinute, -1);
    const endMinute = sanitizeNonNegative(candidate.endMinute, -1);
    const multiplier = sanitizeMultiplier(candidate.multiplier, 1);
    if (startMinute > 1439 || endMinute > 1439 || startMinute < 0 || endMinute < 0) continue;
    const label = sanitizeId(candidate.label);
    windows.push({
      id: sanitizeId(candidate.id) ?? `window_${windows.length + 1}`,
      daysOfWeek,
      startMinute,
      endMinute,
      multiplier,
      ...(label ? { label } : {}),
    });
  }
  return windows;
}

function sanitizePricingProfile(data: FirebaseFirestore.DocumentData | undefined, profileId: string): PricingProfileDoc {
  if (!data) {
    return getFallbackPricingProfile();
  }
  const baseRatePerKm = sanitizeMultiplier(data.baseRatePerKm, PRICING_CONFIG.RATE_PER_KM);
  const minimumFareIls = sanitizeMultiplier(data.minimumFareIls, PRICING_CONFIG.MINIMUM_PRICE_ILS);
  const seatSurchargePerSeat = sanitizeNonNegative(data.seatSurchargePerSeat, 2);
  return {
    profileId,
    status: data.status === 'inactive' ? 'inactive' : 'active',
    baseRatePerKm,
    minimumFareIls,
    seatSurchargePerSeat,
    peakWindows: sanitizePeakWindows(data.peakWindows),
    vehicleMultipliers: typeof data.vehicleMultipliers === 'object' && data.vehicleMultipliers
      ? (data.vehicleMultipliers as Record<string, number>)
      : {},
    officeMultipliers: typeof data.officeMultipliers === 'object' && data.officeMultipliers
      ? (data.officeMultipliers as Record<string, number>)
      : {},
    lineMultipliers: typeof data.lineMultipliers === 'object' && data.lineMultipliers
      ? (data.lineMultipliers as Record<string, number>)
      : {},
  };
}

async function getPricingProfileIdForLine(lineId: string | null): Promise<string> {
  if (!lineId) return DEFAULT_PRICING_PROFILE_ID;

  const cached = lineProfileCache.get(lineId);
  if (isCacheValid(cached)) {
    return cached.value;
  }

  const db = getFirestore();
  const lineDoc = await db.collection('lines').doc(lineId).get();
  const profileId =
    sanitizeId(lineDoc.data()?.pricingProfileId) ?? DEFAULT_PRICING_PROFILE_ID;

  lineProfileCache.set(lineId, {
    value: profileId,
    expiresAtMs: Date.now() + PRICING_CACHE_TTL_MS,
  });
  return profileId;
}

async function getPricingProfile(profileId: string): Promise<PricingProfileDoc> {
  const cached = profileCache.get(profileId);
  if (isCacheValid(cached)) {
    return cached.value;
  }

  const db = getFirestore();
  const profileDoc = await db.collection('pricingProfiles').doc(profileId).get();
  const profile = sanitizePricingProfile(profileDoc.data(), profileId);
  const finalProfile = profile.status === 'inactive' ? getFallbackPricingProfile() : profile;

  profileCache.set(profileId, {
    value: finalProfile,
    expiresAtMs: Date.now() + PRICING_CACHE_TTL_MS,
  });
  return finalProfile;
}

function sanitizePricingZone(data: FirebaseFirestore.DocumentData | undefined, zoneId: string): PricingZoneDoc | null {
  if (!data || data.status === 'inactive') return null;
  if (!data.center || typeof data.center !== 'object') return null;
  const center = data.center as { lat?: unknown; lng?: unknown };
  if (typeof center.lat !== 'number' || typeof center.lng !== 'number') return null;
  const radiusKm = sanitizeMultiplier(data.radiusKm, 0);
  if (radiusKm <= 0) return null;
  const appliesTo = data.appliesTo === 'pickup' || data.appliesTo === 'dropoff' ? data.appliesTo : 'both';
  return {
    zoneId,
    status: 'active',
    officeId: sanitizeId(data.officeId),
    lineId: sanitizeId(data.lineId),
    center: {
      lat: center.lat,
      lng: center.lng,
    },
    radiusKm,
    multiplier: sanitizeMultiplier(data.multiplier, 1),
    flatSurchargeIls: sanitizeNonNegative(data.flatSurchargeIls, 0),
    appliesTo,
  };
}

async function getActivePricingZones(): Promise<PricingZoneDoc[]> {
  if (isCacheValid(zonesCache)) {
    return zonesCache.value;
  }

  const db = getFirestore();
  const snapshot = await db
    .collection('pricingZones')
    .where('status', '==', 'active')
    .limit(500)
    .get();

  const zones: PricingZoneDoc[] = [];
  snapshot.forEach((docSnap) => {
    const zone = sanitizePricingZone(docSnap.data(), docSnap.id);
    if (zone) zones.push(zone);
  });

  zonesCache = {
    value: zones,
    expiresAtMs: Date.now() + PRICING_CACHE_TTL_MS,
  };
  return zones;
}

function toOpsDate(date: Date): Date {
  const asLocal = date.toLocaleString('en-US', { timeZone: OPS_TIMEZONE });
  return new Date(asLocal);
}

function isMinuteInWindow(currentMinute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute <= endMinute) {
    return currentMinute >= startMinute && currentMinute <= endMinute;
  }
  return currentMinute >= startMinute || currentMinute <= endMinute;
}

function evaluatePeakWindows(windows: PricingPeakWindow[], now: Date): { multiplier: number; windowIds: string[] } {
  if (windows.length === 0) {
    return { multiplier: 1, windowIds: [] };
  }

  const opsNow = toOpsDate(now);
  const dayOfWeek = opsNow.getDay();
  const currentMinute = opsNow.getHours() * 60 + opsNow.getMinutes();

  let maxMultiplier = 1;
  const windowIds: string[] = [];

  for (const window of windows) {
    if (!window.daysOfWeek.includes(dayOfWeek)) continue;
    if (!isMinuteInWindow(currentMinute, window.startMinute, window.endMinute)) continue;
    if (window.multiplier > maxMultiplier) {
      maxMultiplier = window.multiplier;
    }
    windowIds.push(window.id);
  }

  return { multiplier: maxMultiplier, windowIds };
}

function haversineDistanceKm(from: LatLng, to: LatLng): number {
  const earthRadiusKm = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function zoneMatchesScope(zone: PricingZoneDoc, officeId: string | null, lineId: string | null): boolean {
  if (zone.lineId && zone.lineId !== lineId) return false;
  if (zone.officeId && zone.officeId !== officeId) return false;
  if (zone.lineId && !lineId) return false;
  if (zone.officeId && !officeId) return false;
  return true;
}

function evaluateZonePricing(
  zones: PricingZoneDoc[],
  pickup: LatLng | undefined,
  dropoff: LatLng | undefined,
  officeId: string | null,
  lineId: string | null
): {
  zoneMultiplier: number;
  flatSurchargeIls: number;
  appliedZoneIds: string[];
} {
  if (!pickup && !dropoff) {
    return {
      zoneMultiplier: 1,
      flatSurchargeIls: 0,
      appliedZoneIds: [],
    };
  }

  let pickupMultiplier = 1;
  let dropoffMultiplier = 1;
  let pickupFlat = 0;
  let dropoffFlat = 0;
  const appliedZoneIds = new Set<string>();

  for (const zone of zones) {
    if (!zone.center || !zone.radiusKm) continue;
    if (!zoneMatchesScope(zone, officeId, lineId)) continue;

    const appliesPickup = zone.appliesTo === 'pickup' || zone.appliesTo === 'both';
    const appliesDropoff = zone.appliesTo === 'dropoff' || zone.appliesTo === 'both';

    if (pickup && appliesPickup) {
      const distanceKm = haversineDistanceKm(pickup, zone.center);
      if (distanceKm <= zone.radiusKm) {
        appliedZoneIds.add(zone.zoneId);
        pickupMultiplier = Math.max(pickupMultiplier, sanitizeMultiplier(zone.multiplier, 1));
        pickupFlat = Math.max(pickupFlat, sanitizeNonNegative(zone.flatSurchargeIls, 0));
      }
    }

    if (dropoff && appliesDropoff) {
      const distanceKm = haversineDistanceKm(dropoff, zone.center);
      if (distanceKm <= zone.radiusKm) {
        appliedZoneIds.add(zone.zoneId);
        dropoffMultiplier = Math.max(dropoffMultiplier, sanitizeMultiplier(zone.multiplier, 1));
        dropoffFlat = Math.max(dropoffFlat, sanitizeNonNegative(zone.flatSurchargeIls, 0));
      }
    }
  }

  return {
    zoneMultiplier: Math.max(pickupMultiplier, dropoffMultiplier),
    flatSurchargeIls: pickupFlat + dropoffFlat,
    appliedZoneIds: Array.from(appliedZoneIds.values()),
  };
}

export async function calculateDynamicRidePrice(input: DynamicPricingInput): Promise<DynamicPricingResult> {
  const requestedVehicleType = normalizeVehicleType(input.rideOptions?.vehicleType);
  const requiredSeats = normalizeRequestedSeats(input.rideOptions?.requiredSeats);
  const lineId = sanitizeId(input.lineId ?? input.rideOptions?.lineId);
  const officeId = sanitizeId(input.officeId ?? input.rideOptions?.officeId);
  const now = input.now ?? new Date();

  try {
    const profileId = await getPricingProfileIdForLine(lineId);
    const profile = await getPricingProfile(profileId);
    const zones = await getActivePricingZones();
    const roundedDistanceKm = Math.max(0, Math.round(input.distanceKm * 100) / 100);
    const baseFareIls = roundedDistanceKm * profile.baseRatePerKm;
    const seatSurchargeIls = Math.max(0, requiredSeats - 1) * profile.seatSurchargePerSeat;
    const { multiplier: peakMultiplier, windowIds: appliedPeakWindowIds } = evaluatePeakWindows(
      profile.peakWindows,
      now
    );
    const { zoneMultiplier, flatSurchargeIls, appliedZoneIds } = evaluateZonePricing(
      zones,
      input.pickup,
      input.dropoff,
      officeId,
      lineId
    );

    const vehicleMultiplier = sanitizeMultiplier(
      requestedVehicleType ? profile.vehicleMultipliers[requestedVehicleType] : 1,
      requestedVehicleType ? VEHICLE_PRICE_MULTIPLIER[requestedVehicleType] : 1
    );
    const officeMultiplier = sanitizeMultiplier(
      officeId ? profile.officeMultipliers[officeId] : 1,
      1
    );
    const lineMultiplier = sanitizeMultiplier(lineId ? profile.lineMultipliers[lineId] : 1, 1);

    const combinedMultiplier =
      vehicleMultiplier * peakMultiplier * officeMultiplier * lineMultiplier * zoneMultiplier;
    const rawFareIls = (baseFareIls + seatSurchargeIls + flatSurchargeIls) * combinedMultiplier;
    const minimumFareIls = sanitizeMultiplier(
      profile.minimumFareIls,
      PRICING_CONFIG.MINIMUM_PRICE_ILS
    );
    const priceIls = Math.ceil(Math.max(rawFareIls, minimumFareIls));

    return {
      priceIls,
      breakdown: {
        profileId: profile.profileId,
        baseRatePerKm: profile.baseRatePerKm,
        minimumFareIls,
        roundedDistanceKm,
        baseFareIls,
        seatSurchargeIls,
        zoneFlatSurchargeIls: flatSurchargeIls,
        vehicleMultiplier,
        peakMultiplier,
        officeMultiplier,
        lineMultiplier,
        zoneMultiplier,
        combinedMultiplier,
        rawFareIls,
        appliedZoneIds,
        appliedPeakWindowIds,
      },
    };
  } catch (error) {
    logger.error('[Pricing] Dynamic pricing failed. Falling back to base pricing.', {
      error,
      lineId,
      officeId,
    });
    const fallbackPrice = calculateRidePrice(input.distanceKm, {
      requiredSeats,
      ...(requestedVehicleType ? { vehicleType: requestedVehicleType } : {}),
    });
    return {
      priceIls: fallbackPrice,
      breakdown: {
        profileId: DEFAULT_PRICING_PROFILE_ID,
        baseRatePerKm: PRICING_CONFIG.RATE_PER_KM,
        minimumFareIls: PRICING_CONFIG.MINIMUM_PRICE_ILS,
        roundedDistanceKm: Math.max(0, Math.round(input.distanceKm * 100) / 100),
        baseFareIls: input.distanceKm * PRICING_CONFIG.RATE_PER_KM,
        seatSurchargeIls: 0,
        zoneFlatSurchargeIls: 0,
        vehicleMultiplier: 1,
        peakMultiplier: 1,
        officeMultiplier: 1,
        lineMultiplier: 1,
        zoneMultiplier: 1,
        combinedMultiplier: 1,
        rawFareIls: fallbackPrice,
        appliedZoneIds: [],
        appliedPeakWindowIds: [],
      },
    };
  }
}
