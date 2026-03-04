import {
  DocumentData,
  QueryConstraint,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirestoreDb, getFunctionsInstance } from './firebase';

export type Unsubscribe = () => void;

function cleanPayload<T extends Record<string, unknown>>(payload: T): T {
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}

function callable<TInput extends Record<string, unknown>, TOutput>(name: string) {
  const functions = getFunctionsInstance();
  return async (payload: TInput): Promise<TOutput> => {
    const fn = httpsCallable<TInput, TOutput>(functions, name);
    const result = await fn(cleanPayload(payload));
    return result.data;
  };
}

export const upsertOffice = callable<
  {
    officeId?: string;
    name: string;
    code: string;
    city: string;
    status?: 'active' | 'inactive';
    contactPhone?: string;
    dispatchMode?: 'line_based' | 'hybrid';
  },
  { officeId: string; success: true }
>('managerUpsertOffice');

export const upsertLine = callable<
  {
    lineId?: string;
    officeId: string;
    name: string;
    code: string;
    status?: 'active' | 'inactive';
    minSeats?: number;
    maxSeats?: number;
    allowedVehicleTypes?: string[];
    pricingProfileId?: string;
    serviceAreaLabel?: string;
  },
  { lineId: string; success: true }
>('managerUpsertLine');

export const upsertLicense = callable<
  {
    licenseId?: string;
    officeId: string;
    lineId: string;
    licenseNumber: string;
    holderName: string;
    status?: 'active' | 'suspended' | 'expired';
    issuedAt?: string;
    expiresAt?: string;
  },
  { licenseId: string; success: true }
>('managerUpsertLicense');

export const upsertVehicle = callable<
  {
    vehicleId?: string;
    officeId: string;
    lineId: string;
    licenseId?: string;
    plateNumber: string;
    vehicleType: string;
    seatCapacity: number;
    status?: 'active' | 'maintenance' | 'suspended';
    assignedDriverId?: string;
  },
  { vehicleId: string; success: true }
>('managerUpsertVehicle');

export const linkDriverToOperations = callable<
  {
    driverId: string;
    officeId: string;
    lineId: string;
    licenseId?: string;
    vehicleId?: string;
    vehicleType?: string;
    seatCapacity?: number;
  },
  { success: true; driverId: string; vehicleId: string | null }
>('managerLinkDriverToOperations');

export const upsertPricingProfile = callable<
  {
    profileId?: string;
    name: string;
    status?: 'active' | 'inactive';
    baseRatePerKm: number;
    minimumFareIls: number;
    seatSurchargePerSeat?: number;
    peakWindows?: Array<{
      id: string;
      label: string;
      daysOfWeek: number[];
      startMinute: number;
      endMinute: number;
      multiplier: number;
    }>;
    vehicleMultipliers?: Record<string, number>;
    officeMultipliers?: Record<string, number>;
    lineMultipliers?: Record<string, number>;
    notes?: string;
  },
  { success: true; profileId: string }
>('managerUpsertPricingProfile');

export const upsertPricingZone = callable<
  {
    zoneId?: string;
    name: string;
    officeId?: string;
    lineId?: string;
    center: { lat: number; lng: number };
    radiusKm: number;
    multiplier?: number;
    flatSurchargeIls?: number;
    appliesTo?: 'pickup' | 'dropoff' | 'both';
    status?: 'active' | 'inactive';
  },
  { success: true; zoneId: string }
>('managerUpsertPricingZone');

export const upsertStaffRole = callable<
  {
    targetUserId: string;
    role: 'admin' | 'manager' | 'operations_manager' | 'dispatcher' | 'support';
    permissions?: string[];
    officeIds?: string[];
    lineIds?: string[];
    isActive?: boolean;
  },
  { success: true; userId: string; role: string }
>('managerUpsertStaffRole');

export interface CollectionItem<T = DocumentData> {
  id: string;
  data: T;
}

export function subscribeCollection<T = DocumentData>(
  collectionName: string,
  onData: (items: CollectionItem<T>[]) => void,
  options?: {
    orderByField?: string;
    orderDirection?: 'asc' | 'desc';
    limitTo?: number;
  }
): Unsubscribe {
  const db = getFirestoreDb();
  const constraints: QueryConstraint[] = [];
  if (options?.orderByField) {
    constraints.push(orderBy(options.orderByField, options.orderDirection ?? 'desc'));
  }
  if (typeof options?.limitTo === 'number') {
    constraints.push(limit(options.limitTo));
  }

  const ref = collection(db, collectionName);
  const q = constraints.length > 0 ? query(ref, ...constraints) : query(ref);

  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() as T,
    }));
    onData(items);
  });
}

export const acknowledgeAlert = callable<
  { alertId: string; note?: string },
  { success: true; alertId: string }
>('managerAcknowledgeAlert');
