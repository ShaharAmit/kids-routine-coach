import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';

/**
 * Derives the local poster path from the local video URI.
 * e.g. file:///...documentDirectory/welcome/welcome.mp4
 *   →  file:///...documentDirectory/welcome/welcome.jpg
 */
function getLocalPosterUri(localVideoUri: string): string {
  return localVideoUri.replace(/\.[^./?#]+$/, '.jpg');
}

/**
 * Returns the local file URI for the poster image of a given cached video.
 *
 * On first call: generates a JPEG thumbnail at 50 ms via the native
 * VideoThumbnails API and moves it into documentDirectory alongside the video.
 * On subsequent calls: returns the cached file immediately (no network, no work).
 *
 * This replaces the canvas-based extractPosterFrame which can never run on iOS
 * without a user gesture.
 */
export async function getOrExtractMobilePoster(localVideoUri: string): Promise<string> {
  if (!localVideoUri) return '';

  const localPosterUri = getLocalPosterUri(localVideoUri);

  try {
    // Fast-path: poster already cached on disk.
    const fileInfo = await FileSystem.getInfoAsync(localPosterUri);
    if (fileInfo.exists) {
      return localPosterUri;
    }

    // Generate thumbnail at 50 ms to avoid the black 0 ms frame.
    const { uri: tempUri } = await VideoThumbnails.getThumbnailAsync(localVideoUri, {
      time: 50,
      quality: 0.8,
    });

    // Move from the system temp cache to our persistent document directory.
    await FileSystem.moveAsync({ from: tempUri, to: localPosterUri });

    return localPosterUri;
  } catch (error) {
    console.warn('[mobileVideoCache] Failed to extract/cache thumbnail:', error);
    return '';
  }
}

/**
 * Removes the cached poster for a given video URI.
 * Call this whenever the underlying video is replaced (e.g. new welcome.mp4 downloaded).
 */
export async function evictMobilePoster(localVideoUri: string): Promise<void> {
  if (!localVideoUri) return;
  const localPosterUri = getLocalPosterUri(localVideoUri);
  try {
    await FileSystem.deleteAsync(localPosterUri, { idempotent: true });
  } catch {
    // Best-effort; stale poster is harmless.
  }
}
