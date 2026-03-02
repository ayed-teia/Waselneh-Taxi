import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../../localization';

interface LiveEtaCardProps {
  etaToDriverMin?: number | null;
  etaToDestinationMin?: number | null;
  updatedAt?: Date | null;
}

function formatEta(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--';
  if (value < 1) return '<1 min';
  return `${Math.round(value)} min`;
}

export function LiveEtaCard({ etaToDriverMin, etaToDestinationMin, updatedAt }: LiveEtaCardProps) {
  const { isRTL } = useI18n();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{isRTL ? 'وقت الوصول المباشر' : 'Live ETA'}</Text>
      <View style={styles.row}>
        <Text style={styles.label}>{isRTL ? 'وصول السائق' : 'Driver arrival'}</Text>
        <Text style={styles.value}>{formatEta(etaToDriverMin)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{isRTL ? 'الوصول للوجهة' : 'Destination'}</Text>
        <Text style={styles.value}>{formatEta(etaToDestinationMin)}</Text>
      </View>
      <Text style={styles.updated}>
        {isRTL ? 'آخر تحديث' : 'Updated'}: {updatedAt ? updatedAt.toLocaleTimeString() : isRTL ? 'بانتظار...' : 'waiting...'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  value: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '700',
  },
  updated: {
    marginTop: 2,
    fontSize: 11,
    color: '#94A3B8',
  },
});
