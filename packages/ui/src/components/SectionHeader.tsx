import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { waselnehSpacing } from '../tokens/design-tokens';
import { Text } from './Text';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  mode?: 'light' | 'dark';
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({
  title,
  subtitle,
  mode = 'light',
  action,
  style,
}: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.texts}>
        <Text variant="h3" mode={mode}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" mode={mode} muted style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: waselnehSpacing.md,
  },
  texts: {
    flex: 1,
    gap: 4,
  },
  subtitle: {
    lineHeight: 18,
  },
  action: {
    flexShrink: 0,
  },
});
