import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { LocalDailyCompletion } from '../types';

function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function storageKey(routineId: string): string {
  return `daily_completion_${routineId}`;
}

interface DailyCompletionState {
  completedMorningIndexes: Set<number>;
  completedEveningIndexes: Set<number>;
  isMorningAllDone: boolean;
  isEveningAllDone: boolean;
  markStepDone: (
    segment: 'morning' | 'evening',
    stepIndex: number,
    totalSteps: number
  ) => Promise<void>;
  loading: boolean;
}

export function useLocalDailyCompletion(
  userId: string,
  routineId: string,
  childName?: string,
  initialCompletion?: LocalDailyCompletion | null,
  refreshSignal?: string | number
): DailyCompletionState {
  const hasInitialForToday =
    Boolean(initialCompletion) && initialCompletion?.date === getTodayISO();
  const [morningIndexes, setMorningIndexes] = useState<Set<number>>(
    hasInitialForToday ? new Set(initialCompletion?.morning ?? []) : new Set()
  );
  const [eveningIndexes, setEveningIndexes] = useState<Set<number>>(
    hasInitialForToday ? new Set(initialCompletion?.evening ?? []) : new Set()
  );
  const [isMorningAllDone, setIsMorningAllDone] = useState(false);
  const [isEveningAllDone, setIsEveningAllDone] = useState(false);
  const [loading, setLoading] = useState(!hasInitialForToday);

  // Keep a ref to always have the latest sets inside markStepDone without stale closures
  const morningRef = useRef<Set<number>>(new Set());
  const eveningRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    morningRef.current = morningIndexes;
  }, [morningIndexes]);
  useEffect(() => {
    eveningRef.current = eveningIndexes;
  }, [eveningIndexes]);

  // Load from AsyncStorage on mount / routineId change
  useEffect(() => {
    if (!routineId) {
      setLoading(false);
      return;
    }

    if (initialCompletion?.date === getTodayISO()) {
      setMorningIndexes(new Set(initialCompletion.morning ?? []));
      setEveningIndexes(new Set(initialCompletion.evening ?? []));
      setLoading(false);
    }

    let mounted = true;

    async function load() {
      try {
        const raw = await AsyncStorage.getItem(storageKey(routineId));
        if (!mounted) return;

        if (raw) {
          const parsed: LocalDailyCompletion = JSON.parse(raw);
          const today = getTodayISO();
          if (parsed.date === today) {
            const mSet = new Set<number>(parsed.morning);
            const eSet = new Set<number>(parsed.evening);
            setMorningIndexes(mSet);
            setEveningIndexes(eSet);
          }
          // If date differs, start fresh (old data stays but is ignored)
        }
      } catch (err) {
        console.warn('[useLocalDailyCompletion] Load error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, [routineId, initialCompletion, refreshSignal]);

  const markStepDone = useCallback(
    async (
      segment: 'morning' | 'evening',
      stepIndex: number,
      totalSteps: number
    ): Promise<void> => {
      if (!routineId) return;

      const currentSet = segment === 'morning' ? morningRef.current : eveningRef.current;
      if (currentSet.has(stepIndex)) return; // already done, no-op

      const newSet = new Set(currentSet);
      newSet.add(stepIndex);
      const newSize = newSet.size;
      const allDone = newSize >= totalSteps;

      // Optimistic state update
      if (segment === 'morning') {
        setMorningIndexes(newSet);
        if (allDone) setIsMorningAllDone(true);
      } else {
        setEveningIndexes(newSet);
        if (allDone) setIsEveningAllDone(true);
      }

      // Persist to AsyncStorage
      const today = getTodayISO();
      try {
        const raw = await AsyncStorage.getItem(storageKey(routineId));
        const current: LocalDailyCompletion = raw
          ? JSON.parse(raw)
          : { date: today, morning: [], evening: [] };

        // Reset if it's a new day
        const stored: LocalDailyCompletion =
          current.date === today ? current : { date: today, morning: [], evening: [] };

        const updatedArray = Array.from(newSet);
        const updated: LocalDailyCompletion = {
          ...stored,
          [segment]: updatedArray,
        };
        await AsyncStorage.setItem(storageKey(routineId), JSON.stringify(updated));
      } catch (err) {
        console.warn('[useLocalDailyCompletion] Persist error:', err);
      }

      // Write one-shot trophy to Firestore when segment is fully done
      if (allDone && userId) {
        const trophyDocId = `${userId}_${today}_${segment}`;
        const trophyRef = doc(db, 'daily_trophies', trophyDocId);
        try {
          await setDoc(trophyRef, {
            userId,
            date: today,
            segment,
            routineId,
            childName: childName ?? '',
            completedAt: serverTimestamp(),
          });
        } catch (err) {
          // Non-critical — trophy write failure should not block UX
          console.warn('[useLocalDailyCompletion] Trophy write error:', err);
        }
      }
    },
    [routineId, userId, childName]
  );

  return {
    completedMorningIndexes: morningIndexes,
    completedEveningIndexes: eveningIndexes,
    isMorningAllDone,
    isEveningAllDone,
    markStepDone,
    loading,
  };
}
