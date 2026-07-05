import * as FileSystem from 'expo-file-system/legacy';
import { db, storage, ensureAuth } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { Routine, ActivityKey, CaptionCue } from '../types';
import { ACTIVITIES } from '../constants/activities';
import { TTS_AUDIO_ENABLED } from '../constants/featureFlags';

const VIDEO_DIR = `${FileSystem.documentDirectory}videos/`;
const AUDIO_DIR = `${FileSystem.documentDirectory}audio/`;
const CAPTIONS_DIR = `${FileSystem.documentDirectory}captions/`;
const MIN_VIDEO_FILE_BYTES = 16 * 1024;
const MIN_AUDIO_FILE_BYTES = 4 * 1024;

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
  const captionsDirInfo = await FileSystem.getInfoAsync(CAPTIONS_DIR);
  if (!captionsDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CAPTIONS_DIR, { intermediates: true });
  }
}

/** Returns the local file path for a video asset */
export function localVideoPath(activityKey: ActivityKey, avatarId: string): string {
  return `${VIDEO_DIR}${avatarId}_${activityKey}.mp4`;
}

export async function isValidCachedVideo(localPath: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(localPath);
  if (!info.exists) return false;

  // A tiny file is typically an HTML error page or partial download, not a playable MP4.
  const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
  return size >= MIN_VIDEO_FILE_BYTES;
}

/** Returns the local file path for a TTS audio file */
export function localAudioPath(cacheKey: string): string {
  return `${AUDIO_DIR}${cacheKey}.wav`;
}

/** Returns the local file path for a caption cue JSON file */
export function localCaptionsPath(activityKey: ActivityKey, avatarId: string): string {
  return `${CAPTIONS_DIR}${avatarId}_${activityKey}.json`;
}

async function isValidCachedAudio(localPath: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(localPath);
  if (!info.exists) return false;

  const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
  if (size < MIN_AUDIO_FILE_BYTES) return false;

  try {
    // Validate RIFF/WAVE header so stale raw PCM files are not treated as playable WAV.
    const riffHeader = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 4,
    });
    const waveHeader = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
      position: 8,
      length: 4,
    });
    return riffHeader === 'UklGRg==' && waveHeader === 'V0FWRQ==';
  } catch {
    return false;
  }
}

/** Build the Firestore audio_cache document ID */
export function buildAudioCacheKey(
  childName: string,
  activityKey: ActivityKey,
  avatarId: string,
  tone?: Routine['tone'],
  voice?: Routine['voice']
): string {
  const normalizedName = childName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const toneKey = tone ?? 'cheerful';
  const voiceKey = voice ?? 'woman';
  return `${normalizedName}_${activityKey}_${avatarId}_${toneKey}_${voiceKey}`;
}

/**
 * Download a single video file if not already cached locally.
 */
async function syncVideo(activityKey: ActivityKey, avatarId: string): Promise<void> {
  const localPath = localVideoPath(activityKey, avatarId);
  const hasValidCachedVideo = await isValidCachedVideo(localPath);
  if (hasValidCachedVideo) return;

  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  const remoteStoragePath = `avatars/${avatarId}/${activityKey}.mp4`;
  const remoteUrl = await getDownloadURL(ref(storage, remoteStoragePath));
  console.log(`[AssetSync] Downloading video: ${remoteUrl}`);
  const downloadResult = await FileSystem.downloadAsync(remoteUrl, localPath);

  const status = (downloadResult as { status?: number }).status;
  if (typeof status === 'number' && status >= 400) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`[AssetSync] Video download failed (${status}) for ${remoteUrl}`);
  }

  const isPlayable = await isValidCachedVideo(localPath);
  if (!isPlayable) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`[AssetSync] Downloaded video is invalid or too small: ${remoteUrl}`);
  }
}

/**
 * Fetch and cache audio file from Firebase Storage URL.
 */
async function syncAudio(cacheKey: string, audioUrl: string): Promise<void> {
  const localPath = localAudioPath(cacheKey);
  const hasValidCachedAudio = await isValidCachedAudio(localPath);
  if (hasValidCachedAudio) return;

  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  console.log(`[AssetSync] Downloading audio: ${audioUrl}`);
  const downloadResult = await FileSystem.downloadAsync(audioUrl, localPath);

  const status = (downloadResult as { status?: number }).status;
  if (typeof status === 'number' && status >= 400) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`[AssetSync] Audio download failed (${status}) for ${audioUrl}`);
  }

  const isPlayable = await isValidCachedAudio(localPath);
  if (!isPlayable) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`[AssetSync] Downloaded audio is invalid or too small: ${audioUrl}`);
  }
}

/**
 * Download a single activity's caption cue JSON file, if not already cached. Best-effort —
 * not every activity has captions authored yet, so a 404 here is non-fatal.
 */
