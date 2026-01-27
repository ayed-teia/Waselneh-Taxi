import { getFunctions, httpsCallable, HttpsCallableResult } from 'firebase/functions';
import { initializeFirebase } from '../firebase';

const REGION = 'europe-west1';

/**
 * Get Firebase Functions instance
 */
function getCallableFunctions() {
  const app = initializeFirebase();
  return getFunctions(app, REGION);
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
 * Accept a trip request (driver action)
 * All business logic handled by Cloud Function
 */
export interface AcceptTripRequestResponse {
  tripId: string;
}

export async function acceptTripRequest(requestId: string): Promise<AcceptTripRequestResponse> {
  return callFunction<{ requestId: string }, AcceptTripRequestResponse>(
    'acceptTripRequest',
    { requestId }
  );
}

/**
 * Lifecycle response type
 */
export interface LifecycleResponse {
  success: boolean;
  status: string;
}

/**
 * Mark driver as arrived at pickup location
 * Valid transition: driver_assigned → driver_arrived
 */
export async function driverArrived(tripId: string): Promise<LifecycleResponse> {
  return callFunction<{ tripId: string }, LifecycleResponse>(
    'driverArrived',
    { tripId }
  );
}

/**
 * Start the trip (passenger picked up)
 * Valid transition: driver_arrived → in_progress
 */
export async function startTrip(tripId: string): Promise<LifecycleResponse> {
  return callFunction<{ tripId: string }, LifecycleResponse>(
    'startTrip',
    { tripId }
  );
}

/**
 * Complete trip response type
 */
export interface CompleteTripResponse {
  success: boolean;
  status: string;
  finalPriceIls: number;
}

/**
 * Complete the trip (passenger dropped off)
 * Valid transition: in_progress → completed
 */
export async function completeTrip(tripId: string): Promise<CompleteTripResponse> {
  return callFunction<{ tripId: string }, CompleteTripResponse>(
    'completeTrip',
    { tripId }
  );
}
