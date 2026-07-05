import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fs, s, vs } from '../theme';

/**
 * Shared header building blocks so every screen speaks the same visual
 * language (same title weight/size, same back button, same segment theming)
 * without re-declaring the JSX/styles per screen. Update the look here once.
 */

/** Title block used as a native `Stack.Screen` `headerTitle`. */
export function NativeHeaderTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.nativeWrap}>
      <Text style={styles.nativeTitle}>{title}</Text>
      {subtitle ? <Text style={styles.nativeSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/**
 * Full `Stack.Screen` `options` object for screens that use the native header
 * (e.g. `<Stack.Screen options={getNativeHeaderOptions('Settings', 'Parent controls')} />`).
 * Keeps header background/shadow/title styling centralized in one place.
 */
export function getNativeHeaderOptions(title: string, subtitle?: string) {
  return {
    headerTitle: () => <NativeHeaderTitle title={title} subtitle={subtitle} />,
    headerStyle: { backgroundColor: colors.morningBg },
    headerShadowVisible: false,
  } as const;
}

interface InPageHeaderProps {
  title: string;
  onBack?: () => void;
  /** Themes the back chevron + title for a dark (evening) background. */
  evening?: boolean;
  /** Optional leading element rendered between the back button and the title (e.g. a segment icon). */
  icon?: React.ReactNode;
  /** Optional trailing element (e.g. a save button). Defaults to a spacer to keep the title centered. */
  right?: React.ReactNode;
}

/**
 * Custom in-page header row (back chevron + optional icon + title + optional
 * right slot) for screens that render their own header inside a scroll view
 * instead of relying on the native stack header (e.g. the routine editor).
 */
export function InPageHeader({ title, onBack, evening, icon, right }: InPageHeaderProps) {
  return (
    <View style={styles.rowWrap}>
      {onBack ? (
        <TouchableOpacity style={styles.backButton} onPress={onBack} hitSlop={10} activeOpacity={0.85}>
          <Text style={[styles.backChevron, evening && styles.backChevronEvening]}>‹</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.backButtonSpacer} />
      )}
      {icon}
      <Text style={[styles.rowTitle, evening && styles.rowTitleEvening]} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <View style={styles.backButtonSpacer} />}
    </View>
  );
}

const styles = StyleSheet.create({
  nativeWrap: {
    alignItems: 'center',
  },
  nativeTitle: {
    fontSize: fs(18),
    fontWeight: '800',
    color: colors.textInk,
  },
  nativeSubtitle: {
    marginTop: vs(1),
    fontSize: fs(12),
    color: colors.textMuted,
    fontWeight: '700',
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: vs(10),
    gap: s(8),
  },
  backButton: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
  backButtonSpacer: {
    width: s(36),
    height: s(36),
  },
  backChevron: {
    fontSize: fs(26),
    lineHeight: fs(30),
    color: colors.morningTitle,
    fontWeight: '600',
  },
  backChevronEvening: {
    color: colors.eveningTitle,
  },
  rowTitle: {
    flex: 1,
    fontSize: fs(18),
    fontWeight: '800',
    color: colors.morningTitle,
  },
  rowTitleEvening: {
    color: colors.eveningTitle,
  },
});
