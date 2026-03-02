import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore, getMessaging } from '../../core/config';
import { logger } from '../../core/logger';

type NotificationRole = 'passenger' | 'driver';
type SupportedLocale = 'en' | 'ar';

interface NotificationTokens {
  expoPushTokens: string[];
  fcmTokens: string[];
  preferredLocale: SupportedLocale;
}

interface LocalizedContent {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface TripNotificationRecipient {
  userId: string;
  role: NotificationRole;
}

export interface PublishTripStatusNotificationsInput {
  tripId: string;
  status: string;
  recipients: TripNotificationRecipient[];
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

function normalizeTokens(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function getRoleLabel(role: NotificationRole, locale: SupportedLocale): string {
  if (role === 'driver') {
    return locale === 'ar' ? 'السائق' : 'Driver';
  }
  return locale === 'ar' ? 'الراكب' : 'Passenger';
}

function getStatusContent(status: string, role: NotificationRole): LocalizedContent {
  switch (status) {
    case 'pending':
      return role === 'driver'
        ? {
            titleEn: 'New trip request',
            titleAr: 'طلب رحلة جديد',
            bodyEn: 'A nearby passenger needs a ride now.',
            bodyAr: 'يوجد راكب قريب يحتاج رحلة الآن.',
          }
        : {
            titleEn: 'Searching for driver',
            titleAr: 'جاري البحث عن سائق',
            bodyEn: 'We are matching you with the nearest available driver.',
            bodyAr: 'نقوم بمطابقتك مع أقرب سائق متاح.',
          };
    case 'accepted':
      return role === 'driver'
        ? {
            titleEn: 'Trip accepted',
            titleAr: 'تم قبول الرحلة',
            bodyEn: 'Proceed to pickup and follow the route.',
            bodyAr: 'اتجه إلى نقطة الالتقاط واتبع المسار.',
          }
        : {
            titleEn: 'Driver assigned',
            titleAr: 'تم تعيين السائق',
            bodyEn: 'Your driver accepted the trip and is on the way.',
            bodyAr: 'السائق قبل الرحلة وهو في الطريق إليك.',
          };
    case 'driver_arrived':
      return role === 'driver'
        ? {
            titleEn: 'Arrived at pickup',
            titleAr: 'وصلت إلى الالتقاط',
            bodyEn: 'Wait for the passenger and start the trip.',
            bodyAr: 'انتظر الراكب ثم ابدأ الرحلة.',
          }
        : {
            titleEn: 'Driver arrived',
            titleAr: 'وصل السائق',
            bodyEn: 'Your driver is waiting at pickup.',
            bodyAr: 'السائق بانتظارك عند نقطة الالتقاط.',
          };
    case 'in_progress':
      return role === 'driver'
        ? {
            titleEn: 'Trip in progress',
            titleAr: 'الرحلة قيد التنفيذ',
            bodyEn: 'Continue driving toward dropoff.',
            bodyAr: 'تابع القيادة نحو نقطة الوصول.',
          }
        : {
            titleEn: 'Trip started',
            titleAr: 'بدأت الرحلة',
            bodyEn: 'You are now on the way to your destination.',
            bodyAr: 'أنت الآن في الطريق إلى وجهتك.',
          };
    case 'completed':
      return role === 'driver'
        ? {
            titleEn: 'Trip completed',
            titleAr: 'اكتملت الرحلة',
            bodyEn: 'Collect payment and submit passenger rating.',
            bodyAr: 'استلم الدفعة وأرسل تقييم الراكب.',
          }
        : {
            titleEn: 'Trip completed',
            titleAr: 'اكتملت الرحلة',
            bodyEn: 'Please rate your driver and share feedback.',
            bodyAr: 'يرجى تقييم السائق وإضافة ملاحظتك.',
          };
    case 'no_driver_available':
      return {
        titleEn: 'No driver available',
        titleAr: 'لا يوجد سائق متاح',
        bodyEn: 'We could not find an available driver right now.',
        bodyAr: 'لم نتمكن من إيجاد سائق متاح حالياً.',
      };
    case 'cancelled_by_passenger':
      return role === 'driver'
        ? {
            titleEn: 'Trip cancelled',
            titleAr: 'تم إلغاء الرحلة',
            bodyEn: 'Passenger cancelled this trip.',
            bodyAr: 'الراكب قام بإلغاء هذه الرحلة.',
          }
        : {
            titleEn: 'Trip cancelled',
            titleAr: 'تم إلغاء الرحلة',
            bodyEn: 'You cancelled this trip.',
            bodyAr: 'لقد قمت بإلغاء هذه الرحلة.',
          };
    case 'cancelled_by_driver':
      return role === 'driver'
        ? {
            titleEn: 'Trip cancelled',
            titleAr: 'تم إلغاء الرحلة',
            bodyEn: 'You cancelled this trip.',
            bodyAr: 'لقد قمت بإلغاء هذه الرحلة.',
          }
        : {
            titleEn: 'Driver cancelled trip',
            titleAr: 'السائق ألغى الرحلة',
            bodyEn: 'Your driver cancelled this trip.',
            bodyAr: 'السائق ألغى هذه الرحلة.',
          };
    case 'cancelled_by_system':
      return {
        titleEn: 'Trip cancelled',
        titleAr: 'تم إلغاء الرحلة',
        bodyEn: 'This trip was cancelled by the system.',
        bodyAr: 'تم إلغاء هذه الرحلة من النظام.',
      };
    default:
      return {
        titleEn: 'Trip update',
        titleAr: 'تحديث الرحلة',
        bodyEn: `${getRoleLabel(role, 'en')} status changed to "${status}".`,
        bodyAr: `تم تغيير حالة ${getRoleLabel(role, 'ar')} إلى "${status}".`,
      };
  }
}

function sanitizeData(
  tripId: string,
  status: string,
  metadata?: Record<string, string | number | boolean | null | undefined>
): Record<string, string> {
  const base: Record<string, string> = {
    type: 'trip_status',
    tripId,
    status,
  };

  if (!metadata) return base;

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    base[key] = String(value);
  }

  return base;
}

async function loadUserTokens(userId: string): Promise<NotificationTokens> {
  const db = getFirestore();
  const deviceDoc = await db.collection('userDevices').doc(userId).get();
  const raw = deviceDoc.data() as
    | {
        expoPushTokens?: unknown;
        fcmTokens?: unknown;
        preferredLocale?: unknown;
      }
    | undefined;

  const preferredLocale: SupportedLocale = raw?.preferredLocale === 'ar' ? 'ar' : 'en';

  return {
    expoPushTokens: normalizeTokens(raw?.expoPushTokens),
    fcmTokens: normalizeTokens(raw?.fcmTokens),
    preferredLocale,
  };
}

async function sendExpoPush(
  tokens: string[],
  content: LocalizedContent,
  locale: SupportedLocale,
  data: Record<string, string>
): Promise<void> {
  if (tokens.length === 0) return;

  const title = locale === 'ar' ? content.titleAr : content.titleEn;
  const body = locale === 'ar' ? content.bodyAr : content.bodyEn;

  const messages = tokens.map((token) => ({
    to: token,
    title,
    body,
    sound: 'default',
    data,
  }));

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Expo push failed (${response.status}): ${payload}`);
  }
}

async function sendFcmPush(
  tokens: string[],
  content: LocalizedContent,
  locale: SupportedLocale,
  data: Record<string, string>
): Promise<void> {
  if (tokens.length === 0) return;

  const title = locale === 'ar' ? content.titleAr : content.titleEn;
  const body = locale === 'ar' ? content.bodyAr : content.bodyEn;

  const messaging = getMessaging();
  const response = await messaging.sendEachForMulticast({
    tokens,
    data,
    notification: {
      title,
      body,
    },
  });

  if (response.failureCount > 0) {
    logger.warn('[Notifications] Some FCM pushes failed', {
      failed: response.failureCount,
      success: response.successCount,
    });
  }
}

async function writeInAppNotification(
  userId: string,
  role: NotificationRole,
  tripId: string,
  status: string,
  content: LocalizedContent,
  preferredLocale: SupportedLocale
): Promise<void> {
  const db = getFirestore();
  const localizedTitle = preferredLocale === 'ar' ? content.titleAr : content.titleEn;
  const localizedBody = preferredLocale === 'ar' ? content.bodyAr : content.bodyEn;

  await db
    .collection('userNotifications')
    .doc(userId)
    .collection('items')
    .add({
      userId,
      role,
      type: 'trip_status',
      tripId,
      status,
      read: false,
      title: localizedTitle,
      body: localizedBody,
      titleEn: content.titleEn,
      titleAr: content.titleAr,
      bodyEn: content.bodyEn,
      bodyAr: content.bodyAr,
      createdAt: FieldValue.serverTimestamp(),
    });
}

async function notifyRecipient(
  recipient: TripNotificationRecipient,
  tripId: string,
  status: string,
  metadata?: Record<string, string | number | boolean | null | undefined>
): Promise<void> {
  const content = getStatusContent(status, recipient.role);
  const tokens = await loadUserTokens(recipient.userId);
  const payloadData = sanitizeData(tripId, status, metadata);

  await writeInAppNotification(
    recipient.userId,
    recipient.role,
    tripId,
    status,
    content,
    tokens.preferredLocale
  );

  await Promise.all([
    sendExpoPush(tokens.expoPushTokens, content, tokens.preferredLocale, payloadData),
    sendFcmPush(tokens.fcmTokens, content, tokens.preferredLocale, payloadData),
  ]);

  logger.info('[Notifications] Trip update sent', {
    tripId,
    status,
    userId: recipient.userId,
    role: recipient.role,
    expoTokens: tokens.expoPushTokens.length,
    fcmTokens: tokens.fcmTokens.length,
  });
}

export async function publishTripStatusNotifications(
  input: PublishTripStatusNotificationsInput
): Promise<void> {
  const { tripId, status, recipients, metadata } = input;
  const validRecipients = recipients.filter((item) => item.userId.trim().length > 0);

  if (validRecipients.length === 0) {
    return;
  }

  await Promise.all(
    validRecipients.map(async (recipient) => {
      try {
        await notifyRecipient(recipient, tripId, status, metadata);
      } catch (error) {
        logger.error('[Notifications] Failed to notify recipient', error, {
          tripId,
          status,
          userId: recipient.userId,
          role: recipient.role,
        });
      }
    })
  );
}

