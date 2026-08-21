import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, storage, ensureAuth } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, getMetadata, ref } from 'firebase/storage';
import { Routine, ActivityKey, CaptionCue } from '../types';
import { ACTIVITIES } from '../constants/activities';
import { TTS_AUDIO_ENABLED } from '../constants/featureFlags';

const VIDEO_DIR = `${FileSystem.documentDirectory}videos/`;
const AUDIO_DIR = `${FileSystem.documentDirectory}audio/`;
const CAPTIONS_DIR = `${FileSystem.documentDirectory}captions/`;
const MIN_VIDEO_FILE_BYTES = 16 * 1024;
const MIN_AUDIO_FILE_BYTES = 4 * 1024;
const VIDEO_GENERATION_KEY_PREFIX = 'video_generation_v1_';

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

/**
 * Firebase Storage assigns a new `generation` id every time an object at the same path is
 * overwritten. We persist the generation we last downloaded per remote path, so that
 * re-uploading a fixed/updated video (same filename, e.g. after a proportions fix) is detected
 * and forces a fresh download — without this, a "valid-looking" (right-sized) but stale local
 * file would never be replaced, since `isValidCachedVideo` only checks size, not freshness.
 */
async function getStoredVideoGeneration(remoteStoragePath: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(VIDEO_GENERATION_KEY_PREFIX + remoteStoragePath);
  } catch {
    return null;
  }
}

async function setStoredVideoGeneration(remoteStoragePath: string, generation: string): Promise<void> {
  try {
    await AsyncStorage.setItem(VIDEO_GENERATION_KEY_PREFIX + remoteStoragePath, generation);
  } catch {
    // Best-effort — worst case we just re-check/re-download again next time.
  }
}

/**
 * Returns whether the locally cached copy of a remote video is still current. If the remote
 * object can't be reached (offline), we assume "unchanged" so a valid local file keeps working
 * offline instead of being needlessly invalidated.
 */
async function isRemoteVideoUnchanged(remoteStoragePath: string): Promise<{ unchanged: boolean; generation?: string }> {
  try {
    const meta = await getMetadata(ref(storage, remoteStoragePath));
    const generation = meta.generation;
    if (!generation) return { unchanged: true };
    const stored = await getStoredVideoGeneration(remoteStoragePath);
    return { unchanged: stored === generation, generation };
  } catch {
    return { unchanged: true };
  }
}


/** Returns the local file path for a video asset (Part 2 / main) */
export function localVideoPath(activityKey: ActivityKey | string, avatarId: string): string {
  const safeActivity = (activityKey || 'activity').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'activity';
  const safeAvatar = (avatarId || 'becky').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'becky';
  return `${VIDEO_DIR}${safeAvatar}_${safeActivity}.mp4`;
}

/** Returns the local file path for Part 1 video */
export function localPart1VideoPath(activityKey: ActivityKey | string, avatarId: string): string {
  const safeActivity = (activityKey || 'activity').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'activity';
  const safeAvatar = (avatarId || 'becky').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'becky';
  return `${VIDEO_DIR}${safeAvatar}_${safeActivity}_p1.mp4`;
}

export async function isValidCachedVideo(localPath: string): Promise<boolean> {
  if (!localPath) return false;
  try {
    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists) return false;

    // A tiny file is typically an HTML error page or partial download, not a playable MP4.
    const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
    return size >= MIN_VIDEO_FILE_BYTES;
  } catch {
    return false;
  }
}

/** Returns the local file path for a TTS audio file */
export function localAudioPath(cacheKey: string): string {
  const safeKey = (cacheKey || 'cache').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'cache';
  return `${AUDIO_DIR}${safeKey}.wav`;
}

