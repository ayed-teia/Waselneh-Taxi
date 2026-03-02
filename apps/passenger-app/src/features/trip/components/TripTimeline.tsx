import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TripStatus } from '@taxi-line/shared';

const STEPS: Array<{ key: TripStatus; label: string }> = [
  { key: 'pending', label: 'Requested' },
  { key: 'accepted', label: 'Matched' },
  { key: 'driver_arrived', label: 'Driver arriving' },
  { key: 'in_progress', label: 'On trip' },
  { key: 'completed', label: 'Completed' },
];

const STATUS_ORDER: TripStatus[] = [
  'pending',
  'accepted',
  'driver_arrived',
  'in_progress',
  'completed',
  'rated',
  'cancelled_by_passenger',
  'cancelled_by_driver',
  'cancelled_by_system',
  'no_driver_available',
];

interface TripTimelineProps {
  status: TripStatus;
}

export function TripTimeline({ status }: TripTimelineProps) {
  const currentIndex = Math.max(
    0,
    STEPS.findIndex((step) => step.key === status)
  );
  const normalizedIndex =
    currentIndex >= 0 ? currentIndex : Math.max(0, STATUS_ORDER.indexOf(status) - 1);

  return (
    <View style={styles.container}>
      {STEPS.map((step, index) => {
        const done = index <= normalizedIndex;
        const upcoming = index > normalizedIndex;
        return (
          <View key={step.key} style={styles.stepRow}>
            <View style={[styles.dot, done && styles.dotDone, upcoming && styles.dotUpcoming]} />
            <Text style={[styles.label, done && styles.labelDone]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: '#94A3B8',
  },
  dotDone: {
    backgroundColor: '#2563EB',
  },
  dotUpcoming: {
    backgroundColor: '#CBD5E1',
  },
  label: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  labelDone: {
    color: '#0F172A',
  },
});
