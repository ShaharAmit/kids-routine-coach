import React, { useEffect, useCallback, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, ScrollView } from 'react-native';
import { VideoView, useVideoPlayer, VideoSize } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { ActivityStep, CaptionCue } from '../types';
import { ACTIVITIES } from '../constants/activities';
import { TTS_AUDIO_ENABLED } from '../constants/featureFlags';
import { localVideoPath, localAudioPath, buildAudioCacheKey, ensureCaptionsData } from '../services/assetSync';
import { getReadyNameAudioPath, ensureNameAudioReady } from '../services/nameAudio';
import { colors, fs, ms, s, vs } from '../theme';

const NAME_CUE_PATTERN = /\{\{\s*name\s*\}\}/i;

interface ActivityPlayerProps {
  activityStep: ActivityStep;
  childName: string;
  avatarId: string;
  stepNumber: number;
  totalSteps: number;
  showCaptions?: boolean;
  onComplete: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CONTAINER_WIDTH = SCREEN_WIDTH * 0.8;
const MAX_CONTAINER_HEIGHT = SCREEN_HEIGHT * 0.55;
// All avatar clips are currently recorded in 9:16 portrait; used until the real size loads.
const DEFAULT_ASPECT_RATIO = 9 / 16;

function clampContainerHeight(aspectRatio: number): number {
  const idealHeight = CONTAINER_WIDTH / aspectRatio;
  return Math.min(idealHeight, MAX_CONTAINER_HEIGHT);
}

export default function ActivityPlayer({
  activityStep,
  childName,
  avatarId,
  stepNumber,
  totalSteps,
  showCaptions = false,
  onComplete,
}: ActivityPlayerProps) {
  const [activityIndex, setActivityIndex] = useState(0);
  const [videoEnded, setVideoEnded] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [captionCues, setCaptionCues] = useState<CaptionCue[] | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [nameAudioUri, setNameAudioUri] = useState<string | null>(null);

  const currentActivityKey = activityStep[activityIndex];
  const activity = ACTIVITIES[currentActivityKey];

  const videoUri = localVideoPath(currentActivityKey, avatarId);

  // Load timed caption cues for this activity ALWAYS (independent of the subtitles toggle).
  // The cues drive both the optional visual caption bar AND the name-audio overlay timing, so
  // name audio must work whether subtitles are OFF or ON. `showCaptions` only gates the visual.
  useEffect(() => {
    let cancelled = false;
    setCaptionCues(null);

    ensureCaptionsData(currentActivityKey, avatarId).then((cues) => {
      if (!cancelled) setCaptionCues(cues);
    });

    return () => {
      cancelled = true;
    };
  }, [currentActivityKey, avatarId]);

  // Resolve the child's name-audio clip. Fast path: use it if already cached locally. Otherwise
  // self-heal by downloading it (e.g. after the parent cleared cached media) so the overlay works
  // without waiting for the next cold start or questionnaire save.
  useEffect(() => {
    let cancelled = false;

    getReadyNameAudioPath(childName).then((uri) => {
      if (cancelled) return;
      if (uri) {
        setNameAudioUri(uri);
        return;
      }
      ensureNameAudioReady(childName).then((downloadedUri) => {
        if (!cancelled) setNameAudioUri(downloadedUri);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [childName]);

  useEffect(() => {
    setAspectRatio(DEFAULT_ASPECT_RATIO);
  }, [currentActivityKey]);

  const activeCaption = captionCues?.find((cue) => currentTime >= cue.start && currentTime < cue.end) ?? null;
  const activeCaptionText = activeCaption ? activeCaption.text.replace(/\{\{\s*name\s*\}\}/gi, childName) : null;

  const cacheKey = buildAudioCacheKey(childName, currentActivityKey, avatarId);
  // Personalized TTS narration is currently disabled — the avatar videos already carry their own
  // baked-in audio track, so we don't load a separate overlay track (see featureFlags.ts).
  const audioUri = TTS_AUDIO_ENABLED ? localAudioPath(cacheKey) : null;

  const videoPlayer = useVideoPlayer(videoUri, (p: ReturnType<typeof useVideoPlayer>) => {
    p.loop = false;
    p.muted = false; // avatar videos carry their own narration audio
    p.timeUpdateEventInterval = 0.2; // needed for smoothly synced caption cues
    p.play();
  });

  // useAudioPlayer auto-manages lifecycle; component remounts per step via key prop
  const audioPlayer = useAudioPlayer(audioUri, { updateInterval: 250 });
  const audioStatus = useAudioPlayerStatus(audioPlayer);

  // Personalized name clip overlaid during {{name}} cue windows (may be null if not cached yet).
  const nameAudioPlayer = useAudioPlayer(nameAudioUri, { updateInterval: 250 });
  const nameCueIndexRef = useRef<number | null>(null);

  // Configure audio session once for consistent playback in silent mode.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch((err) =>
      console.warn('[ActivityPlayer] Failed to set audio mode:', err)
    );

    const videoEndSub = videoPlayer.addListener('playToEnd', () => {
      setVideoEnded(true);
      if (TTS_AUDIO_ENABLED) audioPlayer.pause();
    });

    const trackChangeSub = videoPlayer.addListener('videoTrackChange', ({ videoTrack }) => {
      const size = videoTrack?.size as VideoSize | undefined;
      if (size && size.width > 0 && size.height > 0) {
        setAspectRatio(size.width / size.height);
      }
    });

    const timeUpdateSub = videoPlayer.addListener('timeUpdate', ({ currentTime: time }) => {
      setCurrentTime(time);
    });

    return () => {
      videoEndSub.remove();
      trackChangeSub.remove();
      timeUpdateSub.remove();

      // On fast screen unmounts, native media objects can already be released.
      try {
        if (TTS_AUDIO_ENABLED) audioPlayer.pause();
      } catch {
        // no-op
      }

      try {
        videoPlayer.pause();
      } catch {
        // no-op
      }
    };
  }, [audioPlayer, videoPlayer]);

  // Start TTS overlay playback only after the source is loaded (no-op while disabled).
  useEffect(() => {
    if (!TTS_AUDIO_ENABLED) return;
    if (!audioStatus.isLoaded || audioStatus.playing) return;

    audioPlayer.loop = false;
    audioPlayer.muted = false;
    audioPlayer.volume = 1;
    audioPlayer.play();
  }, [audioPlayer, audioStatus.isLoaded, audioStatus.playing]);

  // Reset the name-overlay state whenever the active activity changes (multi-activity steps).
  useEffect(() => {
    nameCueIndexRef.current = null;
    try {
      videoPlayer.muted = false;
    } catch {
      // no-op
    }
  }, [currentActivityKey, videoPlayer]);

  // Overlay the personalized name clip during {{name}} cue windows. Works whether subtitles are
  // ON or OFF — driven purely by cue timings, not the visual caption bar. During a name cue we
  // mute the video's baked-in (mis-recorded) name and play the child's real name; we unmute once
  // the cue window ends. Name-only cues swap cleanly; name-in-sentence cues go silent around it.
  useEffect(() => {
    if (!nameAudioUri || !captionCues) return;

    const idx = captionCues.findIndex(
      (cue) => currentTime >= cue.start && currentTime < cue.end && NAME_CUE_PATTERN.test(cue.text)
    );

    if (idx !== -1 && nameCueIndexRef.current !== idx) {
      nameCueIndexRef.current = idx;
      try {
        videoPlayer.muted = true;
        nameAudioPlayer.seekTo(0);
        nameAudioPlayer.play();
      } catch {
        // no-op
      }
    } else if (idx === -1 && nameCueIndexRef.current !== null) {
      nameCueIndexRef.current = null;
      try {
        videoPlayer.muted = false;
      } catch {
        // no-op
      }
    }
  }, [currentTime, captionCues, nameAudioUri, nameAudioPlayer, videoPlayer]);

  const handleRetryVideo = useCallback(async () => {
    setVideoEnded(false);
    nameCueIndexRef.current = null;
    try {
      videoPlayer.muted = false;
    } catch {
      // no-op
    }
    videoPlayer.replay();

    if (TTS_AUDIO_ENABLED && audioStatus.isLoaded) {
      try {
        await audioPlayer.seekTo(0);
      } catch {
        // If seek fails for any reason, still attempt fresh playback.
      }
      audioPlayer.play();
    }
  }, [audioPlayer, audioStatus.isLoaded, videoPlayer]);

  const handleComplete = useCallback(() => {
    try {
      if (TTS_AUDIO_ENABLED) audioPlayer.pause();
    } catch {
      // no-op
    }

    if (activityIndex < activityStep.length - 1) {
      setVideoEnded(false);
      setActivityIndex((prev) => prev + 1);
      return;
    }

    onComplete();
  }, [activityIndex, activityStep.length, audioPlayer, onComplete]);

  if (!activity) return null;

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: activity.color + '22' }]}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Progress indicator */}
      <View style={styles.progressRow}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.progressDot,
              { backgroundColor: i < stepNumber ? activity.color : '#DDD' },
            ]}
          />
        ))}
      </View>

      {/* Step counter */}
      <Text style={styles.stepCounter}>
        Step {stepNumber} of {totalSteps}
      </Text>

      {activityStep.length > 1 ? (
        <Text style={styles.subCounter}>
          Part {activityIndex + 1} of {activityStep.length}
        </Text>
      ) : null}

      {/* Activity emoji + label */}
      <Text style={styles.emoji}>{activity.emoji}</Text>
      <Text style={[styles.activityLabel, { color: activity.color }]}>{activity.label}</Text>

      {/* Avatar video loop */}
      <View
        style={[
          styles.videoContainer,
          { width: CONTAINER_WIDTH, height: clampContainerHeight(aspectRatio) },
        ]}
      >
        <VideoView
          player={videoPlayer}
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
        />

        {showCaptions && activeCaptionText ? (
          <View style={styles.captionBar} pointerEvents="none">
            <Text style={styles.captionText}>{activeCaptionText}</Text>
          </View>
        ) : null}
      </View>

      {videoEnded && (
        <TouchableOpacity
          style={[styles.retryButton, { borderColor: activity.color }]}
          onPress={handleRetryVideo}
          activeOpacity={0.85}
        >
          <Text style={[styles.retryButtonText, { color: activity.color }]}>Retry Video</Text>
        </TouchableOpacity>
      )}

      {/* Personalized prompt text */}
      <Text style={styles.promptText}>{activity.promptTemplate(childName)}</Text>

      {/* Done / Next Mission Complete button */}
      <TouchableOpacity
        style={[styles.doneButton, { backgroundColor: activity.color }]}
        onPress={handleComplete}
        activeOpacity={0.85}
      >
        <Text style={styles.doneButtonText}>
          {activityIndex < activityStep.length - 1
            ? '➡️ Next Activity'
            : stepNumber === totalSteps
              ? '🎉 All Done!'
              : '✅ Mission Complete!'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(24),
    paddingTop: vs(56),
    paddingBottom: vs(40),
  },
  progressRow: {
    flexDirection: 'row',
    gap: s(8),
    marginBottom: vs(12),
  },
  progressDot: {
    width: s(12),
    height: s(12),
    borderRadius: ms(6),
  },
  stepCounter: {
    fontSize: fs(14),
    color: '#888',
    marginBottom: vs(8),
    fontWeight: '500',
  },
  subCounter: {
    fontSize: fs(13),
    color: '#666',
    marginBottom: vs(6),
    fontWeight: '600',
  },
  emoji: {
    fontSize: fs(56),
    marginBottom: vs(4),
  },
  activityLabel: {
    fontSize: fs(28),
    fontWeight: '800',
    marginBottom: vs(20),
    textAlign: 'center',
  },
  videoContainer: {
    borderRadius: ms(24),
    overflow: 'hidden',
    backgroundColor: '#F0F0F0',
    marginBottom: vs(24),
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: ms(12),
    shadowOffset: { width: s(0), height: vs(4) },
  },
  video: {
    width: '100%',
    height: '100%',
  },
  captionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: s(14),
    paddingVertical: vs(8),
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  captionText: {
    color: colors.white,
    fontSize: fs(16),
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: fs(20),
  },
  retryButton: {
    borderWidth: 2,
    borderRadius: ms(24),
    paddingVertical: vs(10),
    paddingHorizontal: s(20),
    marginBottom: vs(14),
    backgroundColor: colors.white,
  },
  retryButtonText: {
    fontSize: fs(16),
    fontWeight: '700',
  },
  promptText: {
    fontSize: fs(18),
    color: '#333',
    textAlign: 'center',
    lineHeight: fs(26),
    marginBottom: vs(32),
    paddingHorizontal: s(8),
  },
  doneButton: {
    paddingVertical: vs(18),
    paddingHorizontal: s(40),
    borderRadius: ms(50),
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: ms(8),
    shadowOffset: { width: s(0), height: vs(3) },
  },
  doneButtonText: {
    color: colors.white,
    fontSize: fs(20),
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
