import { RefObject, useEffect, useState } from 'react';
import { getCaptionTrackSource } from '../services/captionTrack';
import {
  fetchSiteConfig,
  readCachedPosterUrl,
  resolveStorageAssetUrl,
  resolveWelcomePosterUrl,
  resolveWelcomeVideoUrl,
  SiteConfig,
} from '../services/siteConfig';
import { getCachedVideoSource, getCachedImageSource, extractPosterFrame, getPosterFromCache, CachedVideoSource } from '../services/videoCache';

type UseWelcomeVideoOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  fallbackConfig: SiteConfig;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallbackValue), timeoutMs);
    }),
  ]);
}

export function useWelcomeVideo({
  videoRef,
  fallbackConfig,
}: UseWelcomeVideoOptions) {
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(fallbackConfig);
  const [loading, setLoading] = useState(true);
  const [videoSrc, setVideoSrc] = useState('');
  const [captionSrc, setCaptionSrc] = useState('');
  const [videoError, setVideoError] = useState('');
  const [videoFinished, setVideoFinished] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [posterSrc, setPosterSrc] = useState(() => readCachedPosterUrl(fallbackConfig.welcomeVideoUrl));

  useEffect(() => {
    let mounted = true;
    let releaseCachedVideo: (() => void) | undefined;
    let releaseCaptionTrack: (() => void) | undefined;
    let releaseCachedPoster: (() => void) | undefined;

    async function loadConfig() {
      try {
        const config = await withTimeout(fetchSiteConfig(), 4000, fallbackConfig);

        let resolvedVideoUrl = await withTimeout(
          resolveWelcomeVideoUrl(config.welcomeVideoUrl),
          5000,
          ''
        );
        if (!resolvedVideoUrl && config.welcomeVideoUrl !== fallbackConfig.welcomeVideoUrl) {
          resolvedVideoUrl = await withTimeout(
            resolveWelcomeVideoUrl(fallbackConfig.welcomeVideoUrl),
            4000,
            ''
          );
        }

        let resolvedCaptionUrl = await withTimeout(
          resolveStorageAssetUrl(config.welcomeCaptionUrl),
          3000,
          ''
        );
        if (!resolvedCaptionUrl && config.welcomeCaptionUrl !== fallbackConfig.welcomeCaptionUrl) {
          resolvedCaptionUrl = await withTimeout(
            resolveStorageAssetUrl(fallbackConfig.welcomeCaptionUrl),
            2000,
            ''
          );
        }

        // Stable key for canvas-poster cache (strip rotating Firebase token)
        const stableKey = resolvedVideoUrl.indexOf('?alt=media') !== -1
          ? resolvedVideoUrl.substring(0, resolvedVideoUrl.indexOf('?alt=media'))
          : resolvedVideoUrl;

        // Fetch video, captions, and poster URL in parallel.
        // Poster is awaited here so posterSrc is set in the same render as loading→false.
        // This prevents the mobile shimmer from persisting after loading completes.
        const [cachedVideo, captionTrack, cachedPoster] = await Promise.all([
          withTimeout(getCachedVideoSource(resolvedVideoUrl), 5000, { src: resolvedVideoUrl }),
          withTimeout(getCaptionTrackSource(resolvedCaptionUrl), 2000, { src: '' }),
          withTimeout(
            resolveWelcomePosterUrl(config.welcomeVideoUrl)
              .then(url => url ? getCachedImageSource(url) : Promise.resolve({ src: '' } as CachedVideoSource)),
            6000,
            { src: '' } as CachedVideoSource
          ),
        ]);

        // Sync canvas read as fallback for desktop return visits (zero cost if present)
        const posterUrl = cachedPoster.src || getPosterFromCache(stableKey);

        if (mounted) {
          setSiteConfig(config);
          setVideoSrc(cachedVideo.src);
          setPosterSrc(posterUrl);
          setCaptionSrc(captionTrack.src);
          setVideoError('');
          setVideoFinished(false);
          setHasStarted(false);
        }

        // Desktop-only: extract canvas poster for future visits if storage poster is absent
        if (!cachedPoster.src) {
          extractPosterFrame(cachedVideo.src, stableKey).then((dataUrl) => {
            if (mounted && dataUrl) setPosterSrc((prev) => prev || dataUrl);
          }).catch(() => {});
        }

        releaseCachedVideo = cachedVideo.release;
        releaseCaptionTrack = captionTrack.release;
        releaseCachedPoster = cachedPoster.release;
      } catch (error) {
        console.warn('Failed to load site config from Firestore', error);
        if (mounted) {
          setVideoSrc('');
          setCaptionSrc('');
          setPosterSrc('');
          setVideoError('Welcome video failed to load from config.');
          setVideoFinished(true);
          setHasStarted(false);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadConfig();

    return () => {
      mounted = false;
      if (releaseCachedVideo) releaseCachedVideo();
      if (releaseCaptionTrack) releaseCaptionTrack();
      if (releaseCachedPoster) releaseCachedPoster();
    };
  }, [fallbackConfig]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    for (const track of Array.from(videoElement.textTracks)) {
      track.mode = captionSrc ? 'showing' : 'disabled';
    }
  }, [captionSrc, videoRef, videoSrc]);

  async function handleStartVideo() {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    try {
      // iOS Safari is more reliable when playback starts muted, then unmutes.
      videoElement.muted = true;
      await videoElement.play();
      videoElement.muted = false;
      setHasStarted(true);
    } catch (error) {
      try {
        videoElement.muted = false;
        await videoElement.play();
        setHasStarted(true);
      } catch (secondError) {
        console.warn('Manual video playback failed', secondError ?? error);
      }
    }
  }

  function handleVideoEnded() {
    setVideoFinished(true);
  }

  function handleVideoPause() {
    // intentional pause by user — no state change needed beyond what caller tracks
  }

  function handleVideoPlay() {
    setVideoFinished(false);
    setHasStarted(true);
  }

  function handleVideoError() {
    setVideoError('Welcome video is unavailable. Check public_site/config.welcomeVideoUrl.');
    setVideoSrc('');
    setVideoFinished(true);
    setHasStarted(false);
  }

  return {
    siteConfig,
    loading,
    videoSrc,
    posterSrc,
    captionSrc,
    videoError,
    videoFinished,
    hasStarted,
    shouldShowSignup: videoFinished || (!loading && (!videoSrc || !!videoError)),
    handleStartVideo,
    handleVideoEnded,
    handleVideoPlay,
    handleVideoPause,
    handleVideoError,
  };
}