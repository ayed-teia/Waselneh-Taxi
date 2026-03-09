import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { getModeColors, waselnehRadius, waselnehSpacing } from '../tokens/design-tokens';
import { Text } from './Text';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  mode?: 'light' | 'dark';
  withDot?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, variant = 'default', mode = 'light', withDot = false, style }: BadgeProps) {
  const colors = getModeColors(mode);
  const variantStyle =
    variant === 'success'
      ? { backgroundColor: '#DCFCE7', textColor: '#166534' }
      : variant === 'warning'
        ? { backgroundColor: '#FEF3C7', textColor: '#92400E' }
      : variant === 'danger'
          ? { backgroundColor: '#FEE2E2', textColor: '#B91C1C' }
          : variant === 'info'
            ? { backgroundColor: '#DBEAFE', textColor: '#1D4ED8' }
            : { backgroundColor: colors.surfaceMuted, textColor: colors.textPrimary };

  return (
    <View style={[styles.base, { backgroundColor: variantStyle.backgroundColor, borderColor: colors.border }, style]}>
      {withDot ? (
        <View style={[styles.dot, { backgroundColor: variantStyle.textColor }]} />
      ) : null}
      <Text variant="caption" style={[styles.text, { color: variantStyle.textColor }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: waselnehRadius.pill,
    paddingHorizontal: waselnehSpacing.sm,
    paddingVertical: 4,
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
