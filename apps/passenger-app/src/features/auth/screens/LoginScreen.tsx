import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Button, Card, ScreenContainer, Text } from '@waselneh/ui';
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
  const contentWidth = Math.min(width - 32, 430);
  const horizontalPadding = Math.max(16, (width - contentWidth) / 2);

  return (
    <ScreenContainer padded={false} style={styles.container}>
      <View style={styles.backgroundTopBlob} />
      <View style={styles.backgroundBottomBlob} />

      <View style={[styles.page, { paddingHorizontal: horizontalPadding }]}>
        <View style={[styles.header, { marginTop: isCompact ? 22 : 34 }]}>
          <LanguageToggle />
          <View style={styles.badge}>
            <Text variant="caption" style={styles.badgeText}>
              {isRTL ? 'تطبيق الراكب' : 'Passenger App'}
            </Text>
          </View>
          <Text variant="h1" style={styles.title}>
            Waselneh
          </Text>
          <Text muted style={styles.subtitle}>
            {isRTL
              ? 'تنقلات مدينة سريعة وموثوقة في الضفة الغربية'
              : 'Fast and reliable city rides across West Bank'}
          </Text>
        </View>

        <View style={[styles.content, { marginTop: isCompact ? 28 : 40 }]}>
          <Card elevated style={styles.card}>
            <Text style={styles.description}>
              {isRTL
                ? 'احجز خلال ثوانٍ، وتتبع السائق مباشرة، واحصل على تحديثات الطريق والازدحام.'
                : 'Book in seconds, track your driver live, and get route updates for traffic and roadblocks.'}
            </Text>
            <View style={styles.featureRow}>
              <View style={[styles.featureDot, styles.blueDot]} />
              <Text style={styles.featureText}>{isRTL ? 'تتبع السائق مباشرة' : 'Live driver tracking'}</Text>
            </View>
            <View style={styles.featureRow}>
              <View style={[styles.featureDot, styles.amberDot]} />
              <Text style={styles.featureText}>{isRTL ? 'مسارات تراعي الإغلاقات' : 'Roadblock-aware routes'}</Text>
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
            {isRTL ? 'تجربة الراكب الجديدة' : 'vNext rider experience'}
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
    top: -80,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#DBEAFE',
  },
  backgroundBottomBlob: {
    position: 'absolute',
    bottom: -110,
    left: -70,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#E0E7FF',
  },
  header: {
    gap: 10,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  title: {
    color: '#0F172A',
    letterSpacing: 0.4,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 320,
  },
  content: {
    flexGrow: 1,
  },
  card: {
    borderColor: '#DBEAFE',
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    gap: 14,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: '#1E293B',
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
    fontWeight: '500',
  },
  footer: {
    marginTop: 'auto',
    gap: 16,
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
