import * as admin from 'firebase-admin';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

admin.initializeApp();

const ttsClient = new TextToSpeechClient();
const db = admin.firestore();

interface GenerateTTSRequest {
  cacheKey: string;
  text: string;
  childName: string;
  activityKey: string;
  avatarId: string;
}

interface GenerateTTSResponse {
  audioUrl: string;
  cacheKey: string;
}

/**
 * Firebase Cloud Function: generateRoutineAudio
 *
 * Called by the client when saving a routine to generate personalised TTS audio
 * for each activity step. Saves the .mp3 to Firebase Storage and updates the
 * audio_cache Firestore collection.
 *
 * Input: { cacheKey, text, childName, activityKey, avatarId }
 * Output: { audioUrl, cacheKey }
 */
export const generateRoutineAudio = onCall(
  { timeoutSeconds: 120, memory: '512MiB' },
  async (request: CallableRequest<GenerateTTSRequest>): Promise<GenerateTTSResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { cacheKey, text, childName, activityKey, avatarId } = request.data;

    if (!cacheKey || !text || !childName || !activityKey || !avatarId) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required fields: cacheKey, text, childName, activityKey, avatarId'
      );
    }

    // Sanitize text length to prevent abuse
    if (text.length > 500) {
      throw new HttpsError('invalid-argument', 'Text exceeds maximum length of 500 characters.');
    }

    const cacheRef = db.collection('audio_cache').doc(cacheKey);

    try {
      // Build TTS request
      const [response] = await ttsClient.synthesizeSpeech({
        input: { text },
        voice: {
          languageCode: 'en-US',
          ssmlGender: 'FEMALE',
          name: 'en-US-Neural2-F', // Warm, friendly neural voice
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 0.9,   // Slightly slower for children
          pitch: 2.0,          // Slightly higher for friendliness
          volumeGainDb: 2.0,
        },
      });

      if (!response.audioContent) {
        throw new Error('TTS returned empty audio content.');
      }

      // Write to temp file
      const tmpFilePath = path.join(os.tmpdir(), `${cacheKey}.mp3`);
      fs.writeFileSync(tmpFilePath, response.audioContent as Buffer);

      // Upload to Firebase Storage
      const bucket = admin.storage().bucket();
      const storagePath = `audio/${cacheKey}.mp3`;

      await bucket.upload(tmpFilePath, {
        destination: storagePath,
        metadata: {
          contentType: 'audio/mpeg',
          metadata: {
            childName,
            activityKey,
            avatarId,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      // Clean up temp file
      fs.unlinkSync(tmpFilePath);

      // Make publicly readable and get signed URL valid for 10 years
      const file = bucket.file(storagePath);
      const [audioUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '01-01-2035',
      });

      // Update Firestore cache document
      await cacheRef.set({
        id: cacheKey,
        audioUrl,
        status: 'ready',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        childName,
        activityKey,
        avatarId,
      });

      console.info(`[generateRoutineAudio] Generated: ${cacheKey}`);

      return { audioUrl, cacheKey };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[generateRoutineAudio] Error for ${cacheKey}:`, message);

      // Mark as error in Firestore
      await cacheRef.set({ status: 'error', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      throw new HttpsError('internal', `TTS generation failed: ${message}`);
    }
  });

export const onAudioCacheDeleted = onDocumentDeleted(
  'audio_cache/{cacheKey}',
  async (event) => {
    const cacheKey = event.params.cacheKey;
    const storagePath = `audio/${cacheKey}.mp3`;

    try {
      await admin.storage().bucket().file(storagePath).delete();
      console.info(`[onAudioCacheDeleted] Deleted storage file: ${storagePath}`);
    } catch (err) {
      console.warn(`[onAudioCacheDeleted] Could not delete ${storagePath}:`, err);
    }
  }
);
