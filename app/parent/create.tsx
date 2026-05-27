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
import { router } from 'expo-router';
import { saveRoutine } from '../../hooks/useRoutine';
import { scheduleRoutineNotification } from '../../services/notifications';
import { syncRoutineAssets } from '../../services/assetSync';
import { ensureAudioForRoutine } from '../../services/tts';
import { Routine, ActivityKey, ToneOption, VoiceOption } from '../../types';
import { ACTIVITIES, ACTIVITY_KEYS } from '../../constants/activities';
import { ensureAuth } from '../../services/firebase';
import { getChildProfile } from '../../services/profile';

function addMinutes(time: string, minutesToAdd: number): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const total = ((hour * 60 + minute + minutesToAdd) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export default function CreateRoutineScreen() {
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
      setScheduledTime(profile.scheduledTime);
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
  }, []);

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
      const routineId = `${childName.toLowerCase().replace(/\s+/g, '_')}_routine_${Date.now()}`;

      const routine: Routine = {
        id: routineId,
        userId: user.uid,
        childName: childName.trim(),
        childAge,
        avatarId,
        scheduledTime,
        activityStack: selectedActivities.map((entry) => [entry]),
        stepTimes: selectedActivities.map((_, index) => addMinutes(scheduledTime, index * 15)),
        tone,
        voice,
      };

      // 1. Save to Firestore
      await saveRoutine(routine);

      // 2. Trigger TTS generation for all steps (Phase 2)
      await ensureAudioForRoutine(routine);

      // 3. Schedule local push notification (Phase 1)
      const notificationId = await scheduleRoutineNotification(routine);

      // Update routine with notification ID
      const routineWithNotif: Routine = { ...routine, notificationId };
      await saveRoutine(routineWithNotif);

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
  }, [avatarId, childAge, childName, childProfileLoaded, scheduledTime, selectedActivities, tone, voice]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
    padding: 20,
    paddingBottom: 60,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginTop: 20,
    marginBottom: 8,
  },
  hint: {
    fontSize: 13,
    color: '#888',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    color: '#222',
  },
  childSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  childSummaryName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
  },
  childSummaryHint: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B7280',
  },
  activityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  activityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DDD',
    backgroundColor: '#FFF',
    gap: 6,
  },
  activityEmoji: {
    fontSize: 18,
  },
  activityLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
  },
  activityOrder: {
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  orderEmoji: {
    fontSize: 22,
    marginRight: 10,
  },
  orderLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  orderButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  orderBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBtnText: {
    fontSize: 14,
    color: '#555',
  },
  saveButton: {
    marginTop: 32,
    backgroundColor: '#4A90D9',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#4A90D9',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
  },
});
