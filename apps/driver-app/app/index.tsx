import React, { useCallback, useState } from 'react';
import { Redirect } from 'expo-router';
import { Alert } from 'react-native';
import { useAuthStore } from '../src/store';
import { LoadingScreen } from '../src/ui';
import { LoginScreen } from '../src/features/auth';
import { signInAnonymouslyForDev } from '../src/services/firebase';
import { useI18n } from '../src/localization';

// Dev mode - use anonymous auth for testing with emulators
const DEV_MODE = true;

export default function Index() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading, setUser } = useAuthStore();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Dev mode: anonymous signin (creates real Firebase Auth user)
  const handleDevLogin = useCallback(async () => {
    if (isLoggingIn) {
      return;
    }

    setIsLoggingIn(true);
    try {
      if (DEV_MODE) {
        const { user, error } = await signInAnonymouslyForDev();
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
  }, [isLoggingIn, setUser]);

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
