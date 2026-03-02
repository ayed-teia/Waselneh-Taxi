import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useI18n } from '../../../localization';

const LOW_RATING_REASONS = [
  { value: 'No show', key: 'trip.rating.reason.no_show' },
  { value: 'Late pickup', key: 'trip.rating.reason.late_pickup' },
  { value: 'Unsafe behavior', key: 'trip.rating.reason.unsafe_behavior' },
  { value: 'Payment issue', key: 'trip.rating.reason.payment_issue' },
];

interface PassengerRatingCardProps {
  rating: number;
  comment: string;
  lowRatingReason: string | null;
  submitting?: boolean;
  onChangeRating: (rating: number) => void;
  onChangeComment: (value: string) => void;
  onSelectReason: (reason: string) => void;
  onSubmit: () => void;
}

export function PassengerRatingCard({
  rating,
  comment,
  lowRatingReason,
  submitting = false,
  onChangeRating,
  onChangeComment,
  onSelectReason,
  onSubmit,
}: PassengerRatingCardProps) {
  const { isRTL, t } = useI18n();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('trip.rating.title')}</Text>

      <View style={[styles.ratingRow, isRTL && styles.rowReverse]}>
        {[1, 2, 3, 4, 5].map((value) => {
          const selected = value <= rating;
          return (
            <Pressable
              key={value}
              style={[styles.ratingChip, selected && styles.ratingChipSelected]}
              onPress={() => onChangeRating(value)}
            >
              <Text style={[styles.ratingChipText, selected && styles.ratingChipTextSelected]}>{value}</Text>
            </Pressable>
          );
        })}
      </View>

      {rating > 0 && rating <= 3 ? (
        <View style={[styles.reasonRow, isRTL && styles.rowReverse]}>
          {LOW_RATING_REASONS.map((reason) => {
            const selected = lowRatingReason === reason.value;
            return (
              <Pressable
                key={reason.value}
                style={[styles.reasonChip, selected && styles.reasonChipSelected]}
                onPress={() => onSelectReason(reason.value)}
              >
                <Text style={[styles.reasonChipText, selected && styles.reasonChipTextSelected]}>
                  {t(reason.key)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder={t('trip.rating.placeholder')}
        value={comment}
        onChangeText={onChangeComment}
        multiline
        maxLength={300}
      />

      <Pressable
        style={[styles.submitButton, (rating === 0 || submitting) && styles.submitButtonDisabled]}
        onPress={onSubmit}
        disabled={rating === 0 || submitting}
      >
        <Text style={styles.submitText}>
          {submitting ? t('trip.rating.submitting') : t('trip.rating.submit')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  ratingRow: {
    flexDirection: 'row',
    gap: 6,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  ratingChip: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  ratingChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#DBEAFE',
  },
  ratingChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  ratingChipTextSelected: {
    color: '#1D4ED8',
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reasonChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  reasonChipSelected: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  reasonChipText: {
    fontSize: 11,
    color: '#991B1B',
    fontWeight: '700',
  },
  reasonChipTextSelected: {
    color: '#B91C1C',
  },
  input: {
    minHeight: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    fontSize: 12,
    color: '#0F172A',
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  submitButton: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
