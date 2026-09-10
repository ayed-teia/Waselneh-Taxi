import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { evaluatePromo, normalizePromoCode } from '../../modules/promotions';

const Schema = z.object({ code: z.string().trim().min(1).max(32) });

export const validatePromotion = onCall({ region: REGION }, async (request) => {
  try {
    const passengerId = getAuthenticatedUserId(request);
    if (!passengerId) throw new UnauthorizedError('Authentication required');
    const parsed = Schema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid promo code', parsed.error.flatten());
    const code = normalizePromoCode(parsed.data.code);
    const db = getFirestore();
    const [promoSnapshot, redemptionSnapshot] = await Promise.all([
      db.collection('promoCodes').doc(code).get(),
      db.collection('promoRedemptions').doc(`${code}_${passengerId}`).get(),
    ]);
    if (!promoSnapshot.exists) throw new ValidationError('Promo code is invalid');
    const promo = promoSnapshot.data() ?? {};
    const toMillis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : null;
    const minFareIls = Math.max(0, Number(promo.minFareIls) || 0);
    const decision = evaluatePromo({
      active: promo.active === true,
      discountType: promo.discountType === 'percentage' ? 'percentage' : 'fixed',
      discountValue: Number(promo.discountValue),
      maxDiscountIls: Number(promo.maxDiscountIls) || null,
      minFareIls,
      startsAtMs: toMillis(promo.startsAt),
      expiresAtMs: toMillis(promo.expiresAt),
      usageLimit: Number(promo.usageLimit) || null,
      usageCount: Number(promo.usageCount) || 0,
      perPassengerLimit: Number(promo.perPassengerLimit) || 1,
      passengerUsageCount: Number(redemptionSnapshot.data()?.usageCount) || 0,
    }, Math.max(1, minFareIls));
    if (!decision.valid) throw new ValidationError(`Promo code cannot be used: ${decision.reason}`);
    return {
      valid: true as const, code,
      nameAr: String(promo.nameAr ?? code), nameEn: String(promo.nameEn ?? code),
      discountType: promo.discountType === 'percentage' ? 'percentage' as const : 'fixed' as const,
      discountValue: Number(promo.discountValue), maxDiscountIls: Number(promo.maxDiscountIls) || null,
      minFareIls, expiresAt: promo.expiresAt instanceof Timestamp ? promo.expiresAt.toDate().toISOString() : null,
    };
  } catch (error) { throw handleError(error); }
});
