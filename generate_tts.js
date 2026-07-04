const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getSecretFromGCP() {
  try {
    console.log('Fetching GEMINI_API_KEY fresh from GCP Secret Manager via Firebase CLI...');
    const output = execSync('firebase functions:secrets:access GEMINI_API_KEY', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'] // ignore stderr to handle errors gracefully
    });
    return output.trim();
  } catch (error) {
    return null;
  }
}

function pcm16ToWav(pcmData, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
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

async function main() {
  // Try to fetch fresh from GCP first
  let apiKey = getSecretFromGCP();

  if (apiKey) {
    console.log('Successfully retrieved secret from GCP Secret Manager.');
  } else {
    console.log('Could not retrieve secret from GCP. Checking local .env file...');
    // Read .env file in the root as a fallback
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/^(GEMINI_API|GEMINI_API_KEY)=(.+)$/m);
      if (match) {
        apiKey = match[2].trim().replace(/['"]/g, ''); // strip optional quotes
      }
    }
  }

  // Fallback to environment variable
  if (!apiKey) {
    apiKey = process.env.GEMINI_API || process.env.GEMINI_API_KEY;
  }

  if (!apiKey) {
    console.error('Error: GEMINI_API key not found.');
    console.error('Please make sure you are logged in to Firebase CLI (`firebase login`) and the secret is set,');
    console.error('or define GEMINI_API=your_api_key in the .env file in the root of the project.');
    process.exit(1);
  }

  // Default values
  let text = 'Good morning, Anesthesia! The sun is up, and a brand new adventure is waiting for us! Let\'s stretch those arms high to the sky, open those eyes, and get this day started! I\'m ready when you are!';
  let prompt = 'excited';
  let voiceName = 'Aoede';
  let outputFilename = 'output.wav';

  // Parse command line arguments if provided
  // Usage: node generate_tts.js "[Text to synthesize]" "[Emotion/Prompt]" "[output_file_name.wav]"
  if (process.argv[2]) {
    text = process.argv[2];
  }
  if (process.argv[3]) {
    prompt = process.argv[3];
  }
  if (process.argv[4]) {
    outputFilename = process.argv[4];
  }

  // Format content with style instruction if present
  const promptContent = prompt ? `Say in an ${prompt.trim()} style: ${text}` : text;

  const payload = {
    contents: [
      {
        parts: [
          {
            text: promptContent
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voiceName
          }
        }
      }
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`;

  console.log(`Text to synthesize: "${text}"`);
  console.log(`Prompt / Style   : "${prompt}"`);
  console.log('Sending request to Gemini AI Studio API (v1beta)...');
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned status ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.candidates || result.candidates.length === 0) {
      throw new Error('API response did not contain candidates.');
    }

    const parts = result.candidates[0].content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error('API response did not contain content parts.');
    }

    const audioPart = parts.find((part) => part.inlineData && part.inlineData.data);
    if (!audioPart || !audioPart.inlineData.data) {
      throw new Error('API response did not contain inline audio data.');
    }

    // Decode base64 audio content (raw PCM 24kHz mono)
    const rawPcmBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
    
    // Wrap raw PCM in a WAV header
    const wavBuffer = pcm16ToWav(rawPcmBuffer, 24000, 1, 16);

    const outputPath = path.resolve(__dirname, outputFilename);
    fs.writeFileSync(outputPath, wavBuffer);
    
    console.log(`\nSuccess! Audio generated and saved to: ${outputPath}`);
  } catch (error) {
    console.error('\nError generating TTS:', error.message);
    process.exit(1);
  }
}

main();
