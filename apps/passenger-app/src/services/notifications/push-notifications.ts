import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { arrayUnion, firebaseDB, serverTimestamp } from '../firebase';

const INSTALLATION_ID_KEY = 'waselneh.passenger.installationId';

export interface UserNotification {
  id: string;
  tripId: string;
  status: string;
  title: string;
  body: string;
  read: boolean;
  createdAtMs: number;
}

async function getInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;

  const generated = `passenger-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, generated);
  return generated;
}

async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.easConfig?.projectId;

  const result = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  return result.data || null;
}

export async function registerNotificationDevice(
  userId: string,
  locale: 'en' | 'ar'
): Promise<void> {
  try {
    const installationId = await getInstallationId();
    const expoPushToken = await getExpoPushToken();

    const updatePayload: Record<string, unknown> = {
      userId,
      preferredLocale: locale,
      platform: 'passenger',
      updatedAt: serverTimestamp(),
      [`installations.${installationId}`]: {
        updatedAt: serverTimestamp(),
        platform: Device.osName || 'android',
        modelName: Device.modelName || 'unknown',
      },
    };

    if (expoPushToken) {
      updatePayload.expoPushTokens = arrayUnion(expoPushToken);
      console.log('[Notifications] Passenger expo token registered');
    } else {
      console.log('[Notifications] Passenger expo token unavailable (device/emulator/permission)');
    }

    await firebaseDB
      .collection('userDevices')
      .doc(userId)
      .set(updatePayload, { merge: true });
  } catch (error) {
    console.warn('[Notifications] Failed to register passenger device', error);
  }
}

export function subscribeToUserNotifications(
  userId: string,
  onData: (items: UserNotification[]) => void,
  onError?: (error: Error) => void
): () => void {
  return firebaseDB
    .collection('userNotifications')
    .doc(userId)
    .collection('items')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(
      (snapshot) => {
        const items: UserNotification[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Record<string, any>;
          const createdAt = data.createdAt;
          const createdAtMs =
            typeof createdAt?.toMillis === 'function'
              ? createdAt.toMillis()
              : Date.now();

          return {
            id: doc.id,
            tripId: String(data.tripId || ''),
            status: String(data.status || ''),
            title: String(data.title || data.titleEn || 'Trip update'),
            body: String(data.body || data.bodyEn || ''),
            read: Boolean(data.read),
            createdAtMs,
          };
        });

        onData(items);
      },
      (error) => {
        if (onError) onError(error as Error);
      }
    );
}

export async function markUserNotificationRead(
  userId: string,
  notificationId: string
): Promise<void> {
  await firebaseDB
    .collection('userNotifications')
    .doc(userId)
    .collection('items')
    .doc(notificationId)
    .set(
      {
        read: true,
        readAt: serverTimestamp(),
      },
      { merge: true }
    );
}
