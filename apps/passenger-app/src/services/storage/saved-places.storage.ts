import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedPlace {
  id: 'home' | 'work' | 'favorite';
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
}

const STORAGE_KEY = 'waselneh_saved_places_v1';

const defaultPlaces: SavedPlace[] = [
  {
    id: 'home',
    title: 'Nablus Center',
    subtitle: 'Nablus',
    lat: 32.2211,
    lng: 35.2544,
  },
  {
    id: 'work',
    title: 'Ramallah Center',
    subtitle: 'Ramallah',
    lat: 31.9038,
    lng: 35.2034,
  },
  {
    id: 'favorite',
    title: 'Jenin Center',
    subtitle: 'Jenin',
    lat: 32.4637,
    lng: 35.3042,
  },
];

const defaultById: Record<SavedPlace['id'], SavedPlace> = {
  home: defaultPlaces[0]!,
  work: defaultPlaces[1]!,
  favorite: defaultPlaces[2]!,
};

const genericSubtitles = new Set([
  'saved address',
  'quick destination',
  'selected destination',
  'saved destination',
  'عنوان محفوظ',
  'وجهة سريعة',
  'الوجهة المختارة',
]);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSavedPlace(raw: unknown): SavedPlace | null {
  if (!raw || typeof raw !== 'object') return null;

  const data = raw as Partial<SavedPlace>;
  if (data.id !== 'home' && data.id !== 'work' && data.id !== 'favorite') {
    return null;
  }

  const fallback = defaultById[data.id];
  const normalizedTitleRaw = normalizeText(data.title);
  const normalizedSubtitleRaw = normalizeText(data.subtitle);
  const normalizedTitleLower = normalizedTitleRaw.toLowerCase();
  const normalizedSubtitleLower = normalizedSubtitleRaw.toLowerCase();

  const isGenericTitle =
    normalizedTitleLower.length === 0 ||
    normalizedTitleLower === data.id ||
    (data.id === 'home' && normalizedTitleLower === 'home') ||
    (data.id === 'work' && normalizedTitleLower === 'work') ||
    (data.id === 'favorite' && normalizedTitleLower === 'favorite');

  const isGenericSubtitle =
    normalizedSubtitleLower.length === 0 || genericSubtitles.has(normalizedSubtitleLower);

  return {
    id: data.id,
    title: isGenericTitle ? fallback.title : normalizedTitleRaw,
    subtitle: isGenericSubtitle ? fallback.subtitle : normalizedSubtitleRaw,
    lat:
      typeof data.lat === 'number' && Number.isFinite(data.lat)
        ? data.lat
        : fallback.lat,
    lng:
      typeof data.lng === 'number' && Number.isFinite(data.lng)
        ? data.lng
        : fallback.lng,
  };
}

function normalizeSavedPlaces(raw: unknown): SavedPlace[] {
  const parsed = Array.isArray(raw) ? raw : [];
  const normalized = parsed
    .map((item) => normalizeSavedPlace(item))
    .filter((item): item is SavedPlace => Boolean(item));

  return (['home', 'work', 'favorite'] as const).map(
    (id) => normalized.find((item) => item.id === id) ?? defaultById[id]
  );
}

export async function loadSavedPlaces(): Promise<SavedPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultPlaces;
    }

    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeSavedPlaces(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }

    return normalized;
  } catch {
    return defaultPlaces;
  }
}

export async function saveSavedPlaces(places: SavedPlace[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(places));
}
