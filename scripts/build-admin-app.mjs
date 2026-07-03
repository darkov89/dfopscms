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

/** Kolejność składania — billingView w tym samym scope co mixiny (bez zagnieżdżonego IIFE / window). */
const parts = [
  { file: path.join(adminDir, 'shared.js'), label: 'shared.js' },
  { file: path.join(adminDir, 'billingView.js'), label: 'billingView.js' },
  { file: path.join(adminDir, 'mixins/ui.js'), label: 'mixins/ui.js' },
  { file: path.join(adminDir, 'mixins/auth.js'), label: 'mixins/auth.js' },
  { file: path.join(adminDir, 'mixins/data.js'), label: 'mixins/data.js' },
  { file: path.join(adminDir, 'mixins/billing.js'), label: 'mixins/billing.js' },
  { file: path.join(adminDir, 'mixins/wizard.js'), label: 'mixins/wizard.js' },
  { file: path.join(adminDir, 'mixins/integrations.js'), label: 'mixins/integrations.js' },
  { file: path.join(adminDir, 'app-core.js'), label: 'app-core.js' },
];

const banner =
  '/* GENERATED — nie edytuj ręcznie. Źródło: js/features/admin/ → npm run build:admin-js */\n';

const chunks = parts.map(({ file, label }) => {
  if (!fs.existsSync(file)) {
    console.error('Brak:', label);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8').replace(/\n$/, '');
});

const body = `;(function () {
${chunks.join('\n\n')}
})();\n`;

fs.writeFileSync(outPath, banner + body, 'utf8');
console.log('Built', path.relative(root, outPath));
