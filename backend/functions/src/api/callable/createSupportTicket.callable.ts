import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, UnauthorizedError, ValidationError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue } from 'firebase-admin/firestore';

const CreateSupportTicketSchema = z.object({
  tripId: z.string().min(1).optional(),
  category: z.enum(['trip', 'payment', 'safety', 'technical', 'other']),
  subject: z.string().min(3).max(120),
  message: z.string().min(5).max(2000),
});

interface CreateSupportTicketResponse {
  success: boolean;
  ticketId: string;
  status: 'open';
}

export const createSupportTicket = onCall<unknown, Promise<CreateSupportTicketResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const userId = getAuthenticatedUserId(request);
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const parsed = CreateSupportTicketSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid support ticket payload', parsed.error.flatten());
      }

      const { tripId, category, subject, message } = parsed.data;
      const db = getFirestore();
      const ticketRef = db.collection('supportTickets').doc();
      const role = request.auth?.token?.role ?? 'unknown';

      await ticketRef.set({
        userId,
        userRole: role,
        tripId: tripId ?? null,
        category,
        subject,
        message,
        status: 'open',
        source: 'mobile',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('[Support] Ticket created', {
        ticketId: ticketRef.id,
        userId,
        category,
        tripId: tripId ?? null,
      });

      return {
        success: true,
        ticketId: ticketRef.id,
        status: 'open',
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
