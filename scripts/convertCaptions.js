#!/usr/bin/env node
/**
 * Converts the .srt subtitle files at ../kids-routine-coach-assets/video/*.srt into compact
 * JSON caption cue files at ../kids-routine-coach-assets/normalized/{activityKey}_captions.json.
 *
 * Each output file is an array of cues: [{ start: number, end: number, text: string }]
 * where start/end are in seconds. Consumed by ActivityPlayer as a timed text overlay.
 *
 * Run: node scripts/convertCaptions.js
 */
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(__dirname, '../../kids-routine-coach-assets/video');
const OUTPUT_DIR = path.resolve(__dirname, '../../kids-routine-coach-assets/normalized');

// .srt filename (without "-caption.srt" suffix) -> activityKey. Only files listed here are
// processed; everything else is skipped (matches the exclusions in normalizeAssets.js).
const SRT_NAME_TO_ACTIVITY_KEY = {
  'Bedtime Story': 'bedtime_story',
  'Drink Water': 'drink_water',
  'Eat Dinner': 'eat_dinner',
  Eat_Breakfast: 'eat_breakfast',
  Go_to_Sleep: 'go_to_sleep',
  Homework: 'homework',
  make_bed: 'make_bed',
  'Put on Pajamas': 'put_on_pajamas',
  'Put on Shoes': 'put_shoes_on',
  Tidy_Up_Toys: 'tidy_room',
  WakeUp: 'wake_up',
};

const EXCLUDED_NAMES = new Set([
  'Brush Teeth - Evening',
  'Encouraging',
  'Encouraging 2',
  'Tooth_brush morning',
  'Wash Face & Brush Hair',
]);

function srtTimeToSeconds(time) {
  // "00:00:04,222" -> 4.222
  const match = time.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

function parseSrt(content) {
  const cues = [];
  // Blocks are separated by a blank line; normalize line endings first.
  const blocks = content.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // First line is the cue index (numeric) — skip it. Second line is the timing range.
    const timingLine = lines[1]?.includes('-->') ? lines[1] : lines[0];
    const timingMatch = timingLine.match(/([\d:,.]+)\s*-->\s*([\d:,.]+)/);
    if (!timingMatch) continue;

    const textStartIndex = lines[1]?.includes('-->') ? 2 : 1;
    const text = lines
      .slice(textStartIndex)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) continue;

    cues.push({
      start: srtTimeToSeconds(timingMatch[1]),
      end: srtTimeToSeconds(timingMatch[2]),
      text,
    });
  }

  return cues;
}

function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const srtFiles = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.srt'));
  const results = [];

  for (const fileName of srtFiles) {
    const baseName = fileName.replace(/-caption\.srt$/, '');

    if (EXCLUDED_NAMES.has(baseName)) {
      results.push({ file: fileName, status: 'skipped: excluded' });
      continue;
    }

    const activityKey = SRT_NAME_TO_ACTIVITY_KEY[baseName];
    if (!activityKey) {
      results.push({ file: fileName, status: 'skipped: no manifest mapping' });
      continue;
    }

    const content = fs.readFileSync(path.join(SOURCE_DIR, fileName), 'utf-8');
    const cues = parseSrt(content);

    if (cues.length === 0) {
      results.push({ file: fileName, status: 'error: no cues parsed' });
      continue;
    }

    const outPath = path.join(OUTPUT_DIR, `${activityKey}_captions.json`);
    fs.writeFileSync(outPath, JSON.stringify(cues));
    results.push({ file: fileName, status: `ok -> ${activityKey}_captions.json (${cues.length} cues)` });
  }

  console.log('\nCaption conversion results:\n');
  for (const r of results) {
    console.log(`  ${r.file.padEnd(40)} ${r.status}`);
  }
}

main();
