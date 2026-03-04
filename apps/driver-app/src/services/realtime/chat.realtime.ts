import { firebaseDB, serverTimestamp, Unsubscribe } from '../firebase';

export interface TripChatMessage {
  id: string;
  tripId: string;
  senderId: string;
  senderRole: 'passenger' | 'driver' | 'system';
  text: string;
  quickReply: boolean;
  createdAt: Date | null;
}

export function subscribeToTripChat(
  tripId: string,
  onData: (messages: TripChatMessage[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('trips')
    .doc(tripId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .limit(8)
    .onSnapshot(
      (snapshot) => {
        const messages = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            tripId,
            senderId: data?.senderId ?? '',
            senderRole: (data?.senderRole as TripChatMessage['senderRole']) ?? 'system',
            text: data?.text ?? '',
            quickReply: Boolean(data?.quickReply),
            createdAt: data?.createdAt?.toDate?.() ?? null,
          };
        });
        onData(messages);
      },
      onError
    );
}

export async function sendTripChatMessage(
  tripId: string,
  payload: {
    senderId: string;
    senderRole: 'passenger' | 'driver';
    text: string;
    quickReply?: boolean;
  }
): Promise<void> {
  await firebaseDB
    .collection('trips')
    .doc(tripId)
    .collection('messages')
    .add({
      senderId: payload.senderId,
      senderRole: payload.senderRole,
      text: payload.text.trim(),
      quickReply: Boolean(payload.quickReply),
      createdAt: serverTimestamp(),
    });
}
