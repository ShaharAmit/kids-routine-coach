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
  preloadRoutineAssetsInBackground,
  subscribeAssetCacheStatus,
} from '../services/assetCacheService';
import { Routine } from '../types';

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
      id: `routine_${profile.userId}`,
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
    padding: 18,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1A2533',
    marginBottom: 14,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E4EAF1',
  },
  cardLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '700',
    marginBottom: 8,
  },
  profileName: {
    fontSize: 20,
    color: '#1F2937',
    fontWeight: '800',
    marginBottom: 6,
  },
  profileSummary: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: '#4A90D9',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryBtnText: {
    color: '#1F2937',
    fontSize: 16,
    fontWeight: '700',
  },
  dangerBtn: {
    backgroundColor: '#FFE9E9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  dangerBtnText: {
    color: '#B91C1C',
    fontSize: 16,
    fontWeight: '800',
  },
});
