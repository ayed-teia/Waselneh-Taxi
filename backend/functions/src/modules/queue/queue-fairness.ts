/**
 * ============================================================================
 * TAXI-LINE QUEUE - FAIRNESS SIMULATION
 * ============================================================================
 *
 * WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT
 *
 * This is a pure, offline simulator for ANSWERING the fairness questions in
 * docs/REMAINING_PLAN.md section 3. It enforces nothing, is wired into no dispatch
 * path, and is called by no callable. Its only job is to let a human put numbers in
 * front of drivers before anyone agrees to a policy.
 *
 * It deliberately does NOT decide any of the open questions - whether a short trip
 * returns a driver to the head, whether a brief geofence exit forfeits a place,
 * whether a distance cap overrides FIFO. Those are "deliberately not decided in
 * code" pending driver sign-off, and a simulator that quietly picked answers would
 * be making the decision while appearing to inform it.
 *
 * Instead the policy is an INPUT. Run it twice with different rules and compare.
 *
 * WHY A SIMULATION IS WORTH HAVING AT ALL
 *
 * "FIFO is fairer" is an assertion. Whether it is true for a given rank depends on
 * arrival patterns, trip lengths, and how often drivers decline - and the forfeit
 * rules decide who earns money on a given day. A driver meeting goes better with a
 * distribution than with an adjective.
 *
 * Deterministic by construction: it takes events, not a clock, and no randomness.
 * The same input always yields the same report, so two people comparing policies
 * are comparing policies rather than noise.
 * ============================================================================
 */

/** What a driver did, at a given moment, in simulated time. */
export type SimEventKind =
  | 'join'
  | 'trip_offered'
  | 'trip_accepted'
  | 'trip_completed'
  | 'declined'
  | 'went_offline';

export interface SimEvent {
  /** Simulated milliseconds. Strictly the ordering key; no wall clock is read. */
  atMs: number;
  kind: SimEventKind;
  driverId: string;
  /** Fare in whole shekels, on `trip_completed`. */
  fareIls?: number;
  /** Trip duration in simulated minutes, on `trip_completed`. */
  durationMinutes?: number;
}

/**
 * The rules under test. Every field is a QUESTION from REMAINING_PLAN section 3,
 * expressed so it can be varied - never so it can be assumed.
 */
export interface FairnessPolicy {
  /** Does declining an offer send a driver to the back? */
  declineForfeitsPlace: boolean;
  /** Does going offline send a driver to the back? */
  offlineForfeitsPlace: boolean;
  /**
   * A trip at or below this many minutes returns the driver to the HEAD rather
   * than the tail. 0 disables it - the default, because it is undecided.
   */
  shortTripReturnsToHeadMaxMinutes: number;
}

/** The current default in the code, so a comparison has a baseline. */
export const IMPLEMENTED_POLICY: FairnessPolicy = {
  declineForfeitsPlace: true,
  offlineForfeitsPlace: true,
  shortTripReturnsToHeadMaxMinutes: 0,
};

export interface DriverOutcome {
  driverId: string;
  tripsCompleted: number;
  earningsIls: number;
  /** Simulated minutes spent waiting in the queue, summed across stints. */
  waitingMinutes: number;
  timesForfeited: number;
}

export interface FairnessReport {
  outcomes: DriverOutcome[];
  totalTrips: number;
  totalEarningsIls: number;
  /**
   * Gini coefficient over earnings: 0 is perfectly equal, 1 maximally unequal.
   * A single number to compare two policies by - not a verdict on either.
   */
  earningsGini: number;
  /** Largest minus smallest trip count. The number drivers will actually cite. */
  tripCountSpread: number;
}

/**
 * Gini coefficient over a set of values.
 *
 * Returns 0 for an empty set, a single value, or an all-zero set - all of which
 * are "no measurable inequality" rather than an error. Guarding this matters
 * because a simulation of a quiet morning legitimately produces all zeros.
 */
export function giniCoefficient(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;

  let weighted = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    weighted += (index + 1) * (sorted[index] ?? 0);
  }

  const n = sorted.length;
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

