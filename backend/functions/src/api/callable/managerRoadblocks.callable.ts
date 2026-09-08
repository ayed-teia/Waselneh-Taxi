import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';

const RoadblockFields = z.object({
  name: z.string().trim().min(2).max(120),
  area: z.string().trim().max(120).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(50).max(10_000).default(250),
  status: z.enum(['open', 'closed', 'congested']).default('closed'),
  note: z.string().trim().max(500).optional(),
  delayMin: z.number().min(0).max(240).default(0),
  surchargeIls: z.number().min(0).max(200).default(0),
  source: z.enum(['operations', 'driver_report', 'official', 'ai_assisted']).default('operations'),
});

const UpsertSchema = RoadblockFields.partial().extend({ roadblockId: z.string().trim().min(1).optional() });
const DeleteSchema = z.object({ roadblockId: z.string().trim().min(1) });

export const managerUpsertRoadblock = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await assertManagerPermission(managerId, 'manage_alerts');
    const parsed = UpsertSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid roadblock data', parsed.error.flatten());
    const db = getFirestore();
    const ref = parsed.data.roadblockId
      ? db.collection('roadblocks').doc(parsed.data.roadblockId)
      : db.collection('roadblocks').doc();
    if (parsed.data.roadblockId && !(await ref.get()).exists) throw new NotFoundError('Roadblock not found');
    let fields: Record<string, unknown> = { ...parsed.data };
    delete fields.roadblockId;
    if (!parsed.data.roadblockId) {
      const complete = RoadblockFields.safeParse(fields);
      if (!complete.success) throw new ValidationError('Missing roadblock fields', complete.error.flatten());
      fields = complete.data;
    }
    await ref.set({
      ...fields,
      updatedBy: managerId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!parsed.data.roadblockId ? { createdBy: managerId, createdAt: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
    return { success: true as const, roadblockId: ref.id };
  } catch (error) {
    throw handleError(error);
  }
});

export const managerDeleteRoadblock = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await assertManagerPermission(managerId, 'manage_alerts');
    const parsed = DeleteSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid roadblock id', parsed.error.flatten());
    await getFirestore().collection('roadblocks').doc(parsed.data.roadblockId).delete();
    return { success: true as const };
  } catch (error) {
    throw handleError(error);
  }
});
