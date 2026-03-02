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
    title: 'Home',
    subtitle: 'Saved address',
    lat: 31.967,
    lng: 35.206,
  },
  {
    id: 'work',
    title: 'Work',
    subtitle: 'Saved address',
    lat: 32.2211,
    lng: 35.2544,
  },
  {
    id: 'favorite',
    title: 'Favorite',
    subtitle: 'Quick destination',
    lat: 31.9038,
    lng: 35.2034,
  },
];

export async function loadSavedPlaces(): Promise<SavedPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultPlaces;
    }
    const parsed = JSON.parse(raw) as SavedPlace[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return defaultPlaces;
    }
    return parsed;
  } catch {
    return defaultPlaces;
  }
}

export async function saveSavedPlaces(places: SavedPlace[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(places));
}
