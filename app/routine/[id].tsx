import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoutine } from '../../hooks/useRoutine';
import ActivityPlayer from '../../components/ActivityPlayer';
import { areAssetsReady, syncRoutineAssets } from '../../services/assetSync';
import { ensureAudioForRoutine } from '../../services/tts';
import { ACTIVITIES } from '../../constants/activities';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function RoutineScreen() {
  const insets = useSafeAreaInsets();
  const topInset = insets.top + (Platform.OS === 'android' ? 8 : 0);
  const { id, segment } = useLocalSearchParams<{ id: string; segment?: 'morning' | 'evening' }>();
  const { routine, loading, error } = useRoutine(id ?? '');

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [viewMode, setViewMode] = useState<'tasks' | 'player'>('tasks');
  const [completedSteps, setCompletedSteps] = useState<boolean[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);

  const visibleStepIndexes = useMemo(() => {
    if (!routine) return [] as number[];

    if (segment !== 'morning' && segment !== 'evening') {
      return routine.activityStack.map((_, index) => index);
    }

    return routine.activityStack
      .map((_, index) => {
        const time = routine.stepTimes?.[index] ?? routine.scheduledTime;
        const [hourStr] = time.split(':');
        const hour = Number(hourStr);
        const isMorning = Number.isFinite(hour) ? hour >= 4 && hour < 15 : true;
        if ((segment === 'morning' && isMorning) || (segment === 'evening' && !isMorning)) {
          return index;
        }
        return -1;
      })
      .filter((index) => index >= 0);
  }, [routine, segment]);

  // Verify or sync assets when routine loads
  useEffect(() => {
    if (!routine) return;

    async function prepareAssets() {
      setSyncing(true);
      try {
        const ready = await areAssetsReady(routine!);
        if (ready) {
          setAssetsReady(true);
        } else {
          // Attempt a sync (will use remote URLs)
          const { missingAudioKeys } = await syncRoutineAssets(routine!);
          if (missingAudioKeys.length === 0) {
            setAssetsReady(true);
          } else {
            // Kick off generation for routines created before audio existed,
            // then retry one sync pass to fetch anything that is now ready.
            console.warn('[RoutineScreen] Missing audio keys:', missingAudioKeys);
            await ensureAudioForRoutine(routine!);

            let stillMissing = missingAudioKeys;
            for (let attempt = 1; attempt <= 4; attempt += 1) {
              await wait(1500);
              const retry = await syncRoutineAssets(routine!);
              stillMissing = retry.missingAudioKeys;
              if (stillMissing.length === 0) break;
            }

            if (stillMissing.length > 0) {
              console.warn('[RoutineScreen] Audio still pending after retries:', stillMissing);
            }
            setAssetsReady(true);
          }
        }
      } catch (err) {
        console.error('[RoutineScreen] Asset prep error:', err);
        setAssetsReady(true); // Let the player handle missing file gracefully
      } finally {
        setSyncing(false);
      }
    }

    prepareAssets();
  }, [routine]);

  useEffect(() => {
    if (!routine) return;
    setCompletedSteps(Array.from({ length: routine.activityStack.length }, () => false));
    setCurrentStepIndex(visibleStepIndexes[0] ?? 0);
    setViewMode('tasks');
    setIsComplete(false);
  }, [routine, visibleStepIndexes]);

  const handleStepComplete = useCallback(() => {
    if (!routine) return;

    setCompletedSteps((prev) => {
      const next = [...prev];
      next[currentStepIndex] = true;
      const scopedIndexes = visibleStepIndexes.length > 0
        ? visibleStepIndexes
        : routine.activityStack.map((_, index) => index);
      const allDone = scopedIndexes.every((index) => next[index]);
      if (allDone) {
        setIsComplete(true);
      } else {
        setViewMode('tasks');
      }
      return next;
    });
  }, [currentStepIndex, routine, visibleStepIndexes]);

  const handleFinish = useCallback(() => {
    router.replace('/');
  }, []);

  // ── Loading states ────────────────────────────────────────────────────────
  if (loading || syncing) {
    return (
      <SafeAreaView style={styles.centered}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color="#4A90D9" />
        <Text style={styles.loadingText}>
          {syncing ? '⬇️  Downloading assets…' : 'Loading routine…'}
        </Text>
      </SafeAreaView>
    );
  }

  if (error || !routine) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>⚠️ Routine not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/')}>
          <Text style={styles.backButtonText}>Go Home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Routine Complete ──────────────────────────────────────────────────────
  if (isComplete) {
    return (
      <SafeAreaView style={styles.completionContainer}>
        <StatusBar barStyle="dark-content" />
        <Text style={styles.completionEmoji}>🏆</Text>
        <Text style={styles.completionTitle}>Amazing, {routine.childName}!</Text>
        <Text style={styles.completionSub}>
          You finished all {routine.activityStack.length} steps!
        </Text>
        <TouchableOpacity style={styles.homeButton} onPress={handleFinish}>
          <Text style={styles.homeButtonText}>🏠 Go Home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Active Step ───────────────────────────────────────────────────────────
  const currentActivityStep = routine.activityStack[currentStepIndex] ?? [];
  const scopedStepIndexes = visibleStepIndexes.length > 0
    ? visibleStepIndexes
    : routine.activityStack.map((_, index) => index);
  const currentStepPosition = Math.max(0, scopedStepIndexes.indexOf(currentStepIndex));

  const renderTasksView = () => {
    const completedCount = scopedStepIndexes.filter((index) => completedSteps[index]).length;
    const title = segment === 'evening' ? 'EVENING ACTIVITIES' : 'MORNING ACTIVITIES';
    const hero = segment === 'evening' ? '🌙' : '☀️';
    const subtitle = segment === 'evening' ? 'Time to wind down' : 'Let us start the day';

    return (
      <View style={styles.tasksContainer}>
        <View style={styles.starsLayer} pointerEvents="none">
          <Text style={[styles.star, { top: 12, left: 18 }]}>★</Text>
          <Text style={[styles.star, { top: 48, right: 36 }]}>★</Text>
          <Text style={[styles.star, { top: 178, left: 44 }]}>★</Text>
          <Text style={[styles.star, { top: 236, right: 20 }]}>★</Text>
        </View>

        <View style={styles.tasksHeader}>
          <Text style={styles.tasksTitle}>{title}</Text>
          <Text style={styles.tasksSun}>{hero}</Text>
          <Text style={styles.tasksHeroSub}>{subtitle}</Text>
          <Text style={styles.tasksSub}>
            {completedCount} of {scopedStepIndexes.length} completed
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.tasksList}>
          {scopedStepIndexes.map((index) => {
            const step = routine.activityStack[index] ?? [];
            const metas = step.map((key) => ACTIVITIES[key]).filter(Boolean);
            const title = metas[0]?.label ?? 'Task';
            const sub = metas.slice(1).map((meta) => meta.label).join(' • ');
            const previewEmoji = metas.map((meta) => meta.emoji).join(' ');

            const durationMin = Math.max(5, step.length * 5);
            const done = completedSteps[index] ?? false;

            return (
              <TouchableOpacity
                key={`step-${index}`}
                style={[styles.taskCard, done && styles.taskCardDone]}
                activeOpacity={0.88}
                onPress={() => {
                  setCurrentStepIndex(index);
                  setViewMode('player');
                }}
              >
                <View style={styles.taskEmojiWrap}>
                  <Text style={styles.taskEmoji}>{previewEmoji || '⭐'}</Text>
                </View>

                <View style={styles.taskTextWrap}>
                  <Text style={styles.taskTitle}>{title}</Text>
                  {sub ? <Text style={styles.taskSub}>{sub}</Text> : null}
                  <Text style={styles.taskDuration}>{durationMin} min</Text>
                </View>

                <View style={[styles.checkWrap, done && styles.checkWrapDone]}>
                  <Text style={[styles.checkText, done && styles.checkTextDone]}>{done ? '✓' : '○'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.doneOverviewBtn} onPress={handleFinish}>
            <Text style={styles.doneOverviewText}>Back Home</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Top bar with routine name and exit */}
      <View style={styles.topBar}>
        <View style={{ width: 36 }} />
        <Text style={styles.routineTitle} numberOfLines={1}>
          {routine.childName}'s Routine
        </Text>
        <TouchableOpacity style={styles.menuButton} onPress={() => setMenuVisible(true)}>
          <Text style={styles.menuIcon}>≡</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'tasks' ? renderTasksView() : null}

      {/* The activity player handles video + audio + done button */}
      {viewMode === 'player' && assetsReady && (
        <ActivityPlayer
          key={currentStepIndex} // Re-mounts on each step change to reset media
          activityStep={currentActivityStep}
          childName={routine.childName}
          avatarId={routine.avatarId}
          stepNumber={currentStepPosition + 1}
          totalSteps={scopedStepIndexes.length}
          onComplete={handleStepComplete}
        />
      )}

      {viewMode === 'player' ? (
        <TouchableOpacity
          style={styles.backToTasksBtn}
          onPress={() => setViewMode('tasks')}
          activeOpacity={0.85}
        >
          <Text style={styles.backToTasksText}>Back To Tasks</Text>
        </TouchableOpacity>
      ) : null}

      {menuVisible ? (
        <View style={[styles.menuPopover, { top: topInset + 54 }]}>
          <Text style={styles.menuTitle}>Menu</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push('/settings' as never);
            }}
          >
            <Text style={styles.menuItemText}>Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push('/onboarding/questionnaire' as never);
            }}
          >
            <Text style={styles.menuItemText}>Questionnaire</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push('/parent/create');
            }}
          >
            <Text style={styles.menuItemText}>Add Routine</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4EEDB',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#E53935',
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: '#4A90D9',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 30,
  },
  backButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E6DDC0',
    backgroundColor: '#F7F1DF',
  },
  menuButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFE8D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    fontSize: 19,
    color: '#6A5C3A',
    lineHeight: 20,
  },
  routineTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#3A3324',
    marginHorizontal: 8,
  },
  tasksContainer: {
    flex: 1,
  },
  starsLayer: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.2,
  },
  star: {
    position: 'absolute',
    color: '#C9AB5A',
    fontSize: 44,
  },
  tasksHeader: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 18,
  },
  tasksTitle: {
    fontSize: 30,
    color: '#2B2A28',
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tasksSun: {
    fontSize: 70,
    marginTop: 8,
    marginBottom: 8,
  },
  tasksSub: {
    color: '#6C5F3D',
    fontSize: 14,
    fontWeight: '700',
  },
  tasksHeroSub: {
    color: '#8A7C56',
    fontSize: 14,
    marginBottom: 4,
  },
  tasksList: {
    paddingHorizontal: 14,
    paddingBottom: 34,
  },
  taskCard: {
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#DED3B7',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#6A5E43',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  taskCardDone: {
    backgroundColor: '#F6F3E7',
  },
  taskEmojiWrap: {
    width: 66,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  taskEmoji: {
    fontSize: 34,
  },
  taskTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  taskTitle: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    color: '#252420',
  },
  taskSub: {
    fontSize: 16,
    color: '#544D3E',
    marginTop: 2,
  },
  taskDuration: {
    marginTop: 5,
    fontSize: 15,
    color: '#3A3324',
    fontWeight: '700',
  },
  checkWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: '#C59A3E',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF9EA',
  },
  checkWrapDone: {
    backgroundColor: '#EDE3C6',
  },
  checkText: {
    fontSize: 28,
    lineHeight: 30,
    color: '#B38A35',
    fontWeight: '700',
  },
  checkTextDone: {
    color: '#8D6D25',
  },
  doneOverviewBtn: {
    marginTop: 6,
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C8B890',
    backgroundColor: '#FFF8E3',
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  doneOverviewText: {
    color: '#5A4E31',
    fontSize: 14,
    fontWeight: '700',
  },
  backToTasksBtn: {
    position: 'absolute',
    right: 14,
    bottom: 16,
    borderRadius: 999,
    backgroundColor: '#FFF8E3',
    borderWidth: 1,
    borderColor: '#C8B890',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backToTasksText: {
    color: '#5A4E31',
    fontSize: 13,
    fontWeight: '700',
  },
  completionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDE7',
    padding: 32,
  },
  completionEmoji: {
    fontSize: 96,
    marginBottom: 24,
  },
  completionTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#F9A825',
    textAlign: 'center',
    marginBottom: 12,
  },
  completionSub: {
    fontSize: 18,
    color: '#555',
    textAlign: 'center',
    marginBottom: 48,
    lineHeight: 26,
  },
  homeButton: {
    backgroundColor: '#4A90D9',
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 50,
    elevation: 4,
    shadowColor: '#4A90D9',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  homeButtonText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
  },
  menuPopover: {
    position: 'absolute',
    right: 16,
    minWidth: 190,
    zIndex: 30,
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
    fontFamily: 'AvenirNext-DemiBold',
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
    fontFamily: 'AvenirNext-Medium',
  },
});
