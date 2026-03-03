import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { REGION } from '../../core/env';
import { getAuth, getFirestore, isEmulatorEnvironment } from '../../core/config';

interface DevCustomTokenBody {
  uid?: unknown;
}

/**
 * Dev-only endpoint:
 * - Upserts an eligible driver profile for the provided UID
 * - Returns a Firebase custom token for that UID
 */
export const devCustomToken = onRequest(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (req, res) => {
    if (!isEmulatorEnvironment()) {
      res.status(403).json({ error: 'This endpoint is available only in emulator mode.' });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = (req.body || {}) as DevCustomTokenBody;
    const uid = typeof body.uid === 'string' ? body.uid.trim() : '';

    if (!uid) {
      res.status(400).json({ error: 'uid is required' });
      return;
    }

    try {
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
      res.status(200).json({ uid, token });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mint custom token';
      res.status(500).json({ error: message });
    }
  }
);

