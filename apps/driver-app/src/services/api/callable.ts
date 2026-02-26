import { firebaseFunctions } from '../firebase';

// Dev mode configuration - matches app/index.tsx
const DEV_MODE = true;
const DEV_DRIVER_ID = 'dev-driver-001';

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
    ? { ...data, devUserId: DEV_DRIVER_ID }
    : data;
  
  const result = await callable(requestData as TRequest & { devUserId?: string });
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
 * Accept a trip request (driver action)
 * All business logic handled by Cloud Function
 */
export interface AcceptTripRequestResponse {
  tripId: string;
}

export async function acceptTripRequest(tripId: string): Promise<AcceptTripRequestResponse> {
  return callFunction<{ tripId: string }, AcceptTripRequestResponse>(
    'acceptTripRequest',
    { tripId }
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

/**
 * Confirm cash payment response type
 */
export interface ConfirmCashPaymentResponse {
  success: boolean;
  paymentStatus: string;
  fareAmount: number;
  paidAt: string;
}

/**
 * Confirm cash payment collected for a completed trip
 * Called by driver after receiving cash from passenger
 */
export async function confirmCashPayment(tripId: string): Promise<ConfirmCashPaymentResponse> {
  return callFunction<{ tripId: string }, ConfirmCashPaymentResponse>(
    'confirmCashPayment',
    { tripId }
  );
}

/**
 * Reject a trip request (driver action)
 * Updates driverRequests/{driverId}/requests/{tripId} status to 'rejected'
 */
export interface RejectTripRequestResponse {
  success: boolean;
}

export async function rejectTripRequest(tripId: string): Promise<RejectTripRequestResponse> {
  return callFunction<{ tripId: string }, RejectTripRequestResponse>(
    'rejectTripRequest',
    { tripId }
  );
}
