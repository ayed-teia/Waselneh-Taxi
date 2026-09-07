import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

import { docData, getNumber, getString } from '../../core/firestore/doc-data';
import { logger } from '../../core/logger';

/**
 * ============================================================================
 * TAXI-LINE FIFO QUEUE
 * ============================================================================
 *
 * ⚠️  BEHIND A FLAG, DEFAULT OFF, AND IT NEEDS DRIVER SIGN-OFF BEFORE IT IS EVER
 *     ENABLED. See docs/REMAINING_PLAN.md.
 *
 * WHY THE FLAG MATTERS MORE HERE THAN ANYWHERE ELSE
 * A real taxi line is FIFO, not nearest-first. A driver who has waited an hour at the
 * head of the line expects the next fare even if someone just pulled up closer. The
 * existing dispatcher matches by distance, which is defensible for an app and
 * indefensible at a rank - and the forfeit rules below decide, in practice, who earns
 * money on a given day.
 *
 * That makes this a fairness policy that happens to need code. Shipping it without
 * drivers agreeing to the rules is how a platform gets a strike rather than a bug
 * report. The defaults encoded here are a STARTING POINT for that conversation, not
 * a decision:
 *
 *   POSITION      assigned by joinedAt, server-side, ascending.
 *   FORFEIT on    declining an offer, going offline, or leaving the service area.
 *   RE-JOIN       goes to the BACK of the queue.
 *
 * Deliberately unresolved and listed in the plan: whether a very short trip should
 * return a driver to the head rather than the tail, whether a brief geofence exit
 * (traffic, a toilet break) should forfeit, and whether a distance cap should
 * override FIFO for a far-away front-of-line driver.
 *
 * ANTI-GAMING
 * Positions are assigned ONLY here, from callables. The Firestore rule for
 * lines/{lineId}/queue/{driverId} is `allow write: if false`, so a driver cannot
 * write their own position - which would otherwise be the first thing anyone tried.
 *
 * Firestore: lines/{lineId}/queue/{driverId}
 * ============================================================================
 */

export type QueueEntryStatus = 'waiting' | 'offered' | 'serving';

export interface QueueEntry {
  driverId: string;
  lineId: string;
  status: QueueEntryStatus;
  /** Ascending; lower is closer to the front. Server-assigned. */
  position: number;
  joinedAt: Timestamp | null;
}

/** Reasons a driver loses their place. Recorded for the audit trail. */
export type ForfeitReason =
  | 'declined_offer'
  | 'offer_timeout'
  | 'went_offline'
  | 'left_service_area'
  | 'manager_removed';

function queueCollection(db: Firestore, lineId: string) {
  return db.collection('lines').doc(lineId).collection('queue');
}

/**
 * Join a line, or move to the back if already present.
 *
 * Position is `now` in millis: monotonic, unique enough in practice, and it makes
 * "back of the queue" a single assignment rather than a renumbering of every row.
 * Renumbering would be a write per driver per join, and would race.
 */
export async function joinQueue(
  db: Firestore,
  lineId: string,
  driverId: string
): Promise<{ position: number }> {
  const ref = queueCollection(db, lineId).doc(driverId);
  const position = Date.now();

  await ref.set(
    {
      driverId,
      lineId,
      status: 'waiting',
      position,
      joinedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info('[LineQueue] Driver joined', { lineId, driverId, position });
  return { position };
}

/** Remove a driver from a line, recording why. */
export async function leaveQueue(
  db: Firestore,
  lineId: string,
  driverId: string,
  reason: ForfeitReason
): Promise<void> {
  await queueCollection(db, lineId).doc(driverId).delete();
  logger.info('[LineQueue] Driver left', { lineId, driverId, reason });
}

/**
 * Forfeit a driver's place: they leave and must re-join at the back.
 *
 * Modelled as delete-then-rejoin rather than a position bump, so the audit trail
 * shows a discrete event and a driver cannot be silently "moved" mid-queue.
 */
export async function forfeitPlace(
  db: Firestore,
  lineId: string,
  driverId: string,
  reason: ForfeitReason
): Promise<void> {
  await leaveQueue(db, lineId, driverId, reason);
}

/** Everyone currently waiting on a line, front first. */
export async function getWaitingQueue(
  db: Firestore,
  lineId: string
): Promise<QueueEntry[]> {
  const snapshot = await queueCollection(db, lineId)
    .where('status', '==', 'waiting')
    .orderBy('position', 'asc')
    .get();

  return snapshot.docs.map((doc) => {
    const data = docData(doc);
    return {
      driverId: getString(data, 'driverId', doc.id),
      lineId: getString(data, 'lineId', lineId),
      status: getString(data, 'status', 'waiting') as QueueEntryStatus,
      position: getNumber(data, 'position', 0),
      joinedAt: null,
    };
  });
}

/**
 * Order a set of candidate driver ids by queue position.
 *
 * Drivers on the line come first, in FIFO order. Anyone not in the queue keeps their
 * original (distance-ranked) relative order behind them, so enabling the queue never
 * makes a trip UNMATCHABLE - it only changes who is asked first. That property is
 * what lets this ship behind a flag without risking dead trips.
 */
export async function orderCandidatesByQueue(
  db: Firestore,
  lineId: string,
  candidateDriverIds: readonly string[]
): Promise<string[]> {
  if (candidateDriverIds.length === 0) return [];

  const queue = await getWaitingQueue(db, lineId);
  const positionByDriver = new Map(queue.map((entry) => [entry.driverId, entry.position]));

  const inQueue = candidateDriverIds
    .filter((id) => positionByDriver.has(id))
    .sort((a, b) => (positionByDriver.get(a) ?? 0) - (positionByDriver.get(b) ?? 0));

  const notInQueue = candidateDriverIds.filter((id) => !positionByDriver.has(id));

  return [...inQueue, ...notInQueue];
}

/** Mark a driver as holding an offer, so they are not offered a second trip. */
export function markOfferedInTransaction(
  transaction: Transaction,
  db: Firestore,
  lineId: string,
  driverId: string
): void {
  transaction.set(
    queueCollection(db, lineId).doc(driverId),
    { status: 'offered', updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}
