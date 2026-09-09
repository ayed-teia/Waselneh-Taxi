import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';

const PlanSchema = z.object({
  planId: z.string().trim().min(1).optional(),
  nameAr: z.string().trim().min(2).max(100),
  nameEn: z.string().trim().min(2).max(100),
  billingModel: z.enum(['per_trip', 'subscription', 'hybrid']),
  commissionBps: z.number().int().min(0).max(10_000),
  recurringFeeIls: z.number().min(0).max(100_000),
  billingInterval: z.enum(['monthly', 'quarterly', 'annual']),
  isActive: z.boolean(),
});

const AssignmentSchema = z.object({
  targetType: z.enum(['driver', 'office']),
  targetId: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  status: z.enum(['trialing', 'active', 'past_due', 'suspended', 'cancelled']),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
}).refine(
  (value) => !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt),
  { message: 'endsAt must be after startsAt', path: ['endsAt'] }
);
const StoredPlanSchema = PlanSchema.omit({ planId: true });

async function requireGlobalBillingManager(managerId: string) {
  const profile = await assertManagerPermission(managerId, 'manage_pricing');
  if (!profile.isGlobalScope) throw new ForbiddenError('Only a global manager can manage billing');
}

export const managerUpsertSubscriptionPlan = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await requireGlobalBillingManager(managerId);
    const parsed = PlanSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid subscription plan', parsed.error.flatten());

    const db = getFirestore();
    const planRef = parsed.data.planId
      ? db.collection('subscriptionPlans').doc(parsed.data.planId)
      : db.collection('subscriptionPlans').doc();
    const { planId: _planId, ...fields } = parsed.data;
    await planRef.set({
      ...fields,
      planId: planRef.id,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: managerId,
      ...(!_planId ? { createdAt: FieldValue.serverTimestamp(), createdBy: managerId } : {}),
    }, { merge: true });
    return { success: true as const, planId: planRef.id };
  } catch (error) {
    throw handleError(error);
  }
});

export const managerAssignSubscription = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await requireGlobalBillingManager(managerId);
    const parsed = AssignmentSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid subscription assignment', parsed.error.flatten());

    const db = getFirestore();
    const targetCollection = parsed.data.targetType === 'driver' ? 'drivers' : 'offices';
    const targetRef = db.collection(targetCollection).doc(parsed.data.targetId);
    const planRef = db.collection('subscriptionPlans').doc(parsed.data.planId);
    const [targetDoc, planDoc] = await Promise.all([targetRef.get(), planRef.get()]);
    if (!targetDoc.exists) throw new NotFoundError(parsed.data.targetType, parsed.data.targetId);
    const storedPlan = StoredPlanSchema.safeParse(planDoc.data());
    if (!planDoc.exists || !storedPlan.success || !storedPlan.data.isActive) {
      throw new NotFoundError('Active subscription plan', parsed.data.planId);
    }

    const assignmentId = `${parsed.data.targetType}_${parsed.data.targetId}`;
    const assignmentRef = db.collection('subscriptions').doc(assignmentId);
    const auditRef = assignmentRef.collection('events').doc();
    const startsAt = Timestamp.fromDate(new Date(parsed.data.startsAt));
    const endsAt = parsed.data.endsAt ? Timestamp.fromDate(new Date(parsed.data.endsAt)) : null;
    const plan = storedPlan.data;

    const batch = db.batch();
    batch.set(assignmentRef, {
        subscriptionId: assignmentId,
        ...parsed.data,
        startsAt,
        endsAt,
        commissionBps: plan.commissionBps,
        recurringFeeIls: plan.recurringFeeIls,
        billingModel: plan.billingModel,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: managerId,
      }, { merge: true });
    batch.set(targetRef, {
        subscriptionId: assignmentId,
        subscriptionPlanId: parsed.data.planId,
        subscriptionStatus: parsed.data.status,
        subscriptionStartsAt: startsAt,
        subscriptionEndsAt: endsAt,
        commissionBps: plan.commissionBps,
        subscriptionUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    batch.set(auditRef, {
        type: 'subscription_assigned',
        planId: parsed.data.planId,
        status: parsed.data.status,
        actorId: managerId,
        createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { success: true as const, subscriptionId: assignmentId };
  } catch (error) {
    throw handleError(error);
  }
});
