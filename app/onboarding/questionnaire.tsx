import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import PageBackground from '../../components/PageBackground';
import { InPageHeader } from '../../components/ScreenHeader';
import {
  ChildProfile,
  HelpLevel,
  MasteredTask,
  MorningSpeed,
  MorningStuckPoint,
  MotivationStyle,
  QuestionnaireAnswers,
  Routine,
  ToneOption,
} from '../../types';
import { ensureAuth } from '../../services/firebase';
import { saveRoutine, saveRoutineIfMissing } from '../../hooks/useRoutine';
import { scheduleRoutineNotification } from '../../services/notifications';
import { saveChildProfile, getChildProfile, saveUserProfileDoc } from '../../services/profile';
import { preloadRoutineAssetsInBackground } from '../../services/assetCacheService';
import { grantDebugHomeAccess } from '../../services/debugFlow';
import { colors, fs, ms, s, vs } from '../../theme';

const GRASS = require('../../assets/images/grass.png');

const DEFAULT_AVATAR_ID = 'becky';
const DEFAULT_VOICE = 'woman' as const;
const DEFAULT_SCHEDULED_TIME = '08:00';
const DEFAULT_EVENING_TIME = '19:00';

/** Default activities kept in local child profile for first-time UX only. */
const DEFAULT_ACTIVITY_STACK = [['get_dressed'], ['brush_teeth'], ['eat_breakfast']] as const;
const DEFAULT_STEP_TIMES = ['07:30', '07:45', '08:00'];

const MIN_AGE = 2;
const MAX_AGE = 12;

type Option<T extends string> = { key: T; label: string };

const MORNING_STUCK_OPTIONS: Option<MorningStuckPoint>[] = [
  { key: 'getting_out_of_bed', label: 'Getting out of bed' },
  { key: 'getting_dressed', label: 'Getting dressed' },
  { key: 'brushing_washing', label: 'Brushing teeth & washing' },
  { key: 'turning_off_screens', label: 'Turning off screens' },
  { key: 'everything_negotiation', label: 'Everything is a negotiation!' },
];

const MOTIVATION_OPTIONS: Option<MotivationStyle>[] = [
  { key: 'race_game', label: 'Turning it into a race/game' },
  { key: 'autonomy_choose', label: 'Giving them autonomy to choose' },
  { key: 'praise_encouragement', label: 'Lots of praise and encouragement' },
  { key: 'hug_connection', label: 'A warm hug and connection' },
];

const MASTERED_OPTIONS: Option<MasteredTask>[] = [
  { key: 'eating_breakfast', label: 'Eating breakfast' },
  { key: 'choosing_clothes', label: 'Choosing clothes' },
  { key: 'putting_toys_away', label: 'Putting toys away' },
  { key: 'none_yet', label: "None yet — that's why I'm here!" },
];

const HELP_OPTIONS: Option<HelpLevel>[] = [
  { key: 'independent', label: '"I do it myself!" (Completely independent)' },
  { key: 'little_push', label: 'Needs a little push to get started' },
  { key: 'step_by_step', label: 'Needs me step-by-step' },
];

const SPEED_OPTIONS: Option<MorningSpeed>[] = [
  { key: 'fast_energetic', label: 'Fast & energetic' },
  { key: 'slow_dreamy', label: 'Slow and dreamy' },
  { key: 'easily_distracted', label: 'Easily distracted' },
];

/** Map the motivation answer to the TTS tone used by the rest of the app. */
function toneFromMotivation(style: MotivationStyle | undefined): ToneOption {
  switch (style) {
    case 'race_game':
      return 'cheerful';
    case 'hug_connection':
      return 'calm';
    case 'autonomy_choose':
    case 'praise_encouragement':
    default:
      return 'encouraging';
  }
}

// Step 0 = name + age, steps 1..5 = single-select questions. Final = trust screen.
const QUESTION_STEP_COUNT = 6;

