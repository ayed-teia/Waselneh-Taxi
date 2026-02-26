import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { DriverStatus } from '../../store/driver.store';

interface StatusToggleProps {
  status: DriverStatus;
  isLoading: boolean;
  onToggle: (goOnline: boolean) => void;
}

export function StatusToggle({ status, isLoading, onToggle }: StatusToggleProps) {
  const isOnline = status === 'online' || status === 'busy';
  const isBusy = status === 'busy';

  const getStatusText = () => {
    switch (status) {
      case 'online':
        return 'Online - Ready for trips';
      case 'busy':
        return 'Busy - On a trip';
      case 'offline':
      default:
        return 'Offline';
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
      <View style={styles.statusHeader}>
        <Text style={styles.statusLabel}>Driver status</Text>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
          <Text style={styles.statusPillText}>{status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusText}>{getStatusText()}</Text>
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
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
          Complete your current trip to go offline
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
    padding: 14,
    gap: 12,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 16,
    color: '#334155',
    fontWeight: '500',
  },
  busyNote: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
  },
});
