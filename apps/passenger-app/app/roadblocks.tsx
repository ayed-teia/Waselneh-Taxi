import React from 'react';
import { useRouter, Redirect } from 'expo-router';
import { useAuthStore } from '../src/store';
import { RoadblocksList } from '../src/features/roadblocks';

/**
 * Roadblocks page - read-only list of all roadblocks
 */
export default function Roadblocks() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return <RoadblocksList onClose={() => router.back()} />;
}
