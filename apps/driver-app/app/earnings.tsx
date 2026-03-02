import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Card, Header, LoadingState, ScreenContainer, Text } from '@waselneh/ui';
import { getDriverEarningsSummary, DriverEarningsSummaryResponse } from '../src/services/api';
import { useAuthStore } from '../src/store';
import { useI18n } from '../src/localization';

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h`;
}

export default function Earnings() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DriverEarningsSummaryResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    getDriverEarningsSummary(7)
      .then((data) => {
        if (!mounted) return;
        setSummary(data);
      })
      .catch((error) => {
        console.error('Failed to load earnings summary:', error);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title={isRTL ? 'الأرباح' : 'Earnings'}
        subtitle={isRTL ? 'أداء السائق اليومي والأسبوعي' : 'Daily and weekly driver performance'}
        leftAction={
          <Pressable onPress={() => router.replace('/home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>{isRTL ? 'رجوع >' : '< Back'}</Text>
          </Pressable>
        }
      />

      {loading || !summary ? (
        <LoadingState title={isRTL ? 'جاري تحميل الأرباح...' : 'Loading earnings...'} />
      ) : (
        <View style={styles.content}>
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{isRTL ? 'اليوم' : 'Today'}</Text>
            <Text style={styles.value}>{isRTL ? '₪' : 'NIS '} {summary.day.totalEarningsIls.toFixed(2)}</Text>
            <Text muted>{isRTL ? 'الرحلات' : 'Trips'}: {summary.day.tripsCount}</Text>
            <Text muted>{isRTL ? 'متوسط الأجرة' : 'Avg fare'}: {isRTL ? '₪' : 'NIS '} {summary.day.averageFareIls.toFixed(2)}</Text>
            <Text muted>{isRTL ? 'وقت العمل' : 'Working time'}: {formatHours(summary.day.workingMinutes)}</Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{isRTL ? 'آخر 7 أيام' : 'Last 7 days'}</Text>
            <Text style={styles.value}>{isRTL ? '₪' : 'NIS '} {summary.week.totalEarningsIls.toFixed(2)}</Text>
            <Text muted>{isRTL ? 'الرحلات' : 'Trips'}: {summary.week.tripsCount}</Text>
            <Text muted>{isRTL ? 'متوسط الأجرة' : 'Avg fare'}: {isRTL ? '₪' : 'NIS '} {summary.week.averageFareIls.toFixed(2)}</Text>
            <Text muted>{isRTL ? 'وقت العمل' : 'Working time'}: {formatHours(summary.week.workingMinutes)}</Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{isRTL ? 'متتبع الحوافز' : 'Incentive tracker'}</Text>
            <Text muted>
              {isRTL
                ? `أكمل ${Math.max(0, 30 - summary.week.tripsCount)} رحلة إضافية هذا الأسبوع لفتح مكافأة الأداء.`
                : `Complete ${Math.max(0, 30 - summary.week.tripsCount)} more rides this week to unlock performance bonus.`}
            </Text>
          </Card>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  backButton: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  card: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  value: {
    fontSize: 30,
    fontWeight: '800',
    color: '#16A34A',
  },
});
