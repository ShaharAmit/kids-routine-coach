#!/usr/bin/env node
/**
 * Uploads normalized avatar videos to Firebase Storage under avatars/<AVATAR_ID>/.
 *
 * Relies on `gsutil` being authenticated locally (already the case via `firebase login` / gcloud ADC).
 * Relies on existing storage.rules (`avatars/{allPaths=**}` -> public read) — no bucket ACL changes needed,
 * since Firebase client reads go through Firebase Storage security rules, not raw bucket IAM.
 *
 * Run: node scripts/uploadAvatarAssets.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AVATAR_ID = 'becky';
const BUCKET = 'kids-routine-coach-app.firebasestorage.app';
const NORMALIZED_DIR = path.resolve(__dirname, '../../kids-routine-coach-assets/normalized');
const DEST_PREFIX = `gs://${BUCKET}/avatars/${AVATAR_ID}/`;

function main() {
  if (!fs.existsSync(NORMALIZED_DIR)) {
    console.error(`Normalized assets dir not found: ${NORMALIZED_DIR}`);
    console.error('Run `node scripts/normalizeAssets.js` first.');
    process.exit(1);
  }

  const files = fs.readdirSync(NORMALIZED_DIR).filter((f) => f.endsWith('.mp4'));
  if (files.length === 0) {
    console.error(`No .mp4 files found in ${NORMALIZED_DIR}`);
    process.exit(1);
  }

  console.log(`Uploading ${files.length} file(s) to ${DEST_PREFIX} ...\n`);

  for (const file of files) {
    const localPath = path.join(NORMALIZED_DIR, file);
    const destPath = `${DEST_PREFIX}${file}`;
    console.log(`  ${file} -> ${destPath}`);
    execFileSync('gsutil', ['-h', 'Cache-Control:public, max-age=604800', 'cp', localPath, destPath], {
      stdio: 'inherit',
    });
  }

  console.log('\nUpload complete.');
}

main();
