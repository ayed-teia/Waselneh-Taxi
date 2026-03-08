import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type AppLocale = 'ar' | 'en';

interface I18nContextValue {
  locale: AppLocale;
  isRTL: boolean;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;
  txt: (ar: string, en: string) => string;
}

const STORAGE_KEY = 'waselneh.manager.locale';
let warnedMissingProvider = false;

function resolveInitialLocale(): AppLocale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') {
      return stored;
    }
  } catch {
    // Ignore storage read failures and fall back to Arabic.
  }
  return 'ar';
}

const I18nContext = createContext<I18nContextValue | null>(null);

const FALLBACK_CONTEXT: I18nContextValue = {
  locale: 'ar',
  isRTL: true,
  setLocale: () => undefined,
  toggleLocale: () => undefined,
  txt: (ar) => ar,
};

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(resolveInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
    } catch {
      // Ignore storage write failures in local/dev contexts.
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'ar' ? 'en' : 'ar');
  }, [locale, setLocale]);

  const txt = useCallback(
    (ar: string, en: string) => (locale === 'ar' ? ar : en),
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      isRTL: locale === 'ar',
      setLocale,
      toggleLocale,
      txt,
    }),
    [locale, setLocale, toggleLocale, txt]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    if (!warnedMissingProvider) {
      warnedMissingProvider = true;
      console.warn('[I18n] useI18n called outside I18nProvider. Falling back to Arabic.');
    }
    return FALLBACK_CONTEXT;
  }
  return context;
}
