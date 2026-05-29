const VIDEO_CACHE_NAME = 'kidocoach-video-cache-v1';

export type CachedVideoSource = {
  src: string;
  release?: () => void;
};

function canUseCacheApi(): boolean {
  return typeof window !== 'undefined' && typeof window.caches !== 'undefined';
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
    const request = new Request(url, { mode: 'cors', credentials: 'omit' });

    let response = await cache.match(request);
    if (!response) {
      response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
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
