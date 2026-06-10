import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { LocalDailyCompletion, Routine, normalizeActivityStack, normalizeStepTimes } from '../types';

type HomeBootstrapSnapshot = {
  userId: string;
  routines: Routine[];
  completions: Record<string, LocalDailyCompletion>;
  warmedRoutineIds: Record<string, true>;
  createdAt: number;
};

let snapshot: HomeBootstrapSnapshot | null = null;

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

function normalizeRoutine(raw: Record<string, unknown>, id: string): Routine {
  const candidate = raw as Partial<Routine>;
  const stack = normalizeActivityStack((raw.activityStack ?? []) as never);
  const scheduledTime = candidate.scheduledTime ?? '08:00';

  return {
    id,
    userId: candidate.userId ?? '',
    childName: candidate.childName ?? '',
    childAge: candidate.childAge,
    avatarId: candidate.avatarId ?? 'avatar_boy_01',
    scheduledTime,
    activityStack: stack,
    stepTimes: normalizeStepTimes(candidate.stepTimes, stack, scheduledTime),
    tone: candidate.tone,
    voice: candidate.voice,
    notificationId: candidate.notificationId,
  };
}

async function readTodaysCompletion(routineId: string): Promise<LocalDailyCompletion | null> {
  try {
    const raw = await AsyncStorage.getItem(completionStorageKey(routineId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDailyCompletion;
    if (parsed.date !== getTodayISO()) return null;
    if (!Array.isArray(parsed.morning) || !Array.isArray(parsed.evening)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function primeHomeBootstrap(userId: string): Promise<HomeBootstrapSnapshot> {
  const q = query(collection(db, 'routines'), where('userId', '==', userId));
  const docs = await getDocs(q);
  const routines = docs.docs.map((item) => normalizeRoutine(item.data() as Record<string, unknown>, item.id));

  const completions: Record<string, LocalDailyCompletion> = {};
  await Promise.all(
    routines.map(async (routine) => {
      const completion = await readTodaysCompletion(routine.id);
      if (completion) {
        completions[routine.id] = completion;
      }
    })
  );

  snapshot = {
    userId,
    routines,
    completions,
    warmedRoutineIds: snapshot?.userId === userId ? snapshot.warmedRoutineIds : {},
    createdAt: Date.now(),
  };

  return snapshot;
}

export function getHomeBootstrapSnapshot(userId?: string): HomeBootstrapSnapshot | null {
  if (!snapshot) return null;
  if (userId && snapshot.userId !== userId) return null;
  return snapshot;
}

export function markRoutineWarmed(routineId: string, warmed: boolean): void {
  if (!snapshot) return;
  if (warmed) {
    snapshot.warmedRoutineIds[routineId] = true;
    return;
  }
  delete snapshot.warmedRoutineIds[routineId];
}

export function isRoutineWarmed(routineId: string): boolean {
  if (!snapshot) return false;
  return Boolean(snapshot.warmedRoutineIds[routineId]);
}

export function clearHomeBootstrap(): void {
  snapshot = null;
}
