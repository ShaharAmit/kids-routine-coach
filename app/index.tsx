import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActivityPlayer from '../components/ActivityPlayer';
import { ACTIVITIES } from '../constants/activities';
import { useLocalDailyCompletion } from '../hooks/useLocalDailyCompletion';
import { useUserRoutines } from '../hooks/useRoutine';
import { subscribeAssetCacheStatus } from '../services/assetCacheService';
import { areAssetsReady, syncRoutineAssets } from '../services/assetSync';
import { ensureAuth } from '../services/firebase';
import { getHomeBootstrapSnapshot, isRoutineWarmed, markRoutineWarmed } from '../services/homeBootstrap';
import { ensureAudioForRoutine } from '../services/tts';
import { Routine } from '../types';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const TASK_DURATION_MINUTES: Record<string, number> = {
  brush_teeth: 10,
  get_dressed: 10,
  eat_breakfast: 20,
  put_shoes_on: 5,
  tidy_room: 30,
  wash_face: 10,
  pack_backpack: 7,
  put_on_pajamas: 10,
  comb_hair: 10,
  drink_water: 5,
  use_toilet: 10,
  read_book: 20,
};

const MORNING_START_MINUTES = 4 * 60;
const EVENING_START_MINUTES = 15 * 60;

function getCurrentSegment(): 'morning' | 'evening' {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= MORNING_START_MINUTES && minutes < EVENING_START_MINUTES
    ? 'morning'
    : 'evening';
}

function timeToMinutes(value: string): number {
  const [hourStr, minuteStr] = value.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 8 * 60;
  }
  return hour * 60 + minute;
}

function isMorningTime(value: string): boolean {
  const minutes = timeToMinutes(value);
  return minutes >= MORNING_START_MINUTES && minutes < EVENING_START_MINUTES;
}

function routineHasTasksInSegment(routine: Routine, segment: 'morning' | 'evening'): boolean {
  return routine.activityStack.some((_, index) => {
    const time = routine.stepTimes?.[index] ?? routine.scheduledTime;
    const stepIsMorning = isMorningTime(time);
    return segment === 'morning' ? stepIsMorning : !stepIsMorning;
  });
}

