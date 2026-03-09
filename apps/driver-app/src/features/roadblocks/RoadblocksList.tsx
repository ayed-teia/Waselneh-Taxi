import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
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
import { RoadblockData, getRoadblockStatusDisplay, subscribeToAllRoadblocks } from '../../services/realtime';
import { useI18n } from '../../localization';

/**
 * Driver-facing road conditions screen.
 * Read-only list with operational emphasis and clear status hierarchy.
 */
export function RoadblocksList() {
  const { isRTL } = useI18n();
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View style={styles.container}>
      <Header
        title={isRTL ? 'إغلاقات الطريق' : 'Roadblocks'}
        subtitle={isRTL ? `${activeCount} حالة نشطة` : `${activeCount} active condition${activeCount !== 1 ? 's' : ''}`}
      />

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
