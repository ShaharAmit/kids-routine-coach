import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db, ensureAuth, functions } from './firebase';

interface AwardRoutineStepStarRequest {
  userId: string;
  routineId: string;
  date: string; // YYYY-MM-DD
  segment: 'morning' | 'evening';
  stepIndex: number;
  stars?: number;
}

interface AwardRoutineStepStarResponse {
  totalStars: number;
  awarded: boolean;
}

export async function getUserTotalStars(userId: string): Promise<number | null> {
  if (!userId) return null;
  const statsRef = doc(db, 'user_stats', userId);
  const snap = await getDoc(statsRef);
  if (snap.exists()) {
    const total = snap.data()?.totalStars;
    if (typeof total === 'number') return total;
  }

  const awardsRef = collection(db, 'user_stats', userId, 'awards');
  const awardsSnap = await getDocs(awardsRef);
  if (awardsSnap.empty) return null;

  let fallbackTotal = 0;
  awardsSnap.forEach((docSnap) => {
    const stars = docSnap.data()?.stars;
    fallbackTotal += typeof stars === 'number' ? stars : 1;
  });
  return fallbackTotal;
}

export async function awardRoutineStepStar(
  payload: AwardRoutineStepStarRequest
): Promise<AwardRoutineStepStarResponse> {
  await ensureAuth();
  const callable = httpsCallable<AwardRoutineStepStarRequest, AwardRoutineStepStarResponse>(
    functions,
    'awardRoutineStepStar'
  );
  const result = await callable({
    ...payload,
    stars: payload.stars ?? 1,
  });
  return result.data;
}
