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
            label={isRTL ? 'وحدة السائق' : 'Driver Console'}
            variant="default"
            withDot
            style={styles.badge}
          />
          <Text variant="h1" style={styles.title}>
            {isRTL ? 'سائق وصلني' : 'Waselneh Driver'}
          </Text>
          <Text muted style={styles.subtitle}>
            {isRTL
              ? 'تحكّم احترافي في الطلبات المباشرة، الملاحة، وحالة التشغيل.'
              : 'Professional control for live requests, navigation, and shift status.'}
          </Text>
        </View>

        <View style={[styles.content, { marginTop: isCompact ? 26 : 38 }]}>
          <Card elevated style={styles.card}>
            <Text variant="bodyStrong" style={styles.description}>
              {isRTL
                ? 'ادخل لوضع التشغيل، استقبل الرحلات بسرعة، وتابع حالة الطريق مباشرة.'
                : 'Go online, accept rides quickly, and monitor road conditions live.'}
            </Text>
            <View style={styles.featureRow}>
              <View style={[styles.featureDot, styles.greenDot]} />
              <Text style={styles.featureText}>
                {isRTL ? 'صندوق طلبات فوري' : 'Instant request inbox'}
              </Text>
            </View>
            <View style={styles.featureRow}>
              <View style={[styles.featureDot, styles.yellowDot]} />
              <Text style={styles.featureText}>
                {isRTL ? 'خريطة ملاحة تراعي الإغلاقات' : 'Roadblock-aware navigation'}
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
              ? 'بالمتابعة، أنت توافق على شروط الخدمة واتفاقية السائق.'
              : 'By continuing, you agree to our Terms of Service and Driver Agreement.'}
          </Text>
          <Text variant="caption" muted style={styles.version}>
            {isRTL ? 'وضع التشغيل' : 'Operations mode'}
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
    right: -20,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#DCEBFF',
  },
  backgroundBottomBlob: {
    position: 'absolute',
    bottom: -120,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#FFF8DB',
  },
  header: {
    gap: 10,
  },
  badge: {
    alignSelf: 'flex-start',
  },
  title: {
    color: '#0F172A',
    letterSpacing: -0.3,
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
    borderRadius: 22,
    borderColor: '#DCE6F5',
    borderWidth: 1,
    gap: 14,
    backgroundColor: '#FFFFFF',
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
  greenDot: {
    backgroundColor: '#16A34A',
  },
  yellowDot: {
    backgroundColor: '#CA8A04',
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
