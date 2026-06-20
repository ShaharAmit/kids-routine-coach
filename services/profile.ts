import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChildProfile, normalizeActivityStack, normalizeStepTimes } from '../types';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const PROFILE_KEY = 'child_profile_v1';

type UserProfileDoc = {
  childName: string;
  age: number;
  voice: ChildProfile['voice'];
  tone: ChildProfile['tone'];
  avatarId: string;
  updatedAt: number;
};

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
    totalStarsEarned: profile.totalStarsEarned ?? 0,
  };
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
}

export async function saveUserProfileDoc(profile: ChildProfile): Promise<void> {
  const payload: UserProfileDoc = {
    childName: profile.childName.trim(),
    age: profile.age,
    voice: profile.voice,
    tone: profile.tone,
    avatarId: profile.avatarId,
    updatedAt: Date.now(),
  };
  await setDoc(doc(db, 'users', profile.userId), payload, { merge: true });
}

export async function getUserProfileDoc(userId: string): Promise<UserProfileDoc | null> {
  if (!userId) return null;
  const snap = await getDoc(doc(db, 'users', userId));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<UserProfileDoc>;
  if (
    typeof data.childName !== 'string' ||
    typeof data.age !== 'number' ||
    !isValidVoice(data.voice) ||
    !isValidTone(data.tone) ||
    typeof data.avatarId !== 'string'
  ) {
    return null;
  }

  return {
    childName: data.childName.trim(),
    age: data.age,
    voice: data.voice,
    tone: data.tone,
    avatarId: data.avatarId,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
  };
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
      totalStarsEarned: typeof parsed.totalStarsEarned === 'number' ? parsed.totalStarsEarned : 0,
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
