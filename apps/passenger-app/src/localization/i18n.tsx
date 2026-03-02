import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import { AppLocale, PASSENGER_TRANSLATIONS } from './translations';

const STORAGE_KEY = 'waselneh.passenger.locale';

interface I18nContextValue {
  locale: AppLocale;
  isRTL: boolean;
  setLocale: (locale: AppLocale) => Promise<void>;
  toggleLocale: () => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function formatTemplate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;

  return Object.entries(params).reduce(
    (output, [key, value]) => output.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  );
}

function detectDefaultLocale(): AppLocale {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  return locale.startsWith('ar') ? 'ar' : 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>('en');
  const [ready, setReady] = useState(false);

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
        if (active) {
          setReady(true);
        }
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

  if (!ready) {
    return <>{children}</>;
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return context;
}

