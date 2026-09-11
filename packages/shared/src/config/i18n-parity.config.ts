/**
 * ============================================================================
 * TRANSLATION PARITY
 * ============================================================================
 *
 * WHY THIS EXISTS
 *
 * Both mobile apps resolve a string as `TABLE[locale][key] ?? TABLE.en[key] ?? key`.
 * That fallback chain fails SILENTLY in two different ways:
 *
 *   - a key missing from `ar` renders ENGLISH to an Arabic user, mid-trip, with
 *     nothing logged anywhere;
 *   - a key missing from BOTH renders the raw dotted key - a passenger reads
 *     "trip.cancel_error_message" on screen.
 *
 * Neither is detectable by typecheck, lint, or any test that existed before this.
 * The tables are plain `Record<string, string>`, so TypeScript cannot relate the two
 * locales to each other.
 *
 * WHAT THIS IS NOT
 *
 * It does not translate anything, and it is not wired into either app at runtime.
 * The apps keep their own tables; this is the pure comparison the tests drive, so
 * drift is caught in CI rather than by a user.
 *
 * It also deliberately does NOT check that a value was actually translated - an
 * Arabic entry that still holds the English string is a content problem a human has
 * to see. Claiming to detect that would be worse than not claiming it.
 * ============================================================================
 */

/** One locale's key/value table, as both apps declare it. */
export type TranslationTable = Record<string, string>;

/** Every locale's table, keyed by locale code. */
export type LocaleTables = Record<string, TranslationTable>;

export interface ParityProblem {
  key: string;
  /** The locale this key is missing from. */
  missingFrom: string;
  /**
   * What a user would actually see, which is the point: a key present in the
   * fallback locale degrades to that language, one absent everywhere degrades to
   * the raw key.
   */
  userVisibleEffect: 'shows_fallback_language' | 'shows_raw_key';
}

export interface ParityReport {
  problems: ParityProblem[];
  /** The union of every key across every locale. */
  allKeys: string[];
  localeKeyCounts: Record<string, number>;
  isConsistent: boolean;
}

/**
 * Compare every locale's key set against the union of all of them.
 *
 * `fallbackLocale` is the one the apps fall back to (`en` in both). A key missing
 * from a non-fallback locale degrades to that language; a key missing from the
 * fallback itself is what produces a raw key on screen.
 */
export function checkTranslationParity(
  tables: LocaleTables,
  fallbackLocale = 'en'
): ParityReport {
  const locales = Object.keys(tables);
  const allKeys = [...new Set(locales.flatMap((locale) => Object.keys(tables[locale] ?? {})))].sort();

  const problems: ParityProblem[] = [];

  for (const key of allKeys) {
    const presentInFallback = Object.prototype.hasOwnProperty.call(
      tables[fallbackLocale] ?? {},
      key
    );

    for (const locale of locales) {
      if (Object.prototype.hasOwnProperty.call(tables[locale] ?? {}, key)) continue;

      problems.push({
        key,
        missingFrom: locale,
        // Missing from the fallback too means there is nothing left to fall back
        // to, so the raw key reaches the screen.
        userVisibleEffect: presentInFallback ? 'shows_fallback_language' : 'shows_raw_key',
      });
    }
  }

  const localeKeyCounts: Record<string, number> = {};
  for (const locale of locales) {
    localeKeyCounts[locale] = Object.keys(tables[locale] ?? {}).length;
  }

  return {
    problems,
    allKeys,
    localeKeyCounts,
    isConsistent: problems.length === 0,
  };
}

/**
 * Keys whose value is identical across two locales.
 *
 * Reported, never failed on: a proper noun, a currency code or a brand name is
 * legitimately identical in Arabic and English, so this is a list for a human to
 * glance at rather than a rule. Callers that treat it as a failure will be wrong
 * about "Waselneh".
 */
export function findUntranslatedValues(
  tables: LocaleTables,
  localeA: string,
  localeB: string
): string[] {
  const a = tables[localeA] ?? {};
  const b = tables[localeB] ?? {};
  return Object.keys(a)
    .filter((key) => b[key] !== undefined && a[key] === b[key])
    .sort();
}

/**
 * Placeholders such as `{seconds}` in one locale's string but not the other's.
 *
 * This one IS a real defect wherever it appears: `t()` interpolates `{name}` by
 * literal replacement, so a placeholder the translator dropped leaves the user with
 * a sentence missing its number, and one they invented leaves `{whatever}` visible
 * on screen.
 */
export function findPlaceholderMismatches(
  tables: LocaleTables,
  localeA: string,
  localeB: string
): { key: string; onlyInA: string[]; onlyInB: string[] }[] {
  const a = tables[localeA] ?? {};
  const b = tables[localeB] ?? {};

  const placeholders = (value: string): Set<string> =>
    new Set([...value.matchAll(/\{([A-Za-z_][A-Za-z_0-9]*)\}/g)].map((match) => match[1] as string));

  const mismatches: { key: string; onlyInA: string[]; onlyInB: string[] }[] = [];

  for (const key of Object.keys(a)) {
    const valueB = b[key];
    const valueA = a[key];
    if (valueB === undefined || valueA === undefined) continue;

    const inA = placeholders(valueA);
    const inB = placeholders(valueB);

    const onlyInA = [...inA].filter((name) => !inB.has(name)).sort();
    const onlyInB = [...inB].filter((name) => !inA.has(name)).sort();

    if (onlyInA.length || onlyInB.length) {
      mismatches.push({ key, onlyInA, onlyInB });
    }
  }

  return mismatches;
}
