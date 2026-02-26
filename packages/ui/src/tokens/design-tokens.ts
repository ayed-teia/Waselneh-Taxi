export type ColorMode = 'light' | 'dark';

export const waselnehColors = {
  brand: {
    taxiYellow: '#F5C518',
    darkSlate: '#1F2937',
  },
  status: {
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
  },
  light: {
    background: '#FFFDF7',
    surface: '#FFFFFF',
    textPrimary: '#1F2937',
    textSecondary: '#475569',
    border: '#E5E7EB',
    primary: '#F5C518',
    primaryText: '#111827',
    secondary: '#1F2937',
    secondaryText: '#F9FAFB',
  },
  dark: {
    background: '#0B1220',
    surface: '#111827',
    textPrimary: '#F9FAFB',
    textSecondary: '#CBD5E1',
    border: '#334155',
    primary: '#F5C518',
    primaryText: '#111827',
    secondary: '#334155',
    secondaryText: '#F9FAFB',
  },
} as const;

export const waselnehSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const waselnehRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const waselnehTypography = {
  h1: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700' as const,
  },
  h2: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700' as const,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400' as const,
  },
} as const;

export function getModeColors(mode: ColorMode = 'light') {
  return mode === 'dark' ? waselnehColors.dark : waselnehColors.light;
}
