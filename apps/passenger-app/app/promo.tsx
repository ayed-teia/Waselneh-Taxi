import React, { useMemo, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Button, Header, ScreenContainer, Text } from '@waselneh/ui';
import { useAuthStore } from '../src/store';
import { useI18n } from '../src/localization';

export default function Promo() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [promoCode, setPromoCode] = useState('');
  const referralCode = useMemo(() => `WSL-${(user?.uid ?? 'GUEST').slice(0, 6).toUpperCase()}`, [user?.uid]);

  const applyPromo = () => {
    if (!promoCode.trim()) {
      Alert.alert(isRTL ? 'رمز الخصم' : 'Promo code', isRTL ? 'أدخل رمز الخصم أولاً.' : 'Enter a promo code first.');
      return;
    }
    Alert.alert(
      isRTL ? 'تمت إضافة الرمز' : 'Promo added',
      isRTL
        ? `سيتم تطبيق الرمز ${promoCode.trim().toUpperCase()} على أجرتك القادمة.`
        : `Code ${promoCode.trim().toUpperCase()} will apply on your next fare.`
    );
    setPromoCode('');
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

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{isRTL ? 'تفعيل خصم' : 'Apply promo'}</Text>
          <TextInput
            style={styles.input}
            placeholder={isRTL ? 'أدخل رمز الخصم' : 'Enter promo code'}
            value={promoCode}
            onChangeText={setPromoCode}
            autoCapitalize="characters"
          />
          <Button title={isRTL ? 'تفعيل الرمز' : 'Apply code'} onPress={applyPromo} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{isRTL ? 'الإحالة' : 'Referral'}</Text>
          <Text muted style={styles.hint}>
            {isRTL ? 'شارك رمز إحالة الراكب الخاص بك:' : 'Share your rider referral code:'}
          </Text>
          <Text style={styles.refCode}>{referralCode}</Text>
          <Button title={isRTL ? 'مشاركة الإحالة' : 'Share referral'} variant="secondary" onPress={shareReferral} />
        </View>
      </View>
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
});
