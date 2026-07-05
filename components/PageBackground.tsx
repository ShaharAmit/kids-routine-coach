import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import CloudsBackground from './CloudsBackground';

/**
 * Shared full-screen background used across every screen. Change the app's
 * background look (color, clouds, future imagery) here once instead of
 * re-implementing the root View / background / SafeAreaView stack per screen.
 *
 * - `clouds`: light morning color + drifting clouds (settings, onboarding).
 * - `morning` / `evening`: solid segment color, no clouds (routine editor,
 *   where cards already carry the visual weight and clouds would clutter).
 */
export type PageBackgroundVariant = 'clouds' | 'morning' | 'evening';

const VARIANT_BG: Record<PageBackgroundVariant, string> = {
  clouds: colors.morningBg,
  morning: colors.morningBg,
  evening: colors.eveningBg,
};

interface PageBackgroundProps {
  variant?: PageBackgroundVariant;
  /** Wrap children in a SafeAreaView. Disable for screens that manage insets manually. */
  safeArea?: boolean;
  edges?: Edge[];
  style?: ViewStyle;
  children: React.ReactNode;
}

export default function PageBackground({
  variant = 'clouds',
  safeArea = true,
  edges = ['top', 'bottom'],
  style,
  children,
}: PageBackgroundProps) {
  return (
    <View style={[styles.root, { backgroundColor: VARIANT_BG[variant] }, style]}>
      {variant === 'clouds' && <CloudsBackground />}
      {safeArea ? (
        <SafeAreaView style={styles.flex} edges={edges}>
          {children}
        </SafeAreaView>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
});
