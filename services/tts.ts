import * as FileSystem from 'expo-file-system/legacy';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { functions, db, ensureAuth } from './firebase';
import { Routine, ActivityKey, AudioCacheEntry } from '../types';
import { ACTIVITIES } from '../constants/activities';
import { TTS_AUDIO_ENABLED } from '../constants/featureFlags';
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
  if (!TTS_AUDIO_ENABLED) return; // Avatar videos already carry baked-in narration audio for now.

  const activityKeys = Array.from(new Set(routine.activityStack.flat()));

  const activities = activityKeys.map(async (activityKey) => {
    const cacheKey = buildAudioCacheKey(
      routine.childName,
      activityKey,
      routine.avatarId,
      routine.tone,
      routine.voice
    );

    // If already exists locally on device, skip Firestore check and generation completely
    const localPath = `${FileSystem.documentDirectory}audio/${cacheKey}.wav`;
    const localInfo = await FileSystem.getInfoAsync(localPath);
    if (localInfo.exists && 'size' in localInfo && (localInfo.size ?? 0) >= 4096) {
      return;
    }

    await ensureAuth();
    const generateTTS = httpsCallable<GenerateTTSRequest, GenerateTTSResponse>(
      functions,
      'generateRoutineAudio'
    );

    const cacheRef = doc(db, 'audio_cache', cacheKey);

    // Check if audio already exists and is ready in Firestore
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

  await Promise.allSettled(activities);
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
