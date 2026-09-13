import { Button, Card, PhoneNumberField, ScreenContainer, Text } from '@waselneh/ui';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { useI18n } from '../../../localization';
import {
  ALLOWED_COUNTRY_CODES,
  isAcceptablePhoneNumber,
  requestOtpPermission,
} from '../../../services/auth/phone-auth.service';
import { LanguageToggle } from '../../../ui';
import { colors } from '../../../ui/theme';

/**
 * ============================================================================
 * PHONE / OTP SIGN-IN SCREEN
 * ============================================================================
 *
 * Only reachable when EXPO_PUBLIC_ENABLE_PHONE_AUTH=true. With the flag off (the
 * default) the app shows the existing dev login and this screen is never mounted.
 *
 * TWO STEPS: enter a number, then enter the 6-digit code. The server is asked for
 * permission BEFORE Firebase is asked to send anything, so an abusive client is
 * stopped before any SMS is billed.
 *
 * The reCAPTCHA verifier is supplied by the caller (`onRequestCode`), because it is
 * platform-specific and is the one part that genuinely needs a device.
 * ============================================================================
 */

export interface PhoneLoginScreenProps {
  /** Sends the code. Receives an E.164 number; resolves when the SMS is on its way. */
  onRequestCode: (phoneNumber: string) => Promise<void>;
  /** Verifies the code. Resolves on success, rejects with a message on failure. */
  onVerifyCode: (code: string) => Promise<void>;
  /** Fall back to the existing dev sign-in (kept available in dev builds). */
  onUseDevLogin?: () => void;
  loading?: boolean;
}

type Step = 'phone' | 'code';

export function PhoneLoginScreen({
  onRequestCode,
  onVerifyCode,
  onUseDevLogin,
  loading = false,
}: PhoneLoginScreenProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('phone');
  const [countryCode, setCountryCode] = useState<string>(ALLOWED_COUNTRY_CODES[0]);
  const [nationalNumber, setNationalNumber] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const e164 = useMemo(
    () => `${countryCode}${nationalNumber.replace(/^0+/, '').replace(/[\s\-().]/g, '')}`,
    [countryCode, nationalNumber]
  );

  const phoneValid = isAcceptablePhoneNumber(e164);

  /** Map a server refusal reason to a localized message. */
  const messageForReason = useCallback(
    (reason?: string, retryAfterSeconds?: number): string => {
      switch (reason) {
        case 'cooldown':
          return t('auth.otp_cooldown', { seconds: String(retryAfterSeconds ?? 60) });
        case 'number_hourly_limit':
        case 'device_hourly_limit':
          return t('auth.otp_too_many');
        case 'locked_out':
          return t('auth.otp_locked_out');
        case 'country_not_allowed':
          return t('auth.otp_country_not_allowed');
        case 'invalid_number':
          return t('auth.otp_invalid_number');
        case 'rate_limit_unavailable':
          return t('auth.otp_unavailable');
        default:
          return t('auth.otp_send_failed');
      }
    },
    [t]
  );

  const handleSendCode = useCallback(async () => {
    if (busy || !phoneValid) return;
    setBusy(true);
    setError(null);
    try {
      // Server-side gate FIRST - this is where the limits are actually enforced.
      const permission = await requestOtpPermission(e164);
      if (!permission.ok) {
        setError(messageForReason(permission.reason, permission.retryAfterSeconds));
        return;
      }
      await onRequestCode(e164);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.otp_send_failed'));
    } finally {
      setBusy(false);
    }
  }, [busy, phoneValid, e164, onRequestCode, messageForReason, t]);

  const handleVerify = useCallback(async () => {
    if (busy || code.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      await onVerifyCode(code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.otp_wrong_code'));
    } finally {
      setBusy(false);
    }
  }, [busy, code, onVerifyCode, t]);

  const disabled = busy || loading;

  return (
    <ScreenContainer style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <LanguageToggle />
            <Text variant="h1" style={styles.title}>
              {t('auth.phone_title')}
            </Text>
            <Text muted style={styles.subtitle}>
              {step === 'phone' ? t('auth.phone_subtitle') : t('auth.code_subtitle')}
            </Text>
          </View>

          <Card elevated style={styles.card}>
            {step === 'phone' ? (
              <>
                <Text style={styles.label}>{t('auth.phone_label')}</Text>
                <PhoneNumberField
                  countryCodes={ALLOWED_COUNTRY_CODES}
                  selectedCountryCode={countryCode}
                  onSelectCountryCode={setCountryCode}
                  value={nationalNumber}
                  onChangeText={setNationalNumber}
                  placeholder={t('auth.phone_placeholder')}
                  disabled={disabled}
                  accessibilityLabel={t('auth.phone_label')}
                />
                <Button
                  title={busy ? t('auth.sending') : t('auth.send_code')}
                  onPress={() => void handleSendCode()}
                  disabled={disabled || !phoneValid}
                  loading={busy}
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>{t('auth.code_label')}</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="sms-otp"
                  placeholder="------"
                  editable={!disabled}
                  maxLength={8}
                />
                <Button
                  title={busy ? t('auth.verifying') : t('auth.verify_code')}
                  onPress={() => void handleVerify()}
                  disabled={disabled || code.trim().length < 4}
                  loading={busy}
                />
                <Button
                  title={t('auth.change_number')}
                  variant="secondary"
                  onPress={() => {
                    setStep('phone');
                    setCode('');
                    setError(null);
                  }}
                  disabled={disabled}
                />
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {loading ? <ActivityIndicator style={styles.spinner} /> : null}
          </Card>

          {onUseDevLogin ? (
            <Button title={t('auth.use_dev_login')} variant="secondary" onPress={onUseDevLogin} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  // flexGrow (not flex: 1) lets the content centre when short and scroll
  // when the keyboard shrinks the viewport.
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: 24 },
  header: { marginBottom: 24, alignItems: 'center' },
  title: { textAlign: 'center', marginTop: 12 },
  subtitle: { textAlign: 'center', marginTop: 8 },
  card: { padding: 16, gap: 12, width: '100%', alignSelf: 'stretch' },
  label: { marginBottom: 4 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  codeInput: { letterSpacing: 8, textAlign: 'center', fontSize: 22 },
  // flexShrink + full width keeps a long error inside the card rather than
  // stretching it past the screen edge.
  error: { color: '#dc2626', marginTop: 8, width: '100%', flexShrink: 1 },
  spinner: { marginTop: 8 },
});
