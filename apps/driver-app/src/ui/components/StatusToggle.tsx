import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { DriverStatus } from '../../store/driver.store';
import { useI18n } from '../../localization';

interface StatusToggleProps {
  status: DriverStatus;
  isLoading: boolean;
  onToggle: (goOnline: boolean) => void;
}

export function StatusToggle({ status, isLoading, onToggle }: StatusToggleProps) {
  const { isRTL } = useI18n();
  const isOnline = status === 'online' || status === 'busy';
  const isBusy = status === 'busy';

  const getStatusText = () => {
    switch (status) {
      case 'online':
        return isRTL ? 'متصل وجاهز للطلبات' : 'Online and ready for requests';
      case 'busy':
        return isRTL ? 'مشغول برحلة نشطة' : 'Busy on an active trip';
      case 'offline':
      default:
        return isRTL ? 'غير متصل' : 'Offline';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'online':
        return '#34C759';
      case 'busy':
        return '#FF9500';
      case 'offline':
      default:
        return '#8E8E93';
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.statusHeader, isRTL && styles.rowReverse]}>
        <Text style={styles.statusLabel}>{isRTL ? 'حالة السائق' : 'Driver status'}</Text>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
          <Text style={styles.statusPillText}>
            {status === 'online'
              ? isRTL
                ? 'متصل'
                : 'ONLINE'
              : status === 'busy'
                ? isRTL
                  ? 'مشغول'
                  : 'BUSY'
                : isRTL
                  ? 'غير متصل'
                  : 'OFFLINE'}
          </Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusText}>{getStatusText()}</Text>
      </View>

      <View style={[styles.toggleRow, isRTL && styles.rowReverse]}>
        <Text style={styles.toggleLabel}>{isOnline ? (isRTL ? 'انتقل إلى غير متصل' : 'Go offline') : isRTL ? 'انتقل إلى متصل' : 'Go online'}</Text>
        <Switch
          value={isOnline}
          onValueChange={(value: boolean) => onToggle(value)}
          disabled={isLoading || isBusy}
          trackColor={{ false: '#E5E5EA', true: '#34C759' }}
          thumbColor="#FFFFFF"
        />
      </View>

      {isBusy && (
        <Text style={styles.busyNote}>
          {isRTL ? 'أكمل رحلتك الحالية قبل التحويل إلى غير متصل' : 'Complete your current trip to go offline'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    padding: 13,
    gap: 12,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  statusLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 5,
    paddingHorizontal: 10,
    gap: 6,
    backgroundColor: '#F8FAFC',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    letterSpacing: 0.4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 15,
    color: '#334155',
    fontWeight: '500',
  },
  busyNote: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
  },
});
