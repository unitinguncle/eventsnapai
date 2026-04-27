// Typography scale — uses Inter font family (loaded via expo-google-fonts)
// Mirrors the Inter usage on the RaidCloud web portal

import { Platform } from 'react-native';

// Font family names (registered via useFonts in _layout.tsx)
export const Fonts = {
  regular:     'Inter_400Regular',
  medium:      'Inter_500Medium',
  semiBold:    'Inter_600SemiBold',
  bold:        'Inter_700Bold',
  extraBold:   'Inter_800ExtraBold',
} as const;

// Type scale
export const Typography = {
  // Display — large hero text
  display: {
    fontFamily: Fonts.bold,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  // Heading levels
  h1: {
    fontFamily: Fonts.bold,
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  h2: {
    fontFamily: Fonts.semiBold,
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  h3: {
    fontFamily: Fonts.semiBold,
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.1,
  },
  // Body
  bodyLarge: {
    fontFamily: Fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  body: {
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyMedium: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  // Labels & captions
  label: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
  },
  caption: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  // Buttons
  button: {
    fontFamily: Fonts.semiBold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  buttonSmall: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  // Monospace (event IDs, etc.)
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
} as const;

// Spacing scale (multiples of 4)
export const Spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  24,
  xxxl: 32,
  huge: 48,
} as const;

// Border radius scale
export const Radius = {
  sm:   6,
  md:   10,
  lg:   14,
  xl:   18,
  xxl:  24,
  full: 9999,
} as const;

// Shadow presets (Android uses elevation)
export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;
