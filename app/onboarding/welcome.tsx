import React, { useEffect, useMemo, useState } from 'react';
import { View, Image, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { setAudioModeAsync } from 'expo-audio';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { downloadWelcomeAssets, getWelcomeAssetPaths } from '../../services/assetCacheService';
import { getOrExtractMobilePoster } from '../../services/mobileVideoCache';

type WelcomeVideoPlayerProps = {
  videoPath: string;
  posterUri?: string;
  onEnded: () => void;
};

function WelcomeVideoPlayer({ videoPath, posterUri, onEnded }: WelcomeVideoPlayerProps) {
  const [isVideoReady, setIsVideoReady] = useState(false);

  const videoPlayer = useVideoPlayer(videoPath, (player) => {
    player.loop = false;
    player.muted = false;
  });

  useEffect(() => {
    let videoSub: { remove: () => void } | null = null;

    async function startPlayback() {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });

      videoSub = videoPlayer.addListener('playToEnd', () => {
        onEnded();
      });

      videoPlayer.play();
    }

    startPlayback().catch((err) => {
      console.warn('[Welcome] playback init failed:', err);
      onEnded();
    });

    return () => {
      if (videoSub) videoSub.remove();
      try {
        videoPlayer.pause();
      } catch {
        // no-op
      }
    };
  }, [onEnded, videoPlayer]);

  return (
    <View style={styles.videoContainer}>
      <VideoView
        player={videoPlayer}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        onReadyForDisplay={() => setIsVideoReady(true)}
      />
      {/* Poster overlay: sits above the video until the native engine has painted its first frame. */}
      {!isVideoReady && posterUri ? (
        <Image
          source={{ uri: posterUri }}
          style={styles.posterOverlay}
          resizeMode="contain"
        />
      ) : null}
    </View>
  );
}

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const [videoDone, setVideoDone] = useState(false);
  const [isPreparing, setIsPreparing] = useState(true);
  const [assetsReady, setAssetsReady] = useState(false);
  const [posterUri, setPosterUri] = useState<string | undefined>(undefined);

  const { videoPath } = useMemo(() => getWelcomeAssetPaths(), []);

  useEffect(() => {
    let mounted = true;

    async function prepareAssets() {
      setIsPreparing(true);

      try {
        await downloadWelcomeAssets();
      } catch (err) {
        console.warn('[Welcome] failed to sync welcome assets:', err);
      }

      const videoInfo = await FileSystem.getInfoAsync(videoPath);
      if (!mounted) return;

      if (!videoInfo.exists) {
        setAssetsReady(false);
        setVideoDone(true);
        setIsPreparing(false);
        return;
      }

      setAssetsReady(true);
      setVideoDone(false);
      setIsPreparing(false);

      // Non-blocking: generate + cache the poster frame natively.
      // On return visits the JPEG is read straight from disk — no generation needed.
      getOrExtractMobilePoster(videoPath).then((uri) => {
        if (mounted && uri) setPosterUri(uri);
      }).catch(() => {});
    }

    prepareAssets().catch((err) => {
      console.warn('[Welcome] prepare failed:', err);
      setVideoDone(true);
      setIsPreparing(false);
    });

    return () => {
      mounted = false;
    };
  }, [videoPath]);

  return (
    <View style={styles.container}>
      {isPreparing ? (
        <View style={styles.fallback}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.preparingText}>Preparing welcome video...</Text>
        </View>
      ) : assetsReady ? (
        <WelcomeVideoPlayer videoPath={videoPath} posterUri={posterUri} onEnded={() => setVideoDone(true)} />
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.fallbackEmoji}>🧑‍🏫</Text>
        </View>
      )}

      {videoDone ? (
        <Animated.View entering={FadeIn.duration(300)} style={[styles.buttonWrap, { bottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push('/onboarding/questionnaire' as never)}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>Continue To Questionnaire</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : (
        <View style={[styles.waitingSpacer, { bottom: 16 + insets.bottom }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoContainer: {
    width: '100%',
    height: '100%',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  posterOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  fallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackEmoji: {
    fontSize: 72,
    color: '#FFF',
  },
  preparingText: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  waitingSpacer: {
    position: 'absolute',
    height: 56,
  },
  buttonWrap: {
    width: '100%',
    paddingHorizontal: 20,
    position: 'absolute',
  },
  button: {
    backgroundColor: '#4A90D9',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
  },
});
