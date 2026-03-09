import React from 'react';
import { StyleProp, StyleSheet, Text as RNText, TextProps as RNTextProps, TextStyle } from 'react-native';
import { getModeColors, waselnehTypography } from '../tokens/design-tokens';

export type TextVariant = 'h1' | 'h2' | 'h3' | 'body' | 'bodyStrong' | 'caption' | 'overline';

export interface TextProps extends Omit<RNTextProps, 'style'> {
  variant?: TextVariant;
  mode?: 'light' | 'dark';
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}

export function Text({ variant = 'body', mode = 'light', muted = false, style, ...props }: TextProps) {
  const colors = getModeColors(mode);
  const variantStyle =
    variant === 'h1'
      ? styles.h1
      : variant === 'h2'
        ? styles.h2
        : variant === 'h3'
          ? styles.h3
          : variant === 'caption'
            ? styles.caption
            : variant === 'overline'
              ? styles.overline
              : variant === 'bodyStrong'
                ? styles.bodyStrong
                : styles.body;

  return (
    <RNText
      style={[variantStyle, { color: muted ? colors.textSecondary : colors.textPrimary }, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  h1: {
    ...waselnehTypography.h1,
  },
  h2: {
    ...waselnehTypography.h2,
  },
  h3: {
    ...waselnehTypography.h3,
  },
  body: {
    ...waselnehTypography.body,
  },
  bodyStrong: {
    ...waselnehTypography.bodyStrong,
  },
  caption: {
    ...waselnehTypography.caption,
  },
  overline: {
    ...waselnehTypography.overline,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
