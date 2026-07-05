import React, { useEffect, useCallback, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { ActivityStep } from '../types';
import { ACTIVITIES } from '../constants/activities';
import { localVideoPath, localAudioPath, buildAudioCacheKey, isValidCachedVideo } from '../services/assetSync';
import { colors, fs, ms, s, vs } from '../theme';

interface ActivityPlayerProps {
  activityStep: ActivityStep;
  childName: string;
  avatarId: string;
  stepNumber: number;
  totalSteps: number;
  showCaptions?: boolean;
  onComplete: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

  const currentActivityKey = activityStep[activityIndex];
  const activity = ACTIVITIES[currentActivityKey];

  const plainVideoUri = localVideoPath(currentActivityKey, avatarId);
  const captionVideoUri = localVideoPath(currentActivityKey, avatarId, true);
  // Default to the non-caption video; swap to the captioned variant once we confirm it's cached
  // locally (older activities may not have a caption video uploaded yet).
  const [videoUri, setVideoUri] = useState(plainVideoUri);

  useEffect(() => {
    let cancelled = false;

    if (!showCaptions) {
      setVideoUri(plainVideoUri);
      return () => {
        cancelled = true;
      };
    }

    isValidCachedVideo(captionVideoUri).then((isValid) => {
      if (cancelled) return;
      setVideoUri(isValid ? captionVideoUri : plainVideoUri);
    });

    return () => {
      cancelled = true;
    };
  }, [captionVideoUri, plainVideoUri, showCaptions]);

  const cacheKey = buildAudioCacheKey(childName, currentActivityKey, avatarId);
  const audioUri = localAudioPath(cacheKey);

  const videoPlayer = useVideoPlayer(videoUri, (p: ReturnType<typeof useVideoPlayer>) => {
    p.loop = false;
    p.muted = true; // video is always silent; audio comes from TTS
    p.play();
  });

  // useAudioPlayer auto-manages lifecycle; component remounts per step via key prop
  const audioPlayer = useAudioPlayer(audioUri, { updateInterval: 250 });
  const audioStatus = useAudioPlayerStatus(audioPlayer);

  // Configure audio session once for consistent playback in silent mode.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch((err) =>
      console.warn('[ActivityPlayer] Failed to set audio mode:', err)
    );

    const videoEndSub = videoPlayer.addListener('playToEnd', () => {
      setVideoEnded(true);
      audioPlayer.pause();
    });

    return () => {
      videoEndSub.remove();

      // On fast screen unmounts, native media objects can already be released.
      try {
        audioPlayer.pause();
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

  // Start playback only after the source is loaded.
  useEffect(() => {
    if (!audioStatus.isLoaded || audioStatus.playing) return;

    audioPlayer.loop = false;
    audioPlayer.muted = false;
    audioPlayer.volume = 1;
    audioPlayer.play();
  }, [audioPlayer, audioStatus.isLoaded, audioStatus.playing]);

  const handleRetryVideo = useCallback(async () => {
    setVideoEnded(false);
    videoPlayer.replay();

    if (audioStatus.isLoaded) {
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
      audioPlayer.pause();
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
    <View style={[styles.container, { backgroundColor: activity.color + '22' }]}>
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
      <View style={styles.videoContainer}>
        <VideoView
          player={videoPlayer}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
        />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(24),
    paddingVertical: vs(32),
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
    width: SCREEN_WIDTH * 0.75,
    height: SCREEN_WIDTH * 0.75,
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
