import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getModeColors, waselnehSpacing } from '../tokens/design-tokens';
import { Text } from './Text';

interface HeaderProps {
  title: string;
  subtitle?: string;
  mode?: 'light' | 'dark';
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Header({
  title,
  subtitle,
  mode = 'light',
  leftAction,
  rightAction,
  style,
}: HeaderProps) {
  const insets = useSafeAreaInsets();
  const colors = getModeColors(mode);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
          paddingTop: Math.max(insets.top + waselnehSpacing.sm, waselnehSpacing.lg),
        },
        style,
      ]}
    >
      <View style={styles.row}>
        <View style={styles.side}>{leftAction ?? null}</View>
        <View style={styles.center}>
          <Text variant="h2" mode={mode} style={styles.title}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" mode={mode} muted style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={[styles.side, styles.sideRight]}>{rightAction ?? null}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: waselnehSpacing.lg,
    paddingBottom: waselnehSpacing.md,
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: waselnehSpacing.sm,
  },
  side: {
    minWidth: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  center: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
  },
});

