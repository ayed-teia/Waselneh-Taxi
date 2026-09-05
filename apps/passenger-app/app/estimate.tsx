import { ScreenContainer } from '@waselneh/ui';
import { Redirect } from 'expo-router';
import React from 'react';

import { EstimateTripScreen } from '../src/features/estimate';
import { useAuthStore } from '../src/store';
import { BackButton } from '../src/ui';

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
