import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { setHomeViewMode } from '../services/homeViewState';
import { getChildProfile, saveChildProfile } from '../services/profile';
import { awardRoutineStepStar } from '../services/stars';
import { ensureAudioForRoutine } from '../services/tts';
import { Routine } from '../types';
import { getCurrentSegment, isMorningTime } from '../utils/timeOfDay';
import { getTodayISO } from '../utils/date';
import { colors, fs, ms, ROUNDED_FONT, s, vs } from '../theme';

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

function routineHasTasksInSegment(routine: Routine, segment: 'morning' | 'evening'): boolean {
  return routine.activityStack.some((_, index) => {
    const time = routine.stepTimes?.[index] ?? routine.scheduledTime;
    const stepIsMorning = isMorningTime(time);
    return segment === 'morning' ? stepIsMorning : !stepIsMorning;
  });
}

function pickPrimaryRoutine(
  routines: Routine[],
  segment: 'morning' | 'evening'
): Routine | null {
  if (routines.length === 0) return null;

  const withSegmentTasks = routines.find((routine) => routineHasTasksInSegment(routine, segment));
  if (withSegmentTasks) return withSegmentTasks;

  return routines[0];
}

const roundedFontBold = ROUNDED_FONT;

export default function HomeScreen() {
  const navigation = useNavigation();
  const [userId, setUserId] = useState('');
  const [cacheStage, setCacheStage] = useState('idle');
  const [segment, setSegment] = useState<'morning' | 'evening'>(getCurrentSegment());
  const [viewMode, setViewMode] = useState<'tasks' | 'player'>('tasks');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [trophyVisible, setTrophyVisible] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
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
    () => pickPrimaryRoutine(mergedRoutines, segment),
    [mergedRoutines, segment]
  );
  const initialCompletion = primaryRoutine
    ? bootstrapSnapshot?.completions[primaryRoutine.id] ?? null
    : null;

  const {
    completedMorningStepIds,
    completedEveningStepIds,
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
    let mounted = true;

    async function loadCaptionPreference() {
      const profile = await getChildProfile();
      if (mounted) {
        setShowCaptions(profile?.showCaptions ?? false);
      }
    }

    loadCaptionPreference().catch((err) => {
      console.warn('[Home] failed to load caption preference:', err);
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setSegment(getCurrentSegment());
        loadCaptionPreference().catch((err) => {
          console.warn('[Home] failed to refresh caption preference:', err);
        });
      }
    });

    return () => {
      mounted = false;
      appStateSub.remove();
    };
  }, []);

  // Switching tabs (e.g. Settings -> Routines) doesn't remount this screen or trigger an
  // AppState change, so the caption toggle above only picks up the latest saved preference
  // when this tab regains focus.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      getChildProfile()
        .then((profile) => {
          if (mounted) setShowCaptions(profile?.showCaptions ?? false);
        })
        .catch((err) => console.warn('[Home] failed to refresh caption preference on focus:', err));

      return () => {
        mounted = false;
      };
    }, [])
  );

  // Nested <Stack.Screen> options have no effect on a Tabs.Screen's header — this tab's header
  // must be styled via navigation.setOptions so it matches the segment-tinted body background.
  useEffect(() => {
    const isEveningHeader = segment === 'evening';
    navigation.setOptions({
      headerStyle: { backgroundColor: isEveningHeader ? colors.eveningBg : colors.morningBg },
      headerTintColor: isEveningHeader ? '#FFF' : '#1E7B7B',
      headerTitleStyle: {
        fontFamily: roundedFontBold ?? 'System',
        fontSize: fs(17),
        color: isEveningHeader ? '#FFF' : '#1E7B7B',
      },
      headerShadowVisible: false,
    });
  }, [navigation, segment]);

  // Let the root layout know when the full-screen activity player is active so it can hide
  // the moon/sun decoration (which should only float over the task list, not the video).
  useEffect(() => {
    setHomeViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    return () => setHomeViewMode('tasks');
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

  const visibleStepIds = useMemo(() => {
    if (!primaryRoutine) return [] as string[];
    const stepIds = primaryRoutine.stepIds ?? [];
    return visibleStepIndexes.map((index) => stepIds[index] ?? `step_${index}`);
  }, [primaryRoutine, visibleStepIndexes]);

  const completedStepIds = segment === 'morning' ? completedMorningStepIds : completedEveningStepIds;

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
          // Backfill any newly-added variants (e.g. caption videos) without blocking the UI.
          syncRoutineAssets(routine).catch((err) =>
            console.warn('[Home] Background asset backfill failed:', err)
          );
          return;
        }

        const ready = await areAssetsReady(routine);
        if (ready) {
          markRoutineWarmed(routine.id, true);
          setAssetsReady(true);
          // Base video/audio are ready, but caption videos are best-effort and may not have been
          // downloaded yet (e.g. toggled on after the routine was first synced) — backfill them.
          syncRoutineAssets(routine).catch((err) =>
            console.warn('[Home] Background asset backfill failed:', err)
          );
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
    if (visibleStepIds.length === 0) return false;
    return visibleStepIds.every((id) => completedStepIds.has(id));
  }, [visibleStepIds, completedStepIds]);

  useEffect(() => {
    if (!allScopedDone) return;
    if (trophyShownThisSession[segment]) return;

    // Award 1 star for completing the entire routine segment (not per step)
    const awardSegmentStar = async () => {
      if (userId && primaryRoutine) {
        try {
          const award = await awardRoutineStepStar({
            userId,
            routineId: primaryRoutine.id,
            date: getTodayISO(),
            segment,
            stepIndex: -1, // -1 indicates segment completion, not a specific step
          });
          if (award.awarded) {
            const profile = await getChildProfile();
            if (profile && profile.userId === userId) {
              await saveChildProfile({
                ...profile,
                totalStarsEarned: award.totalStars,
                updatedAt: Date.now(),
              });
            }
          }
        } catch (err) {
          console.warn('[Home] Failed to award segment star:', err);
        }
      }
    };

    awardSegmentStar();
    setTrophyVisible(true);
    setTrophyShownThisSession((prev) => ({ ...prev, [segment]: true }));
  }, [allScopedDone, segment, trophyShownThisSession, userId, primaryRoutine]);

  const handleStepComplete = useCallback(async () => {
    if (!primaryRoutine || visibleStepIndexes.length === 0) return;
    const currentStepId = primaryRoutine.stepIds?.[currentStepIndex] ?? `step_${currentStepIndex}`;

    const newlyCompleted = await markStepDone(segment, currentStepId, visibleStepIndexes.length);

    // Star awarding now happens in the allScopedDone effect,
    // so we don't award here anymore. Just mark the step done and switch back to tasks view.
    if (newlyCompleted) {
      setViewMode('tasks');
    }
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
  const completedCount = visibleStepIds.filter((id) => completedStepIds.has(id)).length;

  const currentActivityStep = primaryRoutine.activityStack[currentStepIndex] ?? [];
  const scopedPosition = Math.max(0, visibleStepIndexes.indexOf(currentStepIndex));

  return (
    <View style={[styles.container, isEvening ? styles.containerEvening : styles.containerMorning]}>
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
                  const stepId = primaryRoutine.stepIds?.[index] ?? `step_${index}`;
                  const done = completedStepIds.has(stepId);
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
                    <TouchableOpacity
                      style={styles.emptyAddButton}
                      onPress={() => router.push(`/parent/create?segment=${segment}` as never)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.emptyAddIcon}>＋</Text>
                    </TouchableOpacity>
                    <Text style={styles.emptyTitle}>No activities yet</Text>
                    <Text style={styles.emptySub}>Tap + to add activities for this routine.</Text>
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
            showCaptions={showCaptions}
            onComplete={handleStepComplete}
          />

          <TouchableOpacity
            style={styles.backToTasksBtn}
            onPress={() => setViewMode('tasks')}
            activeOpacity={0.9}
          >
            <Text style={styles.backToTasksText}>‹ Back</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {viewMode === 'player' && !assetsReady ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#5F8F86" />
          <Text style={styles.loadingText}>Preparing media...</Text>
          <TouchableOpacity
            style={[styles.primaryButton, { marginTop: vs(14) }]}
            onPress={() => setViewMode('tasks')}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryButtonText}>Back To Tasks</Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
    backgroundColor: colors.morningBg,
  },
  containerMorning: {
    backgroundColor: colors.morningBg,
  },
  containerEvening: {
    backgroundColor: colors.eveningBg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.appBg,
    padding: ms(24),
  },
  loadingText: {
    marginTop: vs(14),
    fontSize: fs(16),
    color: '#5A6A64',
  },
  errorText: {
    fontSize: fs(20),
    fontWeight: '700',
    color: colors.danger,
    marginBottom: vs(8),
  },
  errorSub: {
    fontSize: fs(14),
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
    top: vs(-30),
    right: s(14),
    width: s(96),
    height: s(96),
    zIndex: 7!,
  },
  sun: {
    position: 'absolute',
    top: vs(-30),
    right: s(12),
    width: s(104),
    height: s(104),
    zIndex: 7!,
  },
  tasksHeader: {
    alignItems: 'center',
    paddingTop: vs(12),
    paddingBottom: vs(6),
    paddingHorizontal: s(16),
  },
  tasksTitle: {
    fontSize: fs(44),
    lineHeight: fs(48),
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.eveningTitle,
    fontFamily: roundedFontBold ?? 'System',
  },
  tasksTitleMorning: {
    color: colors.morningTitle,
  },
  tasksSubtitle: {
    marginTop: vs(4),
    fontSize: fs(30),
    color: colors.eveningSubtitle,
    fontFamily: roundedFontBold ?? 'System',
  },
  tasksSubtitleMorning: {
    color: colors.morningSubtitle,
  },
  tasksProgress: {
    marginTop: vs(6),
    fontSize: fs(15),
    color: '#8E9CC4',
    fontWeight: '600',
  },
  tasksProgressMorning: {
    color: '#4E73A0',
  },
  prepBadge: {
    marginTop: vs(8),
    paddingVertical: vs(7),
    paddingHorizontal: s(12),
    borderRadius: ms(99),
    backgroundColor: '#FFF8D8',
    borderWidth: 1,
    borderColor: '#E8D28E',
  },
  prepBadgeText: {
    fontSize: fs(12),
    color: '#705E1A',
    fontWeight: '700',
  },
  cardWrap: {
    flex: 1,
    maxHeight: '65%',
    marginVertical: 'auto',
    paddingHorizontal: s(18),
    paddingTop: vs(2),
    paddingBottom: vs(6),
  },
  card: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: ms(28),
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: ms(16),
    shadowOffset: { width: 0, height: vs(8) },
    elevation: 4,
  },
  cardMorning: {
    backgroundColor: colors.white,
  },
  tasksList: {
    paddingHorizontal: s(14),
    paddingTop: vs(8),
    paddingBottom: vs(96),
  },
  taskCard: {
    backgroundColor: colors.white,
    borderRadius: ms(20),
    marginBottom: vs(12),
    paddingVertical: vs(12),
    paddingHorizontal: s(12),
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.morningCardBorder,
    borderStyle: 'dashed',
  },
  taskCardDone: {
    backgroundColor: '#F4FBF5',
    borderColor: '#BFE3CF',
  },
  taskImageWrap: {
    width: s(60),
    height: s(60),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: s(12),
  },
  taskImage: {
    width: s(56),
    height: s(56),
  },
  taskTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    fontSize: fs(21),
    color: '#1F4A52',
    fontFamily: roundedFontBold ?? 'System',
  },
  taskSubtitle: {
    marginTop: vs(3),
    fontSize: fs(14),
    color: '#5E8A86',
    fontWeight: '600',
  },
  checkWrap: {
    width: s(34),
    height: s(34),
    borderRadius: ms(17),
    borderWidth: 2,
    borderColor: '#8CA3A1',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: s(8),
    backgroundColor: '#F7FBFA',
  },
  checkWrapDone: {
    borderColor: '#7AA49B',
    backgroundColor: '#E9F4F2',
  },
  checkText: {
    fontSize: fs(20),
    lineHeight: fs(22),
    color: '#5D7E78',
    fontWeight: '800',
  },
  checkTextDone: {
    color: colors.success,
  },
  backToTasksBtn: {
    position: 'absolute',
    left: s(16),
    top: vs(12),
    borderRadius: ms(18),
    backgroundColor: colors.primary,
    paddingVertical: vs(8),
    paddingHorizontal: s(16),
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: ms(6),
    shadowOffset: { width: 0, height: vs(2) },
  },
  backToTasksText: {
    fontSize: fs(15),
    fontWeight: '700',
    color: colors.white,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: colors.overlayLight,
  },
  menuPopover: {
    position: 'absolute',
    borderRadius: ms(14),
    backgroundColor: colors.white,
    padding: ms(10),
    borderWidth: 1,
    borderColor: '#E1E8E7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: vs(5) },
    shadowOpacity: 0.16,
    shadowRadius: ms(14),
    elevation: 8,
  },
  menuTitle: {
    fontSize: fs(12),
    color: '#8B9A98',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: s(8),
    paddingVertical: vs(6),
    fontWeight: '700',
  },
  menuItem: {
    paddingHorizontal: s(10),
    paddingVertical: vs(10),
    borderRadius: ms(10),
  },
  menuItemText: {
    fontSize: fs(16),
    color: '#233232',
    fontWeight: '600',
  },
  trophyOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: ms(18),
  },
  trophyCard: {
    width: '100%',
    maxWidth: s(360),
    borderRadius: ms(22),
    backgroundColor: colors.white,
    paddingHorizontal: s(18),
    paddingVertical: vs(22),
    alignItems: 'center',
  },
  trophyEmoji: {
    fontSize: fs(72),
  },
  trophyTitle: {
    marginTop: vs(8),
    fontSize: fs(28),
    textAlign: 'center',
    color: '#243231',
    fontFamily: roundedFontBold ?? 'System',
  },
  trophySub: {
    marginTop: vs(6),
    marginBottom: vs(18),
    fontSize: fs(16),
    color: '#5E6F6E',
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: ms(14),
    paddingVertical: vs(12),
    paddingHorizontal: s(18),
  },
  primaryButtonText: {
    fontSize: fs(16),
    fontWeight: '700',
    color: colors.white,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: vs(28),
  },
  emptyAddButton: {
    width: s(62),
    height: s(62),
    borderRadius: ms(31),
    backgroundColor: '#EAF5F3',
    borderWidth: 2,
    borderColor: '#B7D9D2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: vs(12),
  },
  emptyAddIcon: {
    fontSize: fs(36),
    lineHeight: fs(38),
    color: '#3B8A7E',
    fontWeight: '700',
  },
  emptyTitle: {
    fontSize: fs(18),
    fontWeight: '700',
    color: '#536362',
  },
  emptySub: {
    marginTop: vs(4),
    fontSize: fs(14),
    color: '#788583',
  },
  headerMenuButton: {
    width: s(38),
    height: s(38),
    borderRadius: ms(19),
    backgroundColor: colors.surfaceTranslucent,
    borderWidth: 1,
    borderColor: '#D8DCCF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMenuIcon: {
    fontSize: fs(24),
    color: colors.white,
    lineHeight: fs(24),
    fontFamily: roundedFontBold ?? 'System',
  },
  headerMenuIconMorning: {
    color: colors.teal,
  },
  floatingMenu: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    backgroundColor: colors.white,
    borderRadius: ms(16),
    paddingHorizontal: s(10),
    paddingVertical: vs(8),
    marginHorizontal: s(12),
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: ms(8),
    shadowOffset: { width: 0, height: vs(-4) },
    elevation: 8,
  },
  menuItemContainer: {
    alignItems: 'center',
    gap: s(3),
  },
  menuIconButton: {
    width: s(28),
    height: s(28),
    borderRadius: ms(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    fontSize: fs(14),
  },
  menuLabel: {
    fontSize: fs(9),
    fontWeight: '600',
    color: '#536362',
    textAlign: 'center',
  },
});
