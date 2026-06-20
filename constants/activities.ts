import { ActivityMeta } from '../types';

export interface ActivityConfig {
  id: string;
  uiTitle: string;
  uiEmoji: string;
  defaultTTSPhrase: string; // Used by Cloud Function for Gemini TTS
  avatarVideoRef: string;   // Reference to fetch from CDN -> FileSystem.documentDirectory
}

export const ADDITIONAL_ACTIVITIES: ActivityConfig[] = [
  {
    id: 'tidy_room',
    uiTitle: 'Tidy Room',
    uiEmoji: '🧸',
    defaultTTSPhrase: 'Great job {childName}! Now, let\'s tidy up our room.',
    avatarVideoRef: 'avatar_loop_tidy_room.mp4',
  },
  {
    id: 'take_shower',
    uiTitle: 'Take a Shower',
    uiEmoji: '🚿',
    defaultTTSPhrase: 'Time for a refreshing shower, {childName}!',
    avatarVideoRef: 'avatar_loop_use_toilet.mp4',
  },
  {
    id: 'read_book',
    uiTitle: 'Read a Book',
    uiEmoji: '📚',
    defaultTTSPhrase: 'Let\'s read a fun book together, {childName}.',
    avatarVideoRef: 'avatar_loop_read_book.mp4',
  },
  {
    id: 'put_on_pajamas',
    uiTitle: 'Put on Pajamas',
    uiEmoji: '👕',
    defaultTTSPhrase: 'Time to get cozy, {childName}. Let\'s put on our pajamas!',
    avatarVideoRef: 'avatar_loop_pajamas.mp4',
  },
];

export const ACTIVITIES: Record<string, ActivityMeta> = {
  brush_teeth: {
    key: 'brush_teeth',
    label: 'Brush Teeth',
    promptTemplate: (name) => `Good morning, ${name}. It is time to brush your teeth for a bright, sparkly smile.`,
    videoFile: 'brush_teeth.mp4',
    emoji: '🦷',
    color: '#4FC3F7',
  },
  get_dressed: {
    key: 'get_dressed',
    label: 'Get Dressed',
    promptTemplate: (name) => `Great job, ${name}. Now let us get dressed and ready for an amazing day.`,
    videoFile: 'get_dressed.mp4',
    emoji: '👕',
    color: '#81C784',
  },
  eat_breakfast: {
    key: 'eat_breakfast',
    label: 'Eat Breakfast',
    promptTemplate: (name) => `Superstar ${name}, it is breakfast time. Let us eat and fill up with energy for the day.`,
    videoFile: 'eat_breakfast.mp4',
    emoji: '🥞',
    color: '#FFB74D',
  },
  pack_backpack: {
    key: 'pack_backpack',
    label: 'Pack Backpack',
    promptTemplate: (name) => `You are doing great, ${name}. Let us pack your backpack so you are ready for school.`,
    videoFile: 'pack_backpack.mp4',
    emoji: '🎒',
    color: '#BA68C8',
  },
  wash_face: {
    key: 'wash_face',
    label: 'Wash Face',
    promptTemplate: (name) => `Rise and shine, ${name}. Let us wash your face and feel fresh and awake.`,
    videoFile: 'wash_face.mp4',
    emoji: '🚿',
    color: '#4DD0E1',
  },
  comb_hair: {
    key: 'comb_hair',
    label: 'Comb Hair',
    promptTemplate: (name) => `Looking good, ${name}. Time to comb your hair so you can look your best.`,
    videoFile: 'comb_hair.mp4',
    emoji: '💇',
    color: '#F06292',
  },
  put_shoes_on: {
    key: 'put_shoes_on',
    label: 'Put Shoes On',
    promptTemplate: (name) => `Almost ready, ${name}. Put your shoes on, and we are good to go.`,
    videoFile: 'put_shoes_on.mp4',
    emoji: '👟',
    color: '#A1887F',
  },
  drink_water: {
    key: 'drink_water',
    label: 'Drink Water',
    promptTemplate: (name) => `Stay healthy, ${name}. Let us drink a big glass of water.`,
    videoFile: 'drink_water.mp4',
    emoji: '💧',
    color: '#29B6F6',
  },
  tidy_room: {
    key: 'tidy_room',
    label: 'Tidy Room',
    promptTemplate: (name) => `Great job ${name}! Now, let us tidy up our room.`,
    videoFile: 'avatar_loop_tidy_room.mp4',
    emoji: '🧸',
    color: '#7E57C2',
  },
  take_shower: {
    key: 'take_shower',
    label: 'Take a Shower',
    promptTemplate: (name) => `Time for a refreshing shower, ${name}!`,
    videoFile: 'avatar_loop_use_toilet.mp4',
    emoji: '🚿',
    color: '#26A69A',
  },
  read_book: {
    key: 'read_book',
    label: 'Read a Book',
    promptTemplate: (name) => `Let us read a fun book together, ${name}.`,
    videoFile: 'avatar_loop_read_book.mp4',
    emoji: '📚',
    color: '#5C6BC0',
  },
  put_on_pajamas: {
    key: 'put_on_pajamas',
    label: 'Put on Pajamas',
    promptTemplate: (name) => `Time to get cozy, ${name}. Let us put on our pajamas!`,
    videoFile: 'avatar_loop_pajamas.mp4',
    emoji: '👕',
    color: '#EC407A',
  },
};

export const ACTIVITY_KEYS = Object.keys(ACTIVITIES) as Array<keyof typeof ACTIVITIES>;

/** Remote base URL for avatar video assets stored in Firebase Storage */
export const AVATAR_VIDEO_BASE_URL =
  'https://storage.googleapis.com/kids-routine-coach-app.firebasestorage.app/avatars';

/** Remote base URL for generated TTS audio stored in Firebase Storage */
export const AUDIO_BASE_URL =
  'https://storage.googleapis.com/kids-routine-coach-app.firebasestorage.app/audio';