interface QueueState {
  driverId: string;
  /** Lower is nearer the front. */
  position: number;
  /** When the current wait began, in simulated ms. */
  waitingSinceMs: number | null;
}

/**
 * Replay a set of events under a policy and report how the work was distributed.
 *
 * Events are sorted by `atMs` first, so a caller may supply them in any order.
 * Unknown driver ids are created on first sight: a simulation should describe what
 * it was given rather than reject it.
 */
export function simulateFairness(
  events: readonly SimEvent[],
  policy: FairnessPolicy = IMPLEMENTED_POLICY
): FairnessReport {
  const ordered = [...events].sort((a, b) => a.atMs - b.atMs);

  const outcomes = new Map<string, DriverOutcome>();
  const queue: QueueState[] = [];
  // Monotonic, like the real implementation's use of `Date.now()` as a position.
  let nextPosition = 1;

  const outcomeFor = (driverId: string): DriverOutcome => {
    let outcome = outcomes.get(driverId);
    if (!outcome) {
      outcome = {
        driverId,
        tripsCompleted: 0,
        earningsIls: 0,
        waitingMinutes: 0,
        timesForfeited: 0,
      };
      outcomes.set(driverId, outcome);
    }
    return outcome;
  };

  const indexOf = (driverId: string): number =>
    queue.findIndex((entry) => entry.driverId === driverId);

  /** Bank the wait accrued so far, then remove the driver from the queue. */
  const removeFrom = (driverId: string, atMs: number): void => {
    const index = indexOf(driverId);
    if (index < 0) return;
    const entry = queue[index];
    if (entry?.waitingSinceMs !== null && entry?.waitingSinceMs !== undefined) {
      outcomeFor(driverId).waitingMinutes += (atMs - entry.waitingSinceMs) / 60000;
    }
    queue.splice(index, 1);
  };

  const enqueue = (driverId: string, atMs: number, toHead: boolean): void => {
    removeFrom(driverId, atMs);
    // Front placement uses a position below every current entry rather than a
    // renumbering, mirroring the real module's single-assignment approach.
    const position = toHead
      ? Math.min(0, ...queue.map((entry) => entry.position)) - 1
      : nextPosition;
    nextPosition += 1;
    queue.push({ driverId, position, waitingSinceMs: atMs });
    queue.sort((a, b) => a.position - b.position);
  };

  for (const event of ordered) {
    const outcome = outcomeFor(event.driverId);

    switch (event.kind) {
      case 'join':
        enqueue(event.driverId, event.atMs, false);
        break;

      case 'trip_offered':
        // Being offered does not itself end the wait; accepting or declining does.
        break;

      case 'trip_accepted':
        removeFrom(event.driverId, event.atMs);
        break;

      case 'trip_completed': {
        outcome.tripsCompleted += 1;
        outcome.earningsIls += event.fareIls ?? 0;
        const duration = event.durationMinutes ?? 0;
        const toHead =
          policy.shortTripReturnsToHeadMaxMinutes > 0 &&
          duration <= policy.shortTripReturnsToHeadMaxMinutes;
        enqueue(event.driverId, event.atMs, toHead);
        break;
      }

      case 'declined':
        if (policy.declineForfeitsPlace) {
          outcome.timesForfeited += 1;
          enqueue(event.driverId, event.atMs, false);
        }
        break;

      case 'went_offline':
        if (policy.offlineForfeitsPlace) {
          outcome.timesForfeited += 1;
        }
        removeFrom(event.driverId, event.atMs);
        break;

      default:
        break;
    }
  }

  const list = [...outcomes.values()].sort((a, b) => a.driverId.localeCompare(b.driverId));
  const tripCounts = list.map((outcome) => outcome.tripsCompleted);

  return {
    outcomes: list,
    totalTrips: tripCounts.reduce((sum, count) => sum + count, 0),
    totalEarningsIls: list.reduce((sum, outcome) => sum + outcome.earningsIls, 0),
    earningsGini: giniCoefficient(list.map((outcome) => outcome.earningsIls)),
    tripCountSpread:
      tripCounts.length === 0 ? 0 : Math.max(...tripCounts) - Math.min(...tripCounts),
  };
}
