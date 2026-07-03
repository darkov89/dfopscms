#!/usr/bin/env node
/**
 * Emituje data/seeds/demo_pages.json z migracji katalogowej demo (6 slugów).
 * Uruchom z korzenia repo: node scripts/extract-demo-seeds-from-migration.mjs
 *
 * Domyślne wejście: supabase/migrations/20260616150000_seed_demo_catalog_pages.sql
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const defaultSql = path.join(root, 'supabase/migrations/20260616150000_seed_demo_catalog_pages.sql');
const sqlPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultSql;
const outPath = path.join(root, 'data', 'seeds', 'demo_pages.json');

const sql = fs.readFileSync(sqlPath, 'utf8');
const seeds = [];
const re =
  /SELECT '([^']+)'::text AS slug, '([^']+)'::text AS theme, '([^']+)'::text AS color_preset, '((?:''|[^'])*)'::jsonb AS content/g;

let m;
while ((m = re.exec(sql)) !== null) {
  const slug = m[1];
  const theme = m[2];
  const color_preset = m[3];
  const jsonStr = m[4].replace(/''/g, "'");
  const content = JSON.parse(jsonStr);
  if (content.pl?.settings) content.pl.settings.color_preset = color_preset;
  seeds.push({ slug, theme, content });
}

if (seeds.length < 1) {
  console.error('Nie znaleziono seedów w', sqlPath);
  process.exit(1);
}

const doc = {
  meta: {
    description: 'Oficjalne demo katalogowe DFCMS (6 szablonów).',
    source_migration: path.relative(root, sqlPath),
    updated: new Date().toISOString().slice(0, 10),
    regenerate: 'node scripts/extract-demo-seeds-from-migration.mjs',
  },
  seeds,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log('Wrote', path.relative(root, outPath), `(${seeds.length} seeds, ${seeds.map((s) => s.slug).join(', ')})`);
