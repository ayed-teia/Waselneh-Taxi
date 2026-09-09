import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';

const Schema = z.object({ officeId: z.string().trim().min(1).max(128) });

function serialize(id: string, value: FirebaseFirestore.DocumentData) {
  return Object.fromEntries(
    Object.entries({ id, ...value }).map(([key, item]) => [
      key,
      item && typeof item === 'object' && (item as unknown) instanceof Timestamp
        ? (item as unknown as Timestamp).toDate().toISOString()
        : item,
    ])
  );
}

export const getManagerOfficeDashboard = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    const parsed = Schema.safeParse(request.data);
    if (!parsed.success)
      throw new ValidationError('Invalid office dashboard request', parsed.error.flatten());

    const { officeId } = parsed.data;
    await assertManagerPermission(managerId, 'view_dashboard', { officeId });
    const db = getFirestore();
    const [office, drivers, vehicles, lines, trips, commissions, invoices, subscription] =
      await Promise.all([
        db.collection('offices').doc(officeId).get(),
        db.collection('drivers').where('officeId', '==', officeId).limit(250).get(),
        db.collection('vehicles').where('officeId', '==', officeId).limit(250).get(),
        db.collection('lines').where('officeId', '==', officeId).limit(100).get(),
        db.collection('trips').where('officeId', '==', officeId).limit(500).get(),
        db.collection('commissionRecords').where('officeId', '==', officeId).limit(500).get(),
        db.collection('subscriptionInvoices').where('targetId', '==', officeId).limit(100).get(),
        db.collection('subscriptions').doc(`office_${officeId}`).get(),
      ]);
    if (!office.exists) throw new NotFoundError('Office', officeId);

    return {
      office: serialize(office.id, office.data() ?? {}),
      drivers: drivers.docs.map((doc) => serialize(doc.id, doc.data())),
      vehicles: vehicles.docs.map((doc) => serialize(doc.id, doc.data())),
      lines: lines.docs.map((doc) => serialize(doc.id, doc.data())),
      trips: trips.docs.map((doc) => serialize(doc.id, doc.data())),
      commissions: commissions.docs.map((doc) => serialize(doc.id, doc.data())),
      invoices: invoices.docs
        .filter((doc) => doc.data().targetType === 'office')
        .map((doc) => serialize(doc.id, doc.data())),
      subscription: subscription.exists
        ? serialize(subscription.id, subscription.data() ?? {})
        : null,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw handleError(error);
  }
});
