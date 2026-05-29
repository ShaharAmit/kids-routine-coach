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

export async function fetchSiteConfig(): Promise<SiteConfig> {
  const ref = doc(db, 'public_site', 'config');
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return DEFAULT_CONFIG;
  }

  const data = snapshot.data() as Record<string, unknown>;
  return {
    welcomeVideoUrl: readString(data.welcomeVideoUrl, DEFAULT_CONFIG.welcomeVideoUrl),
    appStoreUrl: readString(data.appStoreUrl, DEFAULT_CONFIG.appStoreUrl),
    playStoreUrl: readString(data.playStoreUrl, DEFAULT_CONFIG.playStoreUrl),
  };
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
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
