import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { logger } from '../../core/logger';

type AlertSeverity = 'warning' | 'critical';

interface AlertState {
  alertId: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  details: Record<string, unknown>;
}

const ACTIVE_TRIP_STATUSES = ['pending', 'accepted', 'driver_arrived', 'in_progress'];
const ALERT_ID_FATAL_ERRORS = 'fatal_errors';
const ALERT_ID_HIGH_ERROR_RATE = 'high_error_rate';
const ALERT_ID_NO_ONLINE_DRIVERS = 'no_online_drivers';
const ALERT_ID_DISPATCH_STARVATION = 'dispatch_starvation';

async function upsertAlert(alert: AlertState): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('opsAlerts').doc(alert.alertId);
  const existing = await ref.get();

  if (existing.exists && existing.data()?.status === 'open') {
    await ref.set(
      {
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        details: alert.details,
        status: 'open',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  await ref.set(
    {
      alertId: alert.alertId,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      details: alert.details,
      status: 'open',
      acknowledgedAt: null,
      acknowledgedBy: null,
      openedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
    },
    { merge: true }
  );
}

async function resolveAlert(alertId: string): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('opsAlerts').doc(alertId);
  const existing = await ref.get();
  if (!existing.exists || existing.data()?.status !== 'open') {
    return;
  }
  await ref.set(
    {
      status: 'resolved',
      resolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export const aggregateOpsMetrics = onSchedule(
  {
    region: REGION,
    schedule: 'every 5 minutes',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();
    const errorsWindowStart = Timestamp.fromMillis(now.toMillis() - 15 * 60 * 1000);
    const tripsWindowStart = Timestamp.fromMillis(now.toMillis() - 24 * 60 * 60 * 1000);

    logger.info('[OpsMetrics] Aggregation started');

    const [errorsSnapshot, activeTripsSnapshot, trips24hSnapshot, onlineDriversSnapshot] =
      await Promise.all([
        db.collection('opsErrors').where('createdAt', '>=', errorsWindowStart).get(),
        db.collection('trips').where('status', 'in', ACTIVE_TRIP_STATUSES).get(),
        db.collection('trips').where('createdAt', '>=', tripsWindowStart).get(),
        db.collection('drivers').where('isOnline', '==', true).get(),
      ]);

    const errorCounters = {
      total: errorsSnapshot.size,
      info: 0,
      warning: 0,
      error: 0,
      fatal: 0,
      byApp: {} as Record<string, number>,
    };

    errorsSnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const severity = typeof data.severity === 'string' ? data.severity : 'error';
      const app = typeof data.app === 'string' ? data.app : 'unknown';

      if (severity === 'fatal') errorCounters.fatal += 1;
      else if (severity === 'error') errorCounters.error += 1;
      else if (severity === 'warning') errorCounters.warning += 1;
      else errorCounters.info += 1;

      errorCounters.byApp[app] = (errorCounters.byApp[app] ?? 0) + 1;
    });

    let pendingTrips = 0;
    let inProgressTrips = 0;
    activeTripsSnapshot.forEach((docSnap) => {
      const status = docSnap.data()?.status;
      if (status === 'pending') pendingTrips += 1;
      if (status === 'in_progress' || status === 'accepted' || status === 'driver_arrived') {
        inProgressTrips += 1;
      }
    });

    let completedTrips24h = 0;
    let cancelledTrips24h = 0;
    trips24hSnapshot.forEach((docSnap) => {
      const status = docSnap.data()?.status;
      if (status === 'completed' || status === 'rated') completedTrips24h += 1;
      if (
        status === 'cancelled' ||
        status === 'cancelled_by_passenger' ||
        status === 'cancelled_by_driver' ||
        status === 'cancelled_by_system' ||
        status === 'no_driver_available'
      ) {
        cancelledTrips24h += 1;
      }
    });

    let onlineAvailableDrivers = 0;
    onlineDriversSnapshot.forEach((docSnap) => {
      if (docSnap.data()?.isAvailable === true) {
        onlineAvailableDrivers += 1;
      }
    });

    const metricsPayload = {
      generatedAt: FieldValue.serverTimestamp(),
      windows: {
        errorsMinutes: 15,
        tripsHours: 24,
      },
      errors: errorCounters,
      drivers: {
        onlineCount: onlineDriversSnapshot.size,
        availableOnlineCount: onlineAvailableDrivers,
      },
      trips: {
        activeCount: activeTripsSnapshot.size,
        pendingCount: pendingTrips,
        inProgressCount: inProgressTrips,
        createdLast24h: trips24hSnapshot.size,
        completedLast24h: completedTrips24h,
        cancelledLast24h: cancelledTrips24h,
      },
    };

    await db.collection('opsMetrics').doc('current').set(metricsPayload, { merge: true });

    const pendingAlertOps: Promise<void>[] = [];

    if (errorCounters.fatal > 0) {
      pendingAlertOps.push(
        upsertAlert({
          alertId: ALERT_ID_FATAL_ERRORS,
          title: 'Fatal client errors detected',
          message: `${errorCounters.fatal} fatal error(s) reported in last 15 minutes`,
          severity: 'critical',
          details: {
            fatal: errorCounters.fatal,
            byApp: errorCounters.byApp,
          },
        })
      );
    } else {
      pendingAlertOps.push(resolveAlert(ALERT_ID_FATAL_ERRORS));
    }

    if (errorCounters.error >= 20) {
      pendingAlertOps.push(
        upsertAlert({
          alertId: ALERT_ID_HIGH_ERROR_RATE,
          title: 'High error rate',
          message: `${errorCounters.error} error-level reports in last 15 minutes`,
          severity: 'warning',
          details: {
            errorCount: errorCounters.error,
            byApp: errorCounters.byApp,
          },
        })
      );
    } else {
      pendingAlertOps.push(resolveAlert(ALERT_ID_HIGH_ERROR_RATE));
    }

    if (onlineDriversSnapshot.size === 0) {
      pendingAlertOps.push(
        upsertAlert({
          alertId: ALERT_ID_NO_ONLINE_DRIVERS,
          title: 'No online drivers',
          message: 'No drivers are currently online.',
          severity: 'critical',
          details: {},
        })
      );
    } else {
      pendingAlertOps.push(resolveAlert(ALERT_ID_NO_ONLINE_DRIVERS));
    }

    if (pendingTrips > 0 && onlineAvailableDrivers === 0) {
      pendingAlertOps.push(
        upsertAlert({
          alertId: ALERT_ID_DISPATCH_STARVATION,
          title: 'Dispatch starvation',
          message: `${pendingTrips} pending trip(s) with no available online drivers`,
          severity: 'critical',
          details: {
            pendingTrips,
            onlineDrivers: onlineDriversSnapshot.size,
            availableOnlineDrivers: onlineAvailableDrivers,
          },
        })
      );
    } else {
      pendingAlertOps.push(resolveAlert(ALERT_ID_DISPATCH_STARVATION));
    }

    await Promise.all(pendingAlertOps);

    logger.info('[OpsMetrics] Aggregation complete', {
      errors: errorCounters.total,
      activeTrips: activeTripsSnapshot.size,
      onlineDrivers: onlineDriversSnapshot.size,
      availableOnlineDrivers: onlineAvailableDrivers,
    });
  }
);
