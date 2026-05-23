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
import { Routine } from '../types';
import { hasDebugHomeAccess } from '../services/debugFlow';

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

        if (onboardingDone && isPaid) {
          const profile = await getChildProfile();
          if (profile) {
            const routine: Routine = {
              id: `routine_${profile.userId}`,
              userId: profile.userId,
              childName: profile.childName,
              childAge: profile.age,
              avatarId: profile.avatarId,
              scheduledTime: profile.scheduledTime,
              activityStack: profile.activityStack,
              stepTimes: profile.stepTimes,
              tone: profile.tone,
              voice: profile.voice,
            };
            preloadRoutineAssetsInBackground(routine).catch((err) => {
              console.warn('[Loading] Background warmup failed:', err);
            });
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
    paddingHorizontal: 28,
    backgroundColor: '#F5F7FA',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1E2B39',
    marginBottom: 20,
  },
  stage: {
    fontSize: 16,
    color: '#4A5568',
    marginBottom: 24,
  },
  barTrack: {
    width: '100%',
    height: 12,
    borderRadius: 8,
    backgroundColor: '#DFE5EC',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#4A90D9',
  },
  percent: {
    marginTop: 12,
    fontSize: 14,
    color: '#667085',
    fontWeight: '700',
  },
});
