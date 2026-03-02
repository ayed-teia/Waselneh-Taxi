import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TripStatus } from '../../../types/shared';

const STEPS: Array<{ key: TripStatus; label: string }> = [
  { key: 'accepted', label: 'Matched' },
  { key: 'driver_arrived', label: 'Arriving pickup' },
  { key: 'in_progress', label: 'On trip' },
  { key: 'completed', label: 'Completed' },
];

interface TripTimelineProps {
  status: TripStatus;
}

export function TripTimeline({ status }: TripTimelineProps) {
  const index = Math.max(
    0,
    STEPS.findIndex((step) => step.key === status)
  );

  return (
    <View style={styles.container}>
      {STEPS.map((step, stepIndex) => {
        const done = stepIndex <= index;
        return (
          <View key={step.key} style={styles.stepRow}>
            <View style={[styles.dot, done && styles.dotDone]} />
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
    backgroundColor: '#CBD5E1',
  },
  dotDone: {
    backgroundColor: '#1D4ED8',
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
