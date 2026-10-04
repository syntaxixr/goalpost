#!/usr/bin/env node
// Renders docs/media/banner.png (README header and GitHub social preview, 1280x640) and
// docs/media/teaser.gif (short loop of the demo for the README) from goalpost.mp4.
//   node docs/media/make-banner.mjs        needs Edge or Chrome, and ffmpeg on PATH
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(HERE, 'banner.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(HERE, 'banner.png') });
  console.log('banner.png');
} finally {
  await browser.close();
}

// Teaser: the claim and the hidden score without goalpost, then the audit and the score with it.
const video = path.join(HERE, 'goalpost.mp4');
const parts = [[3.0, 7.4], [26.5, 34.5], [62.5, 71.5]];
const filter = parts.map(([a, b], i) => `[0:v]trim=${a}:${b},setpts=PTS-STARTPTS,fps=10,scale=960:-1:flags=lanczos[v${i}]`).join(';')
  + `;${parts.map((_, i) => `[v${i}]`).join('')}concat=n=${parts.length}:v=1:a=0,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-filter_complex', filter, '-loop', '0', path.join(HERE, 'teaser.gif')]);
console.log(`teaser.gif: ${(fs.statSync(path.join(HERE, 'teaser.gif')).size / 1e6).toFixed(1)} MB`);
