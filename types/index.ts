export type ActivityKey =
  | 'brush_teeth'
  | 'get_dressed'
  | 'eat_breakfast'
  | 'pack_backpack'
  | 'wash_face'
  | 'comb_hair'
  | 'put_shoes_on'
  | 'drink_water'
  | 'tidy_room'
  | 'use_toilet'
  | 'read_book'
  | 'put_on_pajamas';

export type ToneOption = 'cheerful' | 'encouraging' | 'calm';
export type VoiceOption = 'woman' | 'man';
export type ChildGender = 'boy' | 'girl';
export type ActivityStep = ActivityKey[];

export interface Routine {
  id: string;
  userId: string;
  childName: string;
  childAge?: number;
  avatarId: string;
  scheduledTime: string; // "HH:MM" 24h format
  activityStack: ActivityStep[];
  stepTimes?: string[];
  tone?: ToneOption;
  voice?: VoiceOption;
  notificationId?: string;
}

export interface ChildProfile {
  userId: string;
  childName: string;
  age: number;
  gender: ChildGender;
  avatarId: string;
  voice: VoiceOption;
  tone: ToneOption;
  scheduledTime: string;
  activityStack: ActivityStep[];
  stepTimes?: string[];
  updatedAt: number;
}

export interface AudioCacheEntry {
  id: string; // {normalizedName}_{activityKey}_{avatarId}_{tone}_{voice}
  audioUrl: string;
  status: 'pending' | 'generating' | 'ready' | 'error';
  createdAt?: number;
}

export interface ActivityMeta {
  key: ActivityKey;
  label: string;
  promptTemplate: (childName: string) => string;
  videoFile: string; // local filename e.g. "brush_teeth.mp4"
  emoji: string;
  color: string;
}

export function normalizeActivityStack(
  stack: ActivityKey[] | ActivityStep[]
): ActivityStep[] {
  if (!Array.isArray(stack)) return [];
  if (stack.length === 0) return [];

  const first = stack[0] as unknown;
  if (typeof first === 'string') {
    return (stack as ActivityKey[]).map((key) => [key]);
  }

  return (stack as ActivityStep[]).filter((step) => Array.isArray(step) && step.length > 0);
}

export function normalizeStepTimes(
  stepTimes: string[] | undefined,
  stack: ActivityStep[],
  fallbackTime: string
): string[] {
  const source = Array.isArray(stepTimes) ? stepTimes : [];
  const normalized: string[] = [];

  for (let i = 0; i < stack.length; i += 1) {
    normalized.push(source[i] ?? fallbackTime);
  }

  return normalized;
}
