import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { DriverMapView } from '../../map';
import { useDriverStore } from '../../../store';
import { StatusToggle } from '../../../ui';

interface HomeScreenProps {
  onToggleStatus: (goOnline: boolean) => void;
}

/**
 * Driver home screen with responsive bottom control panel.
 */
export function HomeScreen({ onToggleStatus }: HomeScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { status, isUpdatingStatus, currentLocation } = useDriverStore();

  const isCompact = height < 760;
  const panelWidth = Math.min(width - 20, 520);

  const driverLocation = currentLocation
    ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
    : null;

  return (
    <View style={styles.container}>
      <DriverMapView driverLocation={driverLocation} followUser />

      <View style={styles.panelLayer} pointerEvents="box-none">
        <View
          style={[
            styles.bottomPanel,
            {
              width: panelWidth,
              paddingHorizontal: isCompact ? 16 : 20,
              paddingTop: isCompact ? 12 : 14,
              paddingBottom: Math.max(14, insets.bottom + 8),
            },
          ]}
        >
          <View style={styles.handle} />

          <StatusToggle status={status} isLoading={isUpdatingStatus} onToggle={onToggleStatus} />

          {status === 'online' ? (
            <View style={styles.requestsSection}>
              <Text style={styles.sectionTitle}>Incoming trips</Text>
              <TouchableOpacity style={styles.inboxButton} onPress={() => router.push('/inbox')} activeOpacity={0.9}>
                <View style={styles.inboxIcon} />
                <View style={styles.inboxBody}>
                  <Text style={styles.inboxTitle}>Open Request Inbox</Text>
                  <Text style={styles.inboxSubtitle}>Review and accept pending trips quickly.</Text>
                </View>
                <Text style={styles.inboxArrow}>{'>'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.offlineMessage}>
              <Text style={styles.offlineTitle}>You are offline</Text>
              <Text style={styles.offlineText}>
                Switch online when ready to receive new trip requests from nearby passengers.
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
    paddingHorizontal: 10,
  },
  bottomPanel: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#F8FAFC',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
    gap: 12,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
  },
  requestsSection: {
    marginTop: 4,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 19,
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
});
