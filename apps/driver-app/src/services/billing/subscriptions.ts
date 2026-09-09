import { firebaseDB, firebaseFunctions, Unsubscribe } from '../firebase/firebase';

export interface DriverSubscriptionInvoice {
  id: string;
  periodKey: string;
  amountIls: number;
  status: 'pending' | 'past_due' | 'suspended' | 'paid' | 'void';
  dueAt?: { toDate(): Date; toMillis(): number };
  createdAt?: { toDate(): Date; toMillis(): number };
  paidAt?: { toDate(): Date; toMillis(): number };
  paymentReference?: string;
}

export async function startSubscriptionInvoicePayment(invoiceId: string): Promise<string> {
  const result = await firebaseFunctions.httpsCallable('startSubscriptionInvoicePayment')({
    invoiceId,
  });
  return (result.data as { clientActionUrl: string }).clientActionUrl;
}

export function subscribeToDriverInvoices(
  driverId: string,
  callback: (items: DriverSubscriptionInvoice[]) => void
): Unsubscribe {
  return firebaseDB
    .collection('subscriptionInvoices')
    .where('targetId', '==', driverId)
    .onSnapshot((snapshot) => {
      const items = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as DriverSubscriptionInvoice
      );
      items.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      callback(items);
    });
}
