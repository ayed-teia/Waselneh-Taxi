import { BookingType, LatLng, VehicleType } from '@taxi-line/shared';

import { clearActivePromoCode, getActivePromoCode } from '../../features/promotions/promo-storage';
import { firebaseFunctions } from '../firebase';

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

export interface PromotionPreview {
  valid: true;
  code: string;
  nameAr: string;
  nameEn: string;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  maxDiscountIls: number | null;
  minFareIls: number;
  expiresAt: string | null;
}

export async function validatePromotion(code: string): Promise<PromotionPreview> {
  return callFunction<{ code: string }, PromotionPreview>('validatePromotion', { code });
}

/**
 * Referral status for the signed-in passenger.
 *
 * Counts only - the backend deliberately never returns the uids of people who
 * joined under you, so this cannot be used to enumerate other users.
 */
export interface ReferralStatus {
  code: string | null;
  claimStatus: 'none' | 'pending' | 'qualified';
  claimedAt: string | null;
  invitedCount: number;
  qualifiedCount: number;
  creditBalance: number;
  rewardsEnabled: boolean;
  inviterCredits: number;
  inviteeCredits: number;
}

/** Issue (or fetch) this passenger's server-owned referral code. */
export async function getMyReferralCode(): Promise<{ code: string }> {
  return callFunction<Record<string, never>, { code: string }>('getMyReferralCode', {});
}

/** Record that this passenger was invited by the owner of `code`. */
export async function claimReferralCode(
  code: string
): Promise<{ claimed: true; status: 'pending' }> {
  return callFunction<{ code: string }, { claimed: true; status: 'pending' }>(
    'claimReferralCode',
    { code }
  );
}

export async function getMyReferralStatus(): Promise<ReferralStatus> {
  return callFunction<Record<string, never>, ReferralStatus>('getMyReferralStatus', {});
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
  roadblockImpact?: {
    affected: boolean;
    hasClosure: boolean;
    delayMin: number;
    surchargeIls: number;
    items: Array<{
      id: string;
      name: string;
      status: 'closed' | 'congested';
      delayMin: number;
      surchargeIls: number;
      distanceToRouteKm: number;
    }>;
  };
  smartRoute?: {
    selectedIndex: number;
    blocked: boolean;
    requiresDriverConfirmation: boolean;
    reason: 'fastest_clear_route' | 'avoids_closed_checkpoint' | 'least_affected_route';
  };
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
  loyaltyPointsToRedeem?: number;
  promoCode?: string;
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
  rideOptions?: RideOptions,
  loyaltyPointsToRedeem?: number
): Promise<CreateTripRequestResponse> {
  const payload: CreateTripRequestInput = { pickup, dropoff, estimate };
  if (rideOptions) {
    payload.rideOptions = rideOptions;
  }
  if (typeof loyaltyPointsToRedeem === 'number' && loyaltyPointsToRedeem > 0) {
    payload.loyaltyPointsToRedeem = Math.floor(loyaltyPointsToRedeem);
  }
  const promoCode = await getActivePromoCode();
  if (promoCode) payload.promoCode = promoCode;

  const response = await callFunction<CreateTripRequestInput, CreateTripRequestResponse>(
    'createTripRequest',
    payload
  );
  if (promoCode) await clearActivePromoCode();
  return response;
}

export interface BookRouteRunResponse {
  bookingId: string;
  availableSeats: number;
  status: string;
}

export async function bookRouteRun(
  runId: string,
  seats: number,
  pickupLabel?: string,
  destinationLabel?: string
): Promise<BookRouteRunResponse> {
  const payload = {
    runId,
    seats,
    ...(pickupLabel ? { pickupLabel } : {}),
    ...(destinationLabel ? { destinationLabel } : {}),
  };
  return callFunction<
    { runId: string; seats: number; pickupLabel?: string; destinationLabel?: string },
    BookRouteRunResponse
  >('bookRouteRun', payload);
}

export async function cancelRouteBooking(
  runId: string
): Promise<{ cancelled: true; availableSeats: number }> {
  return callFunction<{ runId: string }, { cancelled: true; availableSeats: number }>(
    'cancelRouteBooking',
    { runId }
  );
}

export interface NearbyRouteRunResult {
  runId: string;
  lineId: string;
  driverId: string;
  status: string;
  availableSeats: number;
  seatCapacity: number;
  departureTime: string | null;
  originLabel: string | null;
  destinationLabel: string | null;
  distanceToRouteKm: number;
}

export async function findNearbyRouteRuns(
  location: LatLng,
  seats = 1,
  maxRouteDistanceKm = 5
): Promise<{ runs: NearbyRouteRunResult[] }> {
  return callFunction<
    { location: LatLng; seats: number; maxRouteDistanceKm: number },
    { runs: NearbyRouteRunResult[] }
  >('findNearbyRouteRuns', { location, seats, maxRouteDistanceKm });
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

export interface StartOnlinePaymentResponse {
  success: boolean;
  status: 'awaiting_payment';
  clientActionUrl: string;
  providerChargeId: string;
}

export async function startOnlinePayment(tripId: string): Promise<StartOnlinePaymentResponse> {
  return callFunction<{ tripId: string }, StartOnlinePaymentResponse>('startOnlinePayment', {
    tripId,
  });
}
