import React from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useAuthStore } from '../src/store';
import { InboxScreen } from '../src/features/inbox';
import { BackButton } from '../src/ui';

export default function Inbox() {
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <View style={styles.container}>
      <BackButton fallbackRoute="/home" />
      <InboxScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
