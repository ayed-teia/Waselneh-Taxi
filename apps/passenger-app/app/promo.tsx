import { Button, Header, ScreenContainer, Text } from '@waselneh/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';

import { clearActivePromoCode, getActivePromoCode, saveActivePromoCode } from '../src/features/promotions/promo-storage';
import { useI18n } from '../src/localization';
import {
  PromotionPreview,
  ReferralStatus,
  claimReferralCode,
  getMyReferralCode,
  getMyReferralStatus,
  validatePromotion,
} from '../src/services/api';
import { LoyaltyEntry, subscribeToLoyaltyWallet } from '../src/services/realtime/loyalty.realtime';
import { useAuthStore } from '../src/store';

export default function Promo() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [promoCode, setPromoCode] = useState('');
  const [activePromoCode, setActivePromoCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [promotionPreview, setPromotionPreview] = useState<PromotionPreview | null>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [loyaltyTrips, setLoyaltyTrips] = useState(0);
  const [loyaltyEntries, setLoyaltyEntries] = useState<LoyaltyEntry[]>([]);
  const [loyaltyError, setLoyaltyError] = useState(false);
  // The code is issued and owned by the server. It used to be derived on the client
  // from a slice of the uid, which let anyone forge it and leaked uid characters.
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralStatus, setReferralStatus] = useState<ReferralStatus | null>(null);
  const [inviterCode, setInviterCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [referralError, setReferralError] = useState(false);

  useEffect(() => {
    void getActivePromoCode().then(async (code) => {
      setActivePromoCode(code);
      if (!code) return;
      try { setPromotionPreview(await validatePromotion(code)); }
      catch { setPromotionPreview(null); }
    });
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    void (async () => {
      try {
        const [code, status] = await Promise.all([getMyReferralCode(), getMyReferralStatus()]);
        if (!active) return;
        setReferralCode(code.code);
        setReferralStatus(status);
        setReferralError(false);
      } catch {
        // Never leave a silent empty state: the card renders a retry hint instead.
        if (active) setReferralError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.uid]);

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
      const preview = await validatePromotion(promoCode);
      const code = await saveActivePromoCode(promoCode);
      setActivePromoCode(code);
      setPromotionPreview(preview);
      setPromoCode('');
      Alert.alert(
        isRTL ? 'تم حفظ الرمز' : 'Promo saved',
        isRTL
          ? `تم التحقق من ${preview.nameAr}. سيُحسب الخصم عند طلب الرحلة.`
          : `${preview.nameEn} is valid. The discount will be calculated when you request the trip.`
      );
    } catch (error) {
      Alert.alert(isRTL ? 'الرمز غير صالح' : 'Invalid promo', error instanceof Error ? error.message : (isRTL ? 'تعذّر التحقق من الرمز.' : 'Could not validate this code.'));
    } finally {
      setSaving(false);
    }
  };

  const removePromo = async () => {
    await clearActivePromoCode();
    setActivePromoCode(null);
    setPromotionPreview(null);
  };

  const submitInviterCode = async () => {
    const trimmed = inviterCode.trim();
    if (!trimmed || claiming) return;
    setClaiming(true);
    try {
      await claimReferralCode(trimmed);
      setInviterCode('');
      setReferralStatus(await getMyReferralStatus());
      Alert.alert(
        isRTL ? 'تم تسجيل الإحالة' : 'Referral recorded',
        isRTL
          ? 'ستحصل على رصيدك بعد إتمام ودفع رحلتك الأولى.'
          : 'You will receive your credit after your first completed and paid trip.'
      );
    } catch (error) {
      Alert.alert(
        isRTL ? 'تعذّر تسجيل الإحالة' : 'Could not record referral',
        error instanceof Error
          ? error.message
          : isRTL ? 'رمز غير صالح.' : 'That code is not valid.'
      );
    } finally {
      setClaiming(false);
    }
  };

  const shareReferral = async () => {
    if (!referralCode) return;
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
          {promotionPreview ? <Text style={styles.promoDetails}>{promotionPreview.discountType === 'percentage' ? `${promotionPreview.discountValue}%` : `₪${promotionPreview.discountValue}`}{promotionPreview.maxDiscountIls ? ` · ${isRTL ? 'حتى' : 'up to'} ₪${promotionPreview.maxDiscountIls}` : ''}{promotionPreview.minFareIls ? ` · ${isRTL ? 'أدنى أجرة' : 'min fare'} ₪${promotionPreview.minFareIls}` : ''}</Text> : null}
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

          {referralError ? (
            <Text style={styles.errorText}>
              {isRTL ? 'تعذّر تحميل بيانات الإحالة.' : 'Could not load your referral details.'}
            </Text>
          ) : null}

          {referralStatus && !referralStatus.rewardsEnabled ? (
            <Text muted style={styles.hint}>
              {isRTL
                ? 'برنامج الإحالة غير مفعّل حالياً.'
                : 'The referral programme is not active yet.'}
            </Text>
          ) : null}

          <Text muted style={styles.hint}>
            {isRTL ? 'شارك رمز إحالة الراكب الخاص بك:' : 'Share your rider referral code:'}
          </Text>
          <Text style={styles.refCode} accessibilityLabel={isRTL ? 'رمز الإحالة الخاص بك' : 'Your referral code'}>
            {referralCode ?? '…'}
          </Text>
          <Button
            title={isRTL ? 'مشاركة الإحالة' : 'Share referral'}
            variant="secondary"
            onPress={shareReferral}
            disabled={!referralCode}
          />

          {referralStatus ? (
            <Text muted style={styles.hint}>
              {isRTL
                ? `دعوت ${referralStatus.invitedCount} · تأهل ${referralStatus.qualifiedCount} · رصيدك ${referralStatus.creditBalance}`
                : `${referralStatus.invitedCount} invited · ${referralStatus.qualifiedCount} qualified · ${referralStatus.creditBalance} credits`}
            </Text>
          ) : null}

          {referralStatus?.claimStatus === 'none' ? (
            <View style={styles.claimRow}>
              <Text muted style={styles.hint}>
                {isRTL ? 'هل دعاك أحد؟ أدخل رمزه:' : 'Invited by someone? Enter their code:'}
              </Text>
              <TextInput
                style={styles.input}
                placeholder={isRTL ? 'رمز الإحالة' : 'Referral code'}
                value={inviterCode}
                onChangeText={setInviterCode}
                autoCapitalize="characters"
                accessibilityLabel={isRTL ? 'رمز إحالة الداعي' : 'Inviter referral code'}
              />
              <Button
                title={claiming ? (isRTL ? 'جارٍ الإرسال...' : 'Submitting...') : (isRTL ? 'تأكيد الرمز' : 'Apply code')}
                variant="secondary"
                onPress={() => void submitInviterCode()}
                disabled={claiming || !inviterCode.trim()}
              />
            </View>
          ) : null}

          {referralStatus?.claimStatus === 'pending' ? (
            <Text style={styles.badgePending}>
              {isRTL ? 'بانتظار رحلتك الأولى المدفوعة' : 'Waiting for your first paid trip'}
            </Text>
          ) : null}

          {referralStatus?.claimStatus === 'qualified' ? (
            <Text style={styles.badgeQualified}>
              {isRTL ? 'تمت المكافأة' : 'Reward granted'}
            </Text>
          ) : null}
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
  claimRow: {
    gap: 8,
    marginTop: 4,
  },
  badgePending: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  badgeQualified: {
    fontSize: 13,
    fontWeight: '700',
    color: '#047857',
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
  promoDetails: { color: '#047857', fontSize: 13, fontWeight: '700' },
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
