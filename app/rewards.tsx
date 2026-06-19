import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import StarBank from '../components/StarBank';
import DailyProgressCard from '../components/DailyProgressCard';
import CloudsBackground from '../components/CloudsBackground';
import { getChildProfile } from '../services/profile';
import { ensureAuth } from '../services/firebase';
import { useUserRoutines } from '../hooks/useRoutine';
import { getUserTotalStars } from '../services/stars';
import { ChildProfile, DailyProgress, Routine } from '../types';
import { isMorningTime } from '../utils/timeOfDay';

function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function completionStorageKey(routineId: string): string {
  return `daily_completion_${routineId}`;
}

async function computeDailyProgress(routines: Routine[]): Promise<DailyProgress> {
  const today = getTodayISO();
  let morningTotal = 0;
  let eveningTotal = 0;
  let morningCompleted = 0;
  let eveningCompleted = 0;

  for (const routine of routines) {
    const raw = await AsyncStorage.getItem(completionStorageKey(routine.id));
    const parsed = raw
      ? (JSON.parse(raw) as { date?: string; morning?: number[]; evening?: number[] })
      : null;
    const morningSet = new Set<number>(parsed?.date === today ? parsed?.morning ?? [] : []);
    const eveningSet = new Set<number>(parsed?.date === today ? parsed?.evening ?? [] : []);

    routine.activityStack.forEach((_, index) => {
      const stepTime = routine.stepTimes?.[index] ?? routine.scheduledTime;
      if (isMorningTime(stepTime)) {
        morningTotal += 1;
        if (morningSet.has(index)) morningCompleted += 1;
      } else {
        eveningTotal += 1;
        if (eveningSet.has(index)) eveningCompleted += 1;
      }
    });
  }

  return { morningCompleted, morningTotal, eveningCompleted, eveningTotal };
}

function pickPrimaryRoutine(routines: Routine[], userId: string): Routine | null {
  if (routines.length === 0) return null;
  const canonicalRoutineId = userId ? `routine_${userId}` : '';
  if (canonicalRoutineId) {
    const canonical = routines.find((routine) => routine.id === canonicalRoutineId);
    if (canonical) return canonical;
  }
  return routines[0];
}

export default function RewardsScreen() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress>({
    morningCompleted: 0,
    morningTotal: 0,
    eveningCompleted: 0,
    eveningTotal: 0,
  });

  useEffect(() => {
    let mounted = true;

    async function initProfile() {
      try {
        const user = await ensureAuth();
        if (mounted) setUserId(user.uid);

        const childProfile = await getChildProfile();
        if (mounted) setProfile(childProfile);
      } catch (err) {
        console.warn('[Rewards] init failed:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    initProfile();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (pathname !== '/rewards') return;

    let mounted = true;
    async function refreshProfile() {
      try {
        const latest = await getChildProfile();
        if (mounted) setProfile(latest);
      } catch (err) {
        console.warn('[Rewards] refresh profile failed:', err);
      }
    }

    refreshProfile();
    return () => {
      mounted = false;
    };
  }, [pathname]);

  const routinesResult = useUserRoutines(userId);
  const routines = useMemo(() => routinesResult?.routines ?? [], [routinesResult?.routines]);
  const primaryRoutine = useMemo(() => pickPrimaryRoutine(routines, userId), [routines, userId]);

  useEffect(() => {
    if (pathname !== '/rewards' || !userId) return;
    let mounted = true;

    async function refreshRewardsData() {
      try {
        const [profileResult, starsResult, progressResult] = await Promise.allSettled([
          getChildProfile(),
          getUserTotalStars(userId),
          computeDailyProgress(primaryRoutine ? [primaryRoutine] : []),
        ]);

        if (!mounted) return;

        const latestProfile =
          profileResult.status === 'fulfilled' ? profileResult.value : null;
        const serverStars =
          starsResult.status === 'fulfilled' ? starsResult.value : null;
        const progress =
          progressResult.status === 'fulfilled'
            ? progressResult.value
            : { morningCompleted: 0, morningTotal: 0, eveningCompleted: 0, eveningTotal: 0 };

        if (latestProfile) {
          const localStars = latestProfile.totalStarsEarned ?? 0;
          const resolvedStars =
            typeof serverStars === 'number' ? Math.max(localStars, serverStars) : localStars;
          setProfile({
            ...latestProfile,
            totalStarsEarned: resolvedStars,
          });
        } else {
          setProfile(null);
        }

        setDailyProgress(progress);
      } catch (err) {
        console.warn('[Rewards] refresh failed:', err);
      }
    }

    refreshRewardsData();
    return () => {
      mounted = false;
    };
  }, [pathname, userId, primaryRoutine]);

  if (loading || !profile) {
    return (
      <View style={styles.root}>
        <Stack.Screen
          options={{
            headerTitle: 'Rewards',
            headerTitleAlign: 'center',
            headerStyle: { backgroundColor: '#c6e8e8' },
            headerShadowVisible: false,
            headerTintColor: '#1A2533',
            headerTitleStyle: { color: '#1A2533', fontWeight: '700', fontSize: 17 },
          }}
        />
        <CloudsBackground />
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading rewards...</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const totalStars = profile.totalStarsEarned ?? 0;

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerTitle: `${profile.childName}'s Rewards`,
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: '#c6e8e8' },
          headerShadowVisible: false,
          headerTintColor: '#1A2533',
          headerTitleStyle: { color: '#1A2533', fontWeight: '700', fontSize: 17 },
        }}
      />
      <CloudsBackground />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <StarBank totalStars={totalStars} />

        {/* Today's Journey Section */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Today&apos;s Journey</Text>
          {primaryRoutine ? (
            <>
              <DailyProgressCard segment="morning" progress={dailyProgress} />
              <DailyProgressCard segment="evening" progress={dailyProgress} />
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No routine configured yet</Text>
              <Text style={styles.emptyStateSubtext}>Complete your setup to start earning stars!</Text>
            </View>
          )}
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoLabel}>💡 How to earn stars</Text>
          <Text style={styles.infoText}>Complete your morning and evening tasks to earn stars and unlock new levels!</Text>
        </View>
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#c6e8e8',
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 16,
    paddingBottom: 130,
  },
  sectionContainer: {
    marginTop: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#64748B',
  },
  emptyState: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: '#E6F2FF',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#4A90D9',
    marginTop: 20,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 6,
  },
  infoText: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 19,
  },
});
