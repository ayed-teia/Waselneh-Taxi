import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface SafetyToolsCardProps {
  onShareTrip: () => void;
  onEmergencyCall: () => void;
  onCallDispatch: () => void;
}

export function SafetyToolsCard({ onShareTrip, onEmergencyCall, onCallDispatch }: SafetyToolsCardProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Safety tools</Text>
      <View style={styles.row}>
        <Pressable style={[styles.button, styles.shareButton]} onPress={onShareTrip}>
          <Text style={styles.buttonText}>Share trip</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.dispatchButton]} onPress={onCallDispatch}>
          <Text style={styles.buttonText}>Call dispatch</Text>
        </Pressable>
      </View>
      <Pressable style={[styles.button, styles.emergencyButton]} onPress={onEmergencyCall}>
        <Text style={styles.emergencyText}>Emergency call</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    minHeight: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    flex: 1,
  },
  shareButton: {
    backgroundColor: '#DBEAFE',
  },
  dispatchButton: {
    backgroundColor: '#DCFCE7',
  },
  emergencyButton: {
    backgroundColor: '#FEE2E2',
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  emergencyText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B91C1C',
  },
});
