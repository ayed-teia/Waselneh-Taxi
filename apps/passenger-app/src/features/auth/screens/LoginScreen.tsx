import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Badge, Button, Card, ScreenContainer, Text } from '@waselneh/ui';
import { colors } from '../../../ui/theme';
import { useI18n } from '../../../localization';
import { LanguageToggle } from '../../../ui';

interface LoginScreenProps {
  onLogin: () => void;
  loading?: boolean;
}

export function LoginScreen({ onLogin, loading = false }: LoginScreenProps) {
  const { isRTL } = useI18n();
  const { width, height } = useWindowDimensions();
  const isCompact = height < 760;
  const contentWidth = Math.min(width - 32, 440);
  const horizontalPadding = Math.max(16, (width - contentWidth) / 2);

  return (
    <ScreenContainer padded={false} style={styles.container}>
      <View style={styles.backgroundTopBlob} />
      <View style={styles.backgroundBottomBlob} />

      <View style={[styles.page, { paddingHorizontal: horizontalPadding }]}>
        <View style={[styles.header, { marginTop: isCompact ? 20 : 30 }]}>
          <LanguageToggle />
          <Badge
            label={isRTL ? 'تطبيق الركّاب' : 'Passenger App'}
            variant="info"
            withDot
            style={styles.badge}
          />
          <Text variant="h1" style={styles.title}>
            {isRTL ? 'وصلني' : 'Waselneh'}
          </Text>
          <Text muted style={styles.subtitle}>
            {isRTL
              ? 'تنقّل سريع وموثوق داخل مدن الضفة الغربية بخطوات بسيطة.'
              : 'Fast and reliable city rides across the West Bank in a few taps.'}
          </Text>
        </View>

        <View style={[styles.content, { marginTop: isCompact ? 26 : 38 }]}>
          <Card elevated style={styles.card}>
            <Text variant="bodyStrong" style={styles.description}>
              {isRTL
                ? 'احجز خلال ثوانٍ، تتبّع السائق لحظياً، وخذ قرارك بسرعة عبر واجهة واضحة.'
                : 'Book in seconds, track your driver live, and make decisions quickly with a clear interface.'}
            </Text>
            <View style={styles.featureRow}>
              <View style={[styles.featureDot, styles.blueDot]} />
              <Text style={styles.featureText}>
                {isRTL ? 'تتبّع مباشر لموقع السائق' : 'Live driver tracking'}
              </Text>
            </View>
            <View style={styles.featureRow}>
              <View style={[styles.featureDot, styles.amberDot]} />
              <Text style={styles.featureText}>
                {isRTL ? 'مسارات تراعي الإغلاقات' : 'Roadblock-aware routes'}
              </Text>
            </View>
          </Card>
        </View>

        <View style={[styles.footer, { paddingBottom: isCompact ? 10 : 18 }]}>
          <Button
            title={isRTL ? 'المتابعة برقم الهاتف' : 'Continue with Phone'}
            onPress={onLogin}
            loading={loading}
            style={styles.loginButton}
          />
          <Text variant="caption" muted style={styles.terms}>
            {isRTL
              ? 'بالمتابعة، أنت توافق على شروط الخدمة وسياسة الخصوصية.'
              : 'By continuing, you agree to our Terms of Service and Privacy Policy.'}
          </Text>
          <Text variant="caption" muted style={styles.version}>
            {isRTL ? 'تجربة ركّاب وصلني' : 'Waselneh rider experience'}
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
  },
  page: {
    flex: 1,
  },
  backgroundTopBlob: {
    position: 'absolute',
    top: -74,
    right: -32,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#DBEAFE',
  },
  backgroundBottomBlob: {
    position: 'absolute',
    bottom: -110,
    left: -70,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: '#E0E7FF',
  },
  header: {
    gap: 10,
  },
  badge: {
    alignSelf: 'flex-start',
  },
  title: {
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 340,
  },
  content: {
    flexGrow: 1,
  },
  card: {
    borderColor: '#DCE6F5',
    borderWidth: 1,
    borderRadius: 22,
    gap: 14,
    backgroundColor: '#FFFFFF',
  },
  description: {
    color: '#1E293B',
    lineHeight: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  blueDot: {
    backgroundColor: '#2563EB',
  },
  amberDot: {
    backgroundColor: '#F59E0B',
  },
  featureText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    marginTop: 'auto',
    gap: 14,
  },
  loginButton: {
    minHeight: 56,
    borderRadius: 16,
  },
  terms: {
    textAlign: 'center',
    lineHeight: 18,
  },
  version: {
    textAlign: 'center',
    opacity: 0.75,
  },
});
