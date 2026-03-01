import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { getModeColors, waselnehSpacing } from '../tokens/design-tokens';
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
      <ActivityIndicator size="large" color={colors.primary} />
      <Text mode={mode} style={styles.title}>
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
  title: {
    marginTop: waselnehSpacing.md,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: waselnehSpacing.xs,
    textAlign: 'center',
  },
});

