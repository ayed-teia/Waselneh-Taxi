import React from 'react';
import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { getModeColors, waselnehRadius, waselnehShadows, waselnehSpacing } from '../tokens/design-tokens';

interface BottomSheetCardProps extends Omit<ViewProps, 'style'> {
  mode?: 'light' | 'dark';
  withHandle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function BottomSheetCard({
  mode = 'light',
  withHandle = true,
  style,
  children,
  ...props
}: BottomSheetCardProps) {
  const colors = getModeColors(mode);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.mapOverlay,
          borderColor: colors.border,
        },
        style,
      ]}
      {...props}
    >
      {withHandle ? <View style={styles.handle} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopLeftRadius: waselnehRadius.sheet,
    borderTopRightRadius: waselnehRadius.sheet,
    borderWidth: 1,
    paddingHorizontal: waselnehSpacing.lg,
    paddingTop: waselnehSpacing.md,
    gap: waselnehSpacing.md,
    ...waselnehShadows.lg,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: waselnehRadius.pill,
    alignSelf: 'center',
    backgroundColor: '#CBD5E1',
  },
});
