import React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
  ViewStyle,
} from 'react-native';
import { getModeColors, waselnehColors, waselnehRadius, waselnehSpacing, waselnehTypography } from '../tokens/design-tokens';

export type UIButtonVariant = 'primary' | 'secondary' | 'destructive' | 'outline';

export interface UIButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  title: string;
  variant?: UIButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  mode?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = true,
  mode = 'light',
  style,
  ...touchableProps
}: UIButtonProps) {
  const colors = getModeColors(mode);
  const isDisabled = disabled || loading;
  const variantStyle =
    variant === 'secondary'
      ? { backgroundColor: colors.secondary, textColor: colors.secondaryText, borderColor: colors.secondary }
      : variant === 'destructive'
        ? { backgroundColor: waselnehColors.status.danger, textColor: '#FFFFFF', borderColor: waselnehColors.status.danger }
        : variant === 'outline'
          ? { backgroundColor: colors.surface, textColor: colors.textPrimary, borderColor: colors.borderStrong }
          : { backgroundColor: colors.primary, textColor: colors.primaryText, borderColor: waselnehColors.brand.taxiYellowDeep };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.base,
        {
          backgroundColor: variantStyle.backgroundColor,
          borderColor: variantStyle.borderColor,
        },
        fullWidth ? styles.fullWidth : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...touchableProps}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: variantStyle.textColor }, loading ? styles.hidden : null]}>{title}</Text>
        {loading ? (
          <View style={styles.spinner}>
            <ActivityIndicator color={variantStyle.textColor} />
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: waselnehRadius.md,
    paddingHorizontal: waselnehSpacing.xl,
    paddingVertical: waselnehSpacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  content: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 24,
  },
  title: {
    ...waselnehTypography.bodyStrong,
    fontWeight: '600',
    letterSpacing: 0.15,
  },
  spinner: {
    position: 'absolute',
  },
  hidden: {
    opacity: 0,
  },
  disabled: {
    opacity: 0.6,
  },
});
