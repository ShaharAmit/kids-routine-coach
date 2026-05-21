import React, { useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { ActivityKey } from '../types';
import { ACTIVITIES } from '../constants/activities';
import { localVideoPath, localAudioPath, buildAudioCacheKey } from '../services/assetSync';

interface ActivityPlayerProps {
  activityKey: ActivityKey;
  childName: string;
  avatarId: string;
  stepNumber: number;
  totalSteps: number;
  onComplete: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ActivityPlayer({
  activityKey,
  childName,
  avatarId,
  stepNumber,
  totalSteps,
  onComplete,
}: ActivityPlayerProps) {
  const activity = ACTIVITIES[activityKey];

  const videoUri = localVideoPath(activityKey);
  const cacheKey = buildAudioCacheKey(childName, activityKey, avatarId);
  const audioUri = localAudioPath(cacheKey);

  const videoPlayer = useVideoPlayer(videoUri, (p: ReturnType<typeof useVideoPlayer>) => {
    p.loop = true;
    p.muted = true; // video is always silent; audio comes from TTS
    p.play();
  });

  // useAudioPlayer auto-manages lifecycle; component remounts per step via key prop
  const audioPlayer = useAudioPlayer({ uri: audioUri });

  // Configure audio session and start playback
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })
      .then(() => audioPlayer.play())
      .catch((err) => console.warn('[ActivityPlayer] Audio error:', err));

    return () => {
      videoPlayer.pause();
    };
  }, [audioPlayer, videoPlayer]);

  const handleComplete = useCallback(() => {
    audioPlayer.pause();
    onComplete();
  }, [audioPlayer, onComplete]);

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

      {/* Personalized prompt text */}
      <Text style={styles.promptText}>{activity.promptTemplate(childName)}</Text>

      {/* Done / Next Mission Complete button */}
      <TouchableOpacity
        style={[styles.doneButton, { backgroundColor: activity.color }]}
        onPress={handleComplete}
        activeOpacity={0.85}
      >
        <Text style={styles.doneButtonText}>
          {stepNumber === totalSteps ? '🎉 All Done!' : '✅ Mission Complete!'}
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
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stepCounter: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
    fontWeight: '500',
  },
  emoji: {
    fontSize: 56,
    marginBottom: 4,
  },
  activityLabel: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 20,
    textAlign: 'center',
  },
  videoContainer: {
    width: SCREEN_WIDTH * 0.75,
    height: SCREEN_WIDTH * 0.75,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F0F0F0',
    marginBottom: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  video: {
    width: '100%',
    height: '100%',
  },
  promptText: {
    fontSize: 18,
    color: '#333',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  doneButton: {
    paddingVertical: 18,
    paddingHorizontal: 40,
    borderRadius: 50,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  doneButtonText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
