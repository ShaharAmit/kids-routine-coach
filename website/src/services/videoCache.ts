const VIDEO_CACHE_NAME = 'kidocoach-video-cache-v1';

export type CachedVideoSource = {
  src: string;
  release?: () => void;
};

function canUseCacheApi(): boolean {
  return typeof window !== 'undefined' && typeof window.caches !== 'undefined';
}

/**
 * Firebase Storage download URLs contain a rotating ?alt=media&token=... suffix.
 * Strip it so the cache key stays stable across token refreshes.
 */
function getStableCacheKey(url: string): string {
  const tokenIdx = url.indexOf('?alt=media');
  if (tokenIdx !== -1) return url.substring(0, tokenIdx);
  // Also strip any generic query string for other CDN URLs
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) return url.substring(0, qIdx);
  return url;
}

/**
 * Fetch an image URL into the Cache API and return a blob URL.
 * Reuses the same cache bucket as video so both are pre-warmed in parallel.
 * Falls back to the raw URL on any error so the <img> can still load.
 */
export async function getCachedImageSource(url: string): Promise<CachedVideoSource> {
  if (!url) return { src: '' };
  if (!canUseCacheApi()) return { src: url };

  try {
    const cache = await window.caches.open(VIDEO_CACHE_NAME);
    const stableKey = getStableCacheKey(url);
    const cacheRequest = new Request(stableKey);

    let response = await cache.match(cacheRequest);
    if (!response) {
      response = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
      if (response.ok) await cache.put(cacheRequest, response.clone());
    }

    if (!response || !response.ok) return { src: url };

    const blob = await response.blob();
    if (!blob || blob.size === 0) return { src: url };

    const objectUrl = URL.createObjectURL(blob);
    return { src: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
  } catch {
    return { src: url };
  }
}

export async function getCachedVideoSource(url: string): Promise<CachedVideoSource> {
  if (!url) {
    return { src: '' };
  }

  if (!canUseCacheApi()) {
    return { src: url };
  }

  try {
    const cache = await window.caches.open(VIDEO_CACHE_NAME);
    const stableKey = getStableCacheKey(url);
    // Use stable key for lookup/storage, real URL for the actual fetch
    const cacheRequest = new Request(stableKey);
    const fetchRequest = new Request(url, { mode: 'cors', credentials: 'omit' });

    let response = await cache.match(cacheRequest);
    if (!response) {
      response = await fetch(fetchRequest);
      if (response.ok) {
        await cache.put(cacheRequest, response.clone());
      }
    }

    if (!response || !response.ok) {
      return { src: url };
    }

    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      return { src: url };
    }

    const objectUrl = URL.createObjectURL(blob);
    return {
      src: objectUrl,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    return { src: url };
  }
}

const POSTER_LS_PREFIX = 'kidocoach:poster:v1:';

function getPosterLsKey(stableVideoUrl: string): string {
  return POSTER_LS_PREFIX + stableVideoUrl;
}

/**
 * Synchronous localStorage check for a cached poster frame.
 * Call this before rendering to avoid a second render flash.
 */
export function getPosterFromCache(stableVideoUrl: string): string {
  if (typeof window === 'undefined') return '';
  const lsKey = POSTER_LS_PREFIX + stableVideoUrl;
  try {
    const cached = window.localStorage.getItem(lsKey);
    if (cached && cached.startsWith('data:image/')) return cached;
  } catch { /* ignore */ }
  return '';
}

/**
 * Extract a JPEG first-frame from a video src (blob or https URL).
 * Result is cached in localStorage keyed by the stable video URL.
 * Returns empty string on failure — caller should handle gracefully.
 */
export function extractPosterFrame(videoSrc: string, stableVideoUrl: string): Promise<string> {
  if (!videoSrc || typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve('');
  }

  const lsKey = getPosterLsKey(stableVideoUrl);
  try {
    const cached = window.localStorage.getItem(lsKey);
    if (cached && cached.startsWith('data:image/')) return Promise.resolve(cached);
  } catch { /* ignore */ }

  return new Promise<string>((resolve) => {
    let settled = false;

    function finish(result: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
      resolve(result);
    }

    const timer = setTimeout(() => finish(''), 5000);

    const v = document.createElement('video');
    v.muted = true;
    v.setAttribute('playsinline', '');
    v.preload = 'metadata';

    v.addEventListener('loadeddata', () => {
      // Seek slightly past 0 — iOS won't paint frame 0 without seeking
      v.currentTime = 0.05;
    }, { once: true });

    v.addEventListener('seeked', () => {
      try {
        const W = 240;
        const H = v.videoWidth > 0 ? Math.round(W * v.videoHeight / v.videoWidth) : 426;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) { finish(''); return; }
        ctx.drawImage(v, 0, 0, W, H);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        // A real frame compresses to >2 KB; blank/black frames are much smaller
        if (dataUrl.length > 3000) {
          try { window.localStorage.setItem(lsKey, dataUrl); } catch { /* quota */ }
          finish(dataUrl);
        } else {
          finish('');
        }
      } catch {
        finish('');
      }
    }, { once: true });

    v.addEventListener('error', () => finish(''), { once: true });
    v.src = videoSrc;
  });
}
