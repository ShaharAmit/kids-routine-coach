import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { router } from 'expo-router';
import { ensureAuth } from '../services/firebase';
import { requestNotificationPermissions } from '../services/notifications';
import {
  downloadWelcomeAssets,
  preloadRoutineAssetsInBackground,
} from '../services/assetCacheService';
import { getPaidStatus } from '../services/subscription';
import { getChildProfile, hasCompletedOnboarding } from '../services/profile';
import { ensureNameAudioReady } from '../services/nameAudio';
import { Routine } from '../types';
import { hasDebugHomeAccess } from '../services/debugFlow';
import { getHomeBootstrapSnapshot, primeHomeBootstrap } from '../services/homeBootstrap';
import { colors, fs, ms, s, vs } from '../theme';
import { isMorningTime } from '../utils/timeOfDay';

const HOME_PREWARM_TIMEOUT_MS = 4500;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default function LoadingScreen() {
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('Starting...');

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnim]);

  useEffect(() => {
    let isCancelled = false;

    async function run() {
      try {
        setStage('Signing in...');
        setProgress(20);

        await requestNotificationPermissions();
        const user = await ensureAuth();

        setStage('Preparing your coach...');
        setProgress(55);
        await downloadWelcomeAssets();
        const isPaid = await getPaidStatus();

        const onboardingDone = await hasCompletedOnboarding();

        // Ensure the personalized name-audio clip is present locally (existence-guarded,
        // non-blocking). Runs on every cold start once a child profile exists.
        getChildProfile()
          .then((p) => {
            if (p?.childName) return ensureNameAudioReady(p.childName);
            return null;
          })
          .catch((err) => console.warn('[Loading] Name audio preload failed:', err));

        if (onboardingDone && isPaid) {
          setStage('Loading your routines...');
          setProgress(72);

          const bootstrapPromise = primeHomeBootstrap(user.uid).catch((err) => {
            console.warn('[Loading] Home bootstrap preload failed:', err);
            return null;
          });

          await withTimeout(bootstrapPromise, HOME_PREWARM_TIMEOUT_MS);

          const profile = await getChildProfile();
          const snapshot = getHomeBootstrapSnapshot(user.uid);
          const fallbackRoutine: Routine | null = profile
            ? {
                id: isMorningTime(profile.scheduledTime) ? 'morning' : 'evening',
                userId: profile.userId,
                childName: profile.childName,
                childAge: profile.age,
                avatarId: profile.avatarId,
                scheduledTime: profile.scheduledTime,
                activityStack: profile.activityStack,
                stepTimes: profile.stepTimes,
                tone: profile.tone,
                voice: profile.voice,
              }
            : null;

          const routineToWarm = snapshot?.routines[0] ?? fallbackRoutine;
          if (routineToWarm) {
            setStage('Preparing media...');
            setProgress(88);

            const warmPromise = preloadRoutineAssetsInBackground(routineToWarm).catch((err) => {
              console.warn('[Loading] Background warmup failed:', err);
            });

            await withTimeout(warmPromise, HOME_PREWARM_TIMEOUT_MS);
          }
        }

        setStage('Ready!');
        setProgress(100);

        if (isCancelled) return;
        if (hasDebugHomeAccess()) {
          router.replace('/');
          return;
        }

        if (!isPaid) {
          router.replace('/onboarding/welcome' as never);
        } else if (onboardingDone) {
          router.replace('/');
        } else {
          router.replace('/onboarding/welcome' as never);
        }
      } catch (err) {
        console.warn('[Loading] Failed to initialize app:', err);
        if (!isCancelled) {
          router.replace('/onboarding/welcome' as never);
        }
      }
    }

    run();

    return () => {
      isCancelled = true;
    };
  }, []);

  const width = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kids Routine Coach</Text>
      <Text style={styles.stage}>{stage}</Text>

      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { width }]} />
      </View>

      <Text style={styles.percent}>{Math.round(progress)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(28),
    backgroundColor: '#F5F7FA',
  },
  title: {
    fontSize: fs(28),
    fontWeight: '800',
    color: '#1E2B39',
    marginBottom: vs(20),
  },
  stage: {
    fontSize: fs(16),
    color: '#4A5568',
    marginBottom: vs(24),
  },
  barTrack: {
    width: '100%',
    height: vs(12),
    borderRadius: ms(8),
    backgroundColor: '#DFE5EC',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  percent: {
    marginTop: vs(12),
    fontSize: fs(14),
    color: '#667085',
    fontWeight: '700',
  },
});
