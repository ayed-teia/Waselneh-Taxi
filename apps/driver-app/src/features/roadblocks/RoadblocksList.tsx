import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { subscribeToAllRoadblocks, RoadblockData, getRoadblockStatusDisplay } from '../../services/realtime';

/**
 * ============================================================================
 * ROADBLOCKS LIST SCREEN (DRIVER)
 * ============================================================================
 * 
 * Read-only view of all roadblocks for drivers.
 * Shows:
 * - Name
 * - Status badge (open/closed/congested)
 * - Note (if exists)
 * 
 * Data updates in realtime.
 * 
 * ============================================================================
 */

export function RoadblocksList() {
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAllRoadblocks(
      (data) => {
        setRoadblocks(data);
        setLoading(false);
      },
      (error) => {
        console.error('❌ [RoadblocksList] Subscription error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const renderRoadblock = ({ item }: { item: RoadblockData }) => {
    const statusDisplay = getRoadblockStatusDisplay(item.status);
    
    return (
      <View style={[styles.card, { borderLeftColor: statusDisplay.color }]}>
        <View style={styles.cardHeader}>
          <Text style={styles.statusEmoji}>{statusDisplay.emoji}</Text>
          <View style={styles.nameContainer}>
            <Text style={styles.name}>{item.name}</Text>
            {item.area && <Text style={styles.area}>({item.area})</Text>}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusDisplay.bgColor }]}>
            <Text style={[styles.statusText, { color: statusDisplay.color }]}>
              {statusDisplay.label}
            </Text>
          </View>
        </View>
        {item.note && (
          <Text style={styles.note}>{item.note}</Text>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>🚧 Roadblocks</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading roadblocks...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🚧 Roadblocks</Text>
        <Text style={styles.subtitle}>
          {roadblocks.filter(r => r.status !== 'open').length} active
        </Text>
      </View>

      {roadblocks.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyText}>No roadblocks reported</Text>
          <Text style={styles.emptySubtext}>All roads are clear</Text>
        </View>
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
    backgroundColor: '#F2F2F7',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1C1C1E',
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#8E8E93',
  },
  listContent: {
    padding: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusEmoji: {
    fontSize: 20,
    marginRight: 10,
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
    color: '#1C1C1E',
  },
  area: {
    fontSize: 14,
    color: '#8E8E93',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  note: {
    marginTop: 10,
    fontSize: 14,
    color: '#3C3C43',
    backgroundColor: '#F2F2F7',
    padding: 10,
    borderRadius: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8E8E93',
  },
});
