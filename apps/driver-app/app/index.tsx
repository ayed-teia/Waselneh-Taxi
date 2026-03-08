import React, { useCallback, useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { Alert } from 'react-native';
import { useAuthStore } from '../src/store';
import { LoadingScreen } from '../src/ui';
import { LoginScreen } from '../src/features/auth';
import { signInWithDriverUidForDev } from '../src/services/firebase';
import { useI18n } from '../src/localization';

// Dev mode - use anonymous auth for testing with emulators
const DEV_MODE = true;

function normalizeDriverUid(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

const DEV_DRIVER_UID =
  normalizeDriverUid(process.env.EXPO_PUBLIC_DEV_DRIVER_UID) || 'dev-driver-001';

export default function Index() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading, setUser } = useAuthStore();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [hasAttemptedAutoLogin, setHasAttemptedAutoLogin] = useState(false);

  // Dev mode: sign in with custom token using predefined driver UID
  const handleDevLogin = useCallback(async (uidOverride?: string) => {
    if (isLoggingIn) {
      return;
    }

    const trimmedUid = normalizeDriverUid(uidOverride) || DEV_DRIVER_UID;
    if (!trimmedUid) {
      Alert.alert(t('auth.login_failed'), t('auth.login_generic'));
      return;
    }

    setIsLoggingIn(true);
    try {
      if (DEV_MODE) {
        const { user, error } = await signInWithDriverUidForDev(trimmedUid);
        if (user) {
          setUser(user);
          return;
        }

        Alert.alert(t('auth.login_failed'), error?.message ?? t('auth.login_generic'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('auth.login_generic');
      Alert.alert(t('auth.login_failed'), message);
    } finally {
      setIsLoggingIn(false);
    }
  }, [isLoggingIn, setUser, t]);

  useEffect(() => {
    if (!DEV_MODE || isLoading || isAuthenticated || isLoggingIn || hasAttemptedAutoLogin) {
      return;
    }

    setHasAttemptedAutoLogin(true);
    void handleDevLogin(DEV_DRIVER_UID);
  }, [handleDevLogin, hasAttemptedAutoLogin, isAuthenticated, isLoading, isLoggingIn]);

  if (isLoading) {
    return <LoadingScreen message={t('auth.starting')} />;
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLogin={handleDevLogin}
        loading={isLoggingIn}
      />
    );
  }

  // User is authenticated, redirect to home
  return <Redirect href="/home" />;
}
