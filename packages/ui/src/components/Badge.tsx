import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { getModeColors, waselnehColors, waselnehRadius, waselnehSpacing } from '../tokens/design-tokens';
import { Text } from './Text';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  mode?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, variant = 'default', mode = 'light', style }: BadgeProps) {
  const colors = getModeColors(mode);
  const variantStyle =
    variant === 'success'
      ? { backgroundColor: waselnehColors.status.success, textColor: '#FFFFFF' }
      : variant === 'warning'
        ? { backgroundColor: waselnehColors.status.warning, textColor: '#FFFFFF' }
        : variant === 'danger'
          ? { backgroundColor: waselnehColors.status.danger, textColor: '#FFFFFF' }
          : { backgroundColor: colors.secondary, textColor: colors.secondaryText };

  return (
    <View style={[styles.base, { backgroundColor: variantStyle.backgroundColor }, style]}>
      <Text variant="caption" style={[styles.text, { color: variantStyle.textColor }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: waselnehRadius.pill,
    paddingHorizontal: waselnehSpacing.sm,
    paddingVertical: 4,
  },
  text: {
    fontWeight: '600',
  },
});
