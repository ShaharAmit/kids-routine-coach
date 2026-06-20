import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getChildProfile, clearChildProfile } from '../services/profile';
import {
  clearAllLocalCachedAssets,
  preloadRoutineAssetsInBackground,
  subscribeAssetCacheStatus,
} from '../services/assetCacheService';
import { Routine } from '../types';
import { clearDebugHomeAccess } from '../services/debugFlow';
import { colors, fs, ms, vs } from '../theme';
import { isMorningTime } from '../utils/timeOfDay';

export default function SettingsScreen() {
  const [profileName, setProfileName] = useState('');
  const [profileSummary, setProfileSummary] = useState('No profile found');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheStage, setCacheStage] = useState('idle');

  const loadingLabel = useMemo(() => {
    if (cacheStage === 'warming-assets') return 'Warming routine assets...';
    if (cacheStage === 'downloading-welcome') return 'Downloading welcome assets...';
    if (cacheStage === 'done') return 'Assets ready';
    return 'Idle';
  }, [cacheStage]);

  useEffect(() => {
    const unsubscribe = subscribeAssetCacheStatus((next) => {
      setCacheStage(next.stage);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      const profile = await getChildProfile();
      if (!mounted) return;

      if (!profile) {
        setProfileName('');
        setProfileSummary('No profile found');
        return;
      }

      setProfileName(profile.childName);
      const timesLabel = (profile.stepTimes?.length ?? 0) > 1
        ? `${profile.stepTimes?.length} step times (starts ${profile.stepTimes?.[0] ?? profile.scheduledTime})`
        : profile.scheduledTime;
      setProfileSummary(
        `${profile.childName}, age ${profile.age} | ${profile.gender} | ${profile.voice} voice | ${profile.tone} tone | ${timesLabel}`
      );
    }

    loadProfile().catch((err) => {
      console.warn('[Settings] failed to load profile:', err);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleRefreshAssets = async () => {
    const profile = await getChildProfile();
    if (!profile) {
      Alert.alert('No profile', 'Please complete onboarding first.');
      return;
    }

    const routine: Routine = {
      id: isMorningTime(profile.scheduledTime) ? 'morning' : 'evening',
      userId: profile.userId,
      childName: profile.childName,
      childAge: profile.age,
      avatarId: profile.avatarId,
      scheduledTime: profile.scheduledTime,
      activityStack: profile.activityStack,
      stepTimes: profile.stepTimes,
      tone: profile.tone,
      voice: profile.voice,
    };

    setIsRefreshing(true);
    try {
      await preloadRoutineAssetsInBackground(routine);
      Alert.alert('Done', 'Assets refresh completed.');
    } catch (err) {
      console.warn('[Settings] refresh failed:', err);
      Alert.alert('Failed', 'Could not refresh assets right now.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleResetSetup = async () => {
    Alert.alert('Reset setup?', 'This will clear your child profile and return to onboarding.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await clearChildProfile();
          router.replace('/loading' as never);
        },
      },
    ]);
  };

  const handleCleanLocalData = async () => {
    Alert.alert(
      'Clean local saved data?',
      'This clears child profile and all downloaded media cache on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clean',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearChildProfile();
              await clearAllLocalCachedAssets();
              clearDebugHomeAccess();
              Alert.alert('Cleaned', 'Local saved data was cleared. You will be redirected to onboarding.', [
                { text: 'OK', onPress: () => router.replace('/loading' as never) },
              ]);
            } catch (err) {
              console.warn('[Settings] clean local data failed:', err);
              Alert.alert('Failed', 'Could not clean local data right now.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Current profile</Text>
        <Text style={styles.profileName}>{profileName || 'Not configured'}</Text>
        <Text style={styles.profileSummary}>{profileSummary}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Asset cache status</Text>
        <Text style={styles.profileSummary}>{loadingLabel}</Text>
      </View>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => {
          console.log('[Settings] Edit Questionnaire pressed');
          router.push('/onboarding/questionnaire' as never);
        }}
      >
        <Text style={styles.primaryBtnText}>Edit Questionnaire</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/parent/create' as never)}>
        <Text style={styles.primaryBtnText}>Add Task</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryBtn, isRefreshing && { opacity: 0.7 }]}
        disabled={isRefreshing}
        onPress={handleRefreshAssets}
      >
        <Text style={styles.secondaryBtnText}>
          {isRefreshing ? 'Refreshing...' : 'Refresh Assets'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.dangerBtn} onPress={handleResetSetup}>
        <Text style={styles.dangerBtnText}>Reset Setup</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.dangerBtn} onPress={handleCleanLocalData}>
        <Text style={styles.dangerBtnText}>Clean Local Saved Data</Text>
      </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  content: {
    padding: ms(18),
    paddingBottom: vs(130),
  },
  title: {
    fontSize: fs(28),
    fontWeight: '800',
    color: colors.textInk,
    marginBottom: vs(14),
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: ms(14),
    padding: ms(14),
    marginBottom: vs(12),
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  cardLabel: {
    fontSize: fs(13),
    color: colors.textMuted,
    fontWeight: '700',
    marginBottom: vs(8),
  },
  profileName: {
    fontSize: fs(20),
    color: colors.textDark,
    fontWeight: '800',
    marginBottom: vs(6),
  },
  profileSummary: {
    fontSize: fs(14),
    color: colors.textSlate,
    lineHeight: fs(20),
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: ms(12),
    paddingVertical: vs(14),
    alignItems: 'center',
    marginTop: vs(8),
  },
  primaryBtnText: {
    color: colors.white,
    fontSize: fs(16),
    fontWeight: '800',
  },
  secondaryBtn: {
    backgroundColor: colors.white,
    borderRadius: ms(12),
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: vs(14),
    alignItems: 'center',
    marginTop: vs(10),
  },
  secondaryBtnText: {
    color: colors.textDark,
    fontSize: fs(16),
    fontWeight: '700',
  },
  dangerBtn: {
    backgroundColor: '#FFE9E9',
    borderRadius: ms(12),
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: vs(14),
    alignItems: 'center',
    marginTop: vs(10),
  },
  dangerBtnText: {
    color: colors.dangerStrong,
    fontSize: fs(16),
    fontWeight: '800',
  },
});
