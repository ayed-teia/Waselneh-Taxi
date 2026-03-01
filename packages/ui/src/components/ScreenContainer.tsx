import React from 'react';
import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { getModeColors, waselnehSpacing } from '../tokens/design-tokens';

export interface ScreenContainerProps extends Omit<ViewProps, 'style'> {
  mode?: 'light' | 'dark';
  padded?: boolean;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}

export function ScreenContainer({
  mode = 'light',
  padded = true,
  edges = ['top', 'right', 'bottom', 'left'],
  style,
  children,
  ...props
}: ScreenContainerProps) {
  const colors = getModeColors(mode);

  return (
    <SafeAreaView edges={edges} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.content,
          { backgroundColor: colors.background },
          padded ? styles.padded : null,
          style,
        ]}
        {...props}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: waselnehSpacing.lg,
    paddingVertical: waselnehSpacing.md,
  },
});
