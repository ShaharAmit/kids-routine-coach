const CAPTION_CACHE_NAME = 'kidocoach-caption-cache-v1';

export type CaptionTrackSource = {
  src: string;
  release?: () => void;
};

function canUseCacheApi(): boolean {
  return typeof window !== 'undefined' && typeof window.caches !== 'undefined';
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function convertSrtToVtt(srt: string): string {
  const normalized = normalizeLineEndings(srt).trim();
  if (!normalized) {
    return 'WEBVTT\n\n';
  }

  const convertedBody = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );

  return `WEBVTT\n\n${convertedBody}\n`;
}

export async function getCaptionTrackSource(url: string): Promise<CaptionTrackSource> {
  if (!url) {
    return { src: '' };
  }

  try {
    const request = new Request(url, { mode: 'cors', credentials: 'omit' });
    let response: Response;

    if (canUseCacheApi()) {
      const cache = await window.caches.open(CAPTION_CACHE_NAME);
      response = (await cache.match(request)) ?? (await fetch(request));
      if (response.ok) {
        await cache.put(request, response.clone());
      }
    } else {
      response = await fetch(request);
    }

    if (!response.ok) {
      return { src: '' };
    }

    const srtText = await response.text();
    const vttText = convertSrtToVtt(srtText);
    const blob = new Blob([vttText], { type: 'text/vtt' });
    const objectUrl = URL.createObjectURL(blob);

    return {
      src: objectUrl,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    return { src: '' };
  }
}