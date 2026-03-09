import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BottomSheetCard, StatusChip } from '@waselneh/ui';
import { DriverMapView } from '../../map';
import { useDriverStore } from '../../../store';
import { useTripRequestStore } from '../../../store/trip-request.store';
import { LanguageToggle, StatusToggle } from '../../../ui';
import { useI18n } from '../../../localization';

interface HomeScreenProps {
  onToggleStatus: (goOnline: boolean) => void;
}

export function HomeScreen({ onToggleStatus }: HomeScreenProps) {
  const { isRTL } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { status, isUpdatingStatus, currentLocation } = useDriverStore();
  const { pendingRequest } = useTripRequestStore();

  const isCompact = height < 760;
  const panelWidth = width >= 768 ? 560 : width;

  const driverLocation = currentLocation
    ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
    : null;

  const statusTone =
    status === 'online' ? 'success' : status === 'busy' ? 'warning' : 'neutral';

  return (
    <View style={styles.container}>
      <DriverMapView
        driverLocation={driverLocation}
        followUser
        mapHeightRatio={0.64}
        overlayBottomOffset={16}
      />

      <View style={styles.panelLayer} pointerEvents="box-none">
        <BottomSheetCard
          style={[
            styles.bottomPanel,
            {
              width: panelWidth,
              paddingHorizontal: isCompact ? 14 : 18,
              paddingTop: isCompact ? 10 : 14,
              paddingBottom: Math.max(14, insets.bottom + 8),
            },
          ]}
        >
          <View style={[styles.statusRow, isRTL && styles.rowReverse]}>
            <StatusChip
              label={
                status === 'online'
                  ? isRTL
                    ? 'متصل'
                    : 'Online'
                  : status === 'busy'
                    ? isRTL
                      ? 'مشغول'
                      : 'Busy'
                    : isRTL
                      ? 'غير متصل'
                      : 'Offline'
              }
              tone={statusTone}
            />
            <LanguageToggle />
          </View>

          <StatusToggle status={status} isLoading={isUpdatingStatus} onToggle={onToggleStatus} />

          <View style={[styles.quickRow, isRTL && styles.rowReverse]}>
            <TouchableOpacity style={styles.quickChip} onPress={() => router.push('/history')} activeOpacity={0.9}>
              <Text style={styles.quickChipText}>{isRTL ? 'السجل' : 'History'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickChip} onPress={() => router.push('/earnings')} activeOpacity={0.9}>
              <Text style={styles.quickChipText}>{isRTL ? 'الأرباح' : 'Earnings'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickChip} onPress={() => router.push('/support')} activeOpacity={0.9}>
              <Text style={styles.quickChipText}>{isRTL ? 'الدعم' : 'Support'}</Text>
            </TouchableOpacity>
          </View>

          {status === 'online' ? (
            <View style={styles.requestsSection}>
              <Text style={styles.sectionTitle}>{isRTL ? 'الطلبات القريبة' : 'Nearby requests'}</Text>
              <TouchableOpacity style={[styles.inboxButton, isRTL && styles.rowReverse]} onPress={() => router.push('/inbox')} activeOpacity={0.92}>
                <View style={styles.inboxIcon} />
                <View style={styles.inboxBody}>
                  <Text style={styles.inboxTitle}>{isRTL ? 'افتح صندوق الطلبات' : 'Open request inbox'}</Text>
                  <Text style={styles.inboxSubtitle}>
                    {isRTL
                      ? pendingRequest
                        ? 'يوجد طلب جديد بانتظارك الآن.'
                        : 'راجع الطلبات الواردة واقبلها بسرعة.'
                      : pendingRequest
                        ? 'You have a pending request now.'
                        : 'Review incoming requests and accept quickly.'}
                  </Text>
                </View>
                <Text style={styles.inboxArrow}>{isRTL ? '<' : '>'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.offlineMessage}>
              <Text style={styles.offlineTitle}>{isRTL ? 'أنت غير متصل' : 'You are offline'}</Text>
              <Text style={styles.offlineText}>
                {isRTL
                  ? 'فعّل وضع متصل عندما تصبح جاهزاً لاستقبال طلبات قريبة.'
                  : 'Switch online when you are ready to receive nearby trip requests.'}
              </Text>
            </View>
          )}
        </BottomSheetCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#DDE7F7',
  },
  panelLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 0,
  },
  bottomPanel: {
    alignSelf: 'stretch',
    gap: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  requestsSection: {
    marginTop: 4,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  inboxButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inboxIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  inboxBody: {
    flex: 1,
    gap: 2,
  },
  inboxTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  inboxSubtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  inboxArrow: {
    fontSize: 24,
    color: '#94A3B8',
    fontWeight: '300',
  },
  offlineMessage: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 4,
  },
  offlineTitle: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '700',
  },
  offlineText: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
});
