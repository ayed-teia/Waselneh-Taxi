import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Share } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ErrorState, LoadingState, ScreenContainer } from '@waselneh/ui';
import { TripStatus } from '@taxi-line/shared';
import { ActiveTripScreen } from '../src/features/trip';
import {
  estimateTrip,
  submitPassengerRating,
} from '../src/services/api';
import {
  TripChatMessage,
  TripData,
  sendTripChatMessage,
  subscribeToTrip,
  subscribeToTripChat,
} from '../src/services/realtime';
import { RetryQueue } from '../src/services';
import { useAuthStore, useDriverStore } from '../src/store';
import { BackButton } from '../src/ui';
import { useI18n } from '../src/localization';

function isNetworkError(error: unknown): boolean {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    text.includes('network-request-failed') ||
    text.includes('network') ||
    text.includes('timeout') ||
    text.includes('unreachable')
  );
}

function statusMessage(status: TripStatus, t: (key: string) => string): string {
  switch (status) {
    case 'driver_arrived':
      return t('status.driver_arrived');
    case 'in_progress':
      return t('status.in_progress');
    case 'completed':
      return t('status.completed');
    case 'cancelled_by_passenger':
      return t('status.cancelled_by_passenger');
    case 'cancelled_by_system':
      return t('status.cancelled_by_system');
    default:
      return t('status.default');
  }
}

export default function Trip() {
  const { t } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const { currentLocation } = useDriverStore();
  const params = useLocalSearchParams<{ tripId: string }>();

  const [trip, setTrip] = useState<TripData | null>(null);
  const [chatMessages, setChatMessages] = useState<TripChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [etaToPickupMin, setEtaToPickupMin] = useState<number | null>(null);
  const [etaToDropoffMin, setEtaToDropoffMin] = useState<number | null>(null);
  const [etaUpdatedAt, setEtaUpdatedAt] = useState<Date | null>(null);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [queuedActions, setQueuedActions] = useState(0);
  const [passengerRatingValue, setPassengerRatingValue] = useState(0);
  const [passengerRatingComment, setPassengerRatingComment] = useState('');
  const [passengerLowRatingReason, setPassengerLowRatingReason] = useState<string | null>(null);
  const [passengerRatingSubmitted, setPassengerRatingSubmitted] = useState(false);
  const [submittingPassengerRating, setSubmittingPassengerRating] = useState(false);

  const tripId = params.tripId;
  const previousStatusRef = useRef<TripStatus | null>(null);
  const retryQueueRef = useRef(new RetryQueue());

  useEffect(() => {
    const unsubscribe = retryQueueRef.current.subscribe(setQueuedActions);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!tripId) return;

    const unsubscribe = subscribeToTrip(
      tripId,
      (tripData) => {
        setTrip(tripData);
        setLoading(false);

        const nextStatus = (tripData?.status as TripStatus | undefined) ?? null;
        if (nextStatus && previousStatusRef.current && previousStatusRef.current !== nextStatus) {
          Alert.alert(t('common.trip_update'), statusMessage(nextStatus, t));
        }
        if (nextStatus) {
          previousStatusRef.current = nextStatus;
        }
      },
      (tripError) => {
        setError(tripError.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tripId, t]);

  useEffect(() => {
    if (!tripId) return;

    const unsubscribe = subscribeToTripChat(
      tripId,
      (messages) => setChatMessages(messages),
      (chatError) => console.error('Trip chat subscription failed:', chatError)
    );

    return () => unsubscribe();
  }, [tripId]);

  useEffect(() => {
    if (!trip || !currentLocation) {
      setEtaToPickupMin(null);
      setEtaToDropoffMin(null);
      return;
    }

    const updateEta = async () => {
      try {
        if ((trip.status === 'accepted' || trip.status === 'driver_arrived') && trip.pickup) {
          const eta = await estimateTrip(
            { lat: currentLocation.lat, lng: currentLocation.lng },
            { lat: trip.pickup.lat, lng: trip.pickup.lng }
          );
          setEtaToPickupMin(eta.durationMin);
          setEtaToDropoffMin(null);
          setEtaUpdatedAt(new Date());
          return;
        }

        if (trip.status === 'in_progress' && trip.dropoff) {
          const eta = await estimateTrip(
            { lat: currentLocation.lat, lng: currentLocation.lng },
            { lat: trip.dropoff.lat, lng: trip.dropoff.lng }
          );
          setEtaToDropoffMin(eta.durationMin);
          setEtaToPickupMin(null);
          setEtaUpdatedAt(new Date());
          return;
        }

        setEtaToPickupMin(null);
        setEtaToDropoffMin(null);
      } catch (etaError) {
        console.warn('ETA refresh failed:', etaError);
      }
    };

    updateEta();
    const interval = setInterval(updateEta, 10000);
    return () => clearInterval(interval);
  }, [trip, currentLocation]);

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (!tripId) {
    return <Redirect href="/home" />;
  }

  const handleTripCompleted = () => {
    router.replace('/home');
  };

  const handleSendChat = useCallback(
    async (message: string, quickReply?: boolean) => {
      if (!tripId || !user?.uid) return;

      const sendAction = async () => {
        const payload = {
          senderId: user.uid,
          senderRole: 'driver' as const,
          text: message,
          ...(quickReply ? { quickReply: true } : {}),
        };
        await sendTripChatMessage(tripId, {
          ...payload,
        });
      };

      setIsSendingChat(true);
      try {
        await sendAction();
      } catch (sendError) {
        if (isNetworkError(sendError)) {
          retryQueueRef.current.enqueue({
            label: 'trip-chat-message',
            run: sendAction,
          });
          Alert.alert(t('common.network_issue'), t('trip.chat_queued'));
        } else {
          Alert.alert(
            t('common.chat_failed'),
            sendError instanceof Error ? sendError.message : t('trip.chat_failed')
          );
        }
      } finally {
        setIsSendingChat(false);
      }
    },
    [tripId, user?.uid]
  );

  const handleRetryQueue = useCallback(async () => {
    await retryQueueRef.current.drain();
  }, []);

  const handleShareTrip = useCallback(async () => {
    if (!trip) return;
    await Share.share({
      message: `Waselneh trip ${trip.id} | status: ${trip.status} | pickup: ${trip.pickup.lat},${trip.pickup.lng} | dropoff: ${trip.dropoff.lat},${trip.dropoff.lng}`,
    });
  }, [trip]);

  const handleEmergencyCall = useCallback(async () => {
    try {
      await Linking.openURL('tel:101');
    } catch {
      Alert.alert(t('common.action_failed'), t('trip.emergency_call_failed'));
    }
  }, [t]);

  const handleDispatchCall = useCallback(async () => {
    try {
      await Linking.openURL('tel:+970599111111');
    } catch {
      Alert.alert(t('common.action_failed'), t('trip.dispatch_call_failed'));
    }
  }, [t]);

  const handleSubmitPassengerRating = useCallback(async () => {
    if (!tripId || passengerRatingValue === 0 || submittingPassengerRating) return;

    setSubmittingPassengerRating(true);
    try {
      await submitPassengerRating(
        tripId,
        passengerRatingValue,
        passengerRatingComment.trim() || undefined,
        passengerLowRatingReason ?? undefined
      );
      setPassengerRatingSubmitted(true);
      Alert.alert(t('trip.rating_submitted'), t('trip.rating_submitted_message'));
    } catch (submitError) {
      Alert.alert(
        t('trip.rating_failed'),
        submitError instanceof Error ? submitError.message : t('trip.rating_failed_message')
      );
    } finally {
      setSubmittingPassengerRating(false);
    }
  }, [
    tripId,
    passengerRatingValue,
    passengerRatingComment,
    passengerLowRatingReason,
    submittingPassengerRating,
  ]);

  if (loading) {
    return (
      <ScreenContainer padded={false} edges={[]}>
        <BackButton fallbackRoute="/home" />
        <LoadingState title={t('common.loading_trip')} />
      </ScreenContainer>
    );
  }

  if (error || !trip) {
    return (
      <ScreenContainer padded={false} edges={[]}>
        <BackButton fallbackRoute="/home" />
        <ErrorState
          title={t('common.trip_error')}
          message={error || t('common.trip_not_found')}
          onRetry={() => router.replace('/home')}
          retryLabel={t('common.back_home')}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false} edges={[]}>
      <BackButton fallbackRoute="/home" />
      <ActiveTripScreen
        tripId={tripId}
        status={trip.status as TripStatus}
        estimatedPriceIls={trip.estimatedPriceIls}
        pickup={trip.pickup}
        dropoff={trip.dropoff}
        etaToPickupMin={etaToPickupMin}
        etaToDropoffMin={etaToDropoffMin}
        etaUpdatedAt={etaUpdatedAt}
        chatMessages={chatMessages}
        onSendChat={handleSendChat}
        chatSending={isSendingChat}
        retryQueueCount={queuedActions}
        onRetryQueue={handleRetryQueue}
        onShareTrip={handleShareTrip}
        onEmergencyCall={handleEmergencyCall}
        onCallDispatch={handleDispatchCall}
        passengerRatingValue={passengerRatingValue}
        passengerRatingComment={passengerRatingComment}
        passengerLowRatingReason={passengerLowRatingReason}
        passengerRatingSubmitted={passengerRatingSubmitted}
        isSubmittingPassengerRating={submittingPassengerRating}
        onPassengerRatingChange={setPassengerRatingValue}
        onPassengerRatingCommentChange={setPassengerRatingComment}
        onPassengerLowRatingReasonSelect={setPassengerLowRatingReason}
        onSubmitPassengerRating={handleSubmitPassengerRating}
        onTripCompleted={handleTripCompleted}
      />
    </ScreenContainer>
  );
}
