import React from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/store';
import { InboxScreen } from '../src/features/inbox';

export default function Inbox() {
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return <InboxScreen />;
}
