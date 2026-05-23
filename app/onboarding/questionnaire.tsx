import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ACTIVITY_KEYS, ACTIVITIES } from '../../constants/activities';
import {
  ActivityKey,
  ActivityStep,
  ChildGender,
  ChildProfile,
  normalizeActivityStack,
  normalizeStepTimes,
  Routine,
  ToneOption,
  VoiceOption,
} from '../../types';
import { ensureAuth } from '../../services/firebase';
import { saveRoutine } from '../../hooks/useRoutine';
import { scheduleRoutineNotification } from '../../services/notifications';
import { saveChildProfile } from '../../services/profile';
import { preloadRoutineAssetsInBackground } from '../../services/assetCacheService';
import { getChildProfile } from '../../services/profile';
import { grantDebugHomeAccess } from '../../services/debugFlow';

const ITEM_HEIGHT = 48;

const TONES: Array<{ key: ToneOption; label: string }> = [
  { key: 'cheerful', label: 'Cheerful' },
  { key: 'encouraging', label: 'Encouraging' },
  { key: 'calm', label: 'Calm' },
];

const VOICES: Array<{ key: VoiceOption; label: string }> = [
  { key: 'woman', label: 'Woman' },
  { key: 'man', label: 'Man' },
];

const GENDERS: Array<{ key: ChildGender; label: string; avatarId: string }> = [
  { key: 'boy', label: 'Boy', avatarId: 'avatar_boy_01' },
  { key: 'girl', label: 'Girl', avatarId: 'avatar_girl_01' },
];

function buildTimeSlots(): string[] {
  const slots: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      const h = String(hour).padStart(2, '0');
      const m = String(minute).padStart(2, '0');
      slots.push(`${h}:${m}`);
    }
  }
  return slots;
}

