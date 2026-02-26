import React from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
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
    <View style={styles.container}>
      <BackButton fallbackRoute="/home" />
      <EstimateTripScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
