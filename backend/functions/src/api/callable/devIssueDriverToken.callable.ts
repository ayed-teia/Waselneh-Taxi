import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { REGION } from '../../core/env';
import { getAuth, getFirestore, isEmulatorEnvironment } from '../../core/config';
import { ValidationError } from '../../core/errors';

interface DevIssueDriverTokenResponse {
  uid: string;
  token: string;
}

export const devIssueDriverToken = onCall<unknown, Promise<DevIssueDriverTokenResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (request) => {
    if (!isEmulatorEnvironment()) {
      throw new ValidationError('This function is available only in emulator mode.');
    }

    const raw = request.data as { uid?: unknown } | undefined;
    const uid = typeof raw?.uid === 'string' ? raw.uid.trim() : '';

    if (!uid) {
      throw new ValidationError('uid is required');
    }

    const db = getFirestore();
    await db.collection('drivers').doc(uid).set(
      {
        driverId: uid,
        driverType: 'licensed_line_owner',
        verificationStatus: 'approved',
        lineId: `LINE_${uid.slice(0, 8).toUpperCase()}`,
        licenseId: null,
        isOnline: false,
        isAvailable: false,
        status: 'offline',
        updatedAt: FieldValue.serverTimestamp(),
        devProvisionedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const token = await getAuth().createCustomToken(uid, { role: 'driver' });
    return { uid, token };
  }
);

