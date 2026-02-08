import { httpsCallable, HttpsCallableResult } from 'firebase/functions';
import { getFunctionsAsync } from '../firebase';
import { LatLng } from '@taxi-line/shared';

/**
 * Generic callable function wrapper with type safety
 */
export async function callFunction<TRequest, TResponse>(
  functionName: string,
  data: TRequest
): Promise<TResponse> {
  const functions = await getFunctionsAsync();
  const callable = httpsCallable<TRequest, TResponse>(functions, functionName);
  const result: HttpsCallableResult<TResponse> = await callable(data);
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
 */
export interface CreateTripRequestResponse {
  requestId: string;
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

