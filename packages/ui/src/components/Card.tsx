import React from 'react';
import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { getModeColors, waselnehRadius, waselnehShadows, waselnehSpacing } from '../tokens/design-tokens';

export interface CardProps extends Omit<ViewProps, 'style'> {
  mode?: 'light' | 'dark';
  elevated?: boolean;
  muted?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ mode = 'light', elevated = false, muted = false, style, ...props }: CardProps) {
  const colors = getModeColors(mode);

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: muted ? colors.surfaceMuted : colors.surface,
          borderColor: colors.border,
        },
        elevated ? styles.elevated : null,
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: waselnehRadius.lg,
    padding: waselnehSpacing.xl,
  },
  elevated: {
    ...waselnehShadows.md,
  },
});
