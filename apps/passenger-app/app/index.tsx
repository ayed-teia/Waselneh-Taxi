import React, { useCallback, useState } from 'react';
import { Redirect } from 'expo-router';
import { Alert } from 'react-native';
import { useAuthStore } from '../src/store';
import { LoadingScreen } from '../src/ui';
import { LoginScreen } from '../src/features/auth';
import { signInAnonymouslyForDev } from '../src/services/firebase';

// Dev mode - use anonymous auth for testing with emulators
const DEV_MODE = true;

export default function Index() {
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

        Alert.alert('Login failed', error?.message ?? 'Unable to sign in right now.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in right now.';
      Alert.alert('Login failed', message);
    } finally {
      setIsLoggingIn(false);
    }
  }, [isLoggingIn, setUser]);

  if (isLoading) {
    return <LoadingScreen message="Starting Waselneh..." />;
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLogin={handleDevLogin}
        loading={isLoggingIn}
      />
    );
  }

  // User is authenticated, redirect to home (map)
  return <Redirect href="/home" />;
}
