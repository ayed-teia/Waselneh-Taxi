/**
 * ============================================================================
 * DRIVER ONBOARDING DOCUMENTS
 * ============================================================================
 *
 * Metadata lives at:  drivers/{driverId}/private/documents/{documentType}
 * The file itself at: driver-documents/{driverId}/{documentType}/{fileName}  (Storage)
 *
 * WHY UNDER private/
 * These records reference identity documents. The parent drivers/{driverId} document
 * is readable by the passenger on an active trip (they need the driver card), so
 * anything placed there is visible to them. `private/` carries its own rule - the
 * same reason nationalId and phone were moved there.
 *
 * STATE MACHINE
 *   pending  -> approved            (a manager verified it)
 *   pending  -> rejected(reason)    (a manager refused it)
 *   rejected -> pending             (the driver re-uploaded)
 *   approved -> rejected            (revocation; e.g. a licence later found invalid)
 *
 * `approved -> pending` is NOT allowed: a re-upload over an approved document would
 * silently drop verification. The driver must be rejected first, deliberately.
 *
 * RETENTION
 * A single named constant, pending legal review. It is NOT enforced anywhere yet -
 * deleting identity documents on a timer without a lawyer's sign-off would be worse
 * than keeping them. See docs/REMAINING_PLAN.md.
 * ============================================================================
 */

/** Document kinds a driver can be asked for. */
export const DRIVER_DOCUMENT_TYPES = [
  'national_id',
  'driving_licence',
  'vehicle_registration',
  'insurance',
  'profile_photo',
] as const;

export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

/**
 * Documents that must be approved before a driver can be verified.
 * profile_photo is useful but not an eligibility gate.
 */
export const REQUIRED_DRIVER_DOCUMENTS: readonly DriverDocumentType[] = [
  'national_id',
  'driving_licence',
  'vehicle_registration',
];

export type DriverDocumentStatus = 'pending' | 'approved' | 'rejected';

export interface DriverDocumentRecord {
  driverId: string;
  documentType: DriverDocumentType;
  storagePath: string;
  status: DriverDocumentStatus;
  uploadedAt?: unknown;
  reviewedAt?: unknown;
  reviewedBy?: string | null;
  reviewNote?: string | null;
}

/**
 * PLACEHOLDER, pending legal review. Nothing enforces this yet - it exists so the
 * number has one home rather than being invented separately in three places when
 * someone finally implements deletion.
 *
 * Storing scans of national IDs creates a real retention obligation; the actual
 * figure is a question for your DPO/lawyer, not for this file.
 */
export const DRIVER_DOCUMENT_RETENTION_DAYS = 365 * 2;

export function isDriverDocumentType(value: unknown): value is DriverDocumentType {
  return (
    typeof value === 'string' &&
    (DRIVER_DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

/** Whether a status transition is permitted. */
export function canTransition(
  from: DriverDocumentStatus | null,
  to: DriverDocumentStatus
): boolean {
  // A first upload always lands as pending.
  if (from === null) return to === 'pending';

  switch (from) {
    case 'pending':
      return to === 'approved' || to === 'rejected';
    case 'rejected':
      // Re-upload after a rejection.
      return to === 'pending';
    case 'approved':
      // Revocation is allowed; silently reverting to pending is not, because a
      // re-upload would otherwise drop an existing verification without review.
      return to === 'rejected';
    default:
      return false;
  }
}

/**
 * Reduce a client-supplied file name to a single safe path segment.
 *
 * WHY THIS EXISTS
 *
 * `documentStoragePath` interpolates this into a path. A name like
 * `../../other-driver/national_id/x.jpg` would otherwise produce a storagePath
 * pointing OUTSIDE the uploader's own prefix. Storage itself still refuses the
 * upload - storage.rules binds the real object path to {driverId} - so this was
 * never a file-read breach. But the Firestore metadata record would carry an
 * attacker-chosen path, and anything that later trusts `storagePath` (a signed-URL
 * callable, a manager review queue) would be aimed at an arbitrary object.
 *
 * Sanitising at the boundary is the fix, rather than relying on every future
 * consumer to re-derive safety from a field it has no reason to distrust.
 *
 * Returns null when nothing usable survives, so the caller can reject rather than
 * invent a name.
 */
export function sanitizeDocumentFileName(rawFileName: string): string | null {
  // Take the last segment: any directory structure the client supplied is discarded
  // outright rather than escaped, which also handles backslashes on Windows clients.
  const lastSegment = rawFileName.split(/[/\\]/).pop() ?? '';

  // '.' and '..' are path operators, never file names.
  if (lastSegment === '.' || lastSegment === '..') return null;

  // Keep letters, digits, dot, dash and underscore. Everything else - including the
  // NUL byte, control characters and whitespace - becomes an underscore.
  const cleaned = lastSegment.replace(/[^A-Za-z0-9._-]/g, '_');

  // A name that is only dots would still read as a path operator to some consumers.
  if (!cleaned || /^\.+$/.test(cleaned)) return null;

  // Bound the length so the final path cannot be used to blow a key-size limit.
  return cleaned.slice(0, 120);
}

/**
 * The Storage path a document must live at.
 *
 * `fileName` is sanitised here rather than trusted: see sanitizeDocumentFileName.
 * Throws when nothing usable survives, because silently substituting a generated
 * name would hide a malformed or hostile client from whoever is reading the logs.
 */
export function documentStoragePath(
  driverId: string,
  documentType: DriverDocumentType,
  fileName: string
): string {
  const safeFileName = sanitizeDocumentFileName(fileName);
  if (!safeFileName) {
    throw new Error('File name contains no usable characters');
  }
  return `driver-documents/${driverId}/${documentType}/${safeFileName}`;
}

/**
 * Whether every REQUIRED document is approved.
 * Used to decide when a driver may be moved to verificationStatus 'approved'.
 */
export function allRequiredDocumentsApproved(
  documents: readonly { documentType: string; status: string }[]
): boolean {
  return REQUIRED_DRIVER_DOCUMENTS.every((required) =>
    documents.some((doc) => doc.documentType === required && doc.status === 'approved')
  );
}
