import React from 'react';
import {
  I18nManager,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  getModeColors,
  waselnehColors,
  waselnehRadius,
  waselnehSpacing,
  waselnehTypography,
} from '../tokens/design-tokens';

/**
 * ============================================================================
 * PHONE NUMBER FIELD
 * ============================================================================
 *
 * A country-code selector and a national-number input on one row, sized to fit
 * whatever width the parent actually has.
 *
 * WHY THIS EXISTS - THE OVERFLOW IT FIXES
 *
 * Both phone login screens laid out the row as:
 *
 *     <View style={row}>                       // flexDirection: 'row'
 *       <View style={codePicker}>              // two <Button>s, no constraint
 *       <TextInput style={{ flex: 1 }} />      // no minWidth: 0
 *
 * Three separate reasons that overflows a 360dp screen:
 *
 *   1. The shared Button defaults to `fullWidth: true`, i.e. `width: '100%'`.
 *      TWO of them in a row each demanded the full row width.
 *   2. `flex: 1` alone does not let a React Native child shrink below its
 *      content width - `minWidth: 0` is required, exactly as on the web.
 *   3. 24dp of screen padding plus 48dp of card padding leaves ~288dp on a
 *      Redmi Note 8, which the two 54dp-tall padded buttons already exceed.
 *
 * So the row could only grow, and it grew past the viewport.
 *
 * THE FIX
 *
 * The code selector is a compact bounded control (not the full-width Button),
 * the input takes the remaining space with `minWidth: 0`, and the row is
 * allowed to wrap. Nothing here computes a screen width: the row fits whatever
 * box it is given, so card padding and font scaling cannot push it out.
 *
 * DIRECTION
 *
 * The row follows the locale, but the number itself is always typed and
 * displayed left-to-right. A phone number is a sequence of digits with a
 * meaningful order; rendering it RTL puts the country code visually adjacent
 * to the wrong end and is actively confusing to read back.
 * ============================================================================
 */

export interface PhoneNumberFieldProps {
  countryCodes: readonly string[];
  selectedCountryCode: string;
  onSelectCountryCode: (code: string) => void;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Screen-reader label for the number input. */
  accessibilityLabel?: string;
  /** Localized label for the country selector, for screen readers. */
  countryAccessibilityLabel?: string;
  mode?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
}

export function PhoneNumberField({
  countryCodes,
  selectedCountryCode,
  onSelectCountryCode,
  value,
  onChangeText,
  placeholder,
  disabled = false,
  accessibilityLabel,
  countryAccessibilityLabel,
  mode = 'light',
  style,
}: PhoneNumberFieldProps) {
  const isRTL = I18nManager.isRTL;
  const palette = getModeColors(mode);

  return (
    <View style={[styles.row, isRTL && styles.rowRtl, style]}>
      <View style={[styles.codeGroup, isRTL && styles.rowRtl]}>
        {countryCodes.map((code) => {
          const selected = code === selectedCountryCode;
          return (
            <Pressable
              key={code}
              onPress={() => onSelectCountryCode(code)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={
                countryAccessibilityLabel ? `${countryAccessibilityLabel} ${code}` : code
              }
              style={[
                styles.codeChip,
                { borderColor: palette.border, backgroundColor: palette.surface },
                selected && styles.codeChipSelected,
                disabled && styles.disabled,
              ]}
            >
              <RNText
                // The code is a number with a leading +, so it reads LTR in
                // every locale.
                style={[
                  styles.codeText,
                  { color: palette.textSecondary },
                  selected && styles.codeTextSelected,
                ]}
                numberOfLines={1}
              >
                {code}
              </RNText>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        style={[
          styles.input,
          {
            borderColor: palette.border,
            backgroundColor: palette.surface,
            color: palette.textPrimary,
          },
          disabled && styles.disabled,
        ]}
        value={value}
        onChangeText={onChangeText}
        keyboardType="phone-pad"
        inputMode="tel"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        editable={!disabled}
        maxLength={15}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: waselnehSpacing.sm,
    // Wrap rather than overflow when the container is genuinely too narrow
    // (very large font scaling, or a split-screen window).
    flexWrap: 'wrap',
    // Never wider than the parent, whatever the children ask for.
    width: '100%',
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  codeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: waselnehSpacing.xs,
    // Bounded: the selector takes what it needs and no more, leaving the rest
    // of the row for the number.
    flexGrow: 0,
    flexShrink: 0,
  },
  codeChip: {
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: waselnehSpacing.md,
    paddingVertical: waselnehSpacing.sm,
    borderRadius: waselnehRadius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChipSelected: {
    borderColor: waselnehColors.brand.taxiYellowDeep,
    backgroundColor: waselnehColors.brand.taxiYellow,
  },
  codeText: {
    ...waselnehTypography.bodyStrong,
  },
  codeTextSelected: {
    color: waselnehColors.brand.darkSlate,
  },
  input: {
    // flexShrink + flexBasis 0 + minWidth 0 is what actually lets a React
    // Native text input become narrower than its content.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: waselnehRadius.md,
    paddingHorizontal: waselnehSpacing.md,
    paddingVertical: waselnehSpacing.sm,
    fontSize: 16,
    // Digits stay LTR even in an Arabic UI: a phone number read right-to-left
    // is a different number to the eye. These are STYLE properties in React
    // Native, not TextInput props.
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  disabled: {
    opacity: 0.55,
  },
});
