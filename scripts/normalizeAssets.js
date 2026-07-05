#!/usr/bin/env node
/**
 * Normalizes raw avatar video assets from ../kids-routine-coach-assets/video/<Folder>/
 * into a flat, upload-ready structure at ../kids-routine-coach-assets/normalized/:
 *   {activityKey}.mp4          <- <Folder>/<Folder>.mp4 (silent loop, no captions)
 *   {activityKey}_captions.mp4 <- <Folder>/<Folder>_caption.mp4
 *
 * Per-folder _audio.mp3 files are intentionally skipped — the app generates personalized
 * TTS audio dynamically per child name via a Cloud Function; these sample mp3s are not used.
 *
 * Run: node scripts/normalizeAssets.js
 */
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(__dirname, '../../kids-routine-coach-assets/video');
const OUTPUT_DIR = path.resolve(__dirname, '../../kids-routine-coach-assets/normalized');

// Folder name -> activityKey. Only folders listed here are processed; everything else is skipped.
const FOLDER_TO_ACTIVITY_KEY = {
  Put_on_Shoes: 'put_shoes_on',
  Drink_Water: 'drink_water',
  Eat_Breakfast: 'eat_breakfast',
  Put_on_Pajamas: 'put_on_pajamas',
  Tidy_Up_Toys: 'tidy_room',
  Bedtime_Story: 'bedtime_story',
  Eat_Dinner: 'eat_dinner',
  Go_to_Sleep: 'go_to_sleep',
  Homework: 'homework',
  make_bed: 'make_bed',
  WakeUp: 'wake_up',
};

// Explicitly excluded per product decision (not silently — logged as "skipped: excluded").
const EXCLUDED_FOLDERS = new Set([
  'Tooth_brush_morning',
  'Brush_Teeth_-_Evening',
  'Wash_Face__Brush_Hair',
  'Encouraging',
  'Encouraging_2',
]);

function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      results.push({ folder: entry.name, status: 'skipped: not a directory' });
      continue;
    }

    const folderName = entry.name;

    if (EXCLUDED_FOLDERS.has(folderName)) {
      results.push({ folder: folderName, status: 'skipped: excluded' });
      continue;
    }

    const activityKey = FOLDER_TO_ACTIVITY_KEY[folderName];
    if (!activityKey) {
      results.push({ folder: folderName, status: 'skipped: no manifest mapping' });
      continue;
    }

    const folderPath = path.join(SOURCE_DIR, folderName);
    const videoSrc = path.join(folderPath, `${folderName}.mp4`);
    const captionSrc = path.join(folderPath, `${folderName}_caption.mp4`);

    let copiedVideo = false;
    let copiedCaption = false;

    if (fs.existsSync(videoSrc)) {
      fs.copyFileSync(videoSrc, path.join(OUTPUT_DIR, `${activityKey}.mp4`));
      copiedVideo = true;
    }

    if (fs.existsSync(captionSrc)) {
      fs.copyFileSync(captionSrc, path.join(OUTPUT_DIR, `${activityKey}_captions.mp4`));
      copiedCaption = true;
    }

    if (!copiedVideo) {
      results.push({ folder: folderName, status: `error: missing ${folderName}.mp4` });
      continue;
    }

    results.push({
      folder: folderName,
      status: `ok -> ${activityKey}.mp4${copiedCaption ? ` + ${activityKey}_captions.mp4` : ' (no captions found)'}`,
    });
  }

  console.log('\nNormalization summary:');
  for (const r of results) {
    console.log(`  ${r.folder.padEnd(28)} ${r.status}`);
  }
  console.log(`\nOutput dir: ${OUTPUT_DIR}`);
}

main();
