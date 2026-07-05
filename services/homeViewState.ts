/**
 * Tiny in-memory pub/sub so the root layout (which renders the moon/sun decoration above the
 * Routines tab) knows whether the home screen is showing the task list or the full-screen
 * activity player, without needing a React context. The decoration should only ever appear
 * over the task list — not floating on top of the avatar video during a mission.
 */
type HomeViewMode = 'tasks' | 'player';

let currentMode: HomeViewMode = 'tasks';
const listeners = new Set<(mode: HomeViewMode) => void>();

export function setHomeViewMode(mode: HomeViewMode): void {
  currentMode = mode;
  listeners.forEach((listener) => listener(mode));
}

export function getHomeViewMode(): HomeViewMode {
  return currentMode;
}

export function subscribeHomeViewMode(listener: (mode: HomeViewMode) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
