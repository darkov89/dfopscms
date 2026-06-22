#!/usr/bin/env node
/**
 * Czyta data/seeds/demo_pages.json i emituje migrację Postgres (UPSERT po slug).
 * Uruchom z korzenia repo: node scripts/generate-demo-pages-migration.mjs [timestamp]
 *
 * Domyślny plik wyjściowy: supabase/migrations/<timestamp>_seed_demo_catalog_pages.sql
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const seedsPath = path.join(root, 'data', 'seeds', 'demo_pages.json');

const stamp = process.argv[2] || '20260503140000';
const outFile = path.join(root, 'supabase', 'migrations', `${stamp}_seed_demo_catalog_pages.sql`);

const raw = fs.readFileSync(seedsPath, 'utf8');
const doc = JSON.parse(raw);

if (!Array.isArray(doc.seeds) || doc.seeds.length < 1) {
  console.error('Brak seeds w data/seeds/demo_pages.json');
  process.exit(1);
}

function sqlTxt(s) {
  return "'" + String(s).replace(/'/g, "''") + "'::text";
}

function sqlJsonb(obj) {
  const j = JSON.stringify(obj);
  return "'" + j.replace(/'/g, "''") + "'::jsonb";
}

const parts = [];
for (const s of doc.seeds) {
  const slug = String(s.slug || '').trim();
  const theme = String(s.theme || '').trim();
  if (!slug || !theme || !s.content) continue;

  const preset =
    s.content?.pl?.settings?.color_preset != null && String(s.content.pl.settings.color_preset).trim() !== ''
      ? String(s.content.pl.settings.color_preset).trim()
      : 'gold';

  parts.push(
    `SELECT ${sqlTxt(slug)} AS slug, ${sqlTxt(theme)} AS theme, ${sqlTxt(preset)} AS color_preset, ${sqlJsonb(
      s.content,
    )} AS content`,
  );
}

if (!parts.length) {
  console.error('Żaden poprawny seed');
  process.exit(1);
}

const sql = `-- Demo: strony katalogowe (linki z index.html → ?site=demo-*).
-- Źródło: data/seeds/demo_pages.json (regeneruj: node scripts/generate-demo-pages-migration.mjs)
-- Wymaga UNIQUE na public.pages.slug (ON CONFLICT).

INSERT INTO public.pages (slug, theme, color_preset, content, user_id, trial_blocked_at, billing_failed_at, billing_plan)
SELECT slug, theme, color_preset, content, NULL::uuid, NULL::timestamptz, NULL::timestamptz, 'tier1'::text
FROM (${parts.join('\n  UNION ALL\n  ')}) AS seeds
ON CONFLICT (slug)
DO UPDATE SET
  theme = EXCLUDED.theme,
  color_preset = EXCLUDED.color_preset,
  content = EXCLUDED.content,
  trial_blocked_at = NULL,
  billing_failed_at = NULL,
  billing_plan = 'tier1';
`;

fs.writeFileSync(outFile, sql, 'utf8');
console.log('Wrote', path.relative(root, outFile));
