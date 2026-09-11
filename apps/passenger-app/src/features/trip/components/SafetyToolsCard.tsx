import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../../../localization';

interface SafetyToolsCardProps {
  onShareTrip: () => void;
  onEmergencyCall: () => void;
  onCallTrustedContact: () => void;
  /** Overrides the localized default; omit to use the translation table. */
  trustedContactLabel?: string;
}

export function SafetyToolsCard({
  onShareTrip,
  onEmergencyCall,
  onCallTrustedContact,
  trustedContactLabel,
}: SafetyToolsCardProps) {
  const { isRTL, t } = useI18n();

  // The prop previously defaulted to the English literal 'Trusted contact', so an
  // Arabic user saw English on a safety control. The table has this key in both
  // locales.
  const contactLabel = trustedContactLabel ?? t('trip.trusted_contact_label');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('trip.safety_tools')}</Text>
      <View style={[styles.row, isRTL && styles.rowReverse]}>
        <Pressable
          style={[styles.button, styles.shareButton]}
          onPress={onShareTrip}
          accessibilityRole="button"
          accessibilityLabel={t('trip.share_trip')}
          accessibilityHint={t('trip.share_trip_hint')}
        >
          <Text style={styles.buttonText}>{t('trip.share_trip')}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.contactButton]}
          onPress={onCallTrustedContact}
          accessibilityRole="button"
          accessibilityLabel={contactLabel}
          accessibilityHint={t('trip.trusted_contact_hint')}
        >
          <Text style={styles.buttonText}>{contactLabel}</Text>
        </Pressable>
      </View>
      <Pressable
        style={[styles.button, styles.emergencyButton]}
        onPress={onEmergencyCall}
        accessibilityRole="button"
        accessibilityLabel={t('trip.emergency_call')}
        accessibilityHint={t('trip.emergency_call_hint')}
      >
        <Text style={styles.emergencyText}>{t('trip.emergency_call')}</Text>
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
