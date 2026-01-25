import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { REGION } from '../../core/env';
import { handleError, ValidationError } from '../../core/errors';
import { logger } from '../../core/logger';

const PingRequestSchema = z.object({
  message: z.string().min(1).max(100).optional(),
});

interface PingResponse {
  pong: boolean;
  message: string;
  timestamp: string;
  userId: string | null;
}

/**
 * Example callable function - ping/pong
 * Can be called authenticated or unauthenticated
 */
export const ping = onCall<unknown, Promise<PingResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const parsed = PingRequestSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError('Invalid request data', parsed.error.flatten());
      }

      const { message } = parsed.data;
      const userId = request.auth?.uid ?? null;

      logger.info('Ping received', { userId, message });

      return {
        pong: true,
        message: message ?? 'Hello from Firebase Functions!',
        timestamp: new Date().toISOString(),
        userId,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
