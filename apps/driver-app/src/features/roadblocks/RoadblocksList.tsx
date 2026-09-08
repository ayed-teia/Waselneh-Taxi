import {
  BottomSheetCard,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  StatusChip,
  Text as UIText,
  getModeColors,
  waselnehRadius,
  waselnehShadows,
  waselnehSpacing,
} from '@waselneh/ui';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useI18n } from '../../localization';
import { reportCheckpoint } from '../../services/api';
import { RoadblockData, getRoadblockStatusDisplay, subscribeToAllRoadblocks } from '../../services/realtime';

/**
 * Driver-facing road conditions screen.
 * Read-only list with operational emphasis and clear status hierarchy.
 */
export function RoadblocksList() {
  const { isRTL } = useI18n();
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAllRoadblocks(
      (data) => {
        setRoadblocks(data);
        setError(null);
        setLoading(false);
      },
      (subscriptionError) => {
        console.error('[RoadblocksList] Subscription error:', subscriptionError);
        setError(isRTL ? 'تعذر تحميل الإغلاقات' : 'Failed to load roadblocks');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [isRTL]);

  const activeCount = useMemo(
    () => roadblocks.filter((item) => item.status !== 'open').length,
    [roadblocks],
  );

  const renderRoadblock = ({ item }: { item: RoadblockData }) => {
    const statusDisplay = getRoadblockStatusDisplay(item.status);
    const tone =
      item.status === 'open'
        ? 'success'
        : item.status === 'congested'
          ? 'warning'
          : 'danger';

    return (
      <BottomSheetCard withHandle={false} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.nameContainer}>
            <UIText style={styles.statusEmoji}>{statusDisplay.emoji}</UIText>
            <View style={styles.titleWrap}>
              <UIText style={styles.name}>{item.name}</UIText>
              {item.area ? <UIText muted style={styles.area}>{item.area}</UIText> : null}
            </View>
          </View>
          <StatusChip label={statusDisplay.label} tone={tone} />
        </View>

        <View style={styles.metaRow}>
          <UIText muted style={styles.metaLabel}>{isRTL ? 'الموقع' : 'Location'}</UIText>
          <UIText style={styles.metaValue}>
            {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
          </UIText>
        </View>

        {item.note ? <UIText style={styles.note}>{item.note}</UIText> : null}
      </BottomSheetCard>
    );
  };

  const handleReport = async (status: 'closed' | 'congested' | 'open') => {
    setReporting(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error(isRTL ? 'لازم تسمح بالوصول للموقع.' : 'Location permission is required.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const result = await reportCheckpoint(
        { lat: position.coords.latitude, lng: position.coords.longitude },
        status
      );
      Alert.alert(
        isRTL ? 'تم إرسال البلاغ' : 'Report submitted',
        isRTL
          ? `بانتظار مراجعة الإدارة. درجة الثقة الحالية ${Math.round(result.confidence * 100)}٪.`
          : `Awaiting operations review. Current confidence is ${Math.round(result.confidence * 100)}%.`
      );
    } catch (reportError) {
      Alert.alert(isRTL ? 'تعذّر إرسال البلاغ' : 'Report failed', reportError instanceof Error ? reportError.message : String(reportError));
    } finally {
      setReporting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header
        title={isRTL ? 'إغلاقات الطريق' : 'Roadblocks'}
        subtitle={isRTL ? `${activeCount} حالة نشطة` : `${activeCount} active condition${activeCount !== 1 ? 's' : ''}`}
      />

      <View style={styles.reportBar}>
        <UIText style={styles.reportTitle}>{isRTL ? 'بلّغ من موقعك الحالي' : 'Report from current location'}</UIText>
        <View style={styles.reportActions}>
          <Pressable disabled={reporting} style={[styles.reportButton, styles.closed]} onPress={() => handleReport('closed')}><UIText style={styles.reportButtonText}>{isRTL ? 'مغلق' : 'Closed'}</UIText></Pressable>
          <Pressable disabled={reporting} style={[styles.reportButton, styles.congested]} onPress={() => handleReport('congested')}><UIText style={styles.reportButtonText}>{isRTL ? 'ازدحام' : 'Congested'}</UIText></Pressable>
          <Pressable disabled={reporting} style={[styles.reportButton, styles.open]} onPress={() => handleReport('open')}><UIText style={styles.reportButtonText}>{isRTL ? 'سالِك' : 'Clear'}</UIText></Pressable>
        </View>
      </View>

      {loading ? (
        <LoadingState title={isRTL ? 'جارٍ تحميل حالة الطريق...' : 'Loading road conditions...'} />
      ) : error ? (
        <ErrorState
          title={isRTL ? 'خطأ في الإغلاقات' : 'Roadblocks error'}
          message={error}
          onRetry={() => {
            setLoading(true);
            setError(null);
          }}
        />
      ) : roadblocks.length === 0 ? (
        <EmptyState
          title={isRTL ? 'لا توجد إغلاقات' : 'No roadblocks'}
          subtitle={isRTL ? 'جميع الطرق سالكة حاليًا.' : 'All roads are currently clear.'}
        />
      ) : (
        <FlatList
          data={roadblocks}
          keyExtractor={(item) => item.id}
          renderItem={renderRoadblock}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: getModeColors('light').background,
  },
  listContent: {
    padding: waselnehSpacing.lg,
    gap: waselnehSpacing.sm,
  },
  reportBar: { paddingHorizontal: waselnehSpacing.lg, paddingBottom: waselnehSpacing.sm, gap: 8 },
  reportTitle: { fontWeight: '700' },
  reportActions: { flexDirection: 'row', gap: 8 },
  reportButton: { flex: 1, minHeight: 42, borderRadius: waselnehRadius.md, alignItems: 'center', justifyContent: 'center' },
  reportButtonText: { color: '#FFFFFF', fontWeight: '800' },
  closed: { backgroundColor: '#DC2626' },
  congested: { backgroundColor: '#D97706' },
  open: { backgroundColor: '#16A34A' },
  card: {
    borderRadius: waselnehRadius.xl,
    borderColor: '#DDE3F0',
    borderWidth: 1,
    ...waselnehShadows.sm,
    gap: waselnehSpacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: waselnehSpacing.sm,
  },
  nameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleWrap: {
    flex: 1,
    gap: 2,
  },
  statusEmoji: {
    fontSize: 20,
    lineHeight: 24,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
  },
  area: {
    fontSize: 13,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  note: {
    borderRadius: waselnehRadius.md,
    backgroundColor: getModeColors('light').surfaceMuted,
    borderWidth: 1,
    borderColor: getModeColors('light').border,
    padding: waselnehSpacing.sm,
    fontSize: 14,
    lineHeight: 20,
  },
});
