import { create } from 'zustand';
import { LatLng } from '../types/shared';

export type DriverStatus = 'offline' | 'online' | 'busy';

interface DriverState {
  status: DriverStatus;
  currentLocation: LatLng | null;
  isLocationEnabled: boolean;
  isUpdatingStatus: boolean;
  setStatus: (status: DriverStatus) => void;
  setLocation: (location: LatLng | null) => void;
  setLocationEnabled: (enabled: boolean) => void;
  setUpdatingStatus: (updating: boolean) => void;
}

export const useDriverStore = create<DriverState>((set) => ({
  status: 'offline',
  currentLocation: null,
  isLocationEnabled: false,
  isUpdatingStatus: false,
  setStatus: (status) => set({ status }),
  setLocation: (currentLocation) => set({ currentLocation }),
  setLocationEnabled: (isLocationEnabled) => set({ isLocationEnabled }),
  setUpdatingStatus: (isUpdatingStatus) => set({ isUpdatingStatus }),
}));
