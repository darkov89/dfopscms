#!/usr/bin/env node
/**
 * Generuje docs/DFCMS-Architecture-and-Flow.pdf z docs/DFCMS-Architecture-and-Flow.html
 * Wymaga Google Chrome (macOS) lub ustaw CHROME_PATH.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = path.join(root, 'docs/DFCMS-Architecture-and-Flow.html');
const pdf = path.join(root, 'docs/DFCMS-Architecture-and-Flow.pdf');

const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
].filter(Boolean);

let chrome = null;
for (const c of chromeCandidates) {
  if (c.includes(path.sep) ? fs.existsSync(c) : true) {
    chrome = c;
    break;
  }
}

if (!chrome) {
  console.error('Nie znaleziono Chrome. Ustaw CHROME_PATH lub zainstaluj Google Chrome.');
  process.exit(1);
}

if (!fs.existsSync(html)) {
  console.error('Brak pliku:', html);
  process.exit(1);
}

const url = `file://${html}`;
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--virtual-time-budget=25000',
  '--run-all-compositor-stages-before-draw',
  `--print-to-pdf=${pdf}`,
  url,
];

const r = spawnSync(chrome, args, { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout || 'Chrome zakończył się błędem');
  process.exit(r.status ?? 1);
}

if (!fs.existsSync(pdf)) {
  console.error('PDF nie został utworzony:', pdf);
  process.exit(1);
}

const stat = fs.statSync(pdf);
console.log(`OK: ${pdf} (${Math.round(stat.size / 1024)} KB)`);
