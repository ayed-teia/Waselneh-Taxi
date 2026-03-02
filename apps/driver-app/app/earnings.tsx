import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Card, Header, LoadingState, ScreenContainer, Text } from '@waselneh/ui';
import { getDriverEarningsSummary, DriverEarningsSummaryResponse } from '../src/services/api';
import { useAuthStore } from '../src/store';

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h`;
}

export default function Earnings() {
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
        title="Earnings"
        subtitle="Daily and weekly driver performance"
        leftAction={
          <Pressable onPress={() => router.replace('/home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>{'< Back'}</Text>
          </Pressable>
        }
      />

      {loading || !summary ? (
        <LoadingState title="Loading earnings..." />
      ) : (
        <View style={styles.content}>
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Today</Text>
            <Text style={styles.value}>NIS {summary.day.totalEarningsIls.toFixed(2)}</Text>
            <Text muted>Trips: {summary.day.tripsCount}</Text>
            <Text muted>Avg fare: NIS {summary.day.averageFareIls.toFixed(2)}</Text>
            <Text muted>Working time: {formatHours(summary.day.workingMinutes)}</Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Last 7 days</Text>
            <Text style={styles.value}>NIS {summary.week.totalEarningsIls.toFixed(2)}</Text>
            <Text muted>Trips: {summary.week.tripsCount}</Text>
            <Text muted>Avg fare: NIS {summary.week.averageFareIls.toFixed(2)}</Text>
            <Text muted>Working time: {formatHours(summary.week.workingMinutes)}</Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Incentive tracker</Text>
            <Text muted>
              Complete {Math.max(0, 30 - summary.week.tripsCount)} more rides this week to unlock performance bonus.
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
