import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUserRoutines } from '../hooks/useRoutine';
import RoutineCard from '../components/RoutineCard';
import { ensureAuth } from '../services/firebase';
import { getChildProfile } from '../services/profile';
import { subscribeAssetCacheStatus } from '../services/assetCacheService';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [userId, setUserId] = useState<string>('');
  const [childName, setChildName] = useState<string>('');
  const [cacheStage, setCacheStage] = useState<string>('idle');
  const { routines, loading, error } = useUserRoutines(userId);

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

    async function initialize() {
      const user = await ensureAuth();
      const profile = await getChildProfile();
      if (!mounted) return;

      setUserId(user.uid);
      if (profile?.childName) {
        setChildName(profile.childName);
      }
    }

    initialize().catch((err) => {
      console.warn('[Home] init failed:', err);
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4A90D9" />
        <Text style={styles.loadingText}>Loading routines…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>⚠️ Failed to load routines.</Text>
        <Text style={styles.errorSub}>{error.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#4A90D9" />

      <View style={[styles.heroBar, { paddingTop: insets.top + 12 }]}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroTitle}>🌟 Good Morning{childName ? `, ${childName}` : ''}!</Text>
          <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push('/settings' as never)}>
            <Text style={styles.settingsBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.heroSub}>
          {routines.length === 0
            ? "No routines yet. Tap + to create one!"
            : `You have ${routines.length} routine${routines.length > 1 ? 's' : ''} scheduled.`}
        </Text>
        {cacheStage === 'warming-assets' ? (
          <View style={styles.cacheBadge}>
            <Text style={styles.cacheBadgeText}>Preparing audio and videos...</Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={styles.editSetupBtn}
          onPress={() => {
            console.log('[Home] Edit Questionnaire pressed');
            router.push('/onboarding/questionnaire' as never);
          }}
        >
          <Text style={styles.editSetupText}>Edit Questionnaire</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={routines}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RoutineCard routine={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>No routines yet!</Text>
            <Text style={styles.emptySub}>
              Tap the + button below to create your first morning routine.
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/parent/create')}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 16,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E53935',
    marginBottom: 8,
  },
  errorSub: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  heroBar: {
    backgroundColor: '#4A90D9',
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 4,
    flex: 1,
    marginRight: 10,
  },
  settingsBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF55',
  },
  settingsBtnText: {
    fontSize: 16,
  },
  heroSub: {
    fontSize: 15,
    color: '#D0E8FF',
  },
  cacheBadge: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#FFF5CC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  cacheBadgeText: {
    color: '#7A5A00',
    fontWeight: '700',
    fontSize: 12,
  },
  editSetupBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF22',
    borderWidth: 1,
    borderColor: '#FFFFFF55',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  editSetupText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    paddingVertical: 12,
    paddingBottom: 100,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
  },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4A90D9',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#4A90D9',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: {
    fontSize: 32,
    color: '#FFF',
    lineHeight: 36,
    fontWeight: '300',
  },
});