/** Returns the local file path for a caption cue JSON file */
export function localCaptionsPath(activityKey: ActivityKey | string, avatarId: string): string {
  const safeActivity = (activityKey || 'activity').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'activity';
  const safeAvatar = (avatarId || 'becky').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'becky';
  return `${CAPTIONS_DIR}${safeAvatar}_${safeActivity}.json`;
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
 * Download a single Part 1 video file if not already cached locally, or if the remote file
 * was replaced since the last download (detected via Storage `generation`).
 */
async function syncPart1Video(activityKey: ActivityKey | string, avatarId: string): Promise<void> {
  const localPath = localPart1VideoPath(activityKey, avatarId);
  const remoteStoragePath = `avatars/${avatarId}/${activityKey}_p1.mp4`;

  const hasValidCachedVideo = await isValidCachedVideo(localPath);
  const { unchanged, generation } = await isRemoteVideoUnchanged(remoteStoragePath);
  if (hasValidCachedVideo && unchanged) return;

  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  try {
    const remoteUrl = await getDownloadURL(ref(storage, remoteStoragePath));
    const downloadResult = await FileSystem.downloadAsync(remoteUrl, localPath);
    const status = (downloadResult as { status?: number }).status;
    if (typeof status === 'number' && status >= 400) {
      await FileSystem.deleteAsync(localPath, { idempotent: true });
      return;
    }
    if (generation && (await isValidCachedVideo(localPath))) {
      await setStoredVideoGeneration(remoteStoragePath, generation);
    }
  } catch (err) {
    console.warn(`[AssetSync] Part 1 video not available for ${activityKey}:`, err);
  }
}
async function syncVideo(activityKey: ActivityKey, avatarId: string): Promise<void> {
  const localPath = localVideoPath(activityKey, avatarId);
  const remoteStoragePath = `avatars/${avatarId}/${activityKey}.mp4`;

  const hasValidCachedVideo = await isValidCachedVideo(localPath);
  const { unchanged, generation } = await isRemoteVideoUnchanged(remoteStoragePath);
  if (hasValidCachedVideo && unchanged) return;

  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

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

  if (generation) {
    await setStoredVideoGeneration(remoteStoragePath, generation);
  }
}

/**
 * On-demand, single-activity readiness check + repair. Used defensively by the player right
 * before a Part 1 → Part 2 transition (or on step init): if a video is missing/invalid on
 * device — e.g. it failed to download during preload, or was replaced on the server after the
 * routine was already cached — this re-attempts the download once and reports final readiness,
 * instead of the player silently freezing on whatever it already has loaded.
 */
export async function ensureActivityVideoReady(
  activityKey: ActivityKey | string,
  avatarId: string
): Promise<{ p1Ready: boolean; p2Ready: boolean }> {
  await ensureDirs();
  try {
    await ensureAuth();
  } catch {
    // Offline / auth failure — fall through and report whatever is already on disk.
  }

  await Promise.allSettled([
    syncPart1Video(activityKey, avatarId),
    syncVideo(activityKey as ActivityKey, avatarId),
  ]);

  const [p1Ready, p2Ready] = await Promise.all([
    isValidCachedVideo(localPart1VideoPath(activityKey, avatarId)),
    isValidCachedVideo(localVideoPath(activityKey, avatarId)),
  ]);
  return { p1Ready, p2Ready };
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

  const localPath = localCaptionsPath(activityKey, avatarId);
  const existing = await FileSystem.getInfoAsync(localPath);
  const hasLocal = existing.exists && 'size' in existing && typeof existing.size === 'number' && existing.size > 0;

  if (!hasLocal) {
    try {
      await ensureAuth();
      await syncCaptions(activityKey, avatarId);
    } catch (err) {
      console.warn(`[AssetSync] No captions available for ${activityKey}:`, err);
      return null;
    }
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

  const missingAudioKeys: string[] = [];
  const rawKeys = routine.activityStack.flat();
  const activityKeys = Array.from(new Set(rawKeys));

  let hasAuthenticated = false;
  const lazyEnsureAuth = async () => {
    if (!hasAuthenticated) {
      await ensureAuth();
      hasAuthenticated = true;
    }
  };

  const syncActivities = activityKeys.map(async (activityKey) => {
    // 1. Sync videos (Part 1 greeting + Part 2 activity). Always call through to
    // syncPart1Video/syncVideo — they internally short-circuit against a Storage
    // `generation` check, so a merely size-valid-but-stale local file (e.g. after the
    // source video was replaced on the server) still gets refreshed.
    try {
      await lazyEnsureAuth();
      await Promise.allSettled([
        syncPart1Video(activityKey, routine.avatarId),
        syncVideo(activityKey, routine.avatarId),
      ]);
    } catch (err) {
        console.warn(`[AssetSync] Failed to download video for ${activityKey}:`, err);
    }

    // 2. Sync caption cues - check local cache first
    const captionPath = localCaptionsPath(activityKey, routine.avatarId);
    const captionInfo = await FileSystem.getInfoAsync(captionPath);
    const hasCaptions = captionInfo.exists && 'size' in captionInfo && typeof captionInfo.size === 'number' && captionInfo.size > 0;

    if (!hasCaptions) {
      try {
        await lazyEnsureAuth();
        await syncCaptions(activityKey, routine.avatarId);
      } catch (err) {
        // Captions are optional / best-effort
      }
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
        await lazyEnsureAuth();
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

  await Promise.allSettled(syncActivities);
  return { missingAudioKeys };
}

/**
 * Check whether all assets for a routine are available locally.
 */
export async function areAssetsReady(routine: Routine): Promise<boolean> {
  const rawKeys = routine.activityStack.flat();
  const activityKeys = Array.from(new Set(rawKeys)).filter(
    (k) => typeof k === 'string' && k.length > 0 && Boolean(ACTIVITIES[k as ActivityKey])
  );
  if (activityKeys.length === 0) return true;

  for (const activityKey of activityKeys) {
    const videoReady = await isValidCachedVideo(localVideoPath(activityKey, routine.avatarId));
    if (!videoReady) return false;
  }
  return true;
}

/**
 * Delete all cached assets for a routine (e.g. when routine is deleted).
 */
export async function clearRoutineAssets(routine: Routine): Promise<void> {
  for (const activityKey of routine.activityStack.flat()) {
    const p1VideoPath = localPart1VideoPath(activityKey, routine.avatarId);
    const p1VideoInfo = await FileSystem.getInfoAsync(p1VideoPath);
    if (p1VideoInfo.exists) {
      await FileSystem.deleteAsync(p1VideoPath, { idempotent: true });
    }

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

  // Drop the remote-generation markers too. Without this, a cleared-but-remembered video is
  // re-downloaded and then immediately considered "current" against a stale generation value,
  // which defeats the point of a manual cache clear.
  try {
    const keys = await AsyncStorage.getAllKeys();
    const generationKeys = keys.filter((key) => key.startsWith(VIDEO_GENERATION_KEY_PREFIX));
    await Promise.all(generationKeys.map((key) => AsyncStorage.removeItem(key)));
  } catch {
    // Best-effort — a stale marker only costs one extra metadata check.
  }
}

