import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDownloadURL, getMetadata, ref } from 'firebase/storage';
import { storage } from './firebase';
import { ensureAudioForRoutine } from './tts';
import { Routine } from '../types';
import { clearAllRoutineAssets, syncRoutineAssets } from './assetSync';

const WELCOME_VIDEO_STORAGE_PATH = 'avatars/default/welcome.mp4';

const WELCOME_DIR = `${FileSystem.documentDirectory}welcome/`;
const WELCOME_VIDEO_PATH = `${WELCOME_DIR}welcome.mp4`;
const MIN_WELCOME_VIDEO_FILE_BYTES = 16 * 1024;
const WELCOME_VIDEO_META_KEY = 'welcome_video_meta_v1';

type WelcomeVideoMetadata = {
  generation?: string;
  etag?: string;
  updated?: string;
  size?: string | number;
};

let isWarmupRunning = false;

type CacheProgressStage = 'idle' | 'downloading-welcome' | 'warming-assets' | 'done';

type CacheStatus = {
  stage: CacheProgressStage;
  total: number;
  ready: number;
};

const status: CacheStatus = {
  stage: 'idle',
  total: 0,
  ready: 0,
};

const listeners = new Set<(next: CacheStatus) => void>();

function emitStatus() {
  listeners.forEach((listener) => listener({ ...status }));
}

async function ensureWelcomeDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(WELCOME_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(WELCOME_DIR, { intermediates: true });
  }
}

async function isValidCachedWelcomeVideo(localPath: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(localPath);
  if (!info.exists) return false;

  const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
  return size >= MIN_WELCOME_VIDEO_FILE_BYTES;
}

async function readStoredWelcomeVideoMeta(): Promise<WelcomeVideoMetadata | null> {
  try {
    const raw = await AsyncStorage.getItem(WELCOME_VIDEO_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WelcomeVideoMetadata;
    return parsed;
  } catch {
    return null;
  }
}

async function writeStoredWelcomeVideoMeta(meta: WelcomeVideoMetadata): Promise<void> {
  try {
    await AsyncStorage.setItem(WELCOME_VIDEO_META_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage write failures; asset can still play.
  }
}

function isSameRemoteVersion(
  localMeta: WelcomeVideoMetadata | null,
  remoteMeta: WelcomeVideoMetadata
): boolean {
  if (!localMeta) return false;

  if (localMeta.generation && remoteMeta.generation) {
    return localMeta.generation === remoteMeta.generation;
  }

  if (localMeta.etag && remoteMeta.etag) {
    return localMeta.etag === remoteMeta.etag;
  }

  if (localMeta.updated && remoteMeta.updated) {
    return localMeta.updated === remoteMeta.updated;
  }

  return false;
}

async function downloadOrRepairWelcomeVideo(remotePath: string, localPath: string): Promise<void> {
  const remoteRef = ref(storage, remotePath);
  const remoteMetaResponse = await getMetadata(remoteRef);

  const remoteMeta: WelcomeVideoMetadata = {
    generation: remoteMetaResponse.generation,
    etag: remoteMetaResponse.md5Hash,
    updated: remoteMetaResponse.updated,
    size: remoteMetaResponse.size,
  };

  const hasValidCachedVideo = await isValidCachedWelcomeVideo(localPath);
  const storedMeta = await readStoredWelcomeVideoMeta();

  const localInfo = await FileSystem.getInfoAsync(localPath);
  const localSize = 'size' in localInfo && typeof localInfo.size === 'number' ? localInfo.size : undefined;
  const remoteSize = typeof remoteMeta.size !== 'undefined' ? Number(remoteMeta.size) : undefined;
  const sizeMatches =
    typeof localSize === 'number' && typeof remoteSize === 'number'
      ? localSize === remoteSize
      : true;

  const remoteUnchanged = isSameRemoteVersion(storedMeta, remoteMeta);
  if (hasValidCachedVideo && remoteUnchanged && sizeMatches) {
    return;
  }

  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  const remoteUrl = await getDownloadURL(remoteRef);
  const downloadResult = await FileSystem.downloadAsync(remoteUrl, localPath);

  const status = (downloadResult as { status?: number }).status;
  if (typeof status === 'number' && status >= 400) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`[WelcomeAssets] download failed (${status}) for ${remoteUrl}`);
  }

  const isValid = await isValidCachedWelcomeVideo(localPath);
  if (!isValid) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`[WelcomeAssets] downloaded video is invalid or too small: ${remoteUrl}`);
  }

  await writeStoredWelcomeVideoMeta(remoteMeta);
}

export async function downloadWelcomeAssets(): Promise<{
  videoPath: string;
}> {
  status.stage = 'downloading-welcome';
  emitStatus();

  await ensureWelcomeDir();
  await downloadOrRepairWelcomeVideo(WELCOME_VIDEO_STORAGE_PATH, WELCOME_VIDEO_PATH);

  status.stage = 'done';
  emitStatus();

  return {
    videoPath: WELCOME_VIDEO_PATH,
  };
}

export function getWelcomeAssetPaths() {
  return {
    videoPath: WELCOME_VIDEO_PATH,
  };
}

export function subscribeAssetCacheStatus(listener: (next: CacheStatus) => void) {
  listeners.add(listener);
  listener({ ...status });
  return () => listeners.delete(listener);
}

export async function preloadRoutineAssetsInBackground(routine: Routine): Promise<void> {
  if (isWarmupRunning) return;
  isWarmupRunning = true;
  status.stage = 'warming-assets';
  status.total = routine.activityStack.flat().length;
  status.ready = 0;
  emitStatus();

  try {
    await ensureAudioForRoutine(routine);
    const result = await syncRoutineAssets(routine);
    status.ready = status.total - result.missingAudioKeys.length;
  } catch {
    status.ready = 0;
  } finally {
    status.stage = 'done';
    emitStatus();
    isWarmupRunning = false;
  }
}

/**
 * Clears all locally cached media and metadata.
 */
export async function clearAllLocalCachedAssets(): Promise<void> {
  await clearAllRoutineAssets();

  const welcomeDirInfo = await FileSystem.getInfoAsync(WELCOME_DIR);
  if (welcomeDirInfo.exists) {
    await FileSystem.deleteAsync(WELCOME_DIR, { idempotent: true });
  }

  await AsyncStorage.removeItem(WELCOME_VIDEO_META_KEY);

  status.stage = 'idle';
  status.total = 0;
  status.ready = 0;
  emitStatus();
}