function addMinutes(time: string, minutesToAdd: number): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '08:00';

  const total = ((hour * 60 + minute + minutesToAdd) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export default function QuestionnaireScreen() {
  const timeSlots = useMemo(buildTimeSlots, []);
  const timeListRef = useRef<ScrollView>(null);

  useEffect(() => {
    console.log('[Questionnaire] mounted');
  }, []);

  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('6');
  const [gender, setGender] = useState<ChildGender>('boy');
  const [voice, setVoice] = useState<VoiceOption>('woman');
  const [tone, setTone] = useState<ToneOption>('cheerful');
  const [steps, setSteps] = useState<ActivityStep[]>([
    ['brush_teeth'],
    ['get_dressed'],
    ['eat_breakfast'],
  ]);
  const [stepTimes, setStepTimes] = useState<string[]>(['08:00', '08:15', '08:30']);
  const [mergeMode, setMergeMode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadExistingProfile() {
      const profile = await getChildProfile();
      if (!profile || !mounted) return;

      setChildName(profile.childName);
      setChildAge(String(profile.age));
      setGender(profile.gender);
      setVoice(profile.voice);
      setTone(profile.tone);
      const normalized = normalizeActivityStack((profile as any).activityStack ?? []);
      const nextSteps: ActivityStep[] = normalized.length > 0 ? normalized : [['brush_teeth']];
      const fallbackTime = profile.scheduledTime ?? '08:00';
      setSteps(nextSteps);
      setStepTimes(normalizeStepTimes(profile.stepTimes, nextSteps, fallbackTime));
    }

    loadExistingProfile().catch((err) => {
      console.warn('[Questionnaire] failed to load profile defaults:', err);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const toggleActivity = useCallback((key: ActivityKey) => {
    setSteps((prev) => {
      const next = prev.map((step) => [...step]);
      let found = false;
      let removedIndex = -1;

      for (let index = 0; index < next.length; index += 1) {
        if (next[index].includes(key)) {
          next[index] = next[index].filter((entry) => entry !== key);
          removedIndex = index;
          found = true;
        }
      }

      const cleaned: ActivityStep[] = [];
      const nextTimes: string[] = [];
      let cursor = 0;
      for (let index = 0; index < next.length; index += 1) {
        const step = next[index];
        const prevTime = stepTimes[index] ?? stepTimes[cursor] ?? '08:00';
        if (step.length > 0) {
          cleaned.push(step);
          nextTimes.push(prevTime);
          cursor += 1;
        }
      }

      if (found) {
        setStepTimes(nextTimes);
        return cleaned;
      }

      const lastTime = nextTimes[nextTimes.length - 1] ?? stepTimes[removedIndex] ?? '08:00';
      setStepTimes([...nextTimes, addMinutes(lastTime, 15)]);
      return [...cleaned, [key]];
    });
  }, [stepTimes]);

  const allSelectedKeys = useMemo(() => new Set(steps.flat()), [steps]);

  const moveStep = useCallback((from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;

    setSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

    setStepTimes((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved ?? '08:00');
      return normalizeStepTimes(next, steps, '08:00');
    });
  }, [steps]);

  const mergeStepWithAbove = useCallback((index: number) => {
    if (index <= 0 || index >= steps.length) return;

    setSteps((prev) => {
      const next = [...prev];
      const merged = Array.from(new Set([...(next[index - 1] ?? []), ...(next[index] ?? [])]));
      next.splice(index - 1, 2, merged);
      return next;
    });

    setStepTimes((prev) => {
      const next = [...prev];
      const mergedTime = next[index - 1] ?? next[index] ?? '08:00';
      next.splice(index - 1, 2, mergedTime);
      return next;
    });
  }, [steps.length]);

  const selectedAvatarId = useMemo(
    () => GENDERS.find((entry) => entry.key === gender)?.avatarId ?? 'avatar_boy_01',
    [gender]
  );

  const primaryTime = stepTimes[0] ?? '08:00';

  const saveQuestionnaire = useCallback(async () => {
    if (!childName.trim()) {
      Alert.alert('Missing name', "Please enter your child's name.");
      return;
    }

    const parsedAge = Number(childAge);
    if (!Number.isFinite(parsedAge) || parsedAge <= 1 || parsedAge >= 18) {
      Alert.alert('Invalid age', 'Please enter a valid age between 2 and 17.');
      return;
    }

    if (steps.length === 0) {
      Alert.alert('No activities selected', 'Please select at least one activity.');
      return;
    }

    setSaving(true);
    try {
      const user = await ensureAuth();
      const userId = user.uid;

      const profile: ChildProfile = {
        userId,
        childName: childName.trim(),
        age: parsedAge,
        gender,
        avatarId: selectedAvatarId,
        voice,
        tone,
        scheduledTime: primaryTime,
        activityStack: steps,
        stepTimes: normalizeStepTimes(stepTimes, steps, primaryTime),
        updatedAt: Date.now(),
      };

      const routine: Routine = {
        id: `routine_${userId}`,
        userId,
        childName: profile.childName,
        childAge: parsedAge,
        avatarId: selectedAvatarId,
        scheduledTime: primaryTime,
        activityStack: steps,
        stepTimes: normalizeStepTimes(stepTimes, steps, primaryTime),
        tone,
        voice,
      };

      await saveRoutine(routine);
      const notificationId = await scheduleRoutineNotification(routine);
      await saveRoutine({ ...routine, notificationId });
      await saveChildProfile(profile);
      grantDebugHomeAccess();

      preloadRoutineAssetsInBackground(routine).catch((err) => {
        console.warn('[Questionnaire] background preloading failed:', err);
      });

      router.replace('/');
    } catch (err) {
      console.warn('[Questionnaire] failed to save:', err);
      Alert.alert('Save failed', 'Could not save setup. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [childAge, childName, gender, primaryTime, selectedAvatarId, stepTimes, steps, tone, voice]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Child Setup Questionnaire</Text>

      <Text style={styles.section}>Child name</Text>
      <TextInput
        value={childName}
        onChangeText={setChildName}
        style={styles.input}
        placeholder="Name"
        autoCapitalize="words"
      />

      <Text style={styles.section}>Age</Text>
      <TextInput
        value={childAge}
        onChangeText={setChildAge}
        style={styles.input}
        keyboardType="number-pad"
        maxLength={2}
      />

      <Text style={styles.section}>Boy or girl</Text>
      <View style={styles.optionsRow}>
        {GENDERS.map((entry) => (
          <TouchableOpacity
            key={entry.key}
            onPress={() => setGender(entry.key)}
            style={[styles.optionChip, gender === entry.key && styles.optionChipSelected]}
          >
            <Text style={styles.optionChipText}>{entry.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>Voice</Text>
      <View style={styles.optionsRow}>
        {VOICES.map((entry) => (
          <TouchableOpacity
            key={entry.key}
            onPress={() => setVoice(entry.key)}
            style={[styles.optionChip, voice === entry.key && styles.optionChipSelected]}
          >
            <Text style={styles.optionChipText}>{entry.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>Tone</Text>
      <View style={styles.optionsRow}>
        {TONES.map((entry) => (
          <TouchableOpacity
            key={entry.key}
            onPress={() => setTone(entry.key)}
            style={[styles.optionChip, tone === entry.key && styles.optionChipSelected]}
          >
            <Text style={styles.optionChipText}>{entry.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>Select activities needing help</Text>
      <View style={styles.grid}>
        {ACTIVITY_KEYS.map((key) => {
          const typedKey = key as ActivityKey;
          const item = ACTIVITIES[key];
          const selected = allSelectedKeys.has(typedKey);
          return (
            <TouchableOpacity
              key={key}
              style={[styles.gridItem, selected && styles.gridItemSelected]}
              onPress={() => toggleActivity(typedKey)}
            >
              <Text style={styles.gridEmoji}>{item.emoji}</Text>
              <Text style={styles.gridLabel}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.mergeRow}>
        <Text style={styles.section}>Merge mode</Text>
        <Switch value={mergeMode} onValueChange={setMergeMode} />
      </View>
      <Text style={styles.helpText}>
        Use arrows to reorder. Turn merge mode on to show "Merge Up" buttons.
      </Text>

      <View style={styles.stepsWrap}>
        {steps.map((item, index) => {
          const labels = item.map((key) => ACTIVITIES[key].label).join(' + ');
          const emojis = item.map((key) => ACTIVITIES[key].emoji).join(' ');
          const stepTime = stepTimes[index] ?? '08:00';

          return (
            <View key={`step_${index}_${item.join('_')}`} style={styles.stepRow}>
              <Text style={styles.stepDrag}>{index + 1}</Text>
              <View style={styles.stepMeta}>
                <Text style={styles.stepEmoji}>{emojis}</Text>
                <Text style={styles.stepLabel}>{labels}</Text>
                <TouchableOpacity
                  style={styles.timeBadge}
                  onPress={() => {
                    setStepTimes((prev) => {
                      const next = [...prev];
                      next[index] = addMinutes(next[index] ?? '08:00', 15);
                      return next;
                    });
                  }}
                >
                  <Text style={styles.timeBadgeText}>🕒 {stepTime}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.stepActions}>
                <TouchableOpacity style={styles.smallButton} onPress={() => moveStep(index, index - 1)}>
                  <Text style={styles.smallButtonText}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallButton} onPress={() => moveStep(index, index + 1)}>
                  <Text style={styles.smallButtonText}>↓</Text>
                </TouchableOpacity>
                {mergeMode && index > 0 ? (
                  <TouchableOpacity style={styles.smallButton} onPress={() => mergeStepWithAbove(index)}>
                    <Text style={styles.smallButtonText}>Merge Up</Text>
                  </TouchableOpacity>
                ) : null}
                {item.length > 1 ? (
                  <TouchableOpacity
                    style={styles.smallButton}
                    onPress={() => {
                      setSteps((prev) => {
                        const next = [...prev];
                        next.splice(index, 1, ...item.map((entry) => [entry] as ActivityStep));
                        return next;
                      });
                      setStepTimes((prevTimes) => {
                        const current = prevTimes[index] ?? '08:00';
                        const nextTimes = [...prevTimes];
                        nextTimes.splice(index, 1, ...item.map(() => current));
                        return nextTimes;
                      });
                    }}
                  >
                    <Text style={styles.smallButtonText}>Unmerge</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

        <Text style={styles.section}>Step times</Text>
        <Text style={styles.helpText}>Tap a time chip on any step to move it forward by 15 minutes.</Text>
        <View style={styles.timePicker}>
          <ScrollView
            ref={timeListRef}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            contentOffset={{ x: 0, y: ITEM_HEIGHT * 32 }}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT);
              const safeIndex = Math.max(0, Math.min(timeSlots.length - 1, index));
              const nextTime = timeSlots[safeIndex];
              setStepTimes((prev) => {
                if (prev.length === 0) return [nextTime];
                const offset =
                  (Number(nextTime.split(':')[0]) * 60 + Number(nextTime.split(':')[1])) -
                  (Number((prev[0] ?? '08:00').split(':')[0]) * 60 + Number((prev[0] ?? '08:00').split(':')[1]));
                return prev.map((entry) => addMinutes(entry, offset));
              });
            }}
          >
            {timeSlots.map((item) => (
              <View key={item} style={styles.timeItem}>
                <Text style={(stepTimes[0] ?? '08:00') === item ? styles.timeTextSelected : styles.timeText}>
                  {item}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          disabled={saving}
          onPress={saveQuestionnaire}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Setup'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  content: {
    padding: 18,
    paddingBottom: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1A2533',
    marginBottom: 10,
  },
  section: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  input: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionChip: {
    backgroundColor: '#FFF',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  optionChipSelected: {
    borderColor: '#4A90D9',
    backgroundColor: '#E7F1FD',
  },
  optionChipText: {
    color: '#1F2937',
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridItem: {
    width: '48%',
    backgroundColor: '#FFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gridItemSelected: {
    borderColor: '#4A90D9',
    backgroundColor: '#EAF4FF',
  },
  gridEmoji: {
    fontSize: 18,
  },
  gridLabel: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '700',
    flexShrink: 1,
  },
  mergeRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  helpText: {
    color: '#64748B',
    fontSize: 12,
    marginBottom: 8,
  },
  stepsWrap: {
    marginBottom: 10,
  },
  stepRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepDrag: {
    fontSize: 20,
    color: '#64748B',
  },
  stepMeta: {
    flex: 1,
  },
  stepEmoji: {
    fontSize: 17,
    marginBottom: 2,
  },
  stepLabel: {
    fontSize: 13,
    color: '#1F2937',
    fontWeight: '700',
  },
  timeBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#EEF2FF',
  },
  timeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  stepActions: {
    gap: 6,
    alignItems: 'flex-end',
  },
  smallButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  smallButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  timePicker: {
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    backgroundColor: '#FFF',
    overflow: 'hidden',
    marginTop: 4,
  },
  timeItem: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeText: {
    color: '#64748B',
    fontSize: 16,
  },
  timeTextSelected: {
    color: '#4A90D9',
    fontSize: 18,
    fontWeight: '800',
  },
  saveButton: {
    marginTop: 20,
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
  },
});
