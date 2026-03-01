import React from 'react';
import { Redirect } from 'expo-router';
import { ScreenContainer } from '@waselneh/ui';
import { BackButton } from '../src/ui';
import { useAuthStore } from '../src/store';
import { EstimateTripScreen } from '../src/features/estimate';

export default function Estimate() {
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false} edges={[]}>
      <BackButton fallbackRoute="/home" />
      <EstimateTripScreen />
    </ScreenContainer>
  );
}
