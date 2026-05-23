import * as admin from 'firebase-admin';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { GoogleGenAI } from '@google/genai';

admin.initializeApp();

const db = admin.firestore();
const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const geminiModel = 'gemini-3.1-flash-tts-preview';

if (!projectId) {
  throw new Error('Missing GCP project id (GCLOUD_PROJECT / GCP_PROJECT).');
}

const geminiClient = new GoogleGenAI({
  vertexai: true,
  project: projectId,
  location: 'us-central1',
});

interface GenerateTTSRequest {
  cacheKey: string;
  text: string;
  childName: string;
  activityKey: string;
  avatarId: string;
  tone?: 'cheerful' | 'encouraging' | 'calm';
  voice?: 'woman' | 'man';
}

interface GenerateTTSResponse {
  audioUrl: string;
  cacheKey: string;
}

function pcm16ToWav(pcmData: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmData.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16); // PCM fmt chunk size
  wavHeader.writeUInt16LE(1, 20); // Audio format: PCM
  wavHeader.writeUInt16LE(channels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([wavHeader, pcmData]);
}

function extractAudioBuffer(response: unknown): Buffer {
  const candidates = (response as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string | Uint8Array | Buffer } }> } }> }).candidates;
  if (!candidates?.length) {
    throw new Error('Gemini returned no candidates.');
  }

  const parts = candidates[0].content?.parts;
  if (!parts?.length) {
    throw new Error('Gemini returned no audio parts.');
  }

  const audioPart = parts.find((part) => part.inlineData?.data);
  const data = audioPart?.inlineData?.data;
  if (!data) {
    throw new Error('Gemini returned no inline audio data.');
  }

  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (typeof data === 'string') {
    return Buffer.from(data, 'base64');
  }

  return Buffer.from(data);
}

function buildTonePrompt(tone: GenerateTTSRequest['tone'], text: string): string {
  if (tone === 'encouraging') {
    return `Say in an encouraging, supportive way for a child named listener: ${text}`;
  }

  if (tone === 'calm') {
    return `Say in a calm, gentle way for a child named listener: ${text}`;
  }

  return `Say in a cheerful, enthusiastic way for a child named listener: ${text}`;
}

function mapVoiceToGemini(voice: GenerateTTSRequest['voice']): string {
  return voice === 'man' ? 'Kore' : 'Aoede';
}

async function synthesizeWithGeminiTts(
  text: string,
  tone: GenerateTTSRequest['tone'],
  voice: GenerateTTSRequest['voice']
): Promise<Buffer> {
  let lastError: Error | null = null;
  const selectedVoice = mapVoiceToGemini(voice);
  const prompt = buildTonePrompt(tone, text);

  // Gemini 3.1 Flash TTS can occasionally return no audio; retry a few times.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await geminiClient.models.generateContent({
        model: geminiModel,
        contents: prompt,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: selectedVoice,
              },
            },
          },
        },
      });

      return extractAudioBuffer(response);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error('Unknown Gemini TTS error');
    }
  }

  throw lastError || new Error('Gemini TTS failed after retries.');
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
    const { cacheKey, text, childName, activityKey, avatarId, tone, voice } = request.data;

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
      const selectedVoice = mapVoiceToGemini(voice);
      const selectedTone = tone ?? 'cheerful';
      const rawPcmBuffer = await synthesizeWithGeminiTts(text, selectedTone, voice);
      const audioBuffer = pcm16ToWav(rawPcmBuffer);

      // Write to temp file
      const tmpFilePath = path.join(os.tmpdir(), `${cacheKey}.wav`);
      fs.writeFileSync(tmpFilePath, audioBuffer);

      // Upload to Firebase Storage
      const bucket = admin.storage().bucket();
      const storagePath = `audio/${cacheKey}.wav`;

      await bucket.upload(tmpFilePath, {
        destination: storagePath,
        metadata: {
          contentType: 'audio/wav',
          metadata: {
            childName,
            activityKey,
            avatarId,
            ttsProvider: 'gemini',
            ttsModel: geminiModel,
            ttsVoice: selectedVoice,
            ttsTone: selectedTone,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      // Clean up temp file
      fs.unlinkSync(tmpFilePath);

      // Make publicly readable and return a stable public URL.
      const file = bucket.file(storagePath);
      await file.makePublic();
      const audioUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

      // Update Firestore cache document
      await cacheRef.set({
        id: cacheKey,
        audioUrl,
        status: 'ready',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        childName,
        activityKey,
        avatarId,
        tone: selectedTone,
        voice: voice ?? 'woman',
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

export const onAudioCacheDocDeleted = onDocumentDeleted(
  'audio_cache/{cacheKey}',
  async (event) => {
    const cacheKey = event.params.cacheKey;
    const storagePaths = [`audio/${cacheKey}.wav`, `audio/${cacheKey}.mp3`];

    for (const storagePath of storagePaths) {
      try {
        await admin.storage().bucket().file(storagePath).delete();
        console.info(`[onAudioCacheDeleted] Deleted storage file: ${storagePath}`);
      } catch (err) {
        console.warn(`[onAudioCacheDeleted] Could not delete ${storagePath}:`, err);
      }
    }
  }
);
