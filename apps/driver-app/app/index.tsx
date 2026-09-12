import { isPhoneAuthEnabled } from '@taxi-line/shared';
import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { isDevAuthBypassEnabled } from '../src/config/runtime-env';
import { LoginScreen, PhoneLoginScreen } from '../src/features/auth';
import { useI18n } from '../src/localization';
import {
  startPhoneSignIn,
  type PhoneSignInSession,
} from '../src/services/auth/phone-auth.service';
import { signInWithDriverUidForDev } from '../src/services/firebase';
import { useAuthStore } from '../src/store';
import { LoadingScreen } from '../src/ui';

/**
 * The emulator-only custom-token login (devIssueDriverToken) is permitted ONLY
 * when the environment says so: dev mode AND emulators on AND an explicit bypass
 * flag. Previously this was `const DEV_MODE = true`, which read no environment
 * variable - so pilot builds called an emulator-only Function against real
 * staging and failed with "Driver login function is unavailable".
 */
const DEV_MODE = isDevAuthBypassEnabled;

function normalizeDriverUid(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

const DEV_DRIVER_UID =
  normalizeDriverUid(process.env.EXPO_PUBLIC_DEV_DRIVER_UID) || 'dev-driver-001';

/**
 * PHONE AUTH IS BEHIND A FLAG, DEFAULT OFF.
 *
 * `isPhoneAuthEnabled()` reads EXPO_PUBLIC_ENABLE_PHONE_AUTH and returns false for
 * unset / empty / anything but the literal "true". With the flag off this file
 * behaves EXACTLY as before, including the dev auto-login below.
 *
 * NOTE: when the flag is ON the dev AUTO-login is suppressed, otherwise the driver
 * would be signed in before the phone screen could ever be shown. The dev path is
 * still reachable from a button on that screen, so test accounts keep working.
 */
const PHONE_AUTH_ENABLED = isPhoneAuthEnabled();

export default function Index() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading, setUser } = useAuthStore();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [hasAttemptedAutoLogin, setHasAttemptedAutoLogin] = useState(false);
  const [forceDevLogin, setForceDevLogin] = useState(false);
  const sessionRef = useRef<PhoneSignInSession | null>(null);

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
    // With phone auth on, do NOT auto-login as the dev driver - that would skip the
    // sign-in screen entirely. The dev path stays available via the button on it.
    if (PHONE_AUTH_ENABLED && !forceDevLogin) {
      return;
    }
    if (!DEV_MODE || isLoading || isAuthenticated || isLoggingIn || hasAttemptedAutoLogin) {
      return;
    }

    setHasAttemptedAutoLogin(true);
    void handleDevLogin(DEV_DRIVER_UID);
  }, [handleDevLogin, hasAttemptedAutoLogin, isAuthenticated, isLoading, isLoggingIn, forceDevLogin]);

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
          // exactOptionalPropertyTypes: omit rather than pass undefined.
          {...(DEV_MODE ? { onUseDevLogin: () => setForceDevLogin(true) } : {})}
          loading={isLoggingIn}
        />
      );
    }

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
