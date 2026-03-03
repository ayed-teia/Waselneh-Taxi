import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { logger } from '../../core/logger';
import { evaluateDriverEligibility } from './driver-eligibility';

export const enforceDriverEligibility = onDocumentWritten(
  {
    region: REGION,
    document: 'drivers/{driverId}',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const driverId = event.params.driverId as string;
    const after = event.data?.after;

    if (!after?.exists) {
      return;
    }

    const afterData = after.data();
    const eligibility = evaluateDriverEligibility(afterData);

    if (eligibility.isEligible) {
      return;
    }

    const db = getFirestore();
    const driverRef = db.collection('drivers').doc(driverId);
    const driverLiveRef = db.collection('driverLive').doc(driverId);
    const driverLiveDoc = await driverLiveRef.get();

    const shouldForceOffline =
      afterData?.isOnline === true ||
      afterData?.status === 'online' ||
      afterData?.isAvailable === true;

    const alreadyMarkedBlocked =
      afterData?.eligibilityBlocked === true &&
      afterData?.isOnline === false &&
      afterData?.isAvailable === false &&
      afterData?.status === 'offline';

    if (!shouldForceOffline && alreadyMarkedBlocked && !driverLiveDoc.exists) {
      return;
    }

    await db.runTransaction(async (transaction) => {
      transaction.set(
        driverRef,
        {
          isOnline: false,
          isAvailable: false,
          status: 'offline',
          availability: 'offline',
          eligibilityBlocked: true,
          eligibilityBlockedAt: FieldValue.serverTimestamp(),
          eligibilityBlockReasons: eligibility.reasons,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (driverLiveDoc.exists) {
        transaction.delete(driverLiveRef);
      }
    });

    logger.warn('[DriverEligibilityEnforcer] Forced driver offline due to failed eligibility', {
      driverId,
      reasons: eligibility.reasons,
      driverType: eligibility.driverType,
      verificationStatus: eligibility.verificationStatus,
      lineId: eligibility.lineId,
      licenseId: eligibility.licenseId,
      hadLiveLocation: driverLiveDoc.exists,
    });
  }
);

