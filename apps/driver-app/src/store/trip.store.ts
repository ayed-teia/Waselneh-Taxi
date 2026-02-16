import { create } from 'zustand';
import { TripStatus } from '../types/shared';

interface TripState {
  activeTripId: string | null;
  tripStatus: TripStatus | null;
  isLoading: boolean;
  setActiveTrip: (tripId: string | null, status: TripStatus | null) => void;
  setLoading: (loading: boolean) => void;
  clearTrip: () => void;
}

export const useTripStore = create<TripState>((set) => ({
  activeTripId: null,
  tripStatus: null,
  isLoading: false,
  setActiveTrip: (activeTripId, tripStatus) => set({ activeTripId, tripStatus, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  clearTrip: () => set({ activeTripId: null, tripStatus: null, isLoading: false }),
}));
