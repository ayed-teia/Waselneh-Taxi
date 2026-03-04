import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { LoadingState, ScreenContainer } from '@waselneh/ui';
import { useAuthStore, useDriverStore } from '../src/store';
import { HomeScreen } from '../src/features/home';
import { DriverAccessDeniedScreen } from '../src/features/auth';
import { 
  startLocationTracking, 
  stopLocationTracking,
  requestLocationPermissions,
  setDriverAvailability,
  getCurrentLocation,
  startMockLocationUpdates,
  stopMockLocationUpdates,
} from '../src/services/location';
import {
  startDriverRequestsListener,
  stopDriverRequestsListener,
  subscribeToDriverEligibility,
  type DriverEligibilityState,
} from '../src/services/realtime';
import { useI18n } from '../src/localization';

// DEV MODE - set to false to use real GPS from phone
const DEV_MODE = false;

/**
 * ============================================================================
 * DRIVER HOME SCREEN
 * ============================================================================
 * 
 * ONLINE FLOW:
 * 1. Driver taps "Go Online"
 * 2. Request location permissions
 * 3. Start location tracking → writes to driverLive/{driverId}
 * 4. Start driver requests listener → listens to driverRequests/{driverId}/requests
 * 5. When request arrives → TripRequestModal shows
 * 
 * OFFLINE FLOW:
 * 1. Driver taps "Go Offline"
 * 2. Stop location tracking → deletes driverLive/{driverId}
 * 3. Stop driver requests listener → clears any pending modal
 * 
 * ============================================================================
 */

export default function Home() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const { status, setStatus } = useDriverStore();
  const [eligibility, setEligibility] = useState<DriverEligibilityState | null>(null);
  const [isEligibilityLoading, setIsEligibilityLoading] = useState(true);

  const canOperate = eligibility?.isEligible === true;

  const blockedMessage = useMemo(() => {
    if (!eligibility || eligibility.isEligible) {
      return isRTL ? 'الحساب غير مؤهل للتشغيل.' : 'This account is not eligible to operate.';
    }

    const reasonLabels: Record<string, string> = isRTL
      ? {
          missing_profile: 'لا يوجد ملف سائق معتمد',
          invalid_driver_type: 'نوع السائق ليس licensed_line_owner',
          driver_not_approved: 'حالة التحقق ليست approved',
          missing_line_or_license_link: 'لا يوجد lineId/licenseId صالح',
        }
      : {
          missing_profile: 'Approved driver profile is missing',
          invalid_driver_type: "driverType is not 'licensed_line_owner'",
          driver_not_approved: "verificationStatus is not 'approved'",
          missing_line_or_license_link: 'lineId/licenseId is missing',
        };

    return eligibility.reasons.map((reason) => reasonLabels[reason] ?? reason).join('\n');
  }, [eligibility, isRTL]);

  useEffect(() => {
    if (!user?.uid) {
      setEligibility(null);
      setIsEligibilityLoading(false);
      return;
    }

    setIsEligibilityLoading(true);

    const unsubscribe = subscribeToDriverEligibility(
      user.uid,
      (state) => {
        setEligibility(state);
        setIsEligibilityLoading(false);
      },
      (error) => {
        console.error('Driver eligibility subscription failed:', error);
        setEligibility({
          isEligible: false,
          driverType: null,
          verificationStatus: null,
          lineId: null,
          licenseId: null,
          reasons: ['missing_profile'],
        });
        setIsEligibilityLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // Handle location tracking AND request listener based on online status
  useEffect(() => {
    if (!user?.uid) return;

    const manageTracking = async () => {
      if (!canOperate) {
        if (DEV_MODE) {
          await stopMockLocationUpdates();
        } else {
          await stopLocationTracking();
        }
        await stopDriverRequestsListener();
        if (status !== 'offline') {
          setStatus('offline');
        }
        return;
      }

      if (status === 'online') {
        // DEV MODE: Use mock location updates (no GPS)
        if (DEV_MODE) {
          await startMockLocationUpdates(user.uid);
        } else {
          // PRODUCTION: Use real GPS tracking
          const started = await startLocationTracking(user.uid);
          if (!started) {
            console.warn('Failed to start location tracking');
          }
        }

        // Start listening for trip requests
        await startDriverRequestsListener(user.uid);
      } else {
        // Stop location tracking
        if (DEV_MODE) {
          await stopMockLocationUpdates();
        } else {
          await stopLocationTracking();
        }

        // Stop listening for trip requests
        await stopDriverRequestsListener();
      }
    };

    manageTracking();

    // Cleanup on unmount
    return () => {
      if (DEV_MODE) {
        stopMockLocationUpdates();
      } else {
        stopLocationTracking();
      }
      stopDriverRequestsListener();
    };
  }, [status, user?.uid, canOperate, setStatus]);

  // Handle status toggle with location tracking
  const handleToggleStatus = useCallback(
    async (goOnline: boolean) => {
      if (!user?.uid) return;

      if (goOnline) {
        if (!canOperate) {
          Alert.alert(isRTL ? 'الحساب غير مؤهل' : 'Account not eligible', blockedMessage);
          return;
        }

        // DEV MODE: Skip GPS permission check
        if (!DEV_MODE) {
          // Request permissions first (PRODUCTION only)
          const hasPermission = await requestLocationPermissions();
          if (!hasPermission) {
            Alert.alert(
              isRTL ? 'الموقع مطلوب' : 'Location Required',
              isRTL
                ? 'صلاحية الموقع مطلوبة للاتصال. الرجاء تفعيل الموقع من الإعدادات.'
                : 'Location permission is required to go online. Please enable location access in settings.',
              [{ text: isRTL ? 'حسناً' : 'OK' }]
            );
            return;
          }
        }

        // Get current location for availability (mock in DEV mode)
        const location = DEV_MODE 
          ? { lat: 32.2211, lng: 35.2544 } // Nablus mock
          : await getCurrentLocation();
        
        // Update Firestore availability
        try {
          await setDriverAvailability(user.uid, true, location ?? undefined);
          setStatus('online');
        } catch (error) {
          console.error('Failed to go online:', error);
          Alert.alert(
            isRTL ? 'خطأ' : 'Error',
            isRTL ? 'تعذر الاتصال الآن. يرجى المحاولة مرة أخرى.' : 'Failed to go online. Please try again.'
          );
        }
      } else {
        // Go offline
        try {
          await setDriverAvailability(user.uid, false);
          setStatus('offline');
        } catch (error) {
          console.error('Failed to go offline:', error);
        }
      }
    },
    [blockedMessage, canOperate, isRTL, user?.uid, setStatus]
  );

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (isEligibilityLoading) {
    return (
      <ScreenContainer padded={false}>
        <LoadingState title={isRTL ? 'جاري التحقق من أهلية السائق...' : 'Checking driver eligibility...'} />
      </ScreenContainer>
    );
  }

  if (!canOperate) {
    return (
      <DriverAccessDeniedScreen
        eligibility={
          eligibility ?? {
            isEligible: false,
            driverType: null,
            verificationStatus: null,
            lineId: null,
            licenseId: null,
            reasons: ['missing_profile'],
          }
        }
        onOpenSupport={() => router.push('/support')}
      />
    );
  }

  return <HomeScreen onToggleStatus={handleToggleStatus} />;
}
