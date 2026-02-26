export const colors = {
  primary: '#1D4ED8',
  primaryDark: '#1E40AF',
  secondary: '#0F172A',
  accent: '#F59E0B',
  success: '#16A34A',
  warning: '#F97316',
  error: '#DC2626',
  background: '#F7F8FC',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2FF',
  panel: '#111827',
  text: {
    primary: '#0F172A',
    secondary: '#334155',
    tertiary: '#64748B',
    inverse: '#FFFFFF',
  },
  border: '#DDE3F0',
  map: {
    route: '#2563EB',
    roadblockClosed: '#EF4444',
    roadblockCongested: '#F59E0B',
    roadblockOpen: '#22C55E',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const typography = {
  h1: {
    fontSize: 34,
    fontWeight: 'bold' as const,
  },
  h2: {
    fontSize: 26,
    fontWeight: 'bold' as const,
  },
  h3: {
    fontSize: 21,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 16,
    fontWeight: 'normal' as const,
  },
  caption: {
    fontSize: 14,
    fontWeight: 'normal' as const,
  },
};
