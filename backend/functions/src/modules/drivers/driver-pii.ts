import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * ============================================================================
 * DRIVER PII STORAGE
 * ============================================================================
 *
 * Driver personally-identifying information lives in a PRIVATE SUBCOLLECTION:
 *
 *     drivers/{driverId}/private/pii
 *
 * and never on the parent `drivers/{driverId}` document.
 *
 * WHY
 * Firestore read rules are per-DOCUMENT, not per-field. The passenger on an active
 * trip legitimately needs to read the driver's display card (name shown to them,
 * photo, rating, vehicle, plate, line), so any field on that same document is also
 * readable by them. While nationalId and phone lived there, every passenger of record
 * received them, and before the read-scoping fix ANY authenticated user could read -
 * and enumerate - all of them.
 *
 * Splitting the document is the only way to actually withhold those fields: the
 * subcollection carries its own rule, so the driver and managers can read it while
 * the passenger cannot.
 *
 * WHAT GOES WHERE
 *   drivers/{id}                 display + operational fields the passenger app needs:
 *                                displayName, photoUrl, rating, vehicle, plate,
 *                                lineNumber, route, seats, eligibility, availability.
 *   drivers/{id}/private/pii     nationalId, phone, fullName (the legal name).
 *
 * Note that `displayName` on the parent doc is deliberately distinct from `fullName`
 * in the PII doc: the passenger sees a display name, not the legal identity record.
 * The migration seeds displayName from fullName so nothing renders blank.
 *
 * ALWAYS write PII through the helpers here rather than inlining the path, so a new
 * write path cannot accidentally put PII back on the parent document.
 * ============================================================================
 */

/** Fields that must never be stored on the parent `drivers/{driverId}` document. */
export const DRIVER_PII_FIELDS = ['nationalId', 'phone', 'fullName'] as const;

export type DriverPiiField = (typeof DRIVER_PII_FIELDS)[number];

export interface DriverPii {
  fullName: string | null;
  nationalId: string | null;
  phone: string | null;
}

/** The private PII document reference for a driver. */
export function driverPiiRef(db: Firestore, driverId: string) {
  return db.collection('drivers').doc(driverId).collection('private').doc('pii');
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normalize an arbitrary document body into the DriverPii shape. */
export function toDriverPii(data: FirebaseFirestore.DocumentData | undefined): DriverPii {
  const source = data ?? {};
  return {
    fullName: asStringOrNull(source.fullName),
    nationalId: asStringOrNull(source.nationalId),
    phone: asStringOrNull(source.phone),
  };
}

/** Read a driver's PII outside a transaction. */
export async function readDriverPii(db: Firestore, driverId: string): Promise<DriverPii> {
  const snapshot = await driverPiiRef(db, driverId).get();
  return toDriverPii(snapshot.data());
}

/** Read a driver's PII inside a transaction (must happen before any write). */
export async function readDriverPiiInTransaction(
  transaction: Transaction,
  db: Firestore,
  driverId: string
): Promise<DriverPii> {
  const snapshot = await transaction.get(driverPiiRef(db, driverId));
  return toDriverPii(snapshot.data());
}

/**
 * Write a driver's PII inside a transaction.
 * Only the fields present in `pii` are written, so a caller that knows nothing about
 * (say) nationalId cannot blank it out.
 */
export function writeDriverPiiInTransaction(
  transaction: Transaction,
  db: Firestore,
  driverId: string,
  pii: Partial<DriverPii>,
  updatedBy: string
): void {
  transaction.set(
    driverPiiRef(db, driverId),
    {
      driverId,
      ...pii,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy,
    },
    { merge: true }
  );
}

/** Write a driver's PII outside a transaction. */
export async function writeDriverPii(
  db: Firestore,
  driverId: string,
  pii: Partial<DriverPii>,
  updatedBy: string
): Promise<void> {
  await driverPiiRef(db, driverId).set(
    {
      driverId,
      ...pii,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy,
    },
    { merge: true }
  );
}

/**
 * Strip PII fields from a payload bound for the parent driver document.
 * Defence in depth: even if a future caller forgets, PII cannot land on the
 * publicly-readable document.
 */
export function stripDriverPii<T extends Record<string, unknown>>(payload: T): T {
  const cleaned = { ...payload };
  for (const field of DRIVER_PII_FIELDS) {
    delete cleaned[field];
  }
  return cleaned;
}
