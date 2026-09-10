import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';
import { normalizePromoCode } from '../../modules/promotions';

const PromoSchema = z.object({
  code: z.string().trim().min(1).max(32),
  nameAr: z.string().trim().min(2).max(100),
  nameEn: z.string().trim().min(2).max(100),
  discountType: z.enum(['fixed', 'percentage']),
  discountValue: z.number().positive().max(100_000),
  maxDiscountIls: z.number().positive().max(100_000).nullable().optional(),
  minFareIls: z.number().min(0).max(100_000).default(0),
  usageLimit: z.number().int().positive().max(10_000_000).nullable().optional(),
  perPassengerLimit: z.number().int().positive().max(1_000).default(1),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  active: z.boolean(),
}).refine((value) => value.discountType !== 'percentage' || value.discountValue <= 100, {
  message: 'Percentage discount cannot exceed 100', path: ['discountValue'],
}).refine((value) => !value.startsAt || !value.expiresAt || new Date(value.expiresAt) > new Date(value.startsAt), {
  message: 'Expiry must be after start', path: ['expiresAt'],
});

export const managerUpsertPromotion = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    const profile = await assertManagerPermission(managerId, 'manage_promotions');
    if (!profile.isGlobalScope) throw new ForbiddenError('Only a global manager can manage promotions');
    const parsed = PromoSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid promotion', parsed.error.flatten());
    const code = normalizePromoCode(parsed.data.code);
    if (!code) throw new ValidationError('Promo code is invalid');

    const db = getFirestore();
    const promoRef = db.collection('promoCodes').doc(code);
    const existing = await promoRef.get();
    const auditRef = promoRef.collection('events').doc();
    const { startsAt, expiresAt, code: _code, ...fields } = parsed.data;
    void _code;
    const batch = db.batch();
    batch.set(promoRef, {
      ...fields,
      code,
      startsAt: startsAt ? Timestamp.fromDate(new Date(startsAt)) : null,
      expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: managerId,
      ...(!existing.exists ? { usageCount: 0, createdAt: FieldValue.serverTimestamp(), createdBy: managerId } : {}),
    }, { merge: true });
    batch.set(auditRef, {
      action: existing.exists ? 'updated' : 'created',
      active: parsed.data.active,
      actorId: managerId,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { success: true as const, code };
  } catch (error) {
    throw handleError(error);
  }
});
