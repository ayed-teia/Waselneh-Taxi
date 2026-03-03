import { firebaseDB, Unsubscribe } from '../firebase';

export type DriverEligibilityReason =
  | 'missing_profile'
  | 'invalid_driver_type'
  | 'driver_not_approved'
  | 'missing_line_or_license_link';

export interface DriverEligibilityState {
  isEligible: boolean;
  driverType: string | null;
  verificationStatus: string | null;
  lineId: string | null;
  licenseId: string | null;
  reasons: DriverEligibilityReason[];
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function evaluateEligibility(data: Record<string, unknown> | undefined): DriverEligibilityState {
  if (!data) {
    return {
      isEligible: false,
      driverType: null,
      verificationStatus: null,
      lineId: null,
      licenseId: null,
      reasons: ['missing_profile'],
    };
  }

  const driverType = toNonEmptyString(data.driverType);
  const verificationStatus = toNonEmptyString(data.verificationStatus);
  const lineId = toNonEmptyString(data.lineId);
  const licenseId = toNonEmptyString(data.licenseId);

  const reasons: DriverEligibilityReason[] = [];

  if (driverType !== 'licensed_line_owner') {
    reasons.push('invalid_driver_type');
  }

  if (verificationStatus !== 'approved') {
    reasons.push('driver_not_approved');
  }

  if (!lineId && !licenseId) {
    reasons.push('missing_line_or_license_link');
  }

  return {
    isEligible: reasons.length === 0,
    driverType,
    verificationStatus,
    lineId,
    licenseId,
    reasons,
  };
}

export function subscribeToDriverEligibility(
  driverId: string,
  onData: (state: DriverEligibilityState) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('drivers')
    .doc(driverId)
    .onSnapshot(
      (snapshot) => {
        const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined;
        onData(evaluateEligibility(data));
      },
      onError
    );
}

