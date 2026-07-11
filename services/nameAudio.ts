import * as FileSystem from 'expo-file-system/legacy';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { functions, db, ensureAuth } from './firebase';
import { localAudioPath } from './assetSync';

interface GenerateNameAudioRequest {
  childName: string;
}

interface GenerateNameAudioResponse {
  audioUrl: string | null;
  cacheKey: string;
  status: 'ready' | 'generating';
}

const MIN_NAME_AUDIO_BYTES = 1024;

const AUDIO_DIR = `${FileSystem.documentDirectory}audio/`;

/** Ensure the audio cache directory exists (it is removed by a full cache clear). */
async function ensureAudioDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  }
}

/**
 * Firestore/Storage cache key for the reusable per-child name clip. Must mirror the
 * `buildNameAudioKey` normalizer in functions/src/index.ts.
 */
export function buildNameAudioKey(childName: string): string {
  const normalized = childName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `name_${normalized}_encouraging`;
}

/** Local file path for a child's name-audio clip. */
export function localNameAudioPath(childName: string): string {
  return localAudioPath(buildNameAudioKey(childName));
}

/**
 * Client-side presence check only — NO WAV header parsing (validation happens in the lambda).
 * A non-empty file is treated as present.
 */
async function nameAudioFileExists(localPath: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(localPath);
  if (!info.exists) return false;
  const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
  return size >= MIN_NAME_AUDIO_BYTES;
}

async function downloadNameAudio(localPath: string, audioUrl: string): Promise<boolean> {
  await ensureAudioDir();

  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  const downloadResult = await FileSystem.downloadAsync(audioUrl, localPath);
  const status = (downloadResult as { status?: number }).status;
  if (typeof status === 'number' && status >= 400) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    return false;
  }

  const ok = await nameAudioFileExists(localPath);
  if (!ok) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }
  return ok;
}

/**
 * Ensure the child's name-audio clip is present locally.
 * 1. If already downloaded -> return its path.
 * 2. Else read audio_cache/{cacheKey}: if `ready` download it.
 * 3. Else call the `generateNameAudio` Cloud Function, then download when ready.
 *
 * Best-effort: returns the local path on success or `null` if unavailable. Never throws.
 */
export async function ensureNameAudioReady(childName: string): Promise<string | null> {
  const name = (childName ?? '').trim();
  if (!name) return null;

  const cacheKey = buildNameAudioKey(name);
  const localPath = localAudioPath(cacheKey);

  try {
    if (await nameAudioFileExists(localPath)) {
      return localPath;
    }

    await ensureAuth();

    // Prefer an already-generated global clip.
    const cacheRef = doc(db, 'audio_cache', cacheKey);
    const cached = await getDoc(cacheRef);
    const cachedData = cached.data();
    if (cached.exists() && cachedData?.status === 'ready' && cachedData?.audioUrl) {
      const ok = await downloadNameAudio(localPath, cachedData.audioUrl as string);
      return ok ? localPath : null;
    }

    // Otherwise ask the lambda to generate (existence-guarded server-side).
    const generateNameAudio = httpsCallable<GenerateNameAudioRequest, GenerateNameAudioResponse>(
      functions,
      'generateNameAudio'
    );
    const result = await generateNameAudio({ childName: name });
    const { audioUrl, status } = result.data;

    if (status === 'ready' && audioUrl) {
      const ok = await downloadNameAudio(localPath, audioUrl);
      return ok ? localPath : null;
    }

    // status === 'generating' — another request is producing it; try again next entry point.
    return null;
  } catch (err) {
    console.warn(`[NameAudio] Failed to ensure name audio for "${name}":`, err);
    return null;
  }
}

/** Delete a child's cached name-audio clip. */
export async function clearNameAudioCache(childName: string): Promise<void> {
  const localPath = localNameAudioPath(childName);
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }
}

/**
 * Return the local name-audio path only if it is already present on device.
 * Pure existence check — never triggers generation or download. Used by the player.
 */
export async function getReadyNameAudioPath(childName: string): Promise<string | null> {
  const name = (childName ?? '').trim();
  if (!name) return null;
  const localPath = localNameAudioPath(name);
  return (await nameAudioFileExists(localPath)) ? localPath : null;
}
