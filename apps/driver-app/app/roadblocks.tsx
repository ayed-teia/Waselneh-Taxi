import React from 'react';
import { Redirect } from 'expo-router';
import { ScreenContainer } from '@waselneh/ui';
import { useAuthStore } from '../src/store';
import { RoadblocksList } from '../src/features/roadblocks';
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
