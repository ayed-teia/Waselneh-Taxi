import React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * What a screen reader announces. Defaults to the visible title, which is
   * right for most buttons; override where the title alone is ambiguous out of
   * context (an icon, or a bare "Retry").
   */
  accessibilityLabel?: string;
  /** Extra context, e.g. what pressing this will actually do. */
  accessibilityHint?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[styles.button, styles[variant], isDisabled && styles.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.9}
      // Without an explicit role this is announced as plain text, not as
      // something that can be pressed.
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      // `busy` is why loading is separate from disabled here: a screen reader
      // should say the action is in progress, not merely unavailable.
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' ? '#0F172A' : '#FFFFFF'} />
      ) : (
        <Text style={[styles.text, styles[`${variant}Text` as keyof typeof styles] as TextStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    borderRadius: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#0F172A',
  },
  secondary: {
    backgroundColor: '#1E293B',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#0F172A',
  },
  danger: {
    backgroundColor: '#DC2626',
  },
  disabled: {
    opacity: 0.55,
  },
  text: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  primaryText: {
    color: '#FFFFFF',
  },
  secondaryText: {
    color: '#FFFFFF',
  },
  outlineText: {
    color: '#0F172A',
  },
  dangerText: {
    color: '#FFFFFF',
  },
});
