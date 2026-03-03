import { getFirestore } from '../../core/config';
import { ForbiddenError } from '../../core/errors';
import { logger } from '../../core/logger';

const REQUIRED_DRIVER_TYPE = 'licensed_line_owner';
const REQUIRED_VERIFICATION_STATUS = 'approved';

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface DriverEligibilityResult {
  isEligible: boolean;
  driverType: string | null;
  verificationStatus: string | null;
  lineId: string | null;
  licenseId: string | null;
  reasons: string[];
}

export function evaluateDriverEligibility(
  data: FirebaseFirestore.DocumentData | undefined
): DriverEligibilityResult {
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

  const reasons: string[] = [];

  if (driverType !== REQUIRED_DRIVER_TYPE) {
    reasons.push('invalid_driver_type');
  }

  if (verificationStatus !== REQUIRED_VERIFICATION_STATUS) {
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

function getEligibilityFailureMessage(reasons: string[]): string {
  const detailByReason: Record<string, string> = {
    missing_profile: 'Driver profile was not found.',
    invalid_driver_type: `driverType must be '${REQUIRED_DRIVER_TYPE}'.`,
    driver_not_approved: `verificationStatus must be '${REQUIRED_VERIFICATION_STATUS}'.`,
    missing_line_or_license_link: 'A valid lineId or licenseId is required.',
  };

  const details = reasons
    .map((reason) => detailByReason[reason] ?? reason)
    .join(' ');

  return `Only approved licensed line owners linked to a licensed line can perform this action. ${details}`.trim();
}

export function ensureDriverIsLicensedLineOwnerData(
  driverId: string,
  data: FirebaseFirestore.DocumentData | undefined
): DriverEligibilityResult {
  const eligibility = evaluateDriverEligibility(data);

  if (!eligibility.isEligible) {
    logger.warn('[DriverEligibility] Driver blocked by eligibility guard', {
      driverId,
      driverType: eligibility.driverType,
      verificationStatus: eligibility.verificationStatus,
      lineId: eligibility.lineId,
      licenseId: eligibility.licenseId,
      reasons: eligibility.reasons,
    });
    throw new ForbiddenError(getEligibilityFailureMessage(eligibility.reasons));
  }

  return eligibility;
}

export async function assertDriverIsLicensedLineOwner(driverId: string): Promise<DriverEligibilityResult> {
  const db = getFirestore();
  const driverDoc = await db.collection('drivers').doc(driverId).get();
  return ensureDriverIsLicensedLineOwnerData(driverId, driverDoc.data());
}

