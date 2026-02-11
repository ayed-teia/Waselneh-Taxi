import React from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/store';
import { useDriverStore } from '../src/store/driver.store';
import { DriverMapView } from '../src/features/map';

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

  return <DriverMapView driverLocation={driverLocation} followUser={true} />;
}
