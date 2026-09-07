import { isPhoneAuthEnabled } from '@taxi-line/shared';
import { Redirect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { LoginScreen, PhoneLoginScreen } from '../src/features/auth';
import { useI18n } from '../src/localization';
import { startPhoneSignIn, type PhoneSignInSession } from '../src/services/auth/phone-auth.service';
import { signInAnonymouslyForDev } from '../src/services/firebase';
import { useAuthStore } from '../src/store';
import { LoadingScreen } from '../src/ui';

// Dev mode - use anonymous auth for testing with emulators
const DEV_MODE = true;

/**
 * PHONE AUTH IS BEHIND A FLAG, DEFAULT OFF.
 *
 * `isPhoneAuthEnabled()` reads EXPO_PUBLIC_ENABLE_PHONE_AUTH and returns false for
 * unset / empty / anything but the literal "true". With the flag off this file
 * behaves EXACTLY as before: the dev anonymous sign-in, unchanged. Merging this
 * changes nothing until a human enables the flag after real-device QA.
 *
 * See docs/AUTH_ROLLOUT.md for what must be true before that happens (Phone
 * provider, App Check, SHA keys, APNs).
 */
const PHONE_AUTH_ENABLED = isPhoneAuthEnabled();

export default function Index() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading, setUser } = useAuthStore();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [forceDevLogin, setForceDevLogin] = useState(false);
  const sessionRef = useRef<PhoneSignInSession | null>(null);

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
  }, [isLoggingIn, setUser, t]);

  /**
   * Send an OTP. The reCAPTCHA verifier is platform-specific and is the piece that
   * genuinely needs a device; in the emulator it is not evaluated.
   */
  const handleRequestCode = useCallback(async (phoneNumber: string) => {
    const verifier = {
      type: 'recaptcha',
      verify: () => Promise.resolve('emulator-or-device-token'),
    } as unknown as Parameters<typeof startPhoneSignIn>[1];

    sessionRef.current = await startPhoneSignIn(phoneNumber, verifier);
  }, []);

  const handleVerifyCode = useCallback(
    async (code: string) => {
      const session = sessionRef.current;
      if (!session) throw new Error(t('auth.otp_send_failed'));
      const user = await session.confirm(code);
      if (user) setUser(user);
    },
    [setUser, t]
  );

  if (isLoading) {
    return <LoadingScreen message={t('auth.starting')} />;
  }

  if (!isAuthenticated) {
    if (PHONE_AUTH_ENABLED && !forceDevLogin) {
      return (
        <PhoneLoginScreen
          onRequestCode={handleRequestCode}
          onVerifyCode={handleVerifyCode}
          // Keep the dev path reachable so test accounts still work.
          // exactOptionalPropertyTypes: omit the prop rather than pass undefined.
          {...(DEV_MODE ? { onUseDevLogin: () => setForceDevLogin(true) } : {})}
          loading={isLoggingIn}
        />
      );
    }

    return <LoginScreen onLogin={handleDevLogin} loading={isLoggingIn} />;
  }

  // User is authenticated, redirect to home (map)
  return <Redirect href="/home" />;
}
