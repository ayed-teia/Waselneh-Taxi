import { Card, EmptyState, Header, LoadingState, ScreenContainer, Text } from '@waselneh/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, View } from 'react-native';

import { useI18n } from '../src/localization';
import {
  PassengerPayment,
  PassengerTripHistoryItem,
  subscribeToPassengerPayments,
  subscribeToPassengerTripHistory,
} from '../src/services/realtime';
import { useAuthStore } from '../src/store';

function formatDate(value: Date | null | undefined): string {
  if (!value) return '--';
  return value.toLocaleString();
}

export default function History() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<PassengerTripHistoryItem[]>([]);
  const [payments, setPayments] = useState<PassengerPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;

    const unsubscribe = subscribeToPassengerTripHistory(
      user.uid,
      (items) => {
        setTrips(items);
        setLoading(false);
      },
      (error) => {
        console.error('Passenger history subscription failed:', error);
        setTrips([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeToPassengerPayments(
      user.uid,
      (items) => {
        setPayments(items);
        setPaymentsLoading(false);
      },
      (error) => {
        console.error('Passenger payment history subscription failed:', error);
        setPaymentsLoading(false);
      }
    );
  }, [user?.uid]);

  const paymentsByTrip = useMemo(
    () => new Map(payments.map((payment) => [payment.tripId, payment])),
    [payments]
  );

  const totalSpent = useMemo(
    () => payments.filter((payment) => payment.status === 'paid').reduce((total, payment) => total + payment.amount, 0),
    [payments]
  );

  const shareReceipt = async (trip: PassengerTripHistoryItem, payment: PassengerPayment) => {
    const settledAt = payment.refundedAt ?? payment.paidAt;
    await Share.share({
      message: [
        isRTL ? 'إيصال وصلني' : 'Waselneh receipt',
        `${isRTL ? 'رقم الرحلة' : 'Trip'}: ${trip.id}`,
        `${isRTL ? 'رقم الدفعة' : 'Payment'}: ${payment.id}`,
        `${isRTL ? 'المبلغ' : 'Amount'}: ${payment.amount.toFixed(2)} ${payment.currency}`,
        `${isRTL ? 'الحالة' : 'Status'}: ${payment.status}`,
        `${isRTL ? 'المزوّد' : 'Provider'}: ${payment.provider ?? (isRTL ? 'نقدي' : 'cash')}`,
        `${isRTL ? 'التاريخ' : 'Date'}: ${formatDate(settledAt ?? trip.completedAt)}`,
      ].join('\n'),
    });
  };

  const paymentLabel = (payment?: PassengerPayment) => {
    if (!payment) return isRTL ? 'لا يوجد سجل دفع' : 'No payment record';
    const labels = {
      pending: isRTL ? 'غير مدفوع' : 'Unpaid',
      awaiting_payment: isRTL ? 'بانتظار التأكيد' : 'Awaiting confirmation',
      paid: isRTL ? 'مدفوع' : 'Paid',
      failed: isRTL ? 'فشل الدفع' : 'Payment failed',
      cancelled: isRTL ? 'الدفع ملغي' : 'Payment cancelled',
      refunded: isRTL ? 'تم الاسترداد' : 'Refunded',
    };
    return labels[payment.status];
  };

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title={isRTL ? 'سجل الرحلات' : 'Trip History'}
        subtitle={isRTL ? `إجمالي المدفوع: ₪${totalSpent.toFixed(2)}` : `Total paid: NIS ${totalSpent.toFixed(2)}`}
        leftAction={
          <Pressable onPress={() => router.replace('/home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>{isRTL ? 'رجوع >' : '< Back'}</Text>
          </Pressable>
        }
        rightAction={
          <Pressable onPress={() => router.push('/loyalty')} style={styles.backButton}>
            <Text style={styles.backButtonText}>{isRTL ? 'نقاطي' : 'My points'}</Text>
          </Pressable>
        }
      />

      {loading || paymentsLoading ? (
        <LoadingState title={isRTL ? 'جاري تحميل السجل...' : 'Loading history...'} />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={trips.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={
            <EmptyState
              title={isRTL ? 'لا توجد رحلات بعد' : 'No trips yet'}
              subtitle={
                isRTL ? 'ستظهر هنا الرحلات المكتملة والملغاة.' : 'Your completed and cancelled trips will appear here.'
              }
            />
          }
          renderItem={({ item }) => {
            const payment = paymentsByTrip.get(item.id);
            const canShare = payment?.status === 'paid' || payment?.status === 'refunded';
            const needsPayment = item.status === 'completed' && (!payment || ['pending', 'failed', 'cancelled'].includes(payment.status));
            return (
            <Card style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.tripId}>{isRTL ? `رحلة ${item.id.slice(0, 8)}` : `Trip ${item.id.slice(0, 8)}`}</Text>
                <Text>{item.status}</Text>
              </View>
              <Text muted style={styles.detailText}>
                {isRTL ? 'الالتقاط' : 'Pickup'}: {item.pickup.lat.toFixed(4)}, {item.pickup.lng.toFixed(4)}
              </Text>
              <Text muted style={styles.detailText}>
                {isRTL ? 'الوصول' : 'Dropoff'}: {item.dropoff.lat.toFixed(4)}, {item.dropoff.lng.toFixed(4)}
              </Text>
              <View style={styles.cardRow}>
                <Text>{isRTL ? 'الأجرة' : 'Fare'}</Text>
                <Text style={styles.fare}>{isRTL ? '₪' : 'NIS '} {Math.round(item.finalPriceIls ?? item.estimatedPriceIls)}</Text>
              </View>
              <Text muted style={styles.detailText}>
                {formatDate(item.completedAt ?? item.createdAt)}
              </Text>
              <View style={styles.paymentRow}>
                <View style={[styles.paymentBadge, payment?.status === 'paid' && styles.paymentPaid, payment?.status === 'refunded' && styles.paymentRefunded]}>
                  <Text style={styles.paymentBadgeText}>{paymentLabel(payment)}</Text>
                </View>
                {needsPayment ? <Pressable style={styles.receiptButton} onPress={() => router.push({ pathname: '/trip', params: { tripId: item.id } })}><Text style={styles.receiptButtonText}>{isRTL ? 'إكمال الدفع' : 'Complete payment'}</Text></Pressable> : null}
                {canShare && payment ? <Pressable style={styles.receiptButton} onPress={() => void shareReceipt(item, payment)}><Text style={styles.receiptButtonText}>{isRTL ? 'مشاركة الإيصال' : 'Share receipt'}</Text></Pressable> : null}
              </View>
            </Card>
          );}}
        />
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
  list: {
    padding: 16,
    gap: 10,
  },
  emptyList: {
    flexGrow: 1,
    padding: 16,
  },
  card: {
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripId: {
    fontSize: 14,
    fontWeight: '700',
  },
  detailText: {
    marginTop: 3,
    fontSize: 12,
  },
  fare: {
    fontSize: 17,
    fontWeight: '800',
    color: '#16A34A',
  },
  paymentRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  paymentBadge: {
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  paymentPaid: {
    backgroundColor: '#DCFCE7',
  },
  paymentRefunded: {
    backgroundColor: '#E0E7FF',
  },
  paymentBadgeText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  receiptButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#93C5FD',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  receiptButtonText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
  },
});
