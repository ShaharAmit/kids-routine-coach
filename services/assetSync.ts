import * as FileSystem from 'expo-file-system/legacy';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Routine, ActivityKey } from '../types';
import { ACTIVITIES, AVATAR_VIDEO_BASE_URL } from '../constants/activities';

const VIDEO_DIR = `${FileSystem.documentDirectory}videos/`;
const AUDIO_DIR = `${FileSystem.documentDirectory}audio/`;

/** Ensure local cache directories exist */
async function ensureDirs(): Promise<void> {
  const videoDirInfo = await FileSystem.getInfoAsync(VIDEO_DIR);
  if (!videoDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(VIDEO_DIR, { intermediates: true });
  }
  const audioDirInfo = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!audioDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  }
}

/** Returns the local file path for a video asset */
export function localVideoPath(activityKey: ActivityKey): string {
  return `${VIDEO_DIR}${activityKey}.mp4`;
}

/** Returns the local file path for a TTS audio file */
export function localAudioPath(cacheKey: string): string {
  return `${AUDIO_DIR}${cacheKey}.mp3`;
}

/** Build the Firestore audio_cache document ID */
export function buildAudioCacheKey(
  childName: string,
  activityKey: ActivityKey,
  avatarId: string
): string {
  const normalizedName = childName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `${normalizedName}_${activityKey}_${avatarId}`;
}

/**
 * Download a single video file if not already cached locally.
 */
async function syncVideo(activityKey: ActivityKey, avatarId: string): Promise<void> {
  const localPath = localVideoPath(activityKey);
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return;

  const remoteUrl = `${AVATAR_VIDEO_BASE_URL}/${avatarId}/${activityKey}.mp4`;
  console.log(`[AssetSync] Downloading video: ${remoteUrl}`);
  await FileSystem.downloadAsync(remoteUrl, localPath);
}

/**
 * Fetch and cache audio file from Firebase Storage URL.
 */
async function syncAudio(cacheKey: string, audioUrl: string): Promise<void> {
  const localPath = localAudioPath(cacheKey);
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return;

  console.log(`[AssetSync] Downloading audio: ${audioUrl}`);
  await FileSystem.downloadAsync(audioUrl, localPath);
}

/**
 * Main sync function. Downloads all video and audio assets for a routine.
 * Should be called before the routine notification fires.
 *
 * @returns Object with any missing audio keys (still being generated)
 */
export async function syncRoutineAssets(
  routine: Routine
): Promise<{ missingAudioKeys: string[] }> {
  await ensureDirs();

  const missingAudioKeys: string[] = [];

  const syncTasks = routine.activityStack.map(async (activityKey) => {
    // 1. Sync video
    try {
      await syncVideo(activityKey, routine.avatarId);
    } catch (err) {
      console.warn(`[AssetSync] Failed to download video for ${activityKey}:`, err);
    }

    // 2. Sync audio
    const cacheKey = buildAudioCacheKey(routine.childName, activityKey, routine.avatarId);
    const localPath = localAudioPath(cacheKey);
    const localInfo = await FileSystem.getInfoAsync(localPath);

    if (!localInfo.exists) {
      try {
        const audioDocRef = doc(db, 'audio_cache', cacheKey);
        const audioDoc = await getDoc(audioDocRef);

        if (audioDoc.exists() && audioDoc.data()?.status === 'ready') {
          const audioUrl: string = audioDoc.data()!.audioUrl;
          await syncAudio(cacheKey, audioUrl);
        } else {
          missingAudioKeys.push(cacheKey);
        }
      } catch (err) {
        console.warn(`[AssetSync] Failed to sync audio for ${cacheKey}:`, err);
        missingAudioKeys.push(cacheKey);
      }
    }
  });

  await Promise.allSettled(syncTasks);
  return { missingAudioKeys };
}

/**
 * Check whether all assets for a routine are available locally.
 */
export async function areAssetsReady(routine: Routine): Promise<boolean> {
  for (const activityKey of routine.activityStack) {
    const videoInfo = await FileSystem.getInfoAsync(localVideoPath(activityKey));
    if (!videoInfo.exists) return false;

    const cacheKey = buildAudioCacheKey(routine.childName, activityKey, routine.avatarId);
    const audioInfo = await FileSystem.getInfoAsync(localAudioPath(cacheKey));
    if (!audioInfo.exists) return false;
  }
  return true;
}

/**
 * Delete all cached assets for a routine (e.g. when routine is deleted).
 */
export async function clearRoutineAssets(routine: Routine): Promise<void> {
  for (const activityKey of routine.activityStack) {
    const videoPath = localVideoPath(activityKey);
    const videoInfo = await FileSystem.getInfoAsync(videoPath);
    if (videoInfo.exists) {
      await FileSystem.deleteAsync(videoPath, { idempotent: true });
    }

    const cacheKey = buildAudioCacheKey(routine.childName, activityKey, routine.avatarId);
    const audioPath = localAudioPath(cacheKey);
    const audioInfo = await FileSystem.getInfoAsync(audioPath);
    if (audioInfo.exists) {
      await FileSystem.deleteAsync(audioPath, { idempotent: true });
    }
  }
}
