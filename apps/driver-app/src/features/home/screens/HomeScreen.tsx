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
import { DriverMapView } from '../../map';
import { useDriverStore } from '../../../store';
import { LanguageToggle, StatusToggle } from '../../../ui';
import { useI18n } from '../../../localization';

interface HomeScreenProps {
  onToggleStatus: (goOnline: boolean) => void;
}

/**
 * Driver home with responsive bottom control panel.
 */
export function HomeScreen({ onToggleStatus }: HomeScreenProps) {
  const { isRTL } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { status, isUpdatingStatus, currentLocation } = useDriverStore();

  const isCompact = height < 760;
  const panelWidth = width >= 768 ? 560 : width;

  const driverLocation = currentLocation
    ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
    : null;

  return (
    <View style={styles.container}>
      <DriverMapView
        driverLocation={driverLocation}
        followUser
        mapHeightRatio={0.52}
        overlayBottomOffset={16}
      />

      <View style={styles.panelLayer} pointerEvents="box-none">
        <View
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
          <View style={styles.handle} />

          <StatusToggle status={status} isLoading={isUpdatingStatus} onToggle={onToggleStatus} />

          <View style={[styles.quickRow, isRTL && styles.rowReverse]}>
            <LanguageToggle />
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
              <Text style={styles.sectionTitle}>{isRTL ? 'رحلات قادمة' : 'Incoming trips'}</Text>
              <TouchableOpacity style={[styles.inboxButton, isRTL && styles.rowReverse]} onPress={() => router.push('/inbox')} activeOpacity={0.9}>
                <View style={styles.inboxIcon} />
                <View style={styles.inboxBody}>
                  <Text style={styles.inboxTitle}>{isRTL ? 'فتح صندوق الطلبات' : 'Open Request Inbox'}</Text>
                  <Text style={styles.inboxSubtitle}>
                    {isRTL ? 'راجع واقبل الطلبات المعلقة بسرعة.' : 'Review and accept pending trips quickly.'}
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
                  ? 'حوّل إلى متصل عندما تصبح جاهزاً لاستقبال طلبات قريبة.'
                  : 'Switch online when ready to receive nearby trip requests.'}
              </Text>
            </View>
          )}
        </View>
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: 'rgba(248, 250, 252, 0.98)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 10,
    gap: 12,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
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
