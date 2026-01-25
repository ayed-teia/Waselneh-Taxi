import React from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/store';
import { EstimateTripScreen } from '../src/features/estimate';

export default function Estimate() {
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return <EstimateTripScreen />;
}
