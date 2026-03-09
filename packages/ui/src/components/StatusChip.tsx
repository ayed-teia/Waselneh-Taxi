import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { getModeColors, waselnehRadius, waselnehSpacing } from '../tokens/design-tokens';
import { Text } from './Text';

export type StatusChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface StatusChipProps {
  label: string;
  tone?: StatusChipTone;
  mode?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
}

const tonePalette: Record<StatusChipTone, { bg: string; text: string }> = {
  neutral: { bg: '#E2E8F0', text: '#334155' },
  info: { bg: '#DBEAFE', text: '#1D4ED8' },
  success: { bg: '#DCFCE7', text: '#166534' },
  warning: { bg: '#FEF3C7', text: '#92400E' },
  danger: { bg: '#FEE2E2', text: '#B91C1C' },
};

export function StatusChip({
  label,
  tone = 'neutral',
  mode = 'light',
  style,
}: StatusChipProps) {
  const colors = getModeColors(mode);
  const palette = tonePalette[tone];

  return (
    <View style={[styles.container, { backgroundColor: palette.bg, borderColor: colors.border }, style]}>
      <View style={[styles.dot, { backgroundColor: palette.text }]} />
      <Text variant="caption" style={[styles.text, { color: palette.text }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: waselnehRadius.pill,
    borderWidth: 1,
    paddingHorizontal: waselnehSpacing.sm,
    paddingVertical: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: waselnehRadius.pill,
  },
  text: {
    fontWeight: '700',
  },
});
