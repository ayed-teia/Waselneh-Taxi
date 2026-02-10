import React from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/store';
import { LoadingScreen } from '../src/ui';
import { LoginScreen } from '../src/features/auth';

// Dev mode - skip auth for testing
const DEV_MODE = true;
const DEV_DRIVER_ID = 'dev-driver-001';

export default function Index() {
  const { isAuthenticated, isLoading, setUser } = useAuthStore();

  // Dev mode: auto-login
  const handleDevLogin = () => {
    if (DEV_MODE) {
      console.log('🔧 DEV MODE: Logging in as', DEV_DRIVER_ID);
      // Create a mock user object
      setUser({ uid: DEV_DRIVER_ID } as any);
    }
  };

  if (isLoading) {
    return <LoadingScreen message="Starting Taxi Line Driver..." />;
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
