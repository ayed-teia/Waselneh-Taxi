import { ScreenContainer } from '@waselneh/ui';
import { Redirect } from 'expo-router';
import React from 'react';

import { InboxScreen } from '../src/features/inbox';
import { useAuthStore } from '../src/store';

export default function Inbox() {
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false} edges={[]}>
      <InboxScreen />
    </ScreenContainer>
  );
}
