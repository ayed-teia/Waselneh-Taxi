import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';

const ReportClientErrorSchema = z.object({
  app: z.enum(['passenger-app', 'driver-app', 'manager-web', 'backend']),
  severity: z.enum(['info', 'warning', 'error', 'fatal']),
  message: z.string().trim().min(2).max(800),
  stack: z.string().max(8000).optional(),
  tags: z.record(z.string().max(64), z.string().max(256)).optional(),
  context: z.record(z.string().max(128), z.unknown()).optional(),
});

interface ReportClientErrorResponse {
  accepted: true;
  errorId: string;
}

export const reportClientError = onCall<unknown, Promise<ReportClientErrorResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (request) => {
    try {
      const parsed = ReportClientErrorSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid error report payload', parsed.error.flatten());
      }

      const userId = getAuthenticatedUserId(request);
      const payload = parsed.data;
      const db = getFirestore();
      const ref = db.collection('opsErrors').doc();

      await ref.set({
        errorId: ref.id,
        app: payload.app,
        severity: payload.severity,
        message: payload.message,
        stack: payload.stack ?? null,
        tags: payload.tags ?? {},
        context: payload.context ?? {},
        userId: userId ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });

      const logContext = {
        app: payload.app,
        severity: payload.severity,
        errorId: ref.id,
        userId: userId ?? null,
        tags: payload.tags ?? {},
      };

      if (payload.severity === 'fatal' || payload.severity === 'error') {
        logger.error('[OpsError] Client error reported', payload.message, logContext);
      } else if (payload.severity === 'warning') {
        logger.warn('[OpsError] Client warning reported', logContext);
      } else {
        logger.info('[OpsError] Client info reported', logContext);
      }

      return {
        accepted: true,
        errorId: ref.id,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
