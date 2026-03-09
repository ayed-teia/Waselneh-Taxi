import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { getModeColors, waselnehRadius, waselnehSpacing } from '../tokens/design-tokens';
import { Text } from './Text';

interface LoadingStateProps {
  title?: string;
  subtitle?: string;
  mode?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
}

export function LoadingState({
  title = 'Loading...',
  subtitle,
  mode = 'light',
  style,
}: LoadingStateProps) {
  const colors = getModeColors(mode);

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.spinnerWrap, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
      <Text variant="bodyStrong" mode={mode} style={styles.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text mode={mode} muted style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: waselnehSpacing.lg,
  },
  spinnerWrap: {
    width: 52,
    height: 52,
    borderRadius: waselnehRadius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    marginTop: waselnehSpacing.md,
  },
  subtitle: {
    marginTop: waselnehSpacing.xs,
    textAlign: 'center',
  },
});
