import * as FileSystem from 'expo-file-system/legacy';
import { db, storage, ensureAuth } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { Routine, ActivityKey } from '../types';
import { ACTIVITIES } from '../constants/activities';

const VIDEO_DIR = `${FileSystem.documentDirectory}videos/`;
const AUDIO_DIR = `${FileSystem.documentDirectory}audio/`;
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
}

/** Returns the local file path for a video asset */
export function localVideoPath(activityKey: ActivityKey, avatarId: string, withCaptions = false): string {
  const suffix = withCaptions ? '_captions' : '';
  return `${VIDEO_DIR}${avatarId}_${activityKey}${suffix}.mp4`;
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
 * Missing captioned variants are non-fatal — older activities may not have one uploaded yet,
 * in which case playback falls back to the non-caption video.
 */
async function syncVideo(activityKey: ActivityKey, avatarId: string, withCaptions = false): Promise<void> {
  const localPath = localVideoPath(activityKey, avatarId, withCaptions);
  const hasValidCachedVideo = await isValidCachedVideo(localPath);
  if (hasValidCachedVideo) return;

  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  const suffix = withCaptions ? '_captions' : '';
  const remoteStoragePath = `avatars/${avatarId}/${activityKey}${suffix}.mp4`;
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
    // 1. Sync video (required) and captioned variant (best-effort — may not exist for every activity)
    try {
      await syncVideo(activityKey, routine.avatarId);
    } catch (err) {
      console.warn(`[AssetSync] Failed to download video for ${activityKey}:`, err);
    }

    try {
      await syncVideo(activityKey, routine.avatarId, true);
    } catch (err) {
      console.warn(`[AssetSync] Failed to download captioned video for ${activityKey}:`, err);
    }

    // 2. Sync audio
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

    const captionVideoPath = localVideoPath(activityKey, routine.avatarId, true);
    const captionVideoInfo = await FileSystem.getInfoAsync(captionVideoPath);
    if (captionVideoInfo.exists) {
      await FileSystem.deleteAsync(captionVideoPath, { idempotent: true });
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
 * Delete all cached routine media assets (video/audio) on device.
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
}
