#!/usr/bin/env node
/**
 * Składa js/features/adminApp.js z js/features/admin/**
 * Uruchom: npm run build:admin-js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const adminDir = path.join(root, 'js/features/admin');
const outPath = path.join(root, 'js/features/adminApp.js');

const parts = [
  'shared.js',
  'mixins/ui.js',
  'mixins/auth.js',
  'mixins/data.js',
  'mixins/billing.js',
  'mixins/wizard.js',
  'mixins/integrations.js',
  'app-core.js',
];

const banner =
  '/* GENERATED — nie edytuj ręcznie. Źródło: js/features/admin/ → npm run build:admin-js */\n';

const chunks = parts.map((rel) => {
  const p = path.join(adminDir, rel);
  if (!fs.existsSync(p)) {
    console.error('Brak:', rel);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8').replace(/\n$/, '');
});

const body = `;(function () {
${chunks.join('\n\n')}
})();\n`;

fs.writeFileSync(outPath, banner + body, 'utf8');
console.log('Built', path.relative(root, outPath));
