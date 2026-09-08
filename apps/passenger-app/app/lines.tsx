import { Card, EmptyState, Header, LoadingState, ScreenContainer, StatusChip, Text } from '@waselneh/ui';
import * as Location from 'expo-location';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useI18n } from '../src/localization';
import { bookRouteRun, findNearbyRouteRuns, NearbyRouteRunResult } from '../src/services/api';
import {
  PassengerLine,
  PassengerRouteRun,
  subscribeToPassengerLines,
  subscribeToRouteRuns,
} from '../src/services/realtime';
import { useAuthStore } from '../src/store';

export default function Lines() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [lines, setLines] = useState<PassengerLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<PassengerLine | null>(null);
  const [runs, setRuns] = useState<PassengerRouteRun[]>([]);
  const [seats, setSeats] = useState(1);
  const [loading, setLoading] = useState(true);
  const [bookingRunId, setBookingRunId] = useState<string | null>(null);
  const [nearbyRuns, setNearbyRuns] = useState<NearbyRouteRunResult[]>([]);

  useEffect(
    () =>
      subscribeToPassengerLines(
        (items) => {
          setLines(items);
          setLoading(false);
        },
        () => setLoading(false)
      ),
    []
  );

  useEffect(() => {
    let active = true;
    const loadNearby = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') return;
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const result = await findNearbyRouteRuns(
        { lat: position.coords.latitude, lng: position.coords.longitude },
        seats
      );
      if (active) setNearbyRuns(result.runs);
    };
    void loadNearby().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [seats]);

  useEffect(() => {
    if (!selectedLine) {
      setRuns([]);
      return undefined;
    }
    return subscribeToRouteRuns(selectedLine.id, setRuns, (error) =>
      Alert.alert(isRTL ? 'تعذّر تحميل الرحلات' : 'Unable to load departures', error.message)
    );
  }, [isRTL, selectedLine]);

  if (!isAuthenticated) return <Redirect href="/" />;

  const handleBooking = async (run: PassengerRouteRun) => {
    setBookingRunId(run.id);
    try {
      await bookRouteRun(run.id, seats, run.originLabel ?? undefined, run.destinationLabel ?? undefined);
      Alert.alert(
        isRTL ? 'تم تأكيد الحجز' : 'Booking confirmed',
        isRTL ? `تم حجز ${seats} مقعد.` : `${seats} seat(s) reserved.`
      );
    } catch (error) {
      Alert.alert(
        isRTL ? 'تعذّر الحجز' : 'Booking failed',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setBookingRunId(null);
    }
  };

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title={isRTL ? 'خطوط المدن' : 'City Lines'}
        subtitle={isRTL ? 'اختار الخط والرحلة واحجز مقعدك مباشرة.' : 'Choose a line and reserve your seat live.'}
        leftAction={<Pressable onPress={() => router.replace('/home')}><Text>{isRTL ? 'رجوع >' : '< Back'}</Text></Pressable>}
      />
      {loading ? <LoadingState title={isRTL ? 'جاري تحميل الخطوط...' : 'Loading lines...'} /> : (
        <FlatList<PassengerLine | PassengerRouteRun>
          data={selectedLine ? runs : lines}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={selectedLine ? (
            <View style={styles.headerRow}>
              <Pressable onPress={() => setSelectedLine(null)}><Text style={styles.link}>{isRTL ? 'تغيير الخط' : 'Change line'}</Text></Pressable>
              <View style={styles.seatsRow}>
                <Pressable style={styles.stepper} onPress={() => setSeats(Math.max(1, seats - 1))}><Text>−</Text></Pressable>
                <Text>{isRTL ? `${seats} مقعد` : `${seats} seat(s)`}</Text>
                <Pressable style={styles.stepper} onPress={() => setSeats(Math.min(7, seats + 1))}><Text>+</Text></Pressable>
              </View>
            </View>
          ) : nearbyRuns.length > 0 ? (
            <View style={styles.nearbySection}>
              <Text style={styles.title}>{isRTL ? 'رحلات قريبة من مسارك' : 'Runs near your route'}</Text>
              {nearbyRuns.map((nearby) => (
                <Pressable
                  key={nearby.runId}
                  style={styles.nearbyCard}
                  onPress={() => {
                    const line = lines.find((item) => item.id === nearby.lineId);
                    if (line) setSelectedLine(line);
                  }}
                >
                  <Text>{nearby.originLabel || '—'} → {nearby.destinationLabel || '—'}</Text>
                  <Text muted>{isRTL ? `${nearby.distanceToRouteKm} كم عن المسار` : `${nearby.distanceToRouteKm} km from route`}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          ListEmptyComponent={<EmptyState title={isRTL ? 'لا توجد رحلات متاحة الآن' : 'No available departures'} subtitle={isRTL ? 'الرحلات الجديدة بتظهر هون فورًا.' : 'New departures appear here in real time.'} />}
          renderItem={({ item }) => selectedLine ? (() => {
            const run = item as PassengerRouteRun;
            return (
              <Card style={styles.card}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{run.originLabel || selectedLine.originLabel || '—'} → {run.destinationLabel || selectedLine.destinationLabel || '—'}</Text>
                  <StatusChip label={run.status === 'full' ? (isRTL ? 'ممتلئ' : 'Full') : (isRTL ? 'متاح' : 'Available')} tone={run.status === 'full' ? 'warning' : 'success'} />
                </View>
                <Text muted>{run.departureTime?.toLocaleString() ?? '—'}</Text>
                <Text>{isRTL ? `المقاعد المتاحة: ${run.availableSeats}` : `Available seats: ${run.availableSeats}`}</Text>
                <Pressable style={[styles.primary, (run.status === 'full' || run.availableSeats < seats) && styles.disabled]} disabled={run.status === 'full' || run.availableSeats < seats || bookingRunId !== null} onPress={() => handleBooking(run)}>
                  {bookingRunId === run.id ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.primaryText}>{isRTL ? 'احجز المقاعد' : 'Reserve seats'}</Text>}
                </Pressable>
              </Card>
            );
          })() : (() => {
            const line = item as PassengerLine;
            return (
              <Pressable onPress={() => setSelectedLine(line)}>
                <Card style={styles.card}>
                  <Text style={styles.title}>{line.name}</Text>
                  <Text muted>{line.originLabel || '—'} → {line.destinationLabel || '—'}</Text>
                  {line.fixedPriceIls ? <Text>{isRTL ? `السعر الثابت: ₪${line.fixedPriceIls}` : `Fixed fare: NIS ${line.fixedPriceIls}`}</Text> : null}
                </Card>
              </Pressable>
            );
          })()}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  card: { gap: 8, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '800' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  headerRow: { gap: 12, marginBottom: 12 },
  link: { color: '#2563EB', fontWeight: '700' },
  seatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  stepper: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 46, borderRadius: 14, backgroundColor: '#FACC15', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#0F172A', fontWeight: '800' },
  disabled: { opacity: 0.45 },
  nearbySection: { gap: 8, marginBottom: 16 },
  nearbyCard: { borderRadius: 14, padding: 12, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', gap: 3 },
});
