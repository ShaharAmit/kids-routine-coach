import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { saveRoutine } from '../../hooks/useRoutine';
import { scheduleRoutineNotification } from '../../services/notifications';
import { syncRoutineAssets } from '../../services/assetSync';
import { ensureAudioForRoutine } from '../../services/tts';
import { ChildProfile, Routine, ActivityKey, ToneOption, VoiceOption } from '../../types';
import { ACTIVITIES, ACTIVITY_KEYS } from '../../constants/activities';
import { db, ensureAuth } from '../../services/firebase';
import { getChildProfile, saveUserProfileDoc } from '../../services/profile';
import { colors, fs, ms, s, vs } from '../../theme';
import { getCurrentSegment, isMorningTime } from '../../utils/timeOfDay';
import { getTodayISO } from '../../utils/date';

function addMinutes(time: string, minutesToAdd: number): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const total = ((hour * 60 + minute + minutesToAdd) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

type ActivityEntry = { id: string; key: ActivityKey; time: string; order: number };

async function readExistingActivityEntries(
  userId: string,
  routineId: string
): Promise<ActivityEntry[]> {
  const docs = await getDocs(collection(db, 'users', userId, 'routines', routineId, 'activities'));
  return docs.docs
    .map((d, index) => {
      const data = d.data() as Record<string, unknown>;
      const key = data.activityKey;
      const time = data.time;
      const order = data.order;
      if (typeof key !== 'string' || typeof time !== 'string') return null;
      return {
        id: d.id,
        key: key as ActivityKey,
        time,
        order: typeof order === 'number' ? order : index,
      };
    })
    .filter((item): item is ActivityEntry => Boolean(item))
    .sort((a, b) => a.order - b.order);
}

async function remapLocalDailyCompletionForUpdatedActivities(
  routineId: string,
  previous: ActivityEntry[],
  next: ActivityEntry[]
): Promise<void> {
  const storageKey = `daily_completion_${routineId}`;
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return;

  let parsed: { date?: string; morning?: string[]; evening?: string[] } | null = null;
  try {
    parsed = JSON.parse(raw) as { date?: string; morning?: string[]; evening?: string[] };
  } catch {
    return;
  }
  if (!parsed || parsed.date !== getTodayISO()) return;

  const previousMorning = Array.isArray(parsed.morning) ? parsed.morning : [];
  const previousEvening = Array.isArray(parsed.evening) ? parsed.evening : [];

  const remapForSegment = (segment: 'morning' | 'evening', completedIds: string[]): string[] => {
    const validStepIds = new Set(
      next
        .filter((entry) => (isMorningTime(entry.time) ? 'morning' : 'evening') === segment)
        .map((entry) => entry.id)
    );
    return completedIds.filter((id) => validStepIds.has(id));
  };

  const updated = {
    date: parsed.date,
    morning: remapForSegment('morning', previousMorning),
    evening: remapForSegment('evening', previousEvening),
  };
  await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
}

export default function CreateRoutineScreen() {
  const insets = useSafeAreaInsets();
  const { segment } = useLocalSearchParams<{ segment?: string }>();
  const forcedSegment =
    segment === 'morning' || segment === 'evening' ? segment : null;
  const targetSegment = forcedSegment ?? getCurrentSegment();
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState<number | undefined>(undefined);
  const [childProfileLoaded, setChildProfileLoaded] = useState(false);
  const [avatarId, setAvatarId] = useState('avatar_boy_01');
  const [voice, setVoice] = useState<VoiceOption>('woman');
  const [tone, setTone] = useState<ToneOption>('cheerful');
  const [scheduledTime, setScheduledTime] = useState('08:00');
  const [selectedActivities, setSelectedActivities] = useState<ActivityKey[]>([
    'brush_teeth',
    'get_dressed',
    'eat_breakfast',
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadSingleChildProfile() {
      const user = await ensureAuth();
      const profile = await getChildProfile();
      if (!mounted) return;

      if (!profile) {
        Alert.alert('Finish setup first', 'Please complete the questionnaire to set up your child first.', [
          { text: 'Go to setup', onPress: () => router.replace('/onboarding/questionnaire') },
        ]);
        return;
      }

      setChildName(profile.childName);
      setChildAge(profile.age);
      setAvatarId(profile.avatarId);
      setVoice(profile.voice);
      setTone(profile.tone);
      if (targetSegment === 'evening') {
        setScheduledTime('19:00');
      } else {
        setScheduledTime('08:00');
      }

      const routineRef = doc(db, 'users', user.uid, 'routines', targetSegment);
      const routineSnap = await getDoc(routineRef);
      if (routineSnap.exists()) {
        const routineData = routineSnap.data() as Record<string, unknown>;
        if (typeof routineData.scheduledTime === 'string') {
          setScheduledTime(routineData.scheduledTime);
        }

        const activityDocs = await getDocs(
          collection(db, 'users', user.uid, 'routines', targetSegment, 'activities')
        );
        const sortedActivities = activityDocs.docs
          .map((d, index) => {
            const data = d.data() as Record<string, unknown>;
            const key = data.activityKey;
            const order = data.order;
            if (typeof key !== 'string') return null;
            return {
              key: key as ActivityKey,
              order: typeof order === 'number' ? order : index,
            };
          })
          .filter((entry): entry is { key: ActivityKey; order: number } => Boolean(entry))
          .sort((a, b) => a.order - b.order)
          .map((entry) => entry.key);

        if (sortedActivities.length > 0) {
          setSelectedActivities(sortedActivities);
        }
      }
      setChildProfileLoaded(true);
    }

    loadSingleChildProfile().catch((err) => {
      console.warn('[CreateRoutine] failed to load child profile:', err);
      if (mounted) {
        Alert.alert('Load failed', 'Could not load child profile. Please try again.');
      }
    });

    return () => {
      mounted = false;
    };
  }, [targetSegment]);

  const toggleActivity = useCallback((key: ActivityKey) => {
    setSelectedActivities((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const moveActivity = useCallback((index: number, direction: 'up' | 'down') => {
    setSelectedActivities((prev) => {
      const next = [...prev];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= next.length) return prev;
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return next;
    });
  }, []);

  const validateTime = (time: string): boolean => {
    const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    return regex.test(time);
  };

  const handleSave = useCallback(async () => {
    if (!childProfileLoaded || !childName.trim()) {
      Alert.alert('Missing child profile', 'Please complete child setup first.');
      return;
    }
    if (selectedActivities.length === 0) {
      Alert.alert('No Activities', 'Please select at least one activity.');
      return;
    }
    if (!validateTime(scheduledTime)) {
      Alert.alert('Invalid Time', 'Please enter a valid time in HH:MM format (24h).');
      return;
    }

    setSaving(true);

    try {
      const user = await ensureAuth();
      const trimmedChildName = childName.trim();
      const routineId = targetSegment;
      const previousActivityEntries = await readExistingActivityEntries(user.uid, routineId);
      const nextStepTimes = selectedActivities.map((_, index) => addMinutes(scheduledTime, index * 15));
      const keyToIds = new Map<ActivityKey, string[]>();
      previousActivityEntries.forEach((entry) => {
        const list = keyToIds.get(entry.key) ?? [];
        list.push(entry.id);
        keyToIds.set(entry.key, list);
      });

      const usedIds = new Set<string>();
      const generateNewStepId = (index: number): string => {
        let candidate = '';
        do {
          candidate = `step_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
        } while (usedIds.has(candidate));
        return candidate;
      };

      const nextActivityEntries: ActivityEntry[] = selectedActivities.map((key, index) => {
        const candidateIds = keyToIds.get(key) ?? [];
        let reusedId = candidateIds.shift();
        while (reusedId && usedIds.has(reusedId)) {
          reusedId = candidateIds.shift();
        }
        keyToIds.set(key, candidateIds);
        const resolvedId = reusedId ?? generateNewStepId(index);
        usedIds.add(resolvedId);
        return {
          id: resolvedId,
          key,
          time: nextStepTimes[index],
          order: index,
        };
      });

      const routine: Routine = {
        id: routineId,
        userId: user.uid,
        childName: trimmedChildName,
        childAge,
        avatarId,
        scheduledTime,
        activityStack: selectedActivities.map((entry) => [entry]),
        stepIds: nextActivityEntries.map((entry) => entry.id),
        stepTimes: nextStepTimes,
        tone,
        voice,
      };

      const profileForSync: ChildProfile = {
        userId: user.uid,
        childName: trimmedChildName,
        age: childAge ?? 6,
        gender: 'boy',
        avatarId,
        voice,
        tone,
        scheduledTime,
        activityStack: selectedActivities.map((entry) => [entry]),
        stepTimes: nextStepTimes,
        totalStarsEarned: 0,
        updatedAt: Date.now(),
      };

      await saveUserProfileDoc(profileForSync);

      // 1. Save to Firestore
      await saveRoutine(routine);

      // 2. Trigger TTS generation for all steps (Phase 2)
      await ensureAudioForRoutine(routine);

      // 3. Schedule local push notification (Phase 1)
      const notificationId = await scheduleRoutineNotification(routine);

      // Update routine with notification ID
      const routineWithNotif: Routine = { ...routine, notificationId };
      await saveRoutine(routineWithNotif);

      // Preserve completed activities that still exist; drop stale ones and
      // keep any newly added activities unfinished.
      await remapLocalDailyCompletionForUpdatedActivities(
        routine.id,
        previousActivityEntries,
        nextActivityEntries
      );

      // 4. Kick off background asset sync (Phase 3) — non-blocking
      syncRoutineAssets(routine).catch((err) =>
        console.warn('[CreateRoutine] Asset sync error (background):', err)
      );

      Alert.alert(
        '✅ Routine Saved!',
        `${childName}'s routine is set for ${scheduledTime}. Assets are syncing in the background.`,
        [{ text: 'Great!', onPress: () => router.replace('/') }]
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Error', `Failed to save routine: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [
    avatarId,
    childAge,
    childName,
    childProfileLoaded,
    targetSegment,
    scheduledTime,
    selectedActivities,
    tone,
    voice,
  ]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: vs(170) + insets.bottom }]}
    >
      <Text style={styles.sectionTitle}>Child</Text>
      <View style={styles.childSummaryCard}>
        <Text style={styles.childSummaryName}>{childName || 'Not configured yet'}</Text>
        <Text style={styles.childSummaryHint}>Routines are always saved for your configured child profile.</Text>
      </View>

      <Text style={styles.sectionTitle}>Routine Time (24h format)</Text>
      <TextInput
        style={styles.input}
        placeholder="08:00"
        value={scheduledTime}
        onChangeText={setScheduledTime}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
      />

      <Text style={styles.sectionTitle}>Activities</Text>
      <Text style={styles.hint}>Tap to toggle • Use arrows to reorder</Text>
      <View style={styles.activityGrid}>
        {ACTIVITY_KEYS.map((key) => {
          const activity = ACTIVITIES[key];
          const isSelected = selectedActivities.includes(key as ActivityKey);
          const selectedIndex = selectedActivities.indexOf(key as ActivityKey);
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.activityChip,
                isSelected && { backgroundColor: activity.color + '33', borderColor: activity.color },
              ]}
              onPress={() => toggleActivity(key as ActivityKey)}
            >
              <Text style={styles.activityEmoji}>{activity.emoji}</Text>
              <Text style={[styles.activityLabel, isSelected && { color: activity.color }]}>
                {activity.label}
              </Text>
              {isSelected && (
                <Text style={[styles.activityOrder, { backgroundColor: activity.color }]}>
                  {selectedIndex + 1}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedActivities.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Activity Order</Text>
          {selectedActivities.map((key, index) => {
            const activity = ACTIVITIES[key];
            return (
              <View key={key} style={styles.orderRow}>
                <Text style={styles.orderEmoji}>{activity.emoji}</Text>
                <Text style={styles.orderLabel}>{activity.label}</Text>
                <View style={styles.orderButtons}>
                  <TouchableOpacity
                    style={styles.orderBtn}
                    onPress={() => moveActivity(index, 'up')}
                    disabled={index === 0}
                  >
                    <Text style={[styles.orderBtnText, index === 0 && { opacity: 0.3 }]}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.orderBtn}
                    onPress={() => moveActivity(index, 'down')}
                    disabled={index === selectedActivities.length - 1}
                  >
                    <Text
                      style={[
                        styles.orderBtnText,
                        index === selectedActivities.length - 1 && { opacity: 0.3 },
                      ]}
                    >
                      ▼
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </>
      )}

      <TouchableOpacity
        style={[styles.saveButton, saving && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.saveButtonText}>💾 Save Routine</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  content: {
    padding: ms(20),
  },
  sectionTitle: {
    fontSize: fs(16),
    fontWeight: '700',
    color: '#333',
    marginTop: vs(20),
    marginBottom: vs(8),
  },
  hint: {
    fontSize: fs(13),
    color: '#888',
    marginBottom: vs(10),
  },
  input: {
    backgroundColor: '#FFF',
    borderRadius: ms(12),
    paddingHorizontal: s(16),
    paddingVertical: vs(12),
    fontSize: fs(16),
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    color: '#222',
  },
  childSummaryCard: {
    backgroundColor: colors.white,
    borderRadius: ms(12),
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    paddingHorizontal: s(16),
    paddingVertical: vs(14),
  },
  childSummaryName: {
    fontSize: fs(16),
    fontWeight: '700',
    color: '#222',
  },
  childSummaryHint: {
    marginTop: vs(4),
    fontSize: fs(13),
    color: '#6B7280',
  },
  activityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(10),
  },
  activityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: vs(8),
    paddingHorizontal: s(12),
    borderRadius: ms(12),
    borderWidth: 1.5,
    borderColor: '#DDD',
    backgroundColor: '#FFF',
    gap: s(6),
  },
  activityEmoji: {
    fontSize: fs(18),
  },
  activityLabel: {
    fontSize: fs(13),
    fontWeight: '600',
    color: '#555',
  },
  activityOrder: {
    width: s(20),
    height: s(20),
    borderRadius: ms(10),
    textAlign: 'center',
    lineHeight: fs(20),
    color: '#FFF',
    fontSize: fs(11),
    fontWeight: '700',
    overflow: 'hidden',
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: ms(12),
    padding: ms(12),
    marginBottom: vs(8),
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: ms(4),
    shadowOffset: { width: s(0), height: vs(1) },
  },
  orderEmoji: {
    fontSize: fs(22),
    marginRight: s(10),
  },
  orderLabel: {
    flex: 1,
    fontSize: fs(15),
    fontWeight: '600',
    color: '#333',
  },
  orderButtons: {
    flexDirection: 'row',
    gap: s(4),
  },
  orderBtn: {
    width: s(32),
    height: s(32),
    borderRadius: ms(8),
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBtnText: {
    fontSize: fs(14),
    color: '#555',
  },
  saveButton: {
    marginTop: vs(32),
    backgroundColor: colors.primary,
    paddingVertical: vs(18),
    borderRadius: ms(16),
    alignItems: 'center',
    elevation: 4,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: ms(10),
    shadowOffset: { width: s(0), height: vs(4) },
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: fs(18),
    fontWeight: '800',
  },
});
