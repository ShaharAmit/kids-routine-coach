import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Alert,
  Modal,
  Pressable,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUserRoutines } from '../hooks/useRoutine';
import { ensureAuth } from '../services/firebase';
import { getChildProfile } from '../services/profile';
import { subscribeAssetCacheStatus } from '../services/assetCacheService';

function timeToMinutes(value: string): number {
  const [hourStr, minuteStr] = value.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 8 * 60;
  return hour * 60 + minute;
}

function isMorningTime(value: string): boolean {
  const minutes = timeToMinutes(value);
  return minutes >= 4 * 60 && minutes < 15 * 60;
}

const roundedFont = Platform.select({
  ios: 'Avenir Next Rounded',
  android: 'sans-serif-medium',
  default: 'System',
});

const roundedFontBold = Platform.select({
  ios: 'Avenir Next Rounded',
  android: 'sans-serif',
  default: 'System',
});

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const topInset = insets.top + (Platform.OS === 'android' ? 8 : 0);
  const [userId, setUserId] = useState('');
  const [cacheStage, setCacheStage] = useState('idle');
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [routinePickerSegment, setRoutinePickerSegment] = useState<'morning' | 'evening' | null>(null);
  const headerMenuButtonRef = useRef<any>(null);
  const menuAnim = useRef(new Animated.Value(0)).current;
  const { routines, loading, error } = useUserRoutines(userId);

  const primaryRoutine = routines[0] ?? null;

  const segmentCounts = useMemo(() => {
    if (!primaryRoutine) return { morning: 0, evening: 0 };

    const stepTimes = Array.from({ length: primaryRoutine.activityStack.length }, (_, index) =>
      primaryRoutine.stepTimes?.[index] ?? primaryRoutine.scheduledTime
    );

    let morning = 0;
    let evening = 0;

    stepTimes.forEach((time) => {
      if (isMorningTime(time)) {
        morning += 1;
      } else {
        evening += 1;
      }
    });

    return { morning, evening };
  }, [primaryRoutine]);

  const routinesForSegment = useMemo(() => {
    if (!routinePickerSegment) return [];

    return routines.filter((routine) => {
      const stepTimes = Array.from({ length: routine.activityStack.length }, (_, index) =>
        routine.stepTimes?.[index] ?? routine.scheduledTime
      );
      return stepTimes.some((time) =>
        routinePickerSegment === 'morning' ? isMorningTime(time) : !isMorningTime(time)
      );
    });
  }, [routinePickerSegment, routines]);

  useEffect(() => {
    const unsubscribe = subscribeAssetCacheStatus((next) => {
      setCacheStage(next.stage);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      const user = await ensureAuth();
      const profile = await getChildProfile();
      if (!mounted) return;

      setUserId(user.uid);
      if (profile?.childName) {
        // kept for future personalization
      }
    }

    initialize().catch((err) => {
      console.warn('[Home] init failed:', err);
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#5F8F86" />
        <Text style={styles.loadingText}>Loading routines...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load routines.</Text>
        <Text style={styles.errorSub}>{error.message}</Text>
      </View>
    );
  }

  const handleStart = (segment: 'morning' | 'evening') => {
    if (routines.length === 0) {
      Alert.alert('Create routine', 'Please create a routine first.');
      router.push('/parent/create');
      return;
    }

    setRoutinePickerSegment(segment);
  };

  const measureMenuAnchor = () => {
    headerMenuButtonRef.current?.measureInWindow((x: number, y: number, width: number, height: number) => {
      setMenuAnchor({ x, y, width, height });
    });
  };

  const openMenu = () => {
    measureMenuAnchor();
    setMenuVisible(true);
    menuAnim.setValue(0);
    Animated.timing(menuAnim, {
      toValue: 1,
      duration: 170,
      useNativeDriver: true,
    }).start();
  };

  const closeMenu = () => {
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 130,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMenuVisible(false);
        setMenuAnchor(null);
      }
    });
  };

  const menuAnimatedStyle = {
    opacity: menuAnim,
    transform: [
      {
        translateY: menuAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [-8, 0],
        }),
      },
      {
        scale: menuAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.98, 1],
        }),
      },
    ],
  };

  const menuHorizontalMargin = 12;
  const menuVerticalGap = 6;
  const menuWidth = Math.max(176, Math.min(224, windowWidth * 0.48));
  const estimatedMenuHeight = 248;
  const fallbackTop = topInset + 50;
  const fallbackLeft = Math.max(windowWidth - menuWidth - menuHorizontalMargin, menuHorizontalMargin);

  const menuPosition = menuAnchor
    ? {
        top: Math.min(
          menuAnchor.y + menuAnchor.height + menuVerticalGap,
          windowHeight - insets.bottom - estimatedMenuHeight - 12
        ),
        left: Math.min(
          Math.max(menuAnchor.x + menuAnchor.width - menuWidth, menuHorizontalMargin),
          windowWidth - menuWidth - menuHorizontalMargin
        ),
      }
    : {
        top: fallbackTop,
        left: fallbackLeft,
      };

  const widthScale = Math.min(Math.max(windowWidth / 390, 0.86), 1.18);
  const heightScale = Math.min(Math.max(windowHeight / 844, 0.85), 1.12);
  const uiScale = Math.min(widthScale, heightScale);

  const panelHorizontalPadding = Math.round(22 * widthScale);
  const panelCurve = Math.round(28 * widthScale);
  const panelTopPadding = Math.round(16 * heightScale);

  const sectionTitleSize = Math.round(38 * uiScale);
  const sectionTitleLineHeight = Math.round(42 * uiScale);
  const sectionSubtitleSize = Math.round(16 * uiScale);
  const starSize = Math.round(46 * uiScale);

  const ctaWidth = Math.max(188, Math.min(windowWidth - panelHorizontalPadding * 2 - 8, 360));
  const ctaVerticalPadding = Math.round(Math.max(9, Math.min(12, 10 * uiScale)));
  const ctaHorizontalPadding = Math.round(22 * widthScale);
  const ctaFontSize = Math.round(18 * uiScale);

  const sunSize = Math.round(Math.max(132, Math.min(176, windowWidth * 0.42)));
  const sunFaceSize = Math.round(sunSize * 0.67);
  const sunRayTranslate = -Math.round(sunSize * 0.44);
  const sunRayWide = Math.max(7, Math.round(8 * uiScale));
  const sunRayNarrow = Math.max(6, Math.round(7 * uiScale));
  const sunRayLong = Math.max(28, Math.round(34 * uiScale));
  const sunRayShort = Math.max(24, Math.round(28 * uiScale));

  const moonSize = Math.round(Math.max(132, Math.min(176, windowWidth * 0.41)));
  const moonFontSize = Math.round(moonSize * 0.59);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: '#4A90D9' },
          headerTintColor: '#FFF',
          headerTitleStyle: { fontFamily: roundedFontBold, fontSize: 17 },
          headerRight: () => (
            <TouchableOpacity
              ref={headerMenuButtonRef}
              style={styles.headerMenuButton}
              onPress={() => (menuVisible ? closeMenu() : openMenu())}
              activeOpacity={0.85}
            >
              <Text style={styles.headerMenuIcon}>≡</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <StatusBar barStyle="light-content" />

      <View
        style={[
          styles.morningPanel,
          {
            paddingTop: topInset + panelTopPadding,
            paddingHorizontal: panelHorizontalPadding,
            borderBottomLeftRadius: panelCurve,
            borderBottomRightRadius: panelCurve,
          },
        ]}
      >
        <View style={styles.starLayer} pointerEvents="none">
          <Text style={[styles.morningStar, { top: 10, left: 24, fontSize: starSize }]}>★</Text>
          <Text style={[styles.morningStar, { top: 30, right: 28, fontSize: starSize }]}>★</Text>
          <Text style={[styles.morningStar, { top: 94, left: 70, fontSize: starSize }]}>★</Text>
          <Text style={[styles.morningStar, { top: 130, right: 74, fontSize: starSize }]}>★</Text>
        </View>

        <Text style={[styles.morningTitle, { fontSize: sectionTitleSize, lineHeight: sectionTitleLineHeight }]}>MORNING</Text>
        <Text style={[styles.morningSubtitle, { fontSize: sectionSubtitleSize }]}>Let's start the day!</Text>

        <View style={[styles.sunGraphic, { width: sunSize, height: sunSize }]}> 
          {Array.from({ length: 14 }).map((_, index) => (
            <View
              key={`ray-${index}`}
              style={[
                styles.sunRay,
                {
                  transform: [
                    { rotate: `${index * 25.7 + (index % 2 === 0 ? -3 : 3)}deg` },
                    { translateY: sunRayTranslate },
                  ],
                  borderLeftWidth: index % 2 === 0 ? sunRayWide : sunRayNarrow,
                  borderRightWidth: index % 2 === 0 ? sunRayWide : sunRayNarrow,
                  borderBottomWidth: index % 3 === 0 ? sunRayLong : sunRayShort,
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  borderTopColor: 'transparent',
                  borderBottomColor: index % 2 === 0 ? '#F9C45D' : '#F6B94A',
                  opacity: index % 5 === 0 ? 0.98 : 0.9,
                },
              ]}
            />
          ))}
          <View
            style={[
              styles.sunFaceCircle,
              {
                width: sunFaceSize,
                height: sunFaceSize,
                borderRadius: sunFaceSize / 2,
              },
            ]}
          >
            <View style={[styles.sunFaceEyesRow, { width: Math.round(sunFaceSize * 0.46) }]}>
              <View
                style={[
                  styles.sunEye,
                  styles.sunEyeSoft,
                  {
                    width: Math.max(7, Math.round(sunFaceSize * 0.085)),
                    height: Math.max(7, Math.round(sunFaceSize * 0.085)),
                    borderRadius: Math.max(4, Math.round(sunFaceSize * 0.05)),
                  },
                ]}
              />
              <View
                style={[
                  styles.sunEye,
                  styles.sunEyeSoft,
                  {
                    width: Math.max(7, Math.round(sunFaceSize * 0.085)),
                    height: Math.max(7, Math.round(sunFaceSize * 0.085)),
                    borderRadius: Math.max(4, Math.round(sunFaceSize * 0.05)),
                  },
                ]}
              />
            </View>
            <View
              style={[
                styles.sunSmile,
                {
                  width: Math.round(sunFaceSize * 0.37),
                  height: Math.round(sunFaceSize * 0.17),
                  borderBottomLeftRadius: Math.round(sunFaceSize * 0.22),
                  borderBottomRightRadius: Math.round(sunFaceSize * 0.22),
                },
              ]}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.morningCta,
            {
              width: ctaWidth,
              paddingVertical: ctaVerticalPadding,
              paddingHorizontal: ctaHorizontalPadding,
            },
          ]}
          onPress={() => handleStart('morning')}
          activeOpacity={0.88}
        >
          <Text style={[styles.morningCtaText, { fontSize: ctaFontSize }]}>SHOW MORNING ROUTINES  →</Text>
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.eveningPanel,
          {
            paddingHorizontal: panelHorizontalPadding,
            paddingTop: panelTopPadding,
            borderTopLeftRadius: panelCurve,
            borderTopRightRadius: panelCurve,
          },
        ]}
      >
        <View style={styles.starLayer} pointerEvents="none">
          <Text style={[styles.eveningStar, { top: 16, left: 26, fontSize: starSize }]}>★</Text>
          <Text style={[styles.eveningStar, { top: 48, right: 30, fontSize: starSize }]}>★</Text>
          <Text style={[styles.eveningStar, { top: 112, left: 74, fontSize: starSize }]}>★</Text>
          <Text style={[styles.eveningStar, { top: 138, right: 92, fontSize: starSize }]}>★</Text>
        </View>

        <Text style={[styles.eveningTitle, { fontSize: sectionTitleSize, lineHeight: sectionTitleLineHeight }]}>EVENING</Text>
        <Text style={[styles.eveningSubtitle, { fontSize: sectionSubtitleSize }]}>Time to wind down</Text>

        <View style={[styles.moonHalo, { width: moonSize, height: moonSize, borderRadius: moonSize / 2 }]}> 
          <Text style={[styles.moonEmoji, { fontSize: moonFontSize }]}>🌙</Text>
        </View>

        <TouchableOpacity
          style={[
            styles.eveningCta,
            {
              width: ctaWidth,
              paddingVertical: ctaVerticalPadding,
              paddingHorizontal: ctaHorizontalPadding,
            },
          ]}
          onPress={() => handleStart('evening')}
          activeOpacity={0.88}
        >
          <Text style={[styles.eveningCtaText, { fontSize: ctaFontSize }]}>SHOW EVENING ROUTINES  →</Text>
        </TouchableOpacity>
      </View>

      {cacheStage === 'warming-assets' ? (
        <View style={[styles.prepBadge, { bottom: 20 + Math.max(insets.bottom, 8) }]}> 
          <Text style={styles.prepBadgeText}>Preparing media...</Text>
        </View>
      ) : null}

      <Modal visible={menuVisible} transparent animationType="none" onRequestClose={closeMenu}>
        <Pressable style={styles.menuOverlayFull} onPress={closeMenu}>
          <Animated.View
            style={[
              styles.menuPopover,
              menuPosition,
              { width: menuWidth },
              menuAnimatedStyle,
            ]}
          >
            <Text style={styles.menuTitle}>Menu</Text>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                router.push('/settings' as never);
              }}
            >
              <Text style={styles.menuItemText}>Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                router.push('/onboarding/questionnaire' as never);
              }}
            >
              <Text style={styles.menuItemText}>Questionnaire</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                router.push('/parent/create');
              }}
            >
              <Text style={styles.menuItemText}>Add Routine</Text>
            </TouchableOpacity>
          </Animated.View>
        </Pressable>
      </Modal>

      <Modal
        visible={routinePickerSegment !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRoutinePickerSegment(null)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setRoutinePickerSegment(null)}>
          <Pressable style={styles.menuSheet} onPress={() => {}}>
            <Text style={styles.menuTitle}>
              {routinePickerSegment === 'evening' ? 'Evening Routines' : 'Morning Routines'}
            </Text>

            {routinesForSegment.length === 0 ? (
              <Text style={styles.emptyRoutinesText}>No routines in this time range yet.</Text>
            ) : (
              routinesForSegment.map((routine) => (
                <TouchableOpacity
                  key={routine.id}
                  style={styles.menuItem}
                  onPress={() => {
                    const segment = routinePickerSegment;
                    setRoutinePickerSegment(null);
                    if (!segment) return;
                    router.push(`/routine/${routine.id}?segment=${segment}` as never);
                  }}
                >
                  <Text style={styles.menuItemText}>{routine.childName}</Text>
                </TouchableOpacity>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2D3C6A',
  },
  headerMenuButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFFCC',
    borderWidth: 1,
    borderColor: '#D8DCCF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMenuIcon: {
    fontSize: 21,
    color: '#4C5D57',
    lineHeight: 22,
    fontFamily: roundedFontBold ?? 'System',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2E5',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#466761',
    fontSize: 15,
    fontFamily: roundedFont,
  },
  errorText: {
    fontSize: 18,
    color: '#8B2F2F',
    fontFamily: roundedFontBold ?? 'System',
    marginBottom: 8,
  },
  errorSub: {
    fontSize: 14,
    color: '#6C6C6C',
    textAlign: 'center',
    fontFamily: roundedFont,
  },
  morningPanel: {
    flex: 1,
    backgroundColor: '#EAF0E3',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  eveningPanel: {
    flex: 1,
    backgroundColor: '#46519C',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 22,
    paddingTop: 16,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  starLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  morningStar: {
    position: 'absolute',
    color: '#FFFFFF',
    fontSize: 46,
    opacity: 0.2,
  },
  eveningStar: {
    position: 'absolute',
    color: '#E8EAFF',
    fontSize: 46,
    opacity: 0.16,
  },
  morningTitle: {
    marginTop: 6,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: 1,
    color: '#6F8E87',
    fontFamily: roundedFontBold ?? 'System',
  },
  morningSubtitle: {
    marginTop: 2,
    fontSize: 16,
    color: '#507068',
    fontFamily: roundedFont,
  },
  sunGraphic: {
    width: 162,
    height: 162,
    marginTop: 12,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunRay: {
    position: 'absolute',
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
  },
  sunFaceCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: '#FFE07D',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#EAB74B',
  },
  sunFaceEyesRow: {
    width: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sunEye: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#7A5B2D',
  },
  sunEyeSoft: {
    opacity: 0.95,
  },
  sunSmile: {
    width: 40,
    height: 18,
    borderBottomWidth: 4,
    borderColor: '#7A5B2D',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    marginTop: 10,
  },
  morningCta: {
    borderRadius: 999,
    backgroundColor: '#6A9D93',
    minWidth: 208,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 22,
    shadowColor: '#3E7169',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  morningCtaText: {
    color: '#F4FBF7',
    fontSize: 18,
    letterSpacing: 0.5,
    fontFamily: roundedFontBold ?? 'System',
  },
  eveningTitle: {
    marginTop: 4,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: 1,
    color: '#F7F8FF',
    fontFamily: roundedFontBold ?? 'System',
  },
  eveningSubtitle: {
    marginTop: 2,
    fontSize: 16,
    color: '#B5BDF6',
    fontFamily: roundedFont,
  },
  moonHalo: {
    marginTop: 16,
    marginBottom: 16,
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: '#3B458B',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D9DCFF',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  moonEmoji: {
    fontSize: 92,
  },
  eveningCta: {
    borderRadius: 999,
    backgroundColor: '#8F84D5',
    minWidth: 208,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 22,
    shadowColor: '#5A53A4',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  eveningCtaText: {
    color: '#F8F5FF',
    fontSize: 18,
    letterSpacing: 0.5,
    fontFamily: roundedFontBold ?? 'System',
  },
  prepBadge: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: '#FFF2C9',
    borderWidth: 1,
    borderColor: '#ECD896',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  prepBadgeText: {
    fontSize: 12,
    color: '#6C5D2A',
    fontFamily: roundedFontBold ?? 'System',
  },
  menuPopover: {
    position: 'absolute',
    minWidth: 176,
    zIndex: 30,
    borderRadius: 18,
    backgroundColor: '#FBFAF3',
    borderWidth: 1,
    borderColor: '#E4DDC7',
    padding: 12,
  },
  menuOverlayFull: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: '#00000055',
    justifyContent: 'flex-start',
    paddingTop: 84,
    paddingHorizontal: 16,
  },
  menuSheet: {
    borderRadius: 18,
    backgroundColor: '#FBFAF3',
    borderWidth: 1,
    borderColor: '#E4DDC7',
    padding: 14,
  },
  menuTitle: {
    fontSize: 18,
    color: '#3C3A33',
    marginBottom: 8,
    fontFamily: roundedFontBold ?? 'System',
  },
  menuItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8DFC3',
    backgroundColor: '#FFFDF6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  menuItemText: {
    color: '#4A4438',
    fontSize: 15,
    fontFamily: roundedFont,
  },
  emptyRoutinesText: {
    color: '#6D6756',
    fontSize: 14,
    fontFamily: roundedFont,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
});
