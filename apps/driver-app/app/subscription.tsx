import { Card, Header, LoadingState, ScreenContainer, Text } from '@waselneh/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { useI18n } from '../src/localization';
import {
  DriverSubscriptionInvoice,
  startSubscriptionInvoicePayment,
  subscribeToDriverInvoices,
} from '../src/services/billing/subscriptions';
import { getCurrentUser } from '../src/services/firebase';
import { useAuthStore } from '../src/store';

export default function Subscription() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [invoices, setInvoices] = useState<DriverSubscriptionInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const driverId = getCurrentUser()?.uid;
    if (!driverId) {
      setLoading(false);
      return;
    }
    return subscribeToDriverInvoices(driverId, (items) => {
      setInvoices(items);
      setLoading(false);
    });
  }, []);

  if (!isAuthenticated) return <Redirect href="/" />;
  const open = invoices.filter((item) => !['paid', 'void'].includes(item.status));
  const payInvoice = async (invoiceId: string) =>
    Linking.openURL(await startSubscriptionInvoicePayment(invoiceId));
  const shareReceipt = async (invoice: DriverSubscriptionInvoice) =>
    Share.share({
      message: isRTL
        ? `إيصال واصلني — فاتورة ${invoice.periodKey} — ₪${invoice.amountIls.toFixed(2)} — المرجع: ${invoice.paymentReference ?? invoice.id}`
        : `Waselneh receipt — invoice ${invoice.periodKey} — NIS ${invoice.amountIls.toFixed(2)} — reference: ${invoice.paymentReference ?? invoice.id}`,
    });

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title={isRTL ? 'الاشتراك والفواتير' : 'Subscription & invoices'}
        subtitle={
          isRTL ? 'تابع مستحقات حسابك وحالة كل فاتورة' : 'Track account dues and invoice status'
        }
        leftAction={
          <Pressable onPress={() => router.replace('/home')} style={styles.back}>
            <Text>{isRTL ? 'رجوع >' : '< Back'}</Text>
          </Pressable>
        }
      />
      {loading ? (
        <LoadingState title={isRTL ? 'جاري تحميل الفواتير...' : 'Loading invoices...'} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Card style={styles.summary}>
            <Text style={styles.title}>{isRTL ? 'المبلغ المستحق' : 'Amount due'}</Text>
            <Text style={styles.amount}>
              ₪ {open.reduce((sum, item) => sum + item.amountIls, 0).toFixed(2)}
            </Text>
            <Text muted>
              {isRTL ? `${open.length} فاتورة غير مدفوعة` : `${open.length} unpaid invoice(s)`}
            </Text>
          </Card>
          {invoices.map((invoice) => (
            <Card key={invoice.id} style={styles.invoice}>
              <View style={styles.row}>
                <Text style={styles.title}>{invoice.periodKey}</Text>
                <Text style={[styles.badge, invoice.status === 'paid' ? styles.paid : styles.due]}>
                  {invoice.status}
                </Text>
              </View>
              <Text style={styles.invoiceAmount}>₪ {invoice.amountIls.toFixed(2)}</Text>
              <Text muted>
                {isRTL ? 'تاريخ الاستحقاق' : 'Due date'}:{' '}
                {invoice.dueAt?.toDate().toLocaleDateString() ?? '—'}
              </Text>
              {invoice.paymentReference ? (
                <Text muted>
                  {isRTL ? 'مرجع الدفع' : 'Payment reference'}: {invoice.paymentReference}
                </Text>
              ) : null}
              {!['paid', 'void'].includes(invoice.status) ? (
                <Pressable style={styles.payButton} onPress={() => void payInvoice(invoice.id)}>
                  <Text style={styles.payText}>{isRTL ? 'ادفع إلكترونيًا' : 'Pay online'}</Text>
                </Pressable>
              ) : invoice.status === 'paid' ? (
                <Pressable style={styles.receiptButton} onPress={() => void shareReceipt(invoice)}>
                  <Text style={styles.receiptText}>{isRTL ? 'مشاركة الإيصال' : 'Share receipt'}</Text>
                </Pressable>
              ) : null}
            </Card>
          ))}
          {!invoices.length ? (
            <Card>
              <Text>{isRTL ? 'لا توجد فواتير على حسابك.' : 'No invoices on your account.'}</Text>
            </Card>
          ) : null}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  back: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, gap: 10 },
  summary: { gap: 5 },
  invoice: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800' },
  amount: { fontSize: 30, fontWeight: '900', color: '#B45309' },
  invoiceAmount: { fontSize: 23, fontWeight: '800' },
  badge: {
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    fontWeight: '800',
  },
  paid: { color: '#166534', backgroundColor: '#DCFCE7' },
  due: { color: '#9F1239', backgroundColor: '#FFE4E6' },
  payButton: {
    marginTop: 6,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  payText: { color: '#FFFFFF', fontWeight: '800' },
  receiptButton: { marginTop: 6, borderWidth: 1, borderColor: '#16A34A', borderRadius: 10, padding: 12, alignItems: 'center' },
  receiptText: { color: '#166534', fontWeight: '800' },
});
