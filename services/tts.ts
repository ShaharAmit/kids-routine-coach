import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { functions, db, ensureAuth } from './firebase';
import { Routine, ActivityKey, AudioCacheEntry } from '../types';
import { ACTIVITIES } from '../constants/activities';
import { buildAudioCacheKey } from './assetSync';

interface GenerateTTSRequest {
  cacheKey: string;
  text: string;
  childName: string;
  activityKey: ActivityKey;
  avatarId: string;
  tone?: Routine['tone'];
  voice?: Routine['voice'];
}

interface GenerateTTSResponse {
  audioUrl: string;
  cacheKey: string;
}

/**
 * Scan the activityStack for any activities missing from audio_cache,
 * then trigger the Firebase Cloud Function to generate them.
 * Called when a parent saves/updates a routine.
 */
export async function ensureAudioForRoutine(routine: Routine): Promise<void> {
  await ensureAuth();
  const generateTTS = httpsCallable<GenerateTTSRequest, GenerateTTSResponse>(
    functions,
    'generateRoutineAudio'
  );

  const activityKeys = routine.activityStack.flat();

  const tasks = activityKeys.map(async (activityKey) => {
    const cacheKey = buildAudioCacheKey(
      routine.childName,
      activityKey,
      routine.avatarId,
      routine.tone,
      routine.voice
    );
    const cacheRef = doc(db, 'audio_cache', cacheKey);

    // Check if audio already exists and is ready
    const cached = await getDoc(cacheRef);
    if (cached.exists() && cached.data()?.status === 'ready') {
      return; // Already generated
    }

    const activity = ACTIVITIES[activityKey];
    if (!activity) return;

    const text = activity.promptTemplate(routine.childName);

    try {
      console.log(`[TTS] Generating audio for: ${cacheKey}`);
      await generateTTS({
        cacheKey,
        text,
        childName: routine.childName,
        activityKey,
        avatarId: routine.avatarId,
        tone: routine.tone,
        voice: routine.voice,
      });
    } catch (err) {
      console.error(`[TTS] Failed to generate audio for ${cacheKey}:`, err);
    }
  });

  await Promise.allSettled(tasks);
}

/**
 * Fetch audio cache entries for a given routine.
 */
export async function getAudioCacheForRoutine(
  routine: Routine
): Promise<Record<string, AudioCacheEntry>> {
  const result: Record<string, AudioCacheEntry> = {};

  for (const activityKey of routine.activityStack.flat()) {
    const cacheKey = buildAudioCacheKey(
      routine.childName,
      activityKey,
      routine.avatarId,
      routine.tone,
      routine.voice
    );
    const cacheRef = doc(db, 'audio_cache', cacheKey);
    const snap = await getDoc(cacheRef);
    if (snap.exists()) {
      result[cacheKey] = snap.data() as AudioCacheEntry;
    }
  }

  return result;
}
