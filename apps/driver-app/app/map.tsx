import React from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useAuthStore } from '../src/store';
import { useDriverStore } from '../src/store/driver.store';
import { DriverMapView } from '../src/features/map';
import { BackButton } from '../src/ui';

export default function MapScreen() {
  const { isAuthenticated } = useAuthStore();
  const { currentLocation } = useDriverStore();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  // Convert LatLng to the expected format
  const driverLocation = currentLocation 
    ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
    : null;

  return (
    <View style={styles.container}>
      <BackButton fallbackRoute="/home" />
      <DriverMapView driverLocation={driverLocation} followUser={true} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
