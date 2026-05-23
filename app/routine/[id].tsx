import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoutine } from '../../hooks/useRoutine';
import ActivityPlayer from '../../components/ActivityPlayer';
import { areAssetsReady, syncRoutineAssets } from '../../services/assetSync';
import { ensureAudioForRoutine } from '../../services/tts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function RoutineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { routine, loading, error } = useRoutine(id ?? '');

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

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

  const handleStepComplete = useCallback(() => {
    if (!routine) return;

    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= routine.activityStack.length) {
      setIsComplete(true);
    } else {
      setCurrentStepIndex(nextIndex);
    }
  }, [currentStepIndex, routine]);

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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Top bar with routine name and exit */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() =>
            Alert.alert('Exit Routine?', 'Progress will be lost.', [
              { text: 'Keep Going', style: 'cancel' },
              { text: 'Exit', style: 'destructive', onPress: () => router.replace('/') },
            ])
          }
          style={styles.exitButton}
        >
          <Text style={styles.exitText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.routineTitle} numberOfLines={1}>
          {routine.childName}'s Routine
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* The activity player handles video + audio + done button */}
      {assetsReady && (
        <ActivityPlayer
          key={currentStepIndex} // Re-mounts on each step change to reset media
          activityStep={currentActivityStep}
          childName={routine.childName}
          avatarId={routine.avatarId}
          stepNumber={currentStepIndex + 1}
          totalSteps={routine.activityStack.length}
          onComplete={handleStepComplete}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
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
    borderBottomColor: '#EEE',
    backgroundColor: '#FFF',
  },
  exitButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '700',
  },
  routineTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginHorizontal: 8,
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
});
