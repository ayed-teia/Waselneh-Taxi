import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Text as UIText,
  getModeColors,
  waselnehRadius,
  waselnehShadows,
  waselnehSpacing,
} from '@waselneh/ui';
import { RoadblockData, getRoadblockStatusDisplay, subscribeToAllRoadblocks } from '../../services/realtime';

/**
 * Read-only roadblocks screen for passengers.
 */
export function RoadblocksList() {
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
        setError('Failed to load roadblocks');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const renderRoadblock = ({ item }: { item: RoadblockData }) => {
    const statusDisplay = getRoadblockStatusDisplay(item.status);

    return (
      <Card elevated style={[styles.card, { borderLeftColor: statusDisplay.color }]}>
        <View style={styles.cardHeader}>
          <UIText style={styles.statusEmoji}>{statusDisplay.emoji}</UIText>
          <View style={styles.nameContainer}>
            <UIText style={styles.name}>{item.name}</UIText>
            {item.area ? <UIText muted style={styles.area}>({item.area})</UIText> : null}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusDisplay.bgColor }]}>
            <UIText style={[styles.statusText, { color: statusDisplay.color }]}>{statusDisplay.label}</UIText>
          </View>
        </View>

        {item.note ? <UIText style={styles.note}>{item.note}</UIText> : null}
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <Header
        title="Roadblocks"
        subtitle={`${roadblocks.filter((r) => r.status !== 'open').length} active`}
      />

      {loading ? (
        <LoadingState title="Loading roadblocks..." />
      ) : error ? (
        <ErrorState
          title="Roadblocks error"
          message={error}
          onRetry={() => {
            setLoading(true);
            setError(null);
          }}
        />
      ) : roadblocks.length === 0 ? (
        <EmptyState title="No roadblocks" subtitle="All roads are currently clear." />
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
  },
  card: {
    marginBottom: waselnehSpacing.md,
    borderLeftWidth: 4,
    borderRadius: waselnehRadius.lg,
    ...waselnehShadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusEmoji: {
    marginRight: waselnehSpacing.sm,
    fontSize: 20,
  },
  nameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  area: {
    fontSize: 14,
  },
  statusBadge: {
    borderRadius: waselnehRadius.md,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  note: {
    marginTop: waselnehSpacing.sm,
    borderRadius: waselnehRadius.sm,
    backgroundColor: getModeColors('light').background,
    padding: waselnehSpacing.sm,
    fontSize: 14,
  },
});
