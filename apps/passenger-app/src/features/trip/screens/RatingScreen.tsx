import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../../ui';

interface RatingScreenProps {
  tripId: string;
  finalPriceIls: number;
  onSubmit: (rating: number, comment?: string) => Promise<void>;
  onSkip: () => void;
}

const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very good',
  5: 'Excellent',
};

/**
 * Trip rating screen shown after completion.
 */
export function RatingScreen({
  tripId: _tripId,
  finalPriceIls,
  onSubmit,
  onSkip,
}: RatingScreenProps) {
  void _tripId;

  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 20, 560);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const ratingText = useMemo(() => (rating ? RATING_LABELS[rating] : 'Tap a score'), [rating]);

  const handleSubmit = async () => {
    if (rating === 0 || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(rating, comment.trim() || undefined);
    } catch (error) {
      console.error('Error submitting rating:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(18, insets.bottom + 10) }]}
      >
        <View style={[styles.headerCard, { width: cardWidth }]}> 
          <Text style={styles.headerBadge}>TRIP COMPLETE</Text>
          <Text style={styles.headerTitle}>Trip Completed</Text>
          <Text style={styles.headerPrice}>NIS {finalPriceIls.toFixed(2)}</Text>
        </View>

        <View style={[styles.card, styles.paymentCard, { width: cardWidth }]}> 
          <Text style={styles.sectionTitle}>Payment</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Amount</Text>
            <Text style={styles.summaryValue}>NIS {finalPriceIls.toFixed(2)}</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryRowLast]}>
            <Text style={styles.summaryLabel}>Method</Text>
            <Text style={styles.summaryValue}>Cash</Text>
          </View>
        </View>

        <View style={[styles.card, { width: cardWidth }]}> 
          <Text style={styles.sectionTitle}>How was your trip?</Text>
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((value) => {
              const selected = rating >= value;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setRating(value)}
                  activeOpacity={0.9}
                  style={[styles.ratingChip, selected && styles.ratingChipSelected]}
                >
                  <Text style={[styles.ratingChipText, selected && styles.ratingChipTextSelected]}>{value}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.ratingHint}>{ratingText}</Text>
        </View>

        <View style={[styles.card, { width: cardWidth }]}> 
          <Text style={styles.sectionTitle}>Comment (optional)</Text>
          <TextInput
            style={styles.commentInput}
            placeholder="Tell us about your experience"
            placeholderTextColor="#94A3B8"
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={500}
            numberOfLines={4}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{comment.length}/500</Text>
        </View>

        <View style={[styles.actions, { width: cardWidth }]}> 
          <Button
            title={submitting ? 'Submitting...' : 'Submit Rating'}
            onPress={handleSubmit}
            disabled={rating === 0 || submitting}
            loading={submitting}
          />
          <Button title="Skip" variant="outline" onPress={onSkip} disabled={submitting} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F5FB',
  },
  scrollContent: {
    alignItems: 'center',
    paddingTop: 18,
    gap: 14,
  },
  headerCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 6,
  },
  headerBadge: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: '#2563EB',
  },
  headerTitle: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerPrice: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: '#16A34A',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  paymentCard: {
    borderColor: '#FACC15',
    backgroundColor: '#FFFBEB',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  summaryRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  summaryRowLast: {
    borderBottomWidth: 0,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '700',
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  ratingChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#DBEAFE',
  },
  ratingChipText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#334155',
  },
  ratingChipTextSelected: {
    color: '#1D4ED8',
  },
  ratingHint: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    fontWeight: '500',
  },
  commentInput: {
    minHeight: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0F172A',
  },
  charCount: {
    textAlign: 'right',
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  actions: {
    gap: 10,
  },
});
