import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChildProfile, normalizeActivityStack, normalizeStepTimes } from '../types';

const PROFILE_KEY = 'child_profile_v1';

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
    const parsed = JSON.parse(raw) as ChildProfile;
    const normalizedStack = normalizeActivityStack((parsed as any).activityStack ?? []);
    const fallbackTime = parsed.scheduledTime ?? '08:00';
    return {
      ...parsed,
      scheduledTime: fallbackTime,
      activityStack: normalizedStack,
      stepTimes: normalizeStepTimes((parsed as any).stepTimes, normalizedStack, fallbackTime),
    };
  } catch {
    return null;
  }
}

export async function clearChildProfile(): Promise<void> {
  await AsyncStorage.removeItem(PROFILE_KEY);
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  const profile = await getChildProfile();
  return !!profile;
}
