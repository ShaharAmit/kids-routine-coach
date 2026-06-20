import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { LocalDailyCompletion } from '../types';
import { getTodayISO } from '../utils/date';

function storageKey(routineId: string): string {
  return `daily_completion_${routineId}`;
}

interface DailyCompletionState {
  completedMorningStepIds: Set<string>;
  completedEveningStepIds: Set<string>;
  isMorningAllDone: boolean;
  isEveningAllDone: boolean;
  /**
   * Marks a step complete for today. Returns `true` only when the step was not
   * already completed (i.e. a genuinely new completion). Returns `false` for
   * no-op cases — missing routine or re-completing an already-done step — so
   * callers can avoid re-awarding stars when a child re-watches finished tasks.
   */
  markStepDone: (
    segment: 'morning' | 'evening',
    stepId: string,
    totalSteps: number
  ) => Promise<boolean>;
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
  const [morningStepIds, setMorningStepIds] = useState<Set<string>>(
    hasInitialForToday ? new Set(initialCompletion?.morning ?? []) : new Set()
  );
  const [eveningStepIds, setEveningStepIds] = useState<Set<string>>(
    hasInitialForToday ? new Set(initialCompletion?.evening ?? []) : new Set()
  );
  const [isMorningAllDone, setIsMorningAllDone] = useState(false);
  const [isEveningAllDone, setIsEveningAllDone] = useState(false);
  const [loading, setLoading] = useState(!hasInitialForToday);

  // Keep a ref to always have the latest sets inside markStepDone without stale closures
  const morningRef = useRef<Set<string>>(new Set());
  const eveningRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    morningRef.current = morningStepIds;
  }, [morningStepIds]);
  useEffect(() => {
    eveningRef.current = eveningStepIds;
  }, [eveningStepIds]);

  // Load from AsyncStorage on mount / routineId change
  useEffect(() => {
    if (!routineId) {
      setLoading(false);
      return;
    }

    if (initialCompletion?.date === getTodayISO()) {
      setMorningStepIds(new Set(initialCompletion.morning ?? []));
      setEveningStepIds(new Set(initialCompletion.evening ?? []));
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
            const mSet = new Set<string>((parsed.morning ?? []).filter((id) => typeof id === 'string'));
            const eSet = new Set<string>((parsed.evening ?? []).filter((id) => typeof id === 'string'));
            setMorningStepIds(mSet);
            setEveningStepIds(eSet);
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
      stepId: string,
      totalSteps: number
    ): Promise<boolean> => {
      if (!routineId) return false;
      if (!stepId) return false;

      const currentSet = segment === 'morning' ? morningRef.current : eveningRef.current;
      if (currentSet.has(stepId)) return false; // already done, no-op

      const newSet = new Set(currentSet);
      newSet.add(stepId);
      const newSize = newSet.size;
      const allDone = newSize >= totalSteps;

      // Optimistic state update
      if (segment === 'morning') {
        setMorningStepIds(newSet);
        if (allDone) setIsMorningAllDone(true);
      } else {
        setEveningStepIds(newSet);
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
        const trophyDocId = `${today}_${segment}`;
        const trophyRef = doc(db, 'users', userId, 'trophies', trophyDocId);
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

      return true;
    },
    [routineId, userId, childName]
  );

  return {
    completedMorningStepIds: morningStepIds,
    completedEveningStepIds: eveningStepIds,
    isMorningAllDone,
    isEveningAllDone,
    markStepDone,
    loading,
  };
}
