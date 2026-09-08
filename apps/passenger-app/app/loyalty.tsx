import { Card, Header, LoadingState, ScreenContainer, Text } from '@waselneh/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { firebaseDB } from '../src/services/firebase';
import { useAuthStore } from '../src/store';

interface LoyaltySummary {
  points: number;
  completedTrips: number;
}

export default function Loyalty() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [summary, setSummary] = useState<LoyaltySummary>({ points: 0, completedTrips: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    return firebaseDB.collection('users').doc(user.uid).onSnapshot(
      (snapshot) => {
        const data = snapshot.data() ?? {};
        setSummary({
          points: typeof data.loyaltyPoints === 'number' ? Math.max(0, Math.floor(data.loyaltyPoints)) : 0,
          completedTrips: typeof data.loyaltyTripsCompleted === 'number' ? Math.max(0, Math.floor(data.loyaltyTripsCompleted)) : 0,
        });
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [user?.uid]);

  if (!isAuthenticated) return <Redirect href="/" />;

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title="نقاطي"
        subtitle="اكسب نقاطًا بعد كل رحلة مكتملة"
        leftAction={<Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>رجوع</Text></Pressable>}
      />
      {loading ? <LoadingState title="جاري تحميل رصيدك..." /> : (
        <View style={styles.content}>
          <Card style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>رصيدك الحالي</Text>
            <Text style={styles.points}>{summary.points}</Text>
            <Text style={styles.balanceLabel}>نقطة</Text>
          </Card>
          <Card style={styles.infoCard}>
            <Text style={styles.infoTitle}>رحلات مكتملة: {summary.completedTrips}</Text>
            <Text muted>تُضاف النقاط تلقائيًا بعد اكتمال الرحلة. قريبًا ستتمكن من استبدالها بخصم من الحجز.</Text>
          </Card>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  back: { borderColor: '#D1D5DB', borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  backText: { fontSize: 12 },
  balanceCard: { alignItems: 'center', backgroundColor: '#0F766E', paddingVertical: 32 },
  balanceLabel: { color: '#CCFBF1', fontSize: 16 },
  points: { color: '#FFFFFF', fontSize: 52, fontWeight: '800', marginVertical: 4 },
  infoCard: { gap: 8, padding: 20 },
  infoTitle: { fontSize: 18, fontWeight: '700' },
});