function pickPrimaryRoutine(
  routines: Routine[],
  userId: string,
  segment: 'morning' | 'evening'
): Routine | null {
  if (routines.length === 0) return null;

  const canonicalRoutineId = userId ? `routine_${userId}` : '';
  if (canonicalRoutineId) {
    const canonical = routines.find((routine) => routine.id === canonicalRoutineId);
    if (canonical) return canonical;
  }

  const withSegmentTasks = routines.find((routine) => routineHasTasksInSegment(routine, segment));
  if (withSegmentTasks) return withSegmentTasks;

  return routines[0];
}

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
  const [segment, setSegment] = useState<'morning' | 'evening'>(getCurrentSegment());
  const [viewMode, setViewMode] = useState<'tasks' | 'player'>('tasks');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [trophyVisible, setTrophyVisible] = useState(false);
  const [trophyShownThisSession, setTrophyShownThisSession] = useState<Record<'morning' | 'evening', boolean>>({
    morning: false,
    evening: false,
  });

  const headerMenuButtonRef = useRef<any>(null);
  const menuAnim = useRef(new Animated.Value(0)).current;

  const { routines, loading, error } = useUserRoutines(userId);
  const bootstrapSnapshot = useMemo(() => getHomeBootstrapSnapshot(userId), [userId]);
  const mergedRoutines = useMemo(() => {
    const byId = new Map<string, Routine>();

    for (const routine of bootstrapSnapshot?.routines ?? []) {
      byId.set(routine.id, routine);
    }

    for (const routine of routines) {
      byId.set(routine.id, routine);
    }

    return Array.from(byId.values());
  }, [bootstrapSnapshot, routines]);

  const primaryRoutine = useMemo(
    () => pickPrimaryRoutine(mergedRoutines, userId, segment),
    [mergedRoutines, userId, segment]
  );
  const initialCompletion = primaryRoutine
    ? bootstrapSnapshot?.completions[primaryRoutine.id] ?? null
    : null;

  const {
    completedMorningIndexes,
    completedEveningIndexes,
    markStepDone,
    loading: completionLoading,
  } = useLocalDailyCompletion(
    userId,
    primaryRoutine?.id ?? '',
    primaryRoutine?.childName,
    initialCompletion
  );

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      const user = await ensureAuth();
      if (!mounted) return;
      setUserId(user.uid);
    }

    initialize().catch((err) => {
      console.warn('[Home] init failed:', err);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAssetCacheStatus((next) => {
      setCacheStage(next.stage);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setSegment(getCurrentSegment());
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, []);

  const visibleStepIndexes = useMemo(() => {
    if (!primaryRoutine) return [] as number[];

    return primaryRoutine.activityStack
      .map((_, index) => {
        const time = primaryRoutine.stepTimes?.[index] ?? primaryRoutine.scheduledTime;
        const stepIsMorning = isMorningTime(time);
        if ((segment === 'morning' && stepIsMorning) || (segment === 'evening' && !stepIsMorning)) {
          return index;
        }
        return -1;
      })
      .filter((index) => index >= 0);
  }, [primaryRoutine, segment]);

  const completedIndexes = segment === 'morning' ? completedMorningIndexes : completedEveningIndexes;

  useEffect(() => {
    if (visibleStepIndexes.length === 0) {
      setCurrentStepIndex(0);
      return;
    }

    if (!visibleStepIndexes.includes(currentStepIndex)) {
      setCurrentStepIndex(visibleStepIndexes[0]);
    }
  }, [visibleStepIndexes, currentStepIndex]);

  useEffect(() => {
    if (!primaryRoutine) return;
    const routine = primaryRoutine;

    async function prepareAssets() {
      setAssetsReady(false);
      try {
        if (isRoutineWarmed(routine.id)) {
          setAssetsReady(true);
          return;
        }

        const ready = await areAssetsReady(routine);
        if (ready) {
          markRoutineWarmed(routine.id, true);
          setAssetsReady(true);
          return;
        }

        const { missingAudioKeys } = await syncRoutineAssets(routine);
        if (missingAudioKeys.length === 0) {
          markRoutineWarmed(routine.id, true);
          setAssetsReady(true);
          return;
        }

        await ensureAudioForRoutine(routine);

        let stillMissing = missingAudioKeys;
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          await wait(1500);
          const retry = await syncRoutineAssets(routine);
          stillMissing = retry.missingAudioKeys;
          if (stillMissing.length === 0) {
            break;
          }
        }

        if (stillMissing.length > 0) {
          console.warn('[Home] Audio still pending after retries:', stillMissing);
          markRoutineWarmed(routine.id, false);
        } else {
          markRoutineWarmed(routine.id, true);
        }
        setAssetsReady(true);
      } catch (err) {
        console.error('[Home] Asset prep error:', err);
        markRoutineWarmed(routine.id, false);
        setAssetsReady(true);
      }
    }

    prepareAssets();
  }, [primaryRoutine]);

  const allScopedDone = useMemo(() => {
    if (visibleStepIndexes.length === 0) return false;
    return visibleStepIndexes.every((index) => completedIndexes.has(index));
  }, [visibleStepIndexes, completedIndexes]);

  useEffect(() => {
    if (!allScopedDone) return;
    if (trophyShownThisSession[segment]) return;

    setTrophyVisible(true);
    setTrophyShownThisSession((prev) => ({ ...prev, [segment]: true }));
  }, [allScopedDone, segment, trophyShownThisSession]);

  const handleStepComplete = useCallback(async () => {
    if (!primaryRoutine || visibleStepIndexes.length === 0) return;

    await markStepDone(segment, currentStepIndex, visibleStepIndexes.length);
    setViewMode('tasks');
  }, [primaryRoutine, visibleStepIndexes, markStepDone, segment, currentStepIndex]);

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

  if ((loading || completionLoading) && !primaryRoutine) {
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

  if (!primaryRoutine) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No routine found.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/parent/create')}>
          <Text style={styles.primaryButtonText}>Create Routine</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isEvening = segment === 'evening';
  const title = isEvening ? 'EVENING' : 'MORNING';
  const subtitle = isEvening ? 'Time to wind down' : "Let's start the day!";
  const hero = isEvening ? '🌙' : '☀️';
  const completedCount = visibleStepIndexes.filter((index) => completedIndexes.has(index)).length;

  const currentActivityStep = primaryRoutine.activityStack[currentStepIndex] ?? [];
  const scopedPosition = Math.max(0, visibleStepIndexes.indexOf(currentStepIndex));

  return (
    <View style={[styles.container, isEvening && styles.containerEvening]}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: isEvening ? '#3F4C8F' : '#4A90D9' },
          headerTintColor: '#FFF',
          headerTitleStyle: { fontFamily: roundedFontBold ?? 'System', fontSize: 17 },
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

      {viewMode === 'tasks' ? (
        <View style={styles.tasksContainer}>
          <View style={styles.tasksHeader}>
            <Text style={styles.tasksTitle}>{title}</Text>
            <Text style={styles.tasksHero}>{hero}</Text>
            <Text style={styles.tasksSubtitle}>{subtitle}</Text>
            <Text style={styles.tasksProgress}>
              {completedCount} / {visibleStepIndexes.length}
            </Text>
            {cacheStage === 'warming-assets' ? (
              <View style={styles.prepBadge}>
                <Text style={styles.prepBadgeText}>Preparing media...</Text>
              </View>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={styles.tasksList}>
            {visibleStepIndexes.map((index, listIdx) => {
              const step = primaryRoutine.activityStack[index] ?? [];
              const metas = step.map((key) => ACTIVITIES[key]).filter(Boolean);
              const primaryLabel = metas[0]?.label ?? 'Task';
              const emoji = metas.map((meta) => meta.emoji).join(' ') || '⭐';
              const done = completedIndexes.has(index);
              const primaryActivityKey = step[0] ?? '';
              const durationMin =
                TASK_DURATION_MINUTES[primaryActivityKey] ?? Math.max(5, step.length * 5);

              return (
                <TouchableOpacity
                  key={`segment-step-${index}`}
                  style={[styles.taskCard, done && styles.taskCardDone]}
                  activeOpacity={0.9}
                  onPress={() => {
                    setCurrentStepIndex(index);
                    setViewMode('player');
                  }}
                >
                  <View style={styles.taskEmojiWrap}>
                    <Text style={styles.taskEmoji}>{emoji}</Text>
                  </View>

                  <View style={styles.taskTextWrap}>
                    <Text style={styles.taskTitle}>{listIdx + 1}. {primaryLabel}</Text>
                    <Text style={styles.taskDuration}>{durationMin} min</Text>
                  </View>

                  <View style={[styles.checkWrap, done && styles.checkWrapDone]}>
                    <Text style={[styles.checkText, done && styles.checkTextDone]}>
                      {done ? '✓' : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {visibleStepIndexes.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No tasks in this time block</Text>
                <Text style={styles.emptySub}>Adjust step times in the questionnaire.</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      {viewMode === 'player' && assetsReady ? (
        <>
          <ActivityPlayer
            key={currentStepIndex}
            activityStep={currentActivityStep}
            childName={primaryRoutine.childName}
            avatarId={primaryRoutine.avatarId}
            stepNumber={scopedPosition + 1}
            totalSteps={visibleStepIndexes.length}
            onComplete={handleStepComplete}
          />

          <TouchableOpacity
            style={styles.backToTasksBtn}
            onPress={() => setViewMode('tasks')}
            activeOpacity={0.9}
          >
            <Text style={styles.backToTasksText}>Back To Tasks</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {viewMode === 'player' && !assetsReady ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#5F8F86" />
          <Text style={styles.loadingText}>Preparing media...</Text>
          <TouchableOpacity
            style={[styles.primaryButton, { marginTop: 14 }]}
            onPress={() => setViewMode('tasks')}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryButtonText}>Back To Tasks</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Modal visible={menuVisible} transparent animationType="none" onRequestClose={closeMenu}>
        <Pressable style={styles.menuOverlay} onPress={closeMenu}>
          <Animated.View style={[styles.menuPopover, menuPosition, { width: menuWidth }, menuAnimatedStyle]}>
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
                router.push('/parent/create' as never);
              }}
            >
              <Text style={styles.menuItemText}>Add Routine</Text>
            </TouchableOpacity>
          </Animated.View>
        </Pressable>
      </Modal>

      <Modal visible={trophyVisible} transparent animationType="fade" onRequestClose={() => setTrophyVisible(false)}>
        <View style={styles.trophyOverlay}>
          <View style={styles.trophyCard}>
            <Text style={styles.trophyEmoji}>🏆</Text>
            <Text style={styles.trophyTitle}>Amazing, {primaryRoutine.childName}!</Text>
            <Text style={styles.trophySub}>You finished all {segment} tasks.</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                setTrophyVisible(false);
                setViewMode('tasks');
              }}
            >
              <Text style={styles.primaryButtonText}>Great Job</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F0E2',
  },
  containerEvening: {
    backgroundColor: '#E6EDF8',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
    padding: 24,
  },
  loadingText: {
    marginTop: 14,
    fontSize: 16,
    color: '#5A6A64',
  },
  errorText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#D65050',
    marginBottom: 8,
  },
  errorSub: {
    fontSize: 14,
    color: '#6A6A6A',
    textAlign: 'center',
  },
  tasksContainer: {
    flex: 1,
  },
  tasksHeader: {
    alignItems: 'center',
    paddingTop: 22,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  tasksTitle: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#6E8380',
    fontFamily: roundedFontBold ?? 'System',
  },
  tasksHero: {
    marginTop: 2,
    fontSize: 66,
  },
  tasksSubtitle: {
    marginTop: 4,
    fontSize: 30,
    color: '#5A6F6A',
    fontFamily: roundedFontBold ?? 'System',
  },
  tasksProgress: {
    marginTop: 6,
    fontSize: 15,
    color: '#6A7A78',
    fontWeight: '600',
  },
  prepBadge: {
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 99,
    backgroundColor: '#FFF8D8',
    borderWidth: 1,
    borderColor: '#E8D28E',
  },
  prepBadgeText: {
    fontSize: 12,
    color: '#705E1A',
    fontWeight: '700',
  },
  tasksList: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 24 + 32,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E3E8E7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  taskCardDone: {
    backgroundColor: '#F4FBF5',
  },
  taskEmojiWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDF5F3',
    marginRight: 12,
  },
  taskEmoji: {
    fontSize: 26,
  },
  taskTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    fontSize: 21,
    color: '#1F2626',
    fontFamily: roundedFontBold ?? 'System',
  },
  taskDuration: {
    marginTop: 3,
    fontSize: 13,
    color: '#76807F',
    fontWeight: '600',
  },
  checkWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#8CA3A1',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    backgroundColor: '#F7FBFA',
  },
  checkWrapDone: {
    borderColor: '#7AA49B',
    backgroundColor: '#E9F4F2',
  },
  checkText: {
    fontSize: 20,
    lineHeight: 22,
    color: '#5D7E78',
    fontWeight: '800',
  },
  checkTextDone: {
    color: '#4F7F76',
  },
  backToTasksBtn: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    borderRadius: 18,
    backgroundColor: '#4A90D9',
    alignItems: 'center',
    paddingVertical: 12,
  },
  backToTasksText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
  },
  menuPopover: {
    position: 'absolute',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderWidth: 1,
    borderColor: '#E1E8E7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 8,
  },
  menuTitle: {
    fontSize: 12,
    color: '#8B9A98',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontWeight: '700',
  },
  menuItem: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
  },
  menuItemText: {
    fontSize: 16,
    color: '#233232',
    fontWeight: '600',
  },
  trophyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  trophyCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 22,
    alignItems: 'center',
  },
  trophyEmoji: {
    fontSize: 72,
  },
  trophyTitle: {
    marginTop: 8,
    fontSize: 28,
    textAlign: 'center',
    color: '#243231',
    fontFamily: roundedFontBold ?? 'System',
  },
  trophySub: {
    marginTop: 6,
    marginBottom: 18,
    fontSize: 16,
    color: '#5E6F6E',
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#536362',
  },
  emptySub: {
    marginTop: 4,
    fontSize: 14,
    color: '#788583',
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
});
