import { useI18n } from '../localization';

export function LanguageToggle() {
  const { locale, setLocale, txt } = useI18n();

  return (
    <div className="language-toggle" role="group" aria-label={txt('تبديل اللغة', 'Language toggle')}>
      <button
        type="button"
        className={locale === 'ar' ? 'language-chip active' : 'language-chip'}
        onClick={() => setLocale('ar')}
      >
        عربي
      </button>
      <button
        type="button"
        className={locale === 'en' ? 'language-chip active' : 'language-chip'}
        onClick={() => setLocale('en')}
      >
        EN
      </button>
    </div>
  );
}
