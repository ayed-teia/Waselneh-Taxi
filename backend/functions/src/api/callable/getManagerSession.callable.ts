import { onCall } from 'firebase-functions/v2/https';
import { REGION } from '../../core/env';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { handleError, UnauthorizedError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';

interface ManagerSessionResponse {
  userId: string;
  role: string;
  permissions: string[];
  officeIds: string[];
  lineIds: string[];
  isGlobalScope: boolean;
  profile: {
    displayName: string | null;
    email: string | null;
  };
}

export const getManagerSession = onCall<unknown, Promise<ManagerSessionResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (request) => {
    try {
      const userId = getAuthenticatedUserId(request);
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const profile = await assertManagerPermission(userId, 'view_dashboard');
      const db = getFirestore();
      const userDoc = await db.collection('users').doc(userId).get();
      const data = userDoc.data() ?? {};

      return {
        userId,
        role: profile.role,
        permissions: profile.permissions,
        officeIds: profile.officeIds,
        lineIds: profile.lineIds,
        isGlobalScope: profile.isGlobalScope,
        profile: {
          displayName:
            typeof data.displayName === 'string' ? data.displayName : null,
          email: typeof data.email === 'string' ? data.email : null,
        },
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
