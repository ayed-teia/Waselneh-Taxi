import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import {
  ForbiddenError,
  handleError,
  UnauthorizedError,
  ValidationError,
} from '../../core/errors';
import { docData, getString } from '../../core/firestore/doc-data';
import { logger } from '../../core/logger';
import { assertManagerPermission } from '../../modules/auth/manager-rbac';
import {
  allRequiredDocumentsApproved,
  canTransition,
  documentStoragePath,
  sanitizeDocumentFileName,
  DRIVER_DOCUMENT_TYPES,
  type DriverDocumentStatus,
  type DriverDocumentType,
} from '../../modules/drivers/driver-documents';

/**
 * ============================================================================
 * DRIVER ONBOARDING DOCUMENT CALLABLES
 * ============================================================================
 *
 * The FILE goes to Storage directly from the client, governed by storage.rules
 * (a driver may write only under their own prefix). These callables own the
 * METADATA and the state machine, because status is an authorization decision and
 * must not be client-writable: the Firestore rule for
 * drivers/{id}/private/documents is `allow write: if false`.
 *
 * So a driver can upload a file, but only a manager can call it approved.
 * ============================================================================
 */

const RegisterUploadSchema = z.object({
  documentType: z.enum(DRIVER_DOCUMENT_TYPES),
  fileName: z.string().trim().min(1).max(200),
});

const ReviewDocumentSchema = z.object({
  driverId: z.string().trim().min(1).max(200),
  documentType: z.enum(DRIVER_DOCUMENT_TYPES),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
});

interface RegisterUploadResponse {
  documentType: DriverDocumentType;
  status: DriverDocumentStatus;
  storagePath: string;
}

/**
 * A driver registers that they have uploaded a document. Always lands as `pending`
 * - a driver can never set their own status.
 */
export const registerDriverDocument = onCall<unknown, Promise<RegisterUploadResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    try {
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) throw new UnauthorizedError('Authentication required');

      const parsed = RegisterUploadSchema.safeParse(request.data);
      if (!parsed.success) throw new ValidationError('Invalid document registration');

      const { documentType, fileName } = parsed.data;
      const db = getFirestore();
      const ref = db
        .collection('drivers')
        .doc(driverId)
        .collection('private')
        .doc('documents')
        .collection('items')
        .doc(documentType);

      const existing = await ref.get();
      const currentStatus = existing.exists
        ? (getString(docData(existing), 'status', 'pending') as DriverDocumentStatus)
        : null;

      // A re-upload over an APPROVED document would silently drop its verification.
      if (!canTransition(currentStatus, 'pending')) {
        throw new ForbiddenError(
          `Cannot re-upload a document in status '${currentStatus}'. It must be rejected first.`
        );
      }

      // Sanitise here as well as inside documentStoragePath, so a hostile or
      // malformed name is reported as the client error it is. Left to the module's
      // own throw it would reach handleError as a bare Error, surface to the driver
      // as "An unexpected error occurred", and be logged as an unhandled crash -
      // three wrong signals for one bad input field.
      const safeFileName = sanitizeDocumentFileName(fileName);
      if (!safeFileName) {
        throw new ValidationError('File name contains no usable characters');
      }

      const storagePath = documentStoragePath(driverId, documentType, safeFileName);

      await ref.set(
        {
          driverId,
          documentType,
          storagePath,
          status: 'pending',
          uploadedAt: FieldValue.serverTimestamp(),
          // Clear any previous review when a new file is submitted.
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: null,
        },
        { merge: true }
      );

      logger.info('[DriverDocuments] Document registered', { driverId, documentType });

      return { documentType, status: 'pending', storagePath };
    } catch (error) {
      throw handleError(error);
    }
  }
);

interface ReviewDocumentResponse {
  documentType: DriverDocumentType;
  status: DriverDocumentStatus;
  allRequiredApproved: boolean;
}

/**
 * A manager approves or rejects a document.
 *
 * Requires the manage_drivers permission via assertManagerPermission, which reads
 * managerRoles/{uid} and nothing else (R1).
 */
export const reviewDriverDocument = onCall<unknown, Promise<ReviewDocumentResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const parsed = ReviewDocumentSchema.safeParse(request.data);
      if (!parsed.success) throw new ValidationError('Invalid review request');

      const { driverId, documentType, decision, note } = parsed.data;

      // Authorization: managerRoles is the only authority.
      await assertManagerPermission(managerId, 'manage_drivers');

      const db = getFirestore();
      const itemsRef = db
        .collection('drivers')
        .doc(driverId)
        .collection('private')
        .doc('documents')
        .collection('items');
      const ref = itemsRef.doc(documentType);

      const existing = await ref.get();
      if (!existing.exists) {
        throw new ValidationError('That document has not been uploaded yet');
      }

      const currentStatus = getString(
        docData(existing),
        'status',
        'pending'
      ) as DriverDocumentStatus;

      if (!canTransition(currentStatus, decision)) {
        throw new ForbiddenError(
          `Cannot move a document from '${currentStatus}' to '${decision}'.`
        );
      }

      await ref.set(
        {
          status: decision,
          reviewedAt: FieldValue.serverTimestamp(),
          reviewedBy: managerId,
          reviewNote: note ?? null,
        },
        { merge: true }
      );

      // Report whether the driver is now fully documented. Deliberately only
      // REPORTED, not auto-applied: flipping verificationStatus is a separate,
      // explicit manager action (managerSetDriverEligibility), so approving one
      // document cannot silently put a driver on the road.
      const all = await itemsRef.get();
      const documents = all.docs.map((d) => {
        const data = docData(d);
        return {
          documentType: getString(data, 'documentType', d.id),
          status: getString(data, 'status', 'pending'),
        };
      });

      logger.info('[DriverDocuments] Document reviewed', {
        driverId,
        documentType,
        decision,
        managerId,
      });

      return {
        documentType,
        status: decision,
        allRequiredApproved: allRequiredDocumentsApproved(documents),
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
