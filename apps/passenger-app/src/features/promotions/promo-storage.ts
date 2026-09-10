import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_PROMO_KEY = '@waselneh/active-promo-code';

export function normalizePromoCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}

export async function saveActivePromoCode(value: string): Promise<string> {
  const code = normalizePromoCode(value);
  if (!code) throw new Error('Promo code is required');
  await AsyncStorage.setItem(ACTIVE_PROMO_KEY, code);
  return code;
}

export async function getActivePromoCode(): Promise<string | null> {
  const value = await AsyncStorage.getItem(ACTIVE_PROMO_KEY);
  return value ? normalizePromoCode(value) : null;
}

export async function clearActivePromoCode(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_PROMO_KEY);
}
