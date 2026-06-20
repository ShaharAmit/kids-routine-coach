import { useMemo } from 'react';
import { Dimensions, PixelRatio, useWindowDimensions } from 'react-native';

/**
 * Centralized responsive scaling helpers.
 *
 * All sizing across the app should flow through these helpers so that text,
 * icons, images and containers scale proportionally between phones and tablets
 * (the app ships on iPads with intermittent Wi-Fi). Guideline base dimensions
 * are an iPhone-class portrait screen; everything is scaled relative to that
 * and clamped so layouts never collapse on small phones or explode on tablets.
 */

// Guideline sizes are based on a standard ~iPhone 11/12 portrait viewport.
export const GUIDELINE_BASE_WIDTH = 390;
export const GUIDELINE_BASE_HEIGHT = 844;

// Clamp the scale factor so tablets stay tasteful and tiny phones stay legible.
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function widthScaleFactor(width: number): number {
  return clamp(width / GUIDELINE_BASE_WIDTH, MIN_SCALE, MAX_SCALE);
}

function heightScaleFactor(height: number): number {
  return clamp(height / GUIDELINE_BASE_HEIGHT, MIN_SCALE, MAX_SCALE);
}

/** Round to the nearest device pixel for crisp rendering. */
function round(value: number): number {
  return Math.round(PixelRatio.roundToNearestPixel(value));
}

/**
 * Build a set of scaling helpers bound to a specific viewport. Used internally
 * by the module-level helpers (live window) and by `useResponsive` (reactive).
 */
function createScalers(width: number, height: number) {
  const wFactor = widthScaleFactor(width);
  const hFactor = heightScaleFactor(height);

  /** Scale a horizontal/size value proportionally to screen width. */
  const scaleFn = (size: number): number => round(size * wFactor);

  /** Scale a vertical value proportionally to screen height. */
  const verticalScaleFn = (size: number): number => round(size * hFactor);

  /**
   * Dampened scale — moves a value toward its scaled target by `factor`.
   * Ideal for paddings/margins/radii that shouldn't grow as aggressively.
   */
  const moderateScaleFn = (size: number, factor = 0.5): number =>
    round(size + (size * wFactor - size) * factor);

  /** Font scaling: dampened width scale, ignores OS fontScale to keep layout stable. */
  const scaleFontFn = (size: number): number => round(size + (size * wFactor - size) * 0.5);

  return {
    scale: scaleFn,
    verticalScale: verticalScaleFn,
    moderateScale: moderateScaleFn,
    scaleFont: scaleFontFn,
    widthFactor: wFactor,
    heightFactor: hFactor,
  };
}

// Module-level helpers bound to the window at startup. Suitable for the static
// `StyleSheet.create` blocks that make up the bulk of the app's styling.
const initial = Dimensions.get('window');
const moduleScalers = createScalers(initial.width, initial.height);

export const scale = moduleScalers.scale;
export const verticalScale = moduleScalers.verticalScale;
export const moderateScale = moduleScalers.moderateScale;
export const scaleFont = moduleScalers.scaleFont;

// Short aliases for terse use inside stylesheets.
export const s = scale;
export const vs = verticalScale;
export const ms = moderateScale;
export const fs = scaleFont;

/**
 * Reactive variant of the scaling helpers. Use in components that must respond
 * to orientation changes or split-view resizing on tablets. Returns the live
 * window dimensions alongside the bound scaling functions.
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();
  return useMemo(() => ({ width, height, ...createScalers(width, height) }), [width, height]);
}
