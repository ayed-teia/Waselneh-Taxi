import { ScreenContainer } from '@waselneh/ui';
import { Redirect } from 'expo-router';
import React from 'react';

import { DriverMapView } from '../src/features/map';
import { useAuthStore } from '../src/store';
import { useDriverStore } from '../src/store/driver.store';
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
    <ScreenContainer padded={false} edges={[]}>
      <BackButton fallbackRoute="/home" />
      <DriverMapView driverLocation={driverLocation} followUser={true} />
    </ScreenContainer>
  );
}
