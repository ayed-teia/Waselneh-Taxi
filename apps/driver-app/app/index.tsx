import React, { useCallback, useState } from 'react';
import { Redirect } from 'expo-router';
import { Alert } from 'react-native';
import { useAuthStore } from '../src/store';
import { LoadingScreen } from '../src/ui';
import { LoginScreen } from '../src/features/auth';
import { signInAnonymouslyForDev, isUsingEmulators } from '../src/services/firebase';

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
      Alert.alert('Login', 'Attempting to sign in...');

      if (DEV_MODE) {
        const usingEmulators = isUsingEmulators();
        Alert.alert('Debug', `Using emulators: ${usingEmulators}`);

        const { user, error } = await signInAnonymouslyForDev();
        if (user) {
          Alert.alert('Success', `Logged in as: ${user.uid}`);
          setUser(user);
        } else {
          Alert.alert('Error', `Login failed: ${error?.message}`);
        }
      }
    } finally {
      setIsLoggingIn(false);
    }
  }, [isLoggingIn, setUser]);

  if (isLoading) {
    return <LoadingScreen message="Starting Waselneh Driver..." />;
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
