import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { db, storage } from './firebase';

export type SiteConfig = {
  welcomeVideoUrl: string;
  appStoreUrl: string;
  playStoreUrl: string;
};

const DEFAULT_CONFIG: SiteConfig = {
  welcomeVideoUrl: 'avatars/default/welcome.mp4',
  appStoreUrl: 'https://apps.apple.com/',
  playStoreUrl: 'https://play.google.com/store',
};

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

const CONFIG_CACHE_KEY = 'kidocoach:siteConfig:v2';
const CONFIG_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function readCachedConfig(): SiteConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; config: SiteConfig };
    if (Date.now() - parsed.ts > CONFIG_TTL_MS) return null;
    return parsed.config;
  } catch {
    return null;
  }
}

function writeCachedConfig(config: SiteConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ ts: Date.now(), config }));
  } catch {
    // ignore quota/private-mode errors
  }
}

export async function fetchSiteConfig(): Promise<SiteConfig> {
  const cached = readCachedConfig();
  if (cached) return cached;

  const docRef = doc(db, 'public_site', 'config');
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) {
    return DEFAULT_CONFIG;
  }

  const data = snapshot.data() as Record<string, unknown>;
  const config: SiteConfig = {
    welcomeVideoUrl: readString(data.welcomeVideoUrl, DEFAULT_CONFIG.welcomeVideoUrl),
    appStoreUrl: readString(data.appStoreUrl, DEFAULT_CONFIG.appStoreUrl),
    playStoreUrl: readString(data.playStoreUrl, DEFAULT_CONFIG.playStoreUrl),
  };
  writeCachedConfig(config);
  return config;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isLocalAssetUrl(value: string): boolean {
  return value.startsWith('/');
}

function normalizeStoragePath(value: string): string {
  return value.replace(/^gs:\/\/[^/]+\//, '').replace(/^\/+/, '');
}

function getResolvedVideoUrlCacheKey(objectPath: string): string {
  return `kidocoach:welcomeVideoDownloadUrl:${objectPath}`;
}

function readCachedResolvedVideoUrl(objectPath: string): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage.getItem(getResolvedVideoUrlCacheKey(objectPath));
    return raw && raw.trim().length > 0 ? raw : '';
  } catch {
    return '';
  }
}

function writeCachedResolvedVideoUrl(objectPath: string, resolvedUrl: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getResolvedVideoUrlCacheKey(objectPath), resolvedUrl);
  } catch {
    // ignore storage quota/private mode errors
  }
}

export async function resolveWelcomeVideoUrl(rawValue: string): Promise<string> {
  const value = rawValue.trim();
  if (!value) return '';

  if (isHttpUrl(value)) {
    return value;
  }

  const objectPath = normalizeStoragePath(value);
  if (!objectPath) {
    return '';
  }

  const cachedResolvedUrl = readCachedResolvedVideoUrl(objectPath);
  if (cachedResolvedUrl) {
    return cachedResolvedUrl;
  }

  try {
    const resolvedUrl = await getDownloadURL(ref(storage, objectPath));
    writeCachedResolvedVideoUrl(objectPath, resolvedUrl);
    return resolvedUrl;
  } catch {
    return '';
  }
}

export async function resolveStorageAssetUrl(rawValue: string): Promise<string> {
  const value = rawValue.trim();
  if (!value) return '';

  if (isHttpUrl(value)) {
    return value;
  }

  if (isLocalAssetUrl(value)) {
    return value;
  }

  const objectPath = normalizeStoragePath(value);
  if (!objectPath) {
    return '';
  }

  try {
    return await getDownloadURL(ref(storage, objectPath));
  } catch {
    return '';
  }
}

// ── Poster URL (first-frame preview image alongside the video in Storage) ──

function derivePosterObjectPath(videoRawValue: string): string {
  const value = videoRawValue.trim();
  if (!value || isHttpUrl(value) || isLocalAssetUrl(value)) return '';
  const objectPath = normalizeStoragePath(value);
  return objectPath.replace(/\.[^./?#]+$/, '.jpg');
}

function getPosterUrlCacheKey(objectPath: string): string {
  return `kidocoach:welcomePosterDownloadUrl:${objectPath}`;
}

/** Synchronous — safe to call before rendering to avoid a second-render flash. */
export function readCachedPosterUrl(videoRawValue: string): string {
  if (typeof window === 'undefined') return '';
  const objectPath = derivePosterObjectPath(videoRawValue);
  if (!objectPath) return '';
  try {
    const raw = window.localStorage.getItem(getPosterUrlCacheKey(objectPath));
    return raw && raw.trim().length > 0 ? raw : '';
  } catch {
    return '';
  }
}

/**
 * Resolves the poster image URL for the welcome video.
 * Derives the Storage path by replacing the video extension with `.jpg`
 * (e.g. avatars/default/welcome.mp4 → avatars/default/welcome.jpg).
 * Returns '' if the file does not exist — caller must handle gracefully.
 */
export async function resolveWelcomePosterUrl(videoRawValue: string): Promise<string> {
  const objectPath = derivePosterObjectPath(videoRawValue);
  if (!objectPath) return '';

  const cacheKey = getPosterUrlCacheKey(objectPath);
  try {
    const cached = typeof window !== 'undefined'
      ? window.localStorage.getItem(cacheKey)
      : null;
    if (cached && cached.trim().length > 0) return cached;
  } catch { /* ignore */ }

  try {
    const url = await getDownloadURL(ref(storage, objectPath));
    try { window.localStorage.setItem(cacheKey, url); } catch { /* quota */ }
    return url;
  } catch {
    // File not found or network error — not an error condition
    return '';
  }
}
