import { useState, useEffect } from 'react';
import { doc, getDoc, collection, query, where, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ActivityKey, ActivityStep, Routine, normalizeActivityStack, normalizeStepTimes } from '../types';
import { getHomeBootstrapSnapshot } from '../services/homeBootstrap';

type FirestoreStep = {
  activities: ActivityKey[];
};

function serializeActivityStackForFirestore(stack: ActivityStep[]): FirestoreStep[] {
  return stack.map((step) => ({ activities: [...step] }));
}

function deserializeActivityStackFromFirestore(rawStack: unknown): ActivityStep[] {
  if (!Array.isArray(rawStack)) return [];

  if (rawStack.length === 0) return [];
  const first = rawStack[0] as unknown;

  // Backward compatibility for local/in-memory shapes that may still be string[] or string[][].
  if (typeof first === 'string' || Array.isArray(first)) {
    return normalizeActivityStack(rawStack as ActivityKey[] | ActivityStep[]);
  }

  const asObjects = rawStack as Array<{ activities?: unknown }>;
  return asObjects
    .map((entry) => (Array.isArray(entry.activities) ? (entry.activities as ActivityKey[]) : []))
    .filter((step) => step.length > 0);
}

function normalizeRoutine(raw: Record<string, unknown>, id: string): Routine {
  const stack = deserializeActivityStackFromFirestore(raw.activityStack ?? []);
  const candidate = raw as Partial<Routine>;
  const scheduledTime = candidate.scheduledTime ?? '08:00';

  return {
    userId: candidate.userId ?? '',
    childName: candidate.childName ?? '',
    childAge: candidate.childAge,
    avatarId: candidate.avatarId ?? 'avatar_boy_01',
    scheduledTime,
    stepTimes: normalizeStepTimes(candidate.stepTimes, stack, scheduledTime),
    tone: candidate.tone,
    voice: candidate.voice,
    notificationId: candidate.notificationId,
    id,
    activityStack: stack,
  };
}

/**
 * Subscribe to a single routine document by ID.
 * Returns the routine and a loading flag.
 */
export function useRoutine(routineId: string) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!routineId) return;

    const routineRef = doc(db, 'routines', routineId);
    const unsubscribe = onSnapshot(
      routineRef,
      (snap) => {
        if (snap.exists()) {
          setRoutine(normalizeRoutine(snap.data() as Record<string, unknown>, snap.id));
        } else {
          setRoutine(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('[useRoutine] Firestore error:', err);
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [routineId]);

  return { routine, loading, error };
}

/**
 * Subscribe to all routines for a given user ID.
 */
export function useUserRoutines(userId: string) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setRoutines([]);
      return;
    }

    const bootstrapped = getHomeBootstrapSnapshot(userId);
    if (bootstrapped?.routines?.length) {
      setRoutines(bootstrapped.routines);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const q = query(collection(db, 'routines'), where('userId', '==', userId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) =>
          normalizeRoutine(d.data() as Record<string, unknown>, d.id)
        );
        setRoutines(data);
        setLoading(false);
      },
      (err) => {
        console.error('[useUserRoutines] Firestore error:', err);
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [userId]);

  return { routines, loading, error };
}

/**
 * Save or update a routine in Firestore.
 */
export async function saveRoutine(routine: Routine): Promise<void> {
  const { id, ...data } = routine;
  const routineRef = doc(db, 'routines', id);
  const firestoreData = {
    ...data,
    activityStack: serializeActivityStackForFirestore(routine.activityStack),
  };
  await setDoc(routineRef, firestoreData, { merge: true });
}

/**
 * Update only the notificationId field on an existing routine.
 */
export async function updateNotificationId(
  routineId: string,
  notificationId: string
): Promise<void> {
  const routineRef = doc(db, 'routines', routineId);
  await updateDoc(routineRef, { notificationId });
}
