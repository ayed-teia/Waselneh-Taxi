import { httpsCallable, HttpsCallableResult } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase';
import { LatLng } from '@taxi-line/shared';

/**
 * Get Firebase Functions instance
 */
function getCallableFunctions() {
  return getFirebaseFunctions();
}

/**
 * Generic callable function wrapper with type safety
 */
export async function callFunction<TRequest, TResponse>(
  functionName: string,
  data: TRequest
): Promise<TResponse> {
  const functions = getCallableFunctions();
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

