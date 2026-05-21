import { useState, useEffect } from 'react';
import { doc, getDoc, collection, query, where, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Routine } from '../types';

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
          setRoutine({ id: snap.id, ...snap.data() } as Routine);
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
    if (!userId) return;

    const q = query(collection(db, 'routines'), where('userId', '==', userId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Routine));
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
  await setDoc(routineRef, data, { merge: true });
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