async function syncCaptions(activityKey: ActivityKey, avatarId: string): Promise<void> {
  const localPath = localCaptionsPath(activityKey, avatarId);
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists && 'size' in info && info.size > 0) return;

  if (info.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  const remoteStoragePath = `avatars/${avatarId}/${activityKey}_captions.json`;
  const remoteUrl = await getDownloadURL(ref(storage, remoteStoragePath));
  const downloadResult = await FileSystem.downloadAsync(remoteUrl, localPath);

  const status = (downloadResult as { status?: number }).status;
  if (typeof status === 'number' && status >= 400) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`[AssetSync] Captions download failed (${status}) for ${remoteUrl}`);
  }
}

/**
 * Ensure a single activity's caption cues are downloaded and return the parsed data, or `null`
 * if no captions exist for that activity (or the download fails). Called on-demand by the
 * player when captions are toggled on, so we don't rely solely on the background home-screen
 * backfill sync (which may not have completed yet by the time the child opens a step).
 */
export async function ensureCaptionsData(
  activityKey: ActivityKey,
  avatarId: string
): Promise<CaptionCue[] | null> {
  await ensureDirs();
  await ensureAuth();

  const localPath = localCaptionsPath(activityKey, avatarId);
  try {
    await syncCaptions(activityKey, avatarId);
  } catch (err) {
    console.warn(`[AssetSync] No captions available for ${activityKey}:`, err);
    return null;
  }

  try {
    const raw = await FileSystem.readAsStringAsync(localPath);
    const cues = JSON.parse(raw);
    return Array.isArray(cues) ? (cues as CaptionCue[]) : null;
  } catch (err) {
    console.warn(`[AssetSync] Failed to parse cached captions for ${activityKey}:`, err);
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    return null;
  }
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
  await ensureAuth();

  const missingAudioKeys: string[] = [];
  const activityKeys = routine.activityStack.flat();

  const syncTasks = activityKeys.map(async (activityKey) => {
    // 1. Sync video (required)
    try {
      await syncVideo(activityKey, routine.avatarId);
    } catch (err) {
      console.warn(`[AssetSync] Failed to download video for ${activityKey}:`, err);
    }

    // 2. Sync caption cues (best-effort — may not exist for every activity)
    try {
      await syncCaptions(activityKey, routine.avatarId);
    } catch (err) {
      console.warn(`[AssetSync] Failed to download captions for ${activityKey}:`, err);
    }

    // 3. Sync audio (skipped while personalized TTS narration is disabled — see featureFlags.ts)
    if (!TTS_AUDIO_ENABLED) return;

    const cacheKey = buildAudioCacheKey(
      routine.childName,
      activityKey,
      routine.avatarId,
      routine.tone,
      routine.voice
    );
    const localPath = localAudioPath(cacheKey);
    const audioReady = await isValidCachedAudio(localPath);

    if (!audioReady) {
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
  for (const activityKey of routine.activityStack.flat()) {
    const videoReady = await isValidCachedVideo(localVideoPath(activityKey, routine.avatarId));
    if (!videoReady) return false;

    if (!TTS_AUDIO_ENABLED) continue; // Narration audio comes from the video itself for now.

    const cacheKey = buildAudioCacheKey(
      routine.childName,
      activityKey,
      routine.avatarId,
      routine.tone,
      routine.voice
    );
    const audioReady = await isValidCachedAudio(localAudioPath(cacheKey));
    if (!audioReady) return false;
  }
  return true;
}

/**
 * Delete all cached assets for a routine (e.g. when routine is deleted).
 */
export async function clearRoutineAssets(routine: Routine): Promise<void> {
  for (const activityKey of routine.activityStack.flat()) {
    const videoPath = localVideoPath(activityKey, routine.avatarId);
    const videoInfo = await FileSystem.getInfoAsync(videoPath);
    if (videoInfo.exists) {
      await FileSystem.deleteAsync(videoPath, { idempotent: true });
    }

    const captionsPath = localCaptionsPath(activityKey, routine.avatarId);
    const captionsInfo = await FileSystem.getInfoAsync(captionsPath);
    if (captionsInfo.exists) {
      await FileSystem.deleteAsync(captionsPath, { idempotent: true });
    }

    const cacheKey = buildAudioCacheKey(
      routine.childName,
      activityKey,
      routine.avatarId,
      routine.tone,
      routine.voice
    );
    const audioPath = localAudioPath(cacheKey);
    const audioInfo = await FileSystem.getInfoAsync(audioPath);
    if (audioInfo.exists) {
      await FileSystem.deleteAsync(audioPath, { idempotent: true });
    }
  }
}

/**
 * Delete all cached routine media assets (video/audio/captions) on device.
 */
export async function clearAllRoutineAssets(): Promise<void> {
  const videoDirInfo = await FileSystem.getInfoAsync(VIDEO_DIR);
  if (videoDirInfo.exists) {
    await FileSystem.deleteAsync(VIDEO_DIR, { idempotent: true });
  }

  const audioDirInfo = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (audioDirInfo.exists) {
    await FileSystem.deleteAsync(AUDIO_DIR, { idempotent: true });
  }

  const captionsDirInfo = await FileSystem.getInfoAsync(CAPTIONS_DIR);
  if (captionsDirInfo.exists) {
    await FileSystem.deleteAsync(CAPTIONS_DIR, { idempotent: true });
  }
}

