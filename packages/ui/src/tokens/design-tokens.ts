import { StyleSheet } from 'react-native';

export type ColorMode = 'light' | 'dark';

export const waselnehColors = {
  brand: {
    taxiYellow: '#F5C518',
    taxiYellowDeep: '#D89C05',
    darkSlate: '#0F172A',
    cobalt: '#1D4ED8',
  },
  status: {
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
    info: '#2563EB',
  },
  light: {
    background: '#F2F5FB',
    surface: '#FFFFFF',
    surfaceMuted: '#F8FAFF',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#64748B',
    border: '#D8E1EE',
    borderStrong: '#BCCBDE',
    primary: '#F5C518',
    primaryText: '#111827',
    secondary: '#1E293B',
    secondaryText: '#F9FAFB',
    focusRing: '#93C5FD',
    mapOverlay: 'rgba(248, 250, 252, 0.95)',
  },
  dark: {
    background: '#0B1220',
    surface: '#111827',
    surfaceMuted: '#1E293B',
    textPrimary: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textMuted: '#94A3B8',
    border: '#334155',
    borderStrong: '#475569',
    primary: '#F5C518',
    primaryText: '#111827',
    secondary: '#334155',
    secondaryText: '#F9FAFB',
    focusRing: '#1D4ED8',
    mapOverlay: 'rgba(15, 23, 42, 0.82)',
  },
} as const;

export const waselnehSpacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  jumbo: 40,
} as const;

export const waselnehRadius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 16,
  xl: 22,
  xxl: 30,
  sheet: 28,
  pill: 999,
} as const;

export const waselnehShadows = {
  xs: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sm: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.13,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const;

export const waselnehTypography = {
  h1: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800' as const,
  },
  h2: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800' as const,
  },
  h3: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700' as const,
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  bodyStrong: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500' as const,
  },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
  },
} as const;

export const waselnehMotion = {
  fast: 120,
  normal: 180,
  slow: 260,
} as const;

export function getModeColors(mode: ColorMode = 'light') {
  return mode === 'dark' ? waselnehColors.dark : waselnehColors.light;
}

export function getThemeTokens(mode: ColorMode = 'light') {
  return {
    colors: getModeColors(mode),
    spacing: waselnehSpacing,
    radius: waselnehRadius,
    typography: waselnehTypography,
    shadows: waselnehShadows,
    motion: waselnehMotion,
  };
}

export type WaselnehThemeTokens = ReturnType<typeof getThemeTokens>;

export function createStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: WaselnehThemeTokens) => T,
  mode: ColorMode = 'light'
): T {
  return StyleSheet.create(factory(getThemeTokens(mode)));
}
