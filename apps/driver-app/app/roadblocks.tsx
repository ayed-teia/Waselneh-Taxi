import { ScreenContainer } from '@waselneh/ui';
import { Redirect } from 'expo-router';
import React from 'react';

import { RoadblocksList } from '../src/features/roadblocks';
import { useAuthStore } from '../src/store';
import { BackButton } from '../src/ui';

export default function Roadblocks() {
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false}>
      <BackButton fallbackRoute="/home" />
      <RoadblocksList />
    </ScreenContainer>
  );
}
