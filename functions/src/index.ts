import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as TextToSpeech from '@google-cloud/text-to-speech';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

admin.initializeApp();

const ttsClient = new TextToSpeech.TextToSpeechClient();
const db = admin.firestore();
const storage = admin.storage();

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
export const generateRoutineAudio = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data: GenerateTTSRequest, context): Promise<GenerateTTSResponse> => {
    // Validate auth — only authenticated users may call this function
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    const { cacheKey, text, childName, activityKey, avatarId } = data;

    if (!cacheKey || !text || !childName || !activityKey || !avatarId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing required fields: cacheKey, text, childName, activityKey, avatarId'
      );
    }

    // Sanitize text length to prevent abuse
    if (text.length > 500) {
      throw new functions.https.HttpsError('invalid-argument', 'Text exceeds maximum length of 500 characters.');
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
      const bucket = storage.bucket();
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

      functions.logger.info(`[generateRoutineAudio] Generated: ${cacheKey}`);

      return { audioUrl, cacheKey };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      functions.logger.error(`[generateRoutineAudio] Error for ${cacheKey}:`, message);

      // Mark as error in Firestore
      await cacheRef.set({ status: 'error', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      throw new functions.https.HttpsError('internal', `TTS generation failed: ${message}`);
    }
  });

/**
 * Firestore trigger: Clean up Storage files when an audio_cache doc is deleted.
 */
export const onAudioCacheDeleted = functions.firestore
  .document('audio_cache/{cacheKey}')
  .onDelete(async (snap) => {
    const cacheKey = snap.id;
    const storagePath = `audio/${cacheKey}.mp3`;

    try {
      await storage.bucket().file(storagePath).delete();
      functions.logger.info(`[onAudioCacheDeleted] Deleted storage file: ${storagePath}`);
    } catch (err) {
      // File may not exist — log but don't throw
      functions.logger.warn(`[onAudioCacheDeleted] Could not delete ${storagePath}:`, err);
    }
  });
