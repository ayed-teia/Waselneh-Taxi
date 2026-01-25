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
