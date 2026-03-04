import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { REGION } from '../../core/env';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { handleError, UnauthorizedError, ValidationError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';

const ManagerAcknowledgeAlertSchema = z.object({
  alertId: z.string().trim().min(1),
  note: z.string().trim().max(500).optional(),
});

interface ManagerAcknowledgeAlertResponse {
  success: true;
  alertId: string;
}

export const managerAcknowledgeAlert = onCall<
  unknown,
  Promise<ManagerAcknowledgeAlertResponse>
>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) {
        throw new UnauthorizedError('Authentication required');
      }
      await assertManagerPermission(managerId, 'manage_alerts');

      const parsed = ManagerAcknowledgeAlertSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid acknowledge payload', parsed.error.flatten());
      }

      const { alertId, note } = parsed.data;
      const db = getFirestore();
      await db.collection('opsAlerts').doc(alertId).set(
        {
          acknowledgedAt: FieldValue.serverTimestamp(),
          acknowledgedBy: managerId,
          acknowledgedNote: note ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        success: true,
        alertId,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
