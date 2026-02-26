import React from 'react';
import {
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { getModeColors, waselnehRadius, waselnehSpacing, waselnehTypography } from '../tokens/design-tokens';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  mode?: 'light' | 'dark';
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export function Input({
  label,
  error,
  mode = 'light',
  containerStyle,
  inputStyle,
  ...inputProps
}: InputProps) {
  const colors = getModeColors(mode);

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="caption" mode={mode} style={styles.label}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textSecondary}
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: error ? '#DC2626' : colors.border,
            backgroundColor: colors.surface,
          },
          inputStyle,
        ]}
        {...inputProps}
      />
      {error ? (
        <Text variant="caption" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: waselnehSpacing.xs,
  },
  input: {
    ...waselnehTypography.body,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: waselnehRadius.md,
    paddingHorizontal: waselnehSpacing.md,
    paddingVertical: waselnehSpacing.sm,
  },
  error: {
    marginTop: waselnehSpacing.xs,
    color: '#DC2626',
  },
});
