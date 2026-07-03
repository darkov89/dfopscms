#!/usr/bin/env node
/**
 * Składa admin.html z admin/partials/*.html (kolejność: admin/manifest.json).
 * Uruchom: npm run build:admin
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'admin', 'manifest.json');
const partialsDir = path.join(root, 'admin', 'partials');
const outPath = path.join(root, 'admin.html');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const partials = manifest.partials;
if (!Array.isArray(partials) || partials.length < 1) {
  console.error('Brak partials w admin/manifest.json');
  process.exit(1);
}

const banner = `<!-- GENERATED — nie edytuj ręcznie. Źródło: admin/partials/ → npm run build:admin -->\n`;
const body = partials
  .map((name) => {
    const p = path.join(partialsDir, name);
    if (!fs.existsSync(p)) {
      console.error('Brak partiala:', name);
      process.exit(1);
    }
    return fs.readFileSync(p, 'utf8');
  })
  .join('');

fs.writeFileSync(outPath, banner + body, 'utf8');
console.log(`Built ${path.relative(root, outPath)} from ${partials.length} partials`);
