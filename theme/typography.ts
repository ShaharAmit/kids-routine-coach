import { Platform } from 'react-native';

/**
 * Centralized typography helpers.
 *
 * `roundedFontBold` was previously redefined inside individual screens — keep a
 * single source of truth here so the playful rounded look stays consistent.
 */
export const roundedFontBold: string = Platform.select({
  ios: 'Avenir Next Rounded',
  android: 'sans-serif',
  default: 'System',
}) as string;

/** Convenience: always returns a usable family even if the platform select is undefined. */
export const ROUNDED_FONT = roundedFontBold ?? 'System';
