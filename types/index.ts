export type ActivityKey =
  | 'brush_teeth'
  | 'get_dressed'
  | 'eat_breakfast'
  | 'pack_backpack'
  | 'wash_face'
  | 'comb_hair'
  | 'put_shoes_on'
  | 'drink_water';

export interface Routine {
  id: string;
  userId: string;
  childName: string;
  avatarId: string;
  scheduledTime: string; // "HH:MM" 24h format
  activityStack: ActivityKey[];
  notificationId?: string;
}

export interface AudioCacheEntry {
  id: string; // {normalizedName}_{activityKey}_{avatarId}
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
