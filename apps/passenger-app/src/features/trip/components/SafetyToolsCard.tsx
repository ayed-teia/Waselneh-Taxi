import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../../localization';

interface SafetyToolsCardProps {
  onShareTrip: () => void;
  onEmergencyCall: () => void;
  onCallTrustedContact: () => void;
  trustedContactLabel?: string;
}

export function SafetyToolsCard({
  onShareTrip,
  onEmergencyCall,
  onCallTrustedContact,
  trustedContactLabel = 'Trusted contact',
}: SafetyToolsCardProps) {
  const { isRTL } = useI18n();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{isRTL ? 'أدوات الأمان' : 'Safety tools'}</Text>
      <View style={[styles.row, isRTL && styles.rowReverse]}>
        <Pressable style={[styles.button, styles.shareButton]} onPress={onShareTrip}>
          <Text style={styles.buttonText}>{isRTL ? 'مشاركة الرحلة' : 'Share trip'}</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.contactButton]} onPress={onCallTrustedContact}>
          <Text style={styles.buttonText}>{trustedContactLabel}</Text>
        </Pressable>
      </View>
      <Pressable style={[styles.button, styles.emergencyButton]} onPress={onEmergencyCall}>
        <Text style={styles.emergencyText}>{isRTL ? 'اتصال طوارئ' : 'Emergency call'}</Text>
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
  rowReverse: {
    flexDirection: 'row-reverse',
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
  contactButton: {
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
