import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import { AppLocale, PASSENGER_TRANSLATIONS } from './translations';

const STORAGE_KEY = 'waselneh.passenger.locale';
let warnedMissingProvider = false;

interface I18nContextValue {
  locale: AppLocale;
  isRTL: boolean;
  setLocale: (locale: AppLocale) => Promise<void>;
  toggleLocale: () => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const FALLBACK_CONTEXT: I18nContextValue = {
  locale: 'ar',
  isRTL: true,
  setLocale: async () => undefined,
  toggleLocale: async () => undefined,
  t: (key: string) => key,
};

function formatTemplate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;

  return Object.entries(params).reduce(
    (output, [key, value]) => output.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  );
}

function detectDefaultLocale(): AppLocale {
  return 'ar';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>('ar');

  useEffect(() => {
    I18nManager.allowRTL(true);
    I18nManager.swapLeftAndRightInRTL(true);
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!active) return;
        if (stored === 'ar' || stored === 'en') {
          setLocaleState(stored);
        } else {
          setLocaleState(detectDefaultLocale());
        }
      } catch {
        if (active) {
          setLocaleState(detectDefaultLocale());
        }
      } finally {
        // no-op: keep provider mounted at all times to avoid context gaps
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback(async (nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, nextLocale);
    } catch (error) {
      console.warn('Failed to persist locale preference', error);
    }
  }, []);

  const toggleLocale = useCallback(async () => {
    await setLocale(locale === 'en' ? 'ar' : 'en');
  }, [locale, setLocale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const template =
        PASSENGER_TRANSLATIONS[locale][key] ??
        PASSENGER_TRANSLATIONS.en[key] ??
        key;
      return formatTemplate(template, params);
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      isRTL: locale === 'ar',
      setLocale,
      toggleLocale,
      t,
    }),
    [locale, setLocale, toggleLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    if (!warnedMissingProvider) {
      warnedMissingProvider = true;
      console.warn('[I18n] useI18n called outside I18nProvider. Falling back to default locale.');
    }
    return FALLBACK_CONTEXT;
  }
  return context;
}
