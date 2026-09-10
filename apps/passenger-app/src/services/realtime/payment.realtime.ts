import { firebaseDB, Unsubscribe } from '../firebase';

export type PaymentState =
  | 'pending'
  | 'awaiting_payment'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export interface PassengerPayment {
  id: string;
  tripId: string;
  amount: number;
  currency: string;
  status: PaymentState;
  provider: string | null;
  failureReason: string | null;
  paidAt: Date | null;
  refundedAt: Date | null;
}

const STATES = new Set<PaymentState>([
  'pending',
  'awaiting_payment',
  'paid',
  'failed',
  'cancelled',
  'refunded',
]);

export function subscribeToPayment(
  tripId: string,
  onData: (payment: PassengerPayment | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('payments')
    .doc(`payment_${tripId}`)
    .onSnapshot((snapshot) => {
      if (!snapshot.exists) {
        onData(null);
        return;
      }
      const data = snapshot.data();
      const rawStatus = String(data?.status ?? 'pending') as PaymentState;
      onData({
        id: snapshot.id,
        tripId: String(data?.tripId ?? tripId),
        amount: Number(data?.amount ?? 0),
        currency: String(data?.currency ?? 'ILS'),
        status: STATES.has(rawStatus) ? rawStatus : 'pending',
        provider: typeof data?.provider === 'string' ? data.provider : null,
        failureReason: typeof data?.failureReason === 'string' ? data.failureReason : null,
        paidAt: data?.paidAt?.toDate?.() ?? null,
        refundedAt: data?.refundedAt?.toDate?.() ?? null,
      });
    }, onError);
}

export function subscribeToPassengerPayments(
  passengerId: string,
  onData: (payments: PassengerPayment[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('payments')
    .where('passengerId', '==', passengerId)
    .limit(100)
    .onSnapshot((snapshot) => {
      const payments = snapshot.docs.map((document) => {
        const data = document.data();
        const rawStatus = String(data?.status ?? 'pending') as PaymentState;
        return {
          id: document.id,
          tripId: String(data?.tripId ?? ''),
          amount: Number(data?.amount ?? 0),
          currency: String(data?.currency ?? 'ILS'),
          status: STATES.has(rawStatus) ? rawStatus : 'pending',
          provider: typeof data?.provider === 'string' ? data.provider : null,
          failureReason: typeof data?.failureReason === 'string' ? data.failureReason : null,
          paidAt: data?.paidAt?.toDate?.() ?? null,
          refundedAt: data?.refundedAt?.toDate?.() ?? null,
        } satisfies PassengerPayment;
      });
payments.sort((left, right) =>
  (right.refundedAt?.getTime() ?? right.paidAt?.getTime() ?? 0) -
  (left.refundedAt?.getTime() ?? left.paidAt?.getTime() ?? 0)
);
      onData(payments);
    }, onError);
}
