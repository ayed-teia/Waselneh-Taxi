import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Button, Card, ScreenContainer, Text } from '@waselneh/ui';
import { colors } from '../../../ui/theme';

interface LoginScreenProps {
  onLogin: () => void;
  loading?: boolean;
}

export function LoginScreen({ onLogin, loading = false }: LoginScreenProps) {
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
          <View style={styles.badge}>
            <Text variant="caption" style={styles.badgeText}>
              Driver Console
            </Text>
          </View>
          <Text variant="h1" style={styles.title}>
            Waselneh Driver
          </Text>
          <Text muted style={styles.subtitle}>
            Go online, accept nearby trips, and track route conditions in real time.
          </Text>
        </View>

        <View style={[styles.content, { marginTop: isCompact ? 28 : 40 }]}>
          <Card elevated style={styles.card}>
            <Text style={styles.description}>
              Built for route-line drivers with fast trip actions, live requests, and safer dispatch visibility.
            </Text>
            <View style={styles.featureRow}>
              <View style={[styles.featureDot, styles.greenDot]} />
              <Text style={styles.featureText}>Instant trip request inbox</Text>
            </View>
            <View style={styles.featureRow}>
              <View style={[styles.featureDot, styles.yellowDot]} />
              <Text style={styles.featureText}>Roadblock-aware driving map</Text>
            </View>
          </Card>
        </View>

        <View style={[styles.footer, { paddingBottom: isCompact ? 10 : 18 }]}>
          <Button title="Continue with Phone" onPress={onLogin} loading={loading} style={styles.loginButton} />
          <Text variant="caption" muted style={styles.terms}>
            By continuing, you agree to our Terms of Service and Driver Agreement.
          </Text>
          <Text variant="caption" muted style={styles.version}>
            Operations mode
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
    backgroundColor: '#0F172A',
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
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 330,
  },
  content: {
    flexGrow: 1,
  },
  card: {
    borderRadius: 20,
    borderColor: '#E2E8F0',
    borderWidth: 1,
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
  greenDot: {
    backgroundColor: '#16A34A',
  },
  yellowDot: {
    backgroundColor: '#CA8A04',
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
