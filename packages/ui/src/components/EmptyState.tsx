import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { waselnehSpacing } from '../tokens/design-tokens';
import { Button } from './Button';
import { Text } from './Text';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  mode?: 'light' | 'dark';
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  title,
  subtitle,
  mode = 'light',
  actionLabel,
  onAction,
  style,
}: EmptyStateProps) {
  return (
    <View style={[styles.container, style]}>
      <Text variant="h2" mode={mode} style={styles.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text mode={mode} muted style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} fullWidth={false} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: waselnehSpacing.xl,
  },
  title: {
    textAlign: 'center',
    fontSize: 24,
    lineHeight: 30,
  },
  subtitle: {
    marginTop: waselnehSpacing.xs,
    textAlign: 'center',
    lineHeight: 20,
  },
  action: {
    marginTop: waselnehSpacing.lg,
    minWidth: 140,
  },
});

