import { useColorScheme } from 'react-native';

/** Brand palette shared with the web app (indigo accents). */
export const brand = {
  indigo50: '#eef2ff',
  indigo100: '#e0e7ff',
  indigo300: '#a5b4fc',
  indigo500: '#6366f1',
  indigo600: '#4f46e5',
  indigo700: '#4338ca',
  indigo900: '#312e81',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  textInverse: string;
  brand: string;
  brandSoft: string;
  brandOnSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  neutralSoft: string;
}

export interface Theme {
  dark: boolean;
  statusBar: 'light' | 'dark';
  colors: ThemeColors;
  radius: { sm: number; md: number; lg: number; pill: number };
  spacing: (units: number) => number;
}

const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
const spacing = (units: number) => units * 4;

const lightColors: ThemeColors = {
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  textInverse: '#ffffff',
  brand: brand.indigo600,
  brandSoft: brand.indigo50,
  brandOnSoft: brand.indigo700,
  success: '#15803d',
  successSoft: '#dcfce7',
  warning: '#b45309',
  warningSoft: '#fef3c7',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
  info: '#0369a1',
  infoSoft: '#e0f2fe',
  neutralSoft: '#f1f5f9',
};

const darkColors: ThemeColors = {
  background: '#0b1120',
  surface: '#111827',
  surfaceMuted: '#1f2937',
  border: '#27324a',
  text: '#e5e7eb',
  textMuted: '#94a3b8',
  textInverse: '#0b1120',
  brand: brand.indigo500,
  brandSoft: '#1e1b4b',
  brandOnSoft: brand.indigo300,
  success: '#4ade80',
  successSoft: '#052e16',
  warning: '#fbbf24',
  warningSoft: '#451a03',
  danger: '#f87171',
  dangerSoft: '#450a0a',
  info: '#38bdf8',
  infoSoft: '#082f49',
  neutralSoft: '#1f2937',
};

export const lightTheme: Theme = {
  dark: false,
  statusBar: 'dark',
  colors: lightColors,
  radius,
  spacing,
};

export const darkTheme: Theme = {
  dark: true,
  statusBar: 'light',
  colors: darkColors,
  radius,
  spacing,
};

/** Resolves the active theme from the OS appearance (light/dark aware). */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}

/** Semantic tone used by pills, badges and state banners. */
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export function toneColors(theme: Theme, tone: Tone): { fg: string; bg: string } {
  const { colors } = theme;
  switch (tone) {
    case 'brand':
      return { fg: colors.brandOnSoft, bg: colors.brandSoft };
    case 'success':
      return { fg: colors.success, bg: colors.successSoft };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningSoft };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerSoft };
    case 'info':
      return { fg: colors.info, bg: colors.infoSoft };
    default:
      return { fg: colors.textMuted, bg: colors.neutralSoft };
  }
}
