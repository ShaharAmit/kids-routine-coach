import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChildProfile, normalizeActivityStack, normalizeStepTimes } from '../types';

const PROFILE_KEY = 'child_profile_v1';

function isValidGender(value: unknown): value is ChildProfile['gender'] {
  return value === 'boy' || value === 'girl';
}

function isValidVoice(value: unknown): value is ChildProfile['voice'] {
  return value === 'woman' || value === 'man';
}

function isValidTone(value: unknown): value is ChildProfile['tone'] {
  return value === 'cheerful' || value === 'encouraging' || value === 'calm';
}

async function removeInvalidProfile(reason: string): Promise<null> {
  console.warn('[Profile] clearing invalid stored profile:', reason);
  await AsyncStorage.removeItem(PROFILE_KEY);
  return null;
}

export async function saveChildProfile(profile: ChildProfile): Promise<void> {
  const normalizedStack = normalizeActivityStack(profile.activityStack);
  const normalized: ChildProfile = {
    ...profile,
    activityStack: normalizedStack,
    stepTimes: normalizeStepTimes(profile.stepTimes, normalizedStack, profile.scheduledTime),
  };
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
}

export async function getChildProfile(): Promise<ChildProfile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ChildProfile>;
    if (!parsed || typeof parsed !== 'object') {
      return removeInvalidProfile('not-an-object');
    }

    if (typeof parsed.userId !== 'string' || parsed.userId.trim().length === 0) {
      return removeInvalidProfile('missing-user-id');
    }

    if (typeof parsed.childName !== 'string' || parsed.childName.trim().length === 0) {
      return removeInvalidProfile('missing-child-name');
    }

    if (typeof parsed.age !== 'number' || !Number.isFinite(parsed.age) || parsed.age < 2 || parsed.age > 17) {
      return removeInvalidProfile('invalid-age');
    }

    if (!isValidGender(parsed.gender) || !isValidVoice(parsed.voice) || !isValidTone(parsed.tone)) {
      return removeInvalidProfile('invalid-preferences');
    }

    if (typeof parsed.avatarId !== 'string' || parsed.avatarId.trim().length === 0) {
      return removeInvalidProfile('missing-avatar-id');
    }

    const normalizedStack = normalizeActivityStack((parsed as any).activityStack ?? []);
    if (normalizedStack.length === 0) {
      return removeInvalidProfile('empty-activity-stack');
    }

    const fallbackTime = parsed.scheduledTime ?? '08:00';

    return {
      ...parsed,
      childName: parsed.childName.trim(),
      scheduledTime: fallbackTime,
      activityStack: normalizedStack,
      stepTimes: normalizeStepTimes((parsed as any).stepTimes, normalizedStack, fallbackTime),
      answers: (parsed as any).answers ?? undefined,
    } as ChildProfile;
  } catch {
    return removeInvalidProfile('json-parse-failure');
  }
}

export async function clearChildProfile(): Promise<void> {
  await AsyncStorage.removeItem(PROFILE_KEY);
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  const profile = await getChildProfile();
  return !!profile;
}
