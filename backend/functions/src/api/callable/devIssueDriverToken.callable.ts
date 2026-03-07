import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { VEHICLE_TYPES, getDefaultSeatCapacityForVehicleType } from '@taxi-line/shared';
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
    const vehicleType = VEHICLE_TYPES.TAXI_STANDARD;
    const seatCapacity = getDefaultSeatCapacityForVehicleType(vehicleType);
    const lineSuffix = uid.slice(0, 8).toUpperCase();
    const lineId = `LINE_${lineSuffix}`;
    const lineNumber = `LN-${lineSuffix}`;
    const routePath = 'Nablus <-> Ramallah';
    const routeCities = ['Nablus', 'Ramallah'];
    const profileName = `Driver ${uid}`;
    const nationalId = uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase() || 'DEVDRIVER';
    const phone = `+97059${Math.abs(uid.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0))
      .toString()
      .slice(0, 6)
      .padStart(6, '0')}`;

    await db.collection('drivers').doc(uid).set(
      {
        driverId: uid,
        fullName: profileName,
        nationalId,
        phone,
        driverType: 'licensed_line_owner',
        verificationStatus: 'approved',
        lineId,
        licenseId: null,
        lineNumber,
        routePath,
        routeName: routePath,
        routeCities,
        vehicleType,
        seatCapacity,
        availableSeats: seatCapacity,
        isApproved: true,
        isOnline: false,
        isAvailable: false,
        status: 'offline',
        tripsCount: 0,
        rating: null,
        updatedAt: FieldValue.serverTimestamp(),
        devProvisionedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const token = await getAuth().createCustomToken(uid, { role: 'driver' });
    return { uid, token };
  }
);
