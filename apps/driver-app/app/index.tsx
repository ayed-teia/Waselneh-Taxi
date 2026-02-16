import React, { useCallback } from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/store';
import { LoadingScreen } from '../src/ui';
import { LoginScreen } from '../src/features/auth';
import { signInAnonymouslyForDev, isUsingEmulators } from '../src/services/firebase';

// Dev mode - use anonymous auth for testing with emulators
const DEV_MODE = true;

export default function Index() {
  const { isAuthenticated, isLoading, setUser } = useAuthStore();

  // Dev mode: anonymous signin (creates real Firebase Auth user)
  const handleDevLogin = useCallback(async () => {
    if (DEV_MODE && isUsingEmulators()) {
      console.log('🔧 DEV MODE: Signing in anonymously...');
      const { user, error } = await signInAnonymouslyForDev();
      if (user) {
        setUser(user);
      } else {
        console.error('Dev login failed:', error);
      }
    }
  }, [setUser]);

  if (isLoading) {
    return <LoadingScreen message="Starting Waselneh Driver..." />;
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLogin={handleDevLogin}
      />
    );
  }

  // User is authenticated, redirect to home
  return <Redirect href="/home" />;
}
