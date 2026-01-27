import React, { useCallback } from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore, useDriverStore } from '../src/store';
import { HomeScreen } from '../src/features/home';

export default function Home() {
  const { isAuthenticated } = useAuthStore();
  const { setStatus } = useDriverStore();

  // Handle status toggle - UI only for now
  // TODO: Implement actual GPS tracking and Firestore writes when ready
  const handleToggleStatus = useCallback(
    (goOnline: boolean) => {
      // UI-only toggle - no Firestore writes yet
      // Future: Call setDriverAvailability, updateDriverLocation
      if (goOnline) {
        setStatus('online');
      } else {
        setStatus('offline');
      }
    },
    [setStatus]
  );

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  // Default: show home screen
  // Active trips are now handled via /trip route with realtime subscription
  return <HomeScreen onToggleStatus={handleToggleStatus} />;
}
