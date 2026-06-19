import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
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
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import ActivityPlayer from '../components/ActivityPlayer';
import StarsBackground from '../components/StarsBackground';
import CloudsBackground from '../components/CloudsBackground';
import { ACTIVITIES } from '../constants/activities';
import { useLocalDailyCompletion } from '../hooks/useLocalDailyCompletion';
import { useUserRoutines } from '../hooks/useRoutine';
import { subscribeAssetCacheStatus } from '../services/assetCacheService';
import { areAssetsReady, syncRoutineAssets } from '../services/assetSync';
import { ensureAuth } from '../services/firebase';
import { getHomeBootstrapSnapshot, isRoutineWarmed, markRoutineWarmed } from '../services/homeBootstrap';
import { ensureAudioForRoutine } from '../services/tts';
import { Routine } from '../types';
import { getCurrentSegment, MORNING_START_MINUTES, EVENING_START_MINUTES } from '../utils/timeOfDay';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const TASK_IMAGES: Record<string, ReturnType<typeof require>> = {
  brush_teeth: require('../assets/images/tooth_brush.png'),
  bed_time: require('../assets/images/bed_time.png'),
  put_on_pajamas: require('../assets/images/put_on_pajamas.png'),
  read_book: require('../assets/images/read_book.png'),
  drink_water: require('../assets/images/drink_water.png'),
};

const TASK_FALLBACK_IMAGE = require('../assets/images/sun.png');

const TASK_SUBTITLES: Record<string, string> = {
  brush_teeth: "Let's make those teeth sparkle!",
  get_dressed: 'Time for comfy cozy clothes',
  put_on_pajamas: 'Time for comfy cozy clothes',
  read_book: "Let's go on an adventure!",
  drink_water: 'A little sip for sweet dreams',
};

