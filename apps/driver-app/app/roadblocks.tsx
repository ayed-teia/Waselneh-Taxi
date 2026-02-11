import React from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/store';
import { RoadblocksList } from '../src/features/roadblocks';

export default function Roadblocks() {
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return <RoadblocksList />;
}
