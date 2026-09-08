import { Card, EmptyState, Header, LoadingState, ScreenContainer, StatusChip, Text } from '@waselneh/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useI18n } from '../src/localization';
import { advanceRouteRun, openRouteRun } from '../src/services/api';
import {
  DriverEligibilityState,
  ManifestPassenger,
  subscribeToDriverEligibility,
  subscribeToMyActiveRouteRun,
  subscribeToPassengerManifest,
} from '../src/services/realtime';
import { useAuthStore } from '../src/store';

export default function RouteRun() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [eligibility, setEligibility] = useState<DriverEligibilityState | null>(null);
  const [run, setRun] = useState<({ id: string } & Record<string, unknown>) | null>(null);
  const [manifest, setManifest] = useState<ManifestPassenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.uid) return undefined;
    return subscribeToDriverEligibility(user.uid, setEligibility, (error) => {
      setLoading(false);
      Alert.alert(isRTL ? 'تعذّر تحميل بيانات الخط' : 'Unable to load line profile', error.message);
    });
  }, [isRTL, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    return subscribeToMyActiveRouteRun(
      user.uid,
      (activeRun) => {
        setRun(activeRun);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        Alert.alert(isRTL ? 'تعذّر تحميل الرحلة' : 'Unable to load route run', error.message);
      }
    );
  }, [isRTL, user?.uid]);

  useEffect(() => {
    if (!run?.id) {
      setManifest([]);
      return undefined;
    }
    return subscribeToPassengerManifest(run.id, setManifest, (error) =>
      Alert.alert(isRTL ? 'تعذّر تحميل الركاب' : 'Unable to load manifest', error.message)
    );
  }, [isRTL, run?.id]);

  if (!isAuthenticated) return <Redirect href="/" />;

  const handleOpen = async () => {
    if (!eligibility?.lineId) return;
    setSaving(true);
    try {
      await openRouteRun(
        eligibility.lineId,
        new Date(Date.now() + 30 * 60 * 1000).toISOString()
      );
    } catch (error) {
      Alert.alert(isRTL ? 'تعذّر فتح الرحلة' : 'Unable to open route run', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleAdvance = async (targetStatus: 'departed' | 'completed') => {
    if (!run) return;
    setSaving(true);
    try {
      await advanceRouteRun(run.id, targetStatus);
    } catch (error) {
      Alert.alert(isRTL ? 'تعذّر تحديث الرحلة' : 'Unable to update route run', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const status = String(run?.status ?? '');
  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title={isRTL ? 'رحلة الخط' : 'Route Run'}
        subtitle={isRTL ? 'المقاعد وقائمة الركاب بتتحدث لحظيًا.' : 'Seats and passenger manifest update live.'}
        leftAction={<Pressable onPress={() => router.replace('/home')}><Text>{isRTL ? 'رجوع >' : '< Back'}</Text></Pressable>}
      />
      {loading ? <LoadingState title={isRTL ? 'جاري تحميل الرحلة...' : 'Loading route run...'} /> : !run ? (
        <View style={styles.emptyWrap}>
          <EmptyState title={isRTL ? 'لا توجد رحلة خط مفتوحة' : 'No active route run'} subtitle={isRTL ? 'افتح رحلة جديدة قبل موعد الانطلاق بنصف ساعة.' : 'Open a new run 30 minutes before departure.'} />
          <Pressable style={styles.primary} onPress={handleOpen} disabled={saving || !eligibility?.lineId}>
            {saving ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.primaryText}>{isRTL ? 'افتح رحلة الخط' : 'Open route run'}</Text>}
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={manifest}
          keyExtractor={(item) => item.bookingId}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Card style={styles.summary}>
              <View style={styles.row}>
                <Text style={styles.title}>{String(run.lineId ?? '')}</Text>
                <StatusChip label={status} tone={status === 'full' ? 'warning' : status === 'departed' ? 'info' : 'success'} />
              </View>
              <Text>{isRTL ? `المحجوز: ${Number(run.bookedSeats ?? 0)} من ${Number(run.seatCapacity ?? 0)}` : `Booked: ${Number(run.bookedSeats ?? 0)} / ${Number(run.seatCapacity ?? 0)}`}</Text>
              <Text muted>{isRTL ? `المقاعد المتاحة: ${Number(run.availableSeats ?? 0)}` : `Available: ${Number(run.availableSeats ?? 0)}`}</Text>
              {status === 'boarding' || status === 'full' ? (
                <Pressable style={styles.primary} onPress={() => handleAdvance('departed')} disabled={saving}>
                  <Text style={styles.primaryText}>{isRTL ? 'ابدأ الانطلاق' : 'Depart now'}</Text>
                </Pressable>
              ) : status === 'departed' ? (
                <Pressable style={styles.primary} onPress={() => handleAdvance('completed')} disabled={saving}>
                  <Text style={styles.primaryText}>{isRTL ? 'أنهِ رحلة الخط' : 'Complete route run'}</Text>
                </Pressable>
              ) : null}
            </Card>
          }
          ListEmptyComponent={<EmptyState title={isRTL ? 'لا يوجد ركاب بعد' : 'No passengers yet'} subtitle={isRTL ? 'أي حجز جديد بظهر هون فورًا.' : 'New bookings appear here instantly.'} />}
          renderItem={({ item }) => (
            <Card style={styles.passengerCard}>
              <View style={styles.row}>
                <Text style={styles.title}>{item.passengerName}</Text>
                <StatusChip label={item.status} tone={item.status === 'confirmed' ? 'success' : 'neutral'} />
              </View>
              <Text>{isRTL ? `${item.seats} مقعد` : `${item.seats} seat(s)`}</Text>
              <Text muted>{item.pickupLabel || '—'} → {item.destinationLabel || '—'}</Text>
            </Card>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  emptyWrap: { flex: 1, padding: 16, justifyContent: 'center', gap: 18 },
  summary: { gap: 9, marginBottom: 12 },
  passengerCard: { gap: 6, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '800' },
  primary: { minHeight: 48, borderRadius: 14, backgroundColor: '#FACC15', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryText: { color: '#0F172A', fontWeight: '800' },
});
