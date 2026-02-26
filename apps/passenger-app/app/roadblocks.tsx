import React from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useAuthStore } from '../src/store';
import { RoadblocksList } from '../src/features/roadblocks';
import { BackButton } from '../src/ui';

/**
 * Roadblocks page - read-only list of all roadblocks
 */
export default function Roadblocks() {
  const { isAuthenticated } = useAuthStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <View style={styles.container}>
      <BackButton fallbackRoute="/home" />
      <RoadblocksList />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
