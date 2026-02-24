import { firebaseFunctions } from '../firebase';
import { LatLng } from '@taxi-line/shared';

// Dev mode configuration - matches app/index.tsx
const DEV_MODE = true;
const DEV_PASSENGER_ID = 'dev-passenger-001';

/**
 * Generic callable function wrapper with type safety
 * In dev mode, automatically injects devUserId for backend authentication bypass
 */
export async function callFunction<TRequest, TResponse>(
  functionName: string,
  data: TRequest
): Promise<TResponse> {
  const callable = firebaseFunctions.httpsCallable<TRequest & { devUserId?: string }, TResponse>(functionName);
  
  // In dev mode, inject devUserId for backend authentication
  const requestData = DEV_MODE 
    ? { ...data, devUserId: DEV_PASSENGER_ID }
    : data;
  
  const result = await callable(requestData as TRequest & { devUserId?: string });
  return result.data;
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
}

/**
 * Trip estimation response
 */
export interface EstimateTripResponse {
  distanceKm: number;
  durationMin: number;
  priceIls: number;
}

/**
 * Estimate trip cost based on pickup and dropoff locations
 * Calls the estimateTrip Cloud Function
 */
export async function estimateTrip(
  pickup: LatLng,
  dropoff: LatLng
): Promise<EstimateTripResponse> {
  return callFunction<EstimateTripRequest, EstimateTripResponse>(
    'estimateTrip',
    { pickup, dropoff }
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
  estimate: EstimateTripResponse
): Promise<CreateTripRequestResponse> {
  return callFunction<CreateTripRequestInput, CreateTripRequestResponse>(
    'createTripRequest',
    { pickup, dropoff, estimate }
  );
}

/**
 * Submit rating request
 */
export interface SubmitRatingRequest {
  tripId: string;
  rating: number;
  comment?: string | undefined;
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
  comment?: string
): Promise<SubmitRatingResponse> {
  return callFunction<SubmitRatingRequest, SubmitRatingResponse>(
    'submitRating',
    { tripId, rating, comment }
  );
}

