import { Button, Header, ScreenContainer, Text } from '@waselneh/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';

import { clearActivePromoCode, getActivePromoCode, saveActivePromoCode } from '../src/features/promotions/promo-storage';
import { useI18n } from '../src/localization';
import { LoyaltyEntry, subscribeToLoyaltyWallet } from '../src/services/realtime/loyalty.realtime';
import { useAuthStore } from '../src/store';

export default function Promo() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [promoCode, setPromoCode] = useState('');
  const [activePromoCode, setActivePromoCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [loyaltyTrips, setLoyaltyTrips] = useState(0);
  const [loyaltyEntries, setLoyaltyEntries] = useState<LoyaltyEntry[]>([]);
  const [loyaltyError, setLoyaltyError] = useState(false);
  const referralCode = useMemo(() => `WSL-${(user?.uid ?? 'GUEST').slice(0, 6).toUpperCase()}`, [user?.uid]);

  useEffect(() => {
    void getActivePromoCode().then(setActivePromoCode);
  }, []);

  useEffect(() => {
    if (!user?.uid) return undefined;
    return subscribeToLoyaltyWallet(user.uid, (points, trips) => {
      setLoyaltyPoints(points); setLoyaltyTrips(trips); setLoyaltyError(false);
    }, setLoyaltyEntries, () => setLoyaltyError(true));
  }, [user?.uid]);

  const applyPromo = async () => {
    if (!promoCode.trim()) {
      Alert.alert(isRTL ? 'رمز الخصم' : 'Promo code', isRTL ? 'أدخل رمز الخصم أولاً.' : 'Enter a promo code first.');
      return;
    }
    setSaving(true);
    try {
      const code = await saveActivePromoCode(promoCode);
      setActivePromoCode(code);
      setPromoCode('');
      Alert.alert(
        isRTL ? 'تم حفظ الرمز' : 'Promo saved',
        isRTL
          ? `سيتحقق السيرفر من ${code} ويحسب الخصم عند طلب الرحلة القادمة.`
          : `The server will validate ${code} and calculate the discount on your next request.`
      );
    } finally {
      setSaving(false);
    }
  };

  const removePromo = async () => {
    await clearActivePromoCode();
    setActivePromoCode(null);
  };

  const shareReferral = async () => {
    await Share.share({
      message: isRTL
        ? `انضم إلى وصلني باستخدام رمز الإحالة ${referralCode} واحصل على عرض ترحيبي.`
        : `Join Waselneh with my referral code ${referralCode} and get a welcome promo.`,
    });
  };

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title={isRTL ? 'العروض والإحالة' : 'Promo & Referral'}
        subtitle={isRTL ? 'خصومات للركاب وحوافز نمو' : 'Discounts for riders and growth incentives'}
        leftAction={
          <Pressable onPress={() => router.replace('/home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>{isRTL ? 'رجوع >' : '< Back'}</Text>
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.walletCard}>
          <Text style={styles.walletLabel}>{isRTL ? 'رصيد نقاطك' : 'Your points balance'}</Text>
          <Text style={styles.walletPoints}>{loyaltyPoints.toLocaleString()}</Text>
          <Text style={styles.walletValue}>{isRTL ? `قيمتها حتى ₪${Math.floor(loyaltyPoints / 10)} · ${loyaltyTrips} رحلات مكتملة` : `Worth up to ₪${Math.floor(loyaltyPoints / 10)} · ${loyaltyTrips} completed trips`}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{isRTL ? 'تفعيل خصم' : 'Apply promo'}</Text>
          {activePromoCode ? (
            <View style={styles.activePromo}>
              <Text style={styles.activePromoText}>{isRTL ? `الرمز المحفوظ: ${activePromoCode}` : `Saved code: ${activePromoCode}`}</Text>
              <Pressable accessibilityRole="button" onPress={() => void removePromo()}>
                <Text style={styles.removePromo}>{isRTL ? 'إزالة' : 'Remove'}</Text>
              </Pressable>
            </View>
          ) : null}
          <TextInput
            style={styles.input}
            placeholder={isRTL ? 'أدخل رمز الخصم' : 'Enter promo code'}
            value={promoCode}
            onChangeText={setPromoCode}
            autoCapitalize="characters"
          />
          <Button title={saving ? (isRTL ? 'جارٍ الحفظ...' : 'Saving...') : (isRTL ? 'حفظ للرحلة القادمة' : 'Save for next trip')} onPress={() => void applyPromo()} disabled={saving} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{isRTL ? 'الإحالة' : 'Referral'}</Text>
          <Text muted style={styles.hint}>
            {isRTL ? 'شارك رمز إحالة الراكب الخاص بك:' : 'Share your rider referral code:'}
          </Text>
          <Text style={styles.refCode}>{referralCode}</Text>
          <Button title={isRTL ? 'مشاركة الإحالة' : 'Share referral'} variant="secondary" onPress={shareReferral} />
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{isRTL ? 'آخر حركات النقاط' : 'Recent points activity'}</Text>
          {loyaltyError ? <Text style={styles.errorText}>{isRTL ? 'تعذّر تحميل سجل النقاط.' : 'Could not load points history.'}</Text> : null}
          {!loyaltyError && loyaltyEntries.length === 0 ? <Text muted>{isRTL ? 'لا توجد حركات بعد.' : 'No activity yet.'}</Text> : null}
          {loyaltyEntries.map((entry) => {
            const label = entry.type === 'trip_completed' ? (isRTL ? 'مكافأة رحلة' : 'Trip reward') : entry.type === 'trip_discount_restored' ? (isRTL ? 'نقاط مسترجعة' : 'Points restored') : (isRTL ? 'خصم رحلة' : 'Trip discount');
            return <View key={entry.id} style={styles.ledgerRow}><View><Text style={styles.ledgerLabel}>{label}</Text><Text muted style={styles.ledgerDate}>{entry.createdAt?.toLocaleDateString(isRTL ? 'ar-PS' : 'en-US') ?? '—'}</Text></View><Text style={[styles.ledgerPoints, entry.points < 0 && styles.ledgerDebit]}>{entry.points > 0 ? '+' : ''}{entry.points}</Text></View>;
          })}
        </View>
      </ScrollView>
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    gap: 12,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  hint: {
    fontSize: 13,
  },
  refCode: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    fontSize: 14,
  },
  activePromo: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
  },
  activePromoText: { color: '#065F46', fontWeight: '700' },
  removePromo: { color: '#B91C1C', fontWeight: '700' },
  walletCard: { backgroundColor: '#0F766E', borderRadius: 16, padding: 18 },
  walletLabel: { color: '#CCFBF1', fontSize: 14, fontWeight: '700' },
  walletPoints: { color: '#FFFFFF', fontSize: 38, fontWeight: '900', marginTop: 4 },
  walletValue: { color: '#CCFBF1', fontSize: 13, marginTop: 3 },
  ledgerRow: { alignItems: 'center', borderTopColor: '#E5E7EB', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  ledgerLabel: { fontSize: 14, fontWeight: '700' },
  ledgerDate: { fontSize: 12, marginTop: 2 },
  ledgerPoints: { color: '#047857', fontSize: 17, fontWeight: '800' },
  ledgerDebit: { color: '#B45309' },
  errorText: { color: '#B91C1C' },
});
