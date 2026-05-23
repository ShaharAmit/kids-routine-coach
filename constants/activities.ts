import { ActivityMeta } from '../types';

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
};

export const ACTIVITY_KEYS = Object.keys(ACTIVITIES) as Array<keyof typeof ACTIVITIES>;

/** Remote base URL for avatar video assets stored in Firebase Storage */
export const AVATAR_VIDEO_BASE_URL =
  'https://storage.googleapis.com/kids-routine-coach-app.firebasestorage.app/avatars';

/** Remote base URL for generated TTS audio stored in Firebase Storage */
export const AUDIO_BASE_URL =
  'https://storage.googleapis.com/kids-routine-coach-app.firebasestorage.app/audio';