const TASK_FALLBACK_SUBTITLE = 'Close your eyes and rest';

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
  const [trophyVisible, setTrophyVisible] = useState(false);
  const [trophyShownThisSession, setTrophyShownThisSession] = useState<Record<'morning' | 'evening', boolean>>({
    morning: false,
    evening: false,
  });

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
  const completedCount = visibleStepIndexes.filter((index) => completedIndexes.has(index)).length;

  const currentActivityStep = primaryRoutine.activityStack[currentStepIndex] ?? [];
  const scopedPosition = Math.max(0, visibleStepIndexes.indexOf(currentStepIndex));

  return (
    <View style={[styles.container, isEvening ? styles.containerEvening : styles.containerMorning]}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: isEvening ? '#2e4385' : '#c6e8e8' },
          headerTintColor: isEvening ? '#FFF' : '#1E7B7B',
          headerTitleStyle: { fontFamily: roundedFontBold ?? 'System', fontSize: 17, color: isEvening ? '#FFF' : '#1E7B7B' },
          headerShadowVisible: false,
        }}
      />

      <StatusBar barStyle={isEvening ? 'light-content' : 'dark-content'} />

      {viewMode === 'tasks' ? (
        <View style={styles.tasksContainer}>
          {isEvening ? (
            <>
              <StarsBackground />
            </>
          ) : (
            <>
              <CloudsBackground />
            </>
          )}

          <SafeAreaView style={styles.safeContent} edges={['bottom']}>
           <View style={styles.tasksHeader}>
             <Text style={[styles.tasksProgress, !isEvening && styles.tasksProgressMorning]}>
               {completedCount} / {visibleStepIndexes.length}
             </Text>
              {cacheStage === 'warming-assets' ? (
                <View style={styles.prepBadge}>
                  <Text style={styles.prepBadgeText}>Preparing media...</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.cardWrap}>
              <View style={[styles.card, !isEvening && styles.cardMorning]}>
              <ScrollView contentContainerStyle={styles.tasksList} showsVerticalScrollIndicator={false}>
                {visibleStepIndexes.map((index, listIdx) => {
                  const step = primaryRoutine.activityStack[index] ?? [];
                  const metas = step.map((key) => ACTIVITIES[key]).filter(Boolean);
                  const primaryLabel = metas[0]?.label ?? 'Task';
                  const done = completedIndexes.has(index);
                  const primaryActivityKey = step[0] ?? '';
                  const taskImage = TASK_IMAGES[primaryActivityKey] ?? TASK_FALLBACK_IMAGE;
                  const taskSubtitle = TASK_SUBTITLES[primaryActivityKey] ?? TASK_FALLBACK_SUBTITLE;

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
                      <View style={styles.taskImageWrap}>
                        <Image source={taskImage} style={styles.taskImage} resizeMode="contain" />
                      </View>

                      <View style={styles.taskTextWrap}>
                        <Text style={styles.taskTitle} numberOfLines={1}>
                          {listIdx + 1}. {primaryLabel}
                        </Text>
                        <Text style={styles.taskSubtitle} numberOfLines={1}>
                          {taskSubtitle}
                        </Text>
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
          </View>
          </SafeAreaView>
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

      {/* Floating Bottom Menu Bar */}
      <View style={[styles.floatingMenu, { marginBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={styles.menuItemContainer}
          onPress={() => router.push('/settings' as never)}
          activeOpacity={0.7}
        >
          <View style={styles.menuIconButton}>
            <Text style={styles.menuIcon}>⚙️</Text>
          </View>
          <Text style={styles.menuLabel}>Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItemContainer}
          onPress={() => router.push('/onboarding/questionnaire' as never)}
          activeOpacity={0.7}
        >
          <View style={styles.menuIconButton}>
            <Text style={styles.menuIcon}>✏️</Text>
          </View>
          <Text style={styles.menuLabel}>Questionnaire</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItemContainer}
          onPress={() => router.push('/parent/create' as never)}
          activeOpacity={0.7}
        >
          <View style={styles.menuIconButton}>
            <Text style={styles.menuIcon}>➕</Text>
          </View>
          <Text style={styles.menuLabel}>Add Task</Text>
        </TouchableOpacity>
      </View>

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
    backgroundColor: '#c6e8e8',
  },
  containerMorning: {
    backgroundColor: '#c6e8e8',
  },
  containerEvening: {
    backgroundColor: '#2e4385',
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
  safeContent: {
    flex: 1,
  },
  moon: {
    position: 'absolute',
    top: -30,
    right: 14,
    width: 96,
    height: 96,
    zIndex: 7!,
  },
  sun: {
    position: 'absolute',
    top: -30,
    right: 12,
    width: 104,
    height: 104,
    zIndex: 7!,
  },
  tasksHeader: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  tasksTitle: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#EAF0FF',
    fontFamily: roundedFontBold ?? 'System',
  },
  tasksTitleMorning: {
    color: '#1E4E79',
  },
  tasksSubtitle: {
    marginTop: 4,
    fontSize: 30,
    color: '#B9C6E8',
    fontFamily: roundedFontBold ?? 'System',
  },
  tasksSubtitleMorning: {
    color: '#356491',
  },
  tasksProgress: {
    marginTop: 6,
    fontSize: 15,
    color: '#8E9CC4',
    fontWeight: '600',
  },
  tasksProgressMorning: {
    color: '#4E73A0',
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
  cardWrap: {
    flex: 1,
    maxHeight: '65%',
    marginVertical: 'auto',
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 6,
  },
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#0B2040',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardMorning: {
    backgroundColor: '#FFFFFF',
  },
  tasksList: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 16,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D7EBEB',
    borderStyle: 'dashed',
  },
  taskCardDone: {
    backgroundColor: '#F4FBF5',
    borderColor: '#BFE3CF',
  },
  taskImageWrap: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  taskImage: {
    width: 56,
    height: 56,
  },
  taskTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    fontSize: 21,
    color: '#1F4A52',
    fontFamily: roundedFontBold ?? 'System',
  },
  taskSubtitle: {
    marginTop: 3,
    fontSize: 14,
    color: '#5E8A86',
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
    fontSize: 24,
    color: '#FFFFFF',
    lineHeight: 24,
    fontFamily: roundedFontBold ?? 'System',
  },
  headerMenuIconMorning: {
    color: '#1E7B7B',
  },
  floatingMenu: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 12,
    shadowColor: '#0B2040',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  menuItemContainer: {
    alignItems: 'center',
    gap: 3,
  },
  menuIconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    fontSize: 14,
  },
  menuLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#536362',
    textAlign: 'center',
  },
});
