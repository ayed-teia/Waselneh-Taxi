import React, { useEffect, useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, StyleSheet, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { LoadingState, ScreenContainer } from '@waselneh/ui';
import {
  markUserNotificationRead,
  registerNotificationDevice,
  subscribeToUserNotifications,
} from '../src/services';
import { onAuthStateChanged, type User } from '../src/services/firebase';
import { useAuthStore } from '../src/store';
import { TripRequestModal } from '../src/ui';
import { I18nProvider, useI18n } from '../src/localization';
import '../src/config/mapbox.init';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function RootLayoutContent() {
  const { setUser } = useAuthStore();
  const { locale, isRTL, t } = useI18n();
  const [isReady, setIsReady] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged((user: User | null) => {
      if (!isMounted) return;

      setUser(
        user
          ? ({
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
              emailVerified: user.emailVerified,
              phoneNumber: user.phoneNumber,
              isAnonymous: user.isAnonymous,
            } as any)
          : null
      );

      setAuthUserId(user?.uid ?? null);
      setIsReady(true);
      console.log('Auth state changed:', user ? `User ${user.uid}` : 'No user');
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [setUser]);

  const acknowledgedIds = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    if (!authUserId) return;

    void registerNotificationDevice(authUserId, locale);

    const unsubscribe = subscribeToUserNotifications(
      authUserId,
      (items) => {
        items.forEach((item) => {
          if (item.read || acknowledgedIds.has(item.id)) return;

          acknowledgedIds.add(item.id);
          Alert.alert(item.title, item.body, [
            {
              text: t('common.ok'),
              onPress: () => {
                void markUserNotificationRead(authUserId, item.id);
              },
            },
          ]);
        });
      },
      (error) => {
        console.warn('Driver notification subscription failed', error);
      }
    );

    return () => unsubscribe();
  }, [acknowledgedIds, authUserId, locale, t]);

  if (!isReady) {
    return (
      <ScreenContainer padded={false}>
        <LoadingState title={t('auth.starting')} />
      </ScreenContainer>
    );
  }

  return (
    <View style={[styles.root, isRTL ? styles.rtl : styles.ltr]}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
      {authUserId ? <TripRequestModal /> : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <I18nProvider>
      <RootLayoutContent />
    </I18nProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  ltr: {
    direction: 'ltr',
  },
  rtl: {
    direction: 'rtl',
  },
});