export default function QuestionnaireScreen() {
  const [stepIndex, setStepIndex] = useState(0);
  const [showFinal, setShowFinal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [childName, setChildName] = useState('');
  const [age, setAge] = useState(6);

  const [answers, setAnswers] = useState<QuestionnaireAnswers>({});

  useEffect(() => {
    let mounted = true;
    getChildProfile()
      .then((profile) => {
        if (!profile || !mounted) return;
        setChildName(profile.childName);
        setAge(profile.age);
        if (profile.answers) setAnswers(profile.answers);
      })
      .catch((err) => console.warn('[Questionnaire] failed to load profile defaults:', err));
    return () => {
      mounted = false;
    };
  }, []);

  const displayName = childName.trim() || 'your child';

  const goBack = useCallback(() => {
    if (showFinal) {
      setShowFinal(false);
      return;
    }
    if (stepIndex > 0) {
      setStepIndex((prev) => prev - 1);
      return;
    }
    router.back();
  }, [showFinal, stepIndex]);

  const canContinue = useMemo(() => {
    switch (stepIndex) {
      case 0:
        return childName.trim().length > 0 && age >= MIN_AGE && age <= MAX_AGE;
      case 1:
        return !!answers.morningStuck;
      case 2:
        return !!answers.motivationStyle;
      case 3:
        return !!answers.masteredTask;
      case 4:
        return !!answers.helpLevel;
      case 5:
        return !!answers.morningSpeed;
      default:
        return false;
    }
  }, [stepIndex, childName, age, answers]);

  const handleContinue = useCallback(() => {
    if (!canContinue) return;
    if (stepIndex < QUESTION_STEP_COUNT - 1) {
      setStepIndex((prev) => prev + 1);
    } else {
      setShowFinal(true);
    }
  }, [canContinue, stepIndex]);

  const saveQuestionnaire = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const user = await ensureAuth();
      const userId = user.uid;
      const tone = toneFromMotivation(answers.motivationStyle);
      const activityStack = DEFAULT_ACTIVITY_STACK.map((step) => [...step]);

      const profile: ChildProfile = {
        userId,
        childName: childName.trim(),
        age,
        gender: 'boy',
        avatarId: DEFAULT_AVATAR_ID,
        voice: DEFAULT_VOICE,
        tone,
        scheduledTime: DEFAULT_SCHEDULED_TIME,
        activityStack,
        stepTimes: [...DEFAULT_STEP_TIMES],
        answers,
        totalStarsEarned: 0,
        updatedAt: Date.now(),
      };

      const morningRoutine: Routine = {
        id: 'morning',
        userId,
        childName: profile.childName,
        childAge: age,
        avatarId: DEFAULT_AVATAR_ID,
        scheduledTime: DEFAULT_SCHEDULED_TIME,
        activityStack,
        stepTimes: [...DEFAULT_STEP_TIMES],
        tone,
        voice: DEFAULT_VOICE,
      };
      const eveningRoutine: Routine = {
        id: 'evening',
        userId,
        childName: profile.childName,
        childAge: age,
        avatarId: DEFAULT_AVATAR_ID,
        scheduledTime: DEFAULT_EVENING_TIME,
        activityStack: [],
        stepTimes: [],
        tone,
        voice: DEFAULT_VOICE,
      };

      await saveChildProfile(profile);
      await saveUserProfileDoc(profile);
      const morningCreated = await saveRoutineIfMissing(morningRoutine);
      await saveRoutineIfMissing(eveningRoutine);
      if (morningCreated) {
        const notificationId = await scheduleRoutineNotification(morningRoutine);
        const routineWithNotif: Routine = { ...morningRoutine, notificationId };
        await saveRoutine(routineWithNotif);
        preloadRoutineAssetsInBackground(routineWithNotif).catch((err) => {
          console.warn('[Questionnaire] background preloading failed:', err);
        });
      }
      grantDebugHomeAccess();

      router.replace('/');
    } catch (err) {
      console.warn('[Questionnaire] failed to save:', err);
      Alert.alert('Save failed', 'Could not save setup. Please try again.');
      setSaving(false);
    }
  }, [age, answers, childName, saving]);

  return (
    <PageBackground variant="clouds">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.headerPad}>
          <InPageHeader title="Setup Questionnaire" onBack={goBack} />
        </View>

          {!showFinal && (
            <View style={styles.progressWrap}>
              <View style={styles.dotsRow}>
                {Array.from({ length: QUESTION_STEP_COUNT }).map((_, index) => {
                  const active = index === stepIndex;
                  const done = index < stepIndex;
                  return (
                    <React.Fragment key={index}>
                      {index > 0 && <View style={styles.dotConnector} />}
                      <View
                        style={[styles.dot, active && styles.dotActive, done && styles.dotDone]}
                      />
                    </React.Fragment>
                  );
                })}
              </View>
              <Text style={styles.progressLabel}>
                {stepIndex + 1} of {QUESTION_STEP_COUNT}
              </Text>
            </View>
          )}

          {/* Body */}
          {showFinal ? (
            <FinalCard name={displayName} saving={saving} onStart={saveQuestionnaire} />
          ) : (
            <View style={styles.cardWrap}>
              <View style={styles.card}>
                <ScrollView
                  style={styles.cardBody}
                  contentContainerStyle={styles.cardScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {stepIndex === 0 && (
                    <NameAgeStep
                      childName={childName}
                      onChangeName={setChildName}
                      age={age}
                      onChangeAge={(next) => setAge(Math.max(MIN_AGE, Math.min(MAX_AGE, next)))}
                    />
                  )}

                  {stepIndex === 1 && (
                    <SelectStep
                      title={'Where do mornings usually get "stuck"?'}
                      options={MORNING_STUCK_OPTIONS}
                      selected={answers.morningStuck}
                      onSelect={(key) => setAnswers((a) => ({ ...a, morningStuck: key }))}
                    />
                  )}

                  {stepIndex === 2 && (
                    <SelectStep
                      title={`When ${displayName} is dragging their feet, what helps most?`}
                      options={MOTIVATION_OPTIONS}
                      selected={answers.motivationStyle}
                      onSelect={(key) => setAnswers((a) => ({ ...a, motivationStyle: key }))}
                    />
                  )}

                  {stepIndex === 3 && (
                    <SelectStep
                      title={`What is a routine task ${displayName} already does like a pro?`}
                      options={MASTERED_OPTIONS}
                      selected={answers.masteredTask}
                      onSelect={(key) => setAnswers((a) => ({ ...a, masteredTask: key }))}
                    />
                  )}

                  {stepIndex === 4 && (
                    <SelectStep
                      title={`How much help does ${displayName} usually need in the morning?`}
                      options={HELP_OPTIONS}
                      selected={answers.helpLevel}
                      onSelect={(key) => setAnswers((a) => ({ ...a, helpLevel: key }))}
                    />
                  )}

                  {stepIndex === 5 && (
                    <SelectStep
                      title={`What is ${displayName}'s natural morning speed?`}
                      options={SPEED_OPTIONS}
                      selected={answers.morningSpeed}
                      onSelect={(key) => setAnswers((a) => ({ ...a, morningSpeed: key }))}
                    />
                  )}
                </ScrollView>
                <View style={styles.grassScene} pointerEvents="none">
                  <Image source={GRASS} style={styles.grass} resizeMode="stretch" />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
                onPress={handleContinue}
                disabled={!canContinue}
                activeOpacity={0.85}
              >
                <Text style={styles.continueText}>Continue</Text>
                <Text style={styles.continueArrow}>→</Text>
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
    </PageBackground>
  );
}

function NameAgeStep({
  childName,
  onChangeName,
  age,
  onChangeAge,
}: {
  childName: string;
  onChangeName: (value: string) => void;
  age: number;
  onChangeAge: (value: number) => void;
}) {
  return (
    <View>
      <Text style={styles.cardTitle}>
        <Text style={styles.heartIcon}>💙 </Text>
        Hi! Let&apos;s get to know your child
      </Text>

      <Text style={styles.fieldLabel}>What&apos;s their name?</Text>
      <View style={styles.inputRow}>
        <Text style={styles.inputIcon}>👤</Text>
        <TextInput
          value={childName}
          onChangeText={onChangeName}
          style={styles.input}
          placeholder="Name"
          placeholderTextColor="#9CB8B8"
          autoCapitalize="words"
          returnKeyType="done"
        />
      </View>

      <Text style={[styles.fieldLabel, { marginTop: vs(22) }]}>How old are they?</Text>
      <View style={styles.inputRow}>
        <Text style={styles.inputIcon}>📅</Text>
        <Text style={styles.ageValue}>{age}</Text>
        <View style={styles.stepperGroup}>
          <TouchableOpacity
            style={styles.stepperButton}
            onPress={() => onChangeAge(age - 1)}
            hitSlop={8}
          >
            <Text style={styles.stepperText}>−</Text>
          </TouchableOpacity>
          <View style={styles.stepperDivider} />
          <TouchableOpacity
            style={styles.stepperButton}
            onPress={() => onChangeAge(age + 1)}
            hitSlop={8}
          >
            <Text style={styles.stepperText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.helperRow}>
        <Text style={styles.heartIconSmall}>💙</Text>
        <Text style={styles.helperText}>
          This helps Kido Coach personalize the experience for your child
        </Text>
      </View>
    </View>
  );
}

function SelectStep<T extends string>({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: Option<T>[];
  selected: T | undefined;
  onSelect: (key: T) => void;
}) {
  return (
    <View>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.optionsList}>
        {options.map((option) => {
          const active = selected === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.option, active && styles.optionSelected]}
              onPress={() => onSelect(option.key)}
              activeOpacity={0.85}
            >
              <View style={[styles.radio, active && styles.radioSelected]}>
                {active && <View style={styles.radioInner} />}
              </View>
              <Text style={[styles.optionLabel, active && styles.optionLabelSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function FinalCard({
  name,
  saving,
  onStart,
}: {
  name: string;
  saving: boolean;
  onStart: () => void;
}) {
  return (
    <View style={styles.cardWrap}>
      <View style={styles.card}>
        <View style={styles.finalContent}>
          <Text style={styles.finalEmoji}>🎉</Text>
          <Text style={styles.finalTitle}>Awesome!</Text>
          <Text style={styles.finalBody}>
            Becky is customizing a routine specifically to help{' '}
            <Text style={styles.finalName}>{name}</Text> build independence, while leaving plenty
            of time for the things they love.
          </Text>
          <Text style={styles.finalCta}>Let&apos;s go!</Text>
        </View>
        <View style={styles.grassScene} pointerEvents="none">
          <Image source={GRASS} style={styles.grass} resizeMode="stretch" />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.continueButton, saving && styles.continueButtonDisabled]}
        onPress={onStart}
        disabled={saving}
        activeOpacity={0.85}
      >
        <Text style={styles.continueText}>{saving ? 'Setting up…' : "Let's go!"}</Text>
        {!saving && <Text style={styles.continueArrow}>→</Text>}
      </TouchableOpacity>
    </View>
  );
}

const TEAL_DARK = colors.teal;
const TEAL = '#3FA9A0';

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  headerPad: {
    paddingHorizontal: s(18),
    paddingTop: vs(6),
  },
  progressWrap: {
    alignItems: 'center',
    marginTop: vs(14),
    marginBottom: vs(8),
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: s(16),
    height: s(16),
    borderRadius: ms(8),
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: 'transparent',
  },
  dotActive: {
    backgroundColor: TEAL_DARK,
    borderColor: TEAL_DARK,
  },
  dotDone: {
    backgroundColor: colors.white,
  },
  dotConnector: {
    width: s(26),
    height: s(2),
    backgroundColor: colors.white,
  },
  progressLabel: {
    marginTop: vs(10),
    fontSize: fs(15),
    fontWeight: '700',
    color: TEAL_DARK,
  },
  cardWrap: {
    flex: 1,
    paddingHorizontal: s(18),
    paddingTop: vs(12),
    paddingBottom: vs(12),
  },
  card: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: colors.white,
    borderRadius: ms(28),
    overflow: 'hidden',
    shadowColor: '#0B5757',
    shadowOpacity: 0.1,
    shadowRadius: ms(16),
    shadowOffset: { width: s(0), height: vs(8) },
    elevation: 4,
  },
  cardScroll: {
    padding: ms(26),
    paddingBottom: vs(190),
  },
  cardBody: {
    flex: 1,
    zIndex: 1,
  },
  grass: {
    width: '100%',
    height: '100%',
  },
  grassScene: {
    position: 'absolute',
    left: s(0),
    right: s(0),
    bottom: vs(0),
    height: s(190),
    width: '100%',
    zIndex: 0,
  },
  cardTitle: {
    fontSize: fs(26),
    lineHeight: fs(32),
    fontWeight: '800',
    color: TEAL_DARK,
    marginBottom: vs(24),
  },
  heartIcon: {
    fontSize: fs(22),
  },
  fieldLabel: {
    fontSize: fs(16),
    fontWeight: '700',
    color: TEAL_DARK,
    marginBottom: vs(10),
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: ms(16),
    borderWidth: 1.5,
    borderColor: '#D6ECEC',
    paddingHorizontal: s(16),
    height: s(60),
  },
  inputIcon: {
    fontSize: fs(20),
    marginRight: s(12),
  },
  input: {
    flex: 1,
    fontSize: fs(20),
    color: '#21413F',
    fontWeight: '600',
  },
  ageValue: {
    flex: 1,
    fontSize: fs(20),
    color: '#21413F',
    fontWeight: '700',
  },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D6ECEC',
    borderRadius: ms(12),
    overflow: 'hidden',
  },
  stepperButton: {
    width: s(46),
    height: s(40),
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperDivider: {
    width: s(1),
    height: s(24),
    backgroundColor: '#D6ECEC',
  },
  stepperText: {
    fontSize: fs(24),
    color: TEAL_DARK,
    fontWeight: '600',
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: vs(26),
    gap: s(8),
  },
  heartIconSmall: {
    fontSize: fs(16),
  },
  helperText: {
    flex: 1,
    fontSize: fs(14),
    lineHeight: fs(20),
    color: '#5C7A78',
    fontWeight: '500',
  },
  optionsList: {
    gap: s(12),
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: ms(16),
    borderWidth: 1.5,
    borderColor: '#D6ECEC',
    paddingHorizontal: s(16),
    paddingVertical: vs(16),
    gap: s(14),
  },
  optionSelected: {
    borderColor: TEAL,
    backgroundColor: '#EAF7F6',
  },
  radio: {
    width: s(24),
    height: s(24),
    borderRadius: ms(12),
    borderWidth: 2,
    borderColor: '#C2DDDD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: TEAL,
  },
  radioInner: {
    width: s(12),
    height: s(12),
    borderRadius: ms(6),
    backgroundColor: TEAL,
  },
  optionLabel: {
    flex: 1,
    fontSize: fs(16),
    color: '#3C5654',
    fontWeight: '600',
  },
  optionLabelSelected: {
    color: TEAL_DARK,
    fontWeight: '700',
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEAL,
    borderRadius: ms(30),
    height: s(60),
    marginTop: vs(16),
    gap: s(12),
    shadowColor: TEAL_DARK,
    shadowOpacity: 0.25,
    shadowRadius: ms(10),
    shadowOffset: { width: s(0), height: vs(4) },
    elevation: 3,
  },
  continueButtonDisabled: {
    backgroundColor: '#A9D2CF',
    shadowOpacity: 0,
  },
  continueText: {
    color: colors.white,
    fontSize: fs(19),
    fontWeight: '800',
  },
  continueArrow: {
    color: colors.white,
    fontSize: fs(20),
    fontWeight: '800',
  },
  finalContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: ms(32),
    paddingBottom: vs(190),
  },
  finalEmoji: {
    fontSize: fs(56),
    marginBottom: vs(16),
  },
  finalTitle: {
    fontSize: fs(30),
    fontWeight: '800',
    color: TEAL_DARK,
    marginBottom: vs(16),
  },
  finalBody: {
    fontSize: fs(18),
    lineHeight: fs(26),
    color: '#3C5654',
    textAlign: 'center',
    fontWeight: '500',
  },
  finalName: {
    color: TEAL_DARK,
    fontWeight: '800',
  },
  finalCta: {
    marginTop: vs(20),
    fontSize: fs(20),
    fontWeight: '800',
    color: TEAL,
  },
});
