import { firebaseFunctions } from '../firebase';
import { BookingType, LatLng, VehicleType } from '@taxi-line/shared';

// Dev mode configuration - matches app/index.tsx
const DEV_MODE = process.env.EXPO_PUBLIC_DEV_AUTH_BYPASS === 'true';
const DEV_PASSENGER_ID = process.env.EXPO_PUBLIC_DEV_PASSENGER_ID || 'dev-passenger-001';

function stripUndefined<T>(input: T): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const entries = Object.entries(input as Record<string, unknown>).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}

/**
 * Generic callable function wrapper with type safety
 * In dev mode, automatically injects devUserId for backend authentication bypass
 */
export async function callFunction<TRequest, TResponse>(
  functionName: string,
  data: TRequest
): Promise<TResponse> {
  const callable = firebaseFunctions.httpsCallable(functionName);
  
  // In dev mode, inject devUserId for backend authentication
  const requestData = DEV_MODE 
    ? { ...data, devUserId: DEV_PASSENGER_ID }
    : data;
  
  const result = await callable(stripUndefined(requestData as TRequest & { devUserId?: string }));
  return result.data as TResponse;
}

/**
 * Ping callable function - for testing connectivity
 */
export async function ping(message?: string) {
  return callFunction<{ message?: string | undefined }, { pong: boolean; message: string; timestamp: string }>(
    'ping',
    { message }
  );
}

/**
 * Trip estimation request
 */
export interface EstimateTripRequest {
  pickup: LatLng;
  dropoff: LatLng;
  rideOptions?: RideOptions;
}

/**
 * Trip estimation response
 */
export interface EstimateTripResponse {
  distanceKm: number;
  durationMin: number;
  priceIls: number;
  rideOptions?: RideOptions;
}

export interface RideOptions {
  bookingType?: BookingType;
  requiredSeats?: number;
  vehicleType?: VehicleType;
  officeId?: string;
  lineId?: string;
  destinationLabel?: string;
  destinationCity?: string;
}

/**
 * Estimate trip cost based on pickup and dropoff locations
 * Calls the estimateTrip Cloud Function
 */
export async function estimateTrip(
  pickup: LatLng,
  dropoff: LatLng,
  rideOptions?: RideOptions
): Promise<EstimateTripResponse> {
  const payload: EstimateTripRequest = { pickup, dropoff };
  if (rideOptions) {
    payload.rideOptions = rideOptions;
  }

  return callFunction<EstimateTripRequest, EstimateTripResponse>(
    'estimateTrip',
    payload
  );
}

/**
 * Trip request creation request
 */
export interface CreateTripRequestInput {
  pickup: LatLng;
  dropoff: LatLng;
  estimate: {
    distanceKm: number;
    durationMin: number;
    priceIls: number;
  };
  rideOptions?: RideOptions;
}

/**
 * Trip request creation response
 * Returns requestId for tracking, plus matching status/details
 */
export interface CreateTripRequestResponse {
  requestId: string;
  tripId?: string;
  driverId?: string;
  status: 'matched' | 'searching';
}

/**
 * Create a new trip request
 * Calls the createTripRequest Cloud Function
 */
export async function createTripRequest(
  pickup: LatLng,
  dropoff: LatLng,
  estimate: EstimateTripResponse,
  rideOptions?: RideOptions
): Promise<CreateTripRequestResponse> {
  const payload: CreateTripRequestInput = { pickup, dropoff, estimate };
  if (rideOptions) {
    payload.rideOptions = rideOptions;
  }

  return callFunction<CreateTripRequestInput, CreateTripRequestResponse>(
    'createTripRequest',
    payload
  );
}

export interface CancelTripRequestInput {
  requestId: string;
}

export interface CancelTripRequestResponse {
  requestId: string;
  cancelled: boolean;
  status: 'open' | 'matched' | 'expired' | 'cancelled';
  matchedTripId?: string;
}

export async function cancelTripRequest(
  requestId: string
): Promise<CancelTripRequestResponse> {
  return callFunction<CancelTripRequestInput, CancelTripRequestResponse>(
    'cancelTripRequest',
    { requestId }
  );
}

/**
 * Submit rating request
 */
export interface SubmitRatingRequest {
  tripId: string;
  rating: number;
  comment?: string | undefined;
  lowRatingReason?: string | undefined;
}

/**
 * Submit rating response
 */
export interface SubmitRatingResponse {
  success: boolean;
  ratingId: string;
}

/**
 * Submit a rating for a completed trip
 * Calls the submitRating Cloud Function
 */
export async function submitRating(
  tripId: string,
  rating: number,
  comment?: string,
  lowRatingReason?: string
): Promise<SubmitRatingResponse> {
  return callFunction<SubmitRatingRequest, SubmitRatingResponse>(
    'submitRating',
    { tripId, rating, comment, lowRatingReason }
  );
}

export interface CreateSupportTicketRequest {
  tripId?: string | undefined;
  category: 'trip' | 'payment' | 'safety' | 'technical' | 'other';
  subject: string;
  message: string;
}

export interface CreateSupportTicketResponse {
  success: boolean;
  ticketId: string;
  status: 'open';
}

export async function createSupportTicket(
  payload: CreateSupportTicketRequest
): Promise<CreateSupportTicketResponse> {
  return callFunction<CreateSupportTicketRequest, CreateSupportTicketResponse>(
    'createSupportTicket',
    payload
  );
}

/**
 * Cancel trip request payload
 */
export interface PassengerCancelTripRequest {
  tripId: string;
}

/**
 * Cancel trip response
 */
export interface PassengerCancelTripResponse {
  tripId: string;
  cancelled: boolean;
}

/**
 * Cancel an active trip as passenger.
 * Valid only for pending/accepted states.
 */
export async function passengerCancelTrip(tripId: string): Promise<PassengerCancelTripResponse> {
  return callFunction<PassengerCancelTripRequest, PassengerCancelTripResponse>(
    'passengerCancelTrip',
    { tripId }
  );
}

