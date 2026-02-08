import { create } from 'zustand';

/**
 * ============================================================================
 * TRIP REQUEST STORE
 * ============================================================================
 * 
 * Manages incoming trip requests for the driver.
 * 
 * FLOW:
 * 1. Driver goes ONLINE → listener starts
 * 2. New request in driverRequests/{driverId}/requests → show modal
 * 3. Driver taps Accept → call acceptTripRequest()
 * 4. Driver taps Reject → call rejectTripRequest()
 * 5. Driver goes OFFLINE → listener stops, clear pending request
 * 
 * ============================================================================
 */

/**
 * Incoming trip request from Firestore
 */
export interface TripRequest {
  tripId: string;
  passengerId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedPriceIls: number;
  pickupDistanceKm: number; // Calculated from driver's location
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: Date | null;
  expiresAt: Date | null;
}

interface TripRequestState {
  /** Currently displayed pending request */
  pendingRequest: TripRequest | null;
  
  /** Is the modal visible? */
  isModalVisible: boolean;
  
  /** Is an action (accept/reject) in progress? */
  isProcessing: boolean;
  
  /** Action type being processed */
  processingAction: 'accept' | 'reject' | null;
  
  /** Error message if action failed */
  errorMessage: string | null;
  
  // Actions
  showRequest: (request: TripRequest) => void;
  hideRequest: () => void;
  setProcessing: (processing: boolean, action: 'accept' | 'reject' | null) => void;
  setError: (message: string | null) => void;
  clearAll: () => void;
}

export const useTripRequestStore = create<TripRequestState>((set) => ({
  pendingRequest: null,
  isModalVisible: false,
  isProcessing: false,
  processingAction: null,
  errorMessage: null,

  showRequest: (request) => set({
    pendingRequest: request,
    isModalVisible: true,
    errorMessage: null,
  }),

  hideRequest: () => set({
    isModalVisible: false,
    pendingRequest: null,
    processingAction: null,
    errorMessage: null,
  }),

  setProcessing: (processing, action) => set({
    isProcessing: processing,
    processingAction: action,
  }),

  setError: (message) => set({
    errorMessage: message,
    isProcessing: false,
    processingAction: null,
  }),

  clearAll: () => set({
    pendingRequest: null,
    isModalVisible: false,
    isProcessing: false,
    processingAction: null,
    errorMessage: null,
  }),
}));
