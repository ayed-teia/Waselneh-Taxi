export const colors = {
  primary: '#0F172A',
  primaryDark: '#020617',
  secondary: '#1E293B',
  accent: '#FACC15',
  success: '#16A34A',
  warning: '#F59E0B',
  error: '#DC2626',
  background: '#F6F7FB',
  surface: '#FFFFFF',
  surfaceAlt: '#E2E8F0',
  text: {
    primary: '#0F172A',
    secondary: '#334155',
    tertiary: '#64748B',
    inverse: '#FFFFFF',
  },
  border: '#DDE3F0',
  online: '#22C55E',
  offline: '#94A3B8',
  busy: '#F59E0B',
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
