import React from 'react';
import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { getModeColors, waselnehRadius, waselnehSpacing } from '../tokens/design-tokens';

export interface CardProps extends Omit<ViewProps, 'style'> {
  mode?: 'light' | 'dark';
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ mode = 'light', elevated = false, style, ...props }: CardProps) {
  const colors = getModeColors(mode);

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: colors.surface, borderColor: colors.border },
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
    padding: waselnehSpacing.lg,
  },
  elevated: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
});
