import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { waselnehSpacing } from '../tokens/design-tokens';
import { Button } from './Button';
import { Card } from './Card';
import { Text } from './Text';

interface ErrorStateProps {
  title?: string;
  message: string;
  mode?: 'light' | 'dark';
  retryLabel?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  mode = 'light',
  retryLabel = 'Retry',
  onRetry,
  style,
}: ErrorStateProps) {
  return (
    <View style={[styles.container, style]}>
      <Card mode={mode} elevated style={styles.card}>
        <Text variant="h2" mode={mode} style={styles.title}>
          {title}
        </Text>
        <Text mode={mode} muted style={styles.message}>
          {message}
        </Text>
        {onRetry ? <Button title={retryLabel} onPress={onRetry} /> : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: waselnehSpacing.lg,
  },
  card: {
    gap: waselnehSpacing.md,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
  },
  message: {
    lineHeight: 20,
  },
});

