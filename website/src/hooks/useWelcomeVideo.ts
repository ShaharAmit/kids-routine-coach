import { RefObject, useEffect, useState } from 'react';
import { getCaptionTrackSource } from '../services/captionTrack';
import {
  fetchSiteConfig,
  resolveStorageAssetUrl,
  resolveWelcomeVideoUrl,
  SiteConfig,
} from '../services/siteConfig';
import { getCachedVideoSource } from '../services/videoCache';

type UseWelcomeVideoOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  fallbackConfig: SiteConfig;
};

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

  useEffect(() => {
    let mounted = true;
    let releaseCachedVideo: (() => void) | undefined;
    let releaseCaptionTrack: (() => void) | undefined;

    async function loadConfig() {
      try {
        const config = await fetchSiteConfig();
        const resolvedVideoUrl = await resolveWelcomeVideoUrl(config.welcomeVideoUrl);
        const resolvedCaptionUrl = await resolveStorageAssetUrl(config.welcomeCaptionUrl);
        const cachedVideo = await getCachedVideoSource(resolvedVideoUrl);
        const captionTrack = await getCaptionTrackSource(resolvedCaptionUrl);

        if (mounted) {
          setSiteConfig(config);
          setVideoSrc(cachedVideo.src);
          setCaptionSrc(captionTrack.src);
          setVideoError('');
          setVideoFinished(false);
          setHasStarted(false);
        }

        releaseCachedVideo = cachedVideo.release;
        releaseCaptionTrack = captionTrack.release;
      } catch (error) {
        console.warn('Failed to load site config from Firestore', error);
        if (mounted) {
          setVideoSrc('');
          setCaptionSrc('');
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
      if (releaseCachedVideo) {
        releaseCachedVideo();
      }
      if (releaseCaptionTrack) {
        releaseCaptionTrack();
      }
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
      videoElement.muted = false;
      await videoElement.play();
      setHasStarted(true);
    } catch (error) {
      console.warn('Manual video playback failed', error);
    }
  }

  function handleVideoEnded() {
    setVideoFinished(true);
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
    captionSrc,
    videoError,
    videoFinished,
    hasStarted,
    shouldShowSignup: videoFinished || (!loading && (!videoSrc || !!videoError)),
    handleStartVideo,
    handleVideoEnded,
    handleVideoPlay,
    handleVideoError,
  };
}