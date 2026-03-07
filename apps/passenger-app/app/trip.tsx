import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Linking, Share } from 'react-native';
import { ErrorState, LoadingState, ScreenContainer } from '@waselneh/ui';
import { TripStatus } from '@taxi-line/shared';
import { ActiveTripScreen, RatingScreen } from '../src/features/trip';
import { estimateTrip, passengerCancelTrip, submitRating } from '../src/services/api';
import {
  DriverLocation,
  DriverProfile,
  TripChatMessage,
  TripData,
  sendTripChatMessage,
  subscribeToDriverLocation,
  subscribeToDriverProfile,
  subscribeToTrip,
  subscribeToTripChat,
} from '../src/services/realtime';
import { useAuthStore } from '../src/store';
import { RetryQueue } from '../src/services';
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
    case 'accepted':
      return t('status.accepted');
    case 'driver_arrived':
      return t('status.driver_arrived');
    case 'in_progress':
      return t('status.in_progress');
    case 'completed':
      return t('status.completed');
    case 'cancelled_by_driver':
      return t('status.cancelled_by_driver');
    case 'cancelled_by_system':
      return t('status.cancelled_by_system');
    case 'no_driver_available':
      return t('status.no_driver_available');
    default:
      return t('status.default');
  }
}

export default function Trip() {
  const { t } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const params = useLocalSearchParams<{ tripId: string }>();

  const [trip, setTrip] = useState<TripData | null>(null);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [chatMessages, setChatMessages] = useState<TripChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [hasRated, setHasRated] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [queuedActions, setQueuedActions] = useState(0);
  const [etaToPickupMin, setEtaToPickupMin] = useState<number | null>(null);
  const [etaToDropoffMin, setEtaToDropoffMin] = useState<number | null>(null);
  const [etaUpdatedAt, setEtaUpdatedAt] = useState<Date | null>(null);

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

        if (tripData?.status === 'completed' && !hasRated) {
          setShowRating(true);
        }

        const cancelledStatuses = [
          'cancelled_by_passenger',
          'cancelled_by_driver',
          'cancelled_by_system',
          'no_driver_available',
        ];
        if (tripData && cancelledStatuses.includes(tripData.status)) {
          setTimeout(() => {
            router.replace('/home');
          }, 2500);
        }
      },
      (tripError) => {
        setError(tripError.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tripId, router, hasRated, t]);

  useEffect(() => {
    if (!trip?.driverId) {
      setDriverLocation(null);
      return;
    }

    const activeStatuses = ['accepted', 'driver_arrived', 'in_progress'];
    if (!activeStatuses.includes(trip.status)) {
      setDriverLocation(null);
      return;
    }

    const unsubscribe = subscribeToDriverLocation(
      trip.driverId,
      (location) => {
        setDriverLocation(location);
      },
      (driverError) => {
        console.error('Error subscribing to driver location:', driverError);
      }
    );

    return () => unsubscribe();
  }, [trip?.driverId, trip?.status]);

  useEffect(() => {
    if (!trip?.driverId) {
      setDriverProfile(null);
      return;
    }

    const unsubscribe = subscribeToDriverProfile(
      trip.driverId,
      (profile) => {
        setDriverProfile(profile);
      },
      (driverProfileError) => {
        console.error('Error subscribing to driver profile:', driverProfileError);
      }
    );

    return () => unsubscribe();
  }, [trip?.driverId]);

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
    if (!trip || !driverLocation) {
      setEtaToPickupMin(null);
      setEtaToDropoffMin(null);
      return;
    }

    const updateEta = async () => {
      try {
        if ((trip.status === 'accepted' || trip.status === 'driver_arrived') && trip.pickup) {
          const eta = await estimateTrip(
            { lat: driverLocation.lat, lng: driverLocation.lng },
            { lat: trip.pickup.lat, lng: trip.pickup.lng }
          );
          setEtaToPickupMin(eta.durationMin);
          setEtaToDropoffMin(null);
          setEtaUpdatedAt(new Date());
          return;
        }

        if (trip.status === 'in_progress' && trip.dropoff) {
          const eta = await estimateTrip(
            { lat: driverLocation.lat, lng: driverLocation.lng },
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
  }, [trip, driverLocation]);

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (!tripId) {
    return <Redirect href="/home" />;
  }

  const handleCancel = useCallback(async () => {
    if (!tripId || isCancelling) return;

    setIsCancelling(true);
    try {
      await passengerCancelTrip(tripId);
      router.replace('/home');
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : t('trip.cancel_error_message');
      console.error('Failed to cancel trip:', message);
      Alert.alert(t('common.cancel_failed'), message);
    } finally {
      setIsCancelling(false);
    }
  }, [tripId, router, isCancelling]);

  const handleGoHome = () => {
    router.replace('/home');
  };

  const handleSubmitRating = useCallback(
    async (rating: number, comment?: string, lowRatingReason?: string) => {
      if (!tripId) return;

      await submitRating(tripId, rating, comment, lowRatingReason);
      setHasRated(true);
      setShowRating(false);
      router.replace('/home');
    },
    [tripId, router]
  );

  const handleSkipRating = useCallback(() => {
    setShowRating(false);
    router.replace('/home');
  }, [router]);

  const handleSendChat = useCallback(
    async (message: string, quickReply?: boolean) => {
      if (!tripId || !user?.uid) return;

      const sendAction = async () => {
        const payload = {
          senderId: user.uid,
          senderRole: 'passenger' as const,
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

  const handleTrustedContactCall = useCallback(async () => {
    try {
      await Linking.openURL('tel:+970599000000');
    } catch {
      Alert.alert(t('common.action_failed'), t('trip.trusted_contact_failed'));
    }
  }, [t]);

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

  if (showRating && trip.status === 'completed') {
    return (
      <ScreenContainer padded={false} edges={[]}>
        <BackButton fallbackRoute="/home" />
        <RatingScreen
          tripId={tripId}
          finalPriceIls={trip.finalPriceIls ?? trip.estimatedPriceIls}
          onSubmit={handleSubmitRating}
          onSkip={handleSkipRating}
        />
      </ScreenContainer>
    );
  }

  const activeTripOptionalProps = {
    ...(trip.bookingType ? { bookingType: trip.bookingType } : {}),
    ...(typeof trip.requestedSeats === 'number' ? { requestedSeats: trip.requestedSeats } : {}),
    ...(typeof trip.reservedSeats === 'number' ? { reservedSeats: trip.reservedSeats } : {}),
    ...(trip.destinationLabel !== undefined ? { destinationLabel: trip.destinationLabel } : {}),
    ...(trip.destinationCity !== undefined ? { destinationCity: trip.destinationCity } : {}),
  };

  return (
    <ScreenContainer padded={false} edges={[]}>
      <BackButton fallbackRoute="/home" />
      <ActiveTripScreen
        tripId={tripId}
        status={trip.status as TripStatus}
        estimatedPriceIls={trip.estimatedPriceIls}
        driverLocation={driverLocation}
        driverProfile={driverProfile}
        driverId={trip.driverId}
        pickup={trip.pickup}
        dropoff={trip.dropoff}
        {...activeTripOptionalProps}
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
        onCallTrustedContact={handleTrustedContactCall}
        trustedContactLabel={t('trip.trusted_contact_label')}
        onCancel={handleCancel}
        onGoHome={handleGoHome}
        isCancelling={isCancelling}
      />
    </ScreenContainer>
  );
}
