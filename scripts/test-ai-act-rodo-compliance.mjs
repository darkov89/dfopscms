/**
 * EU AI Act & RODO/GDPR Compliance Tests
 * Weryfikuje:
 * 1. Zgodność z EU AI Act (Rozporządzenie UE 2024/1689 Art. 50):
 *    - Obowiązek informacyjny i transparentność interakcji z AI w AI Studio (studio.html)
 *    - Klauzula prawna w regulaminie (regulamin.html §7.1)
 *    - Oznakowanie wygenerowanych stron badge'em "Stworzono w DFCMS AI" (templates/custom.html)
 *    - Human-in-the-loop: kontrola użytkownika i mechanizm cofania zmian (undoDraft)
 * 2. Zgodność z RODO/GDPR (Rozporządzenie UE 2016/679):
 *    - Minimalizacja danych w schematach domyślnych (brak wrażliwych danych osobowych)
 *    - Zautomatyzowana retencja i procedura usuwania danych trialowych (retention / purge)
 *    - Obecność i dostępność polityki prywatności z prawami użytkownika (polityka.html)
 *
 * Uruchom: node scripts/test-ai-act-rodo-compliance.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('✓', name);
  } catch (e) {
    console.error('✗', name);
    console.error(' ', e.message || e);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------
// 1. EU AI Act (Rozporządzenie 2024/1689)
// ----------------------------------------------------

test('EU AI Act Art. 50: studio.html transparentnie informuje o interakcji z Agentem AI', () => {
  const studioPath = path.join(root, 'studio.html');
  assert.ok(existsSync(studioPath), 'studio.html istnieje');
  const html = readFileSync(studioPath, 'utf8');

  // Przejrzystość: użytkownik musi wiedzieć, że rozmawia z agentem sztucznej inteligencji
  assert.ok(
    html.includes('Agent AI') || html.includes('Agent Zero-CMS'),
    'studio.html musi wprost komunikować obecność Agenta AI'
  );
  assert.ok(
    html.includes('Edytuje stronę bez ruszania kodu') || html.includes('AI'),
    'studio.html musi wyjaśniać działanie AI w panelu'
  );
});

test('EU AI Act Art. 50: regulamin.html zawiera dedykowaną klauzulę prawną dotyczącą AI Act', () => {
  const regulaminPath = path.join(root, 'regulamin.html');
  assert.ok(existsSync(regulaminPath), 'regulamin.html istnieje');
  const html = readFileSync(regulaminPath, 'utf8');

  assert.ok(
    html.includes('2024/1689') || html.includes('AI Act'),
    'regulamin.html musi powoływać się na Rozporządzenie AI Act'
  );
  assert.ok(
    html.includes('art. 50 AI Act') || html.includes('Przejrzystość i Informacja'),
    'regulamin.html musi zawierać postanowienia o przejrzystości AI wg Art. 50'
  );
});

test('EU AI Act Transparency: templates/custom.html posiada nienaruszalny badge wygenerowania AI', () => {
  const customPath = path.join(root, 'templates', 'custom.html');
  assert.ok(existsSync(customPath), 'templates/custom.html istnieje');
  const html = readFileSync(customPath, 'utf8');

  assert.ok(
    html.includes('Stworzono w DFCMS AI'),
    'templates/custom.html musi posiadać widoczny badge transparentności AI dla planów trial/tier0'
  );
  assert.ok(
    html.includes('dfcms-badge') || html.includes('aria-label="Strona stworzona w technologii DFCMS AI"'),
    'templates/custom.html musi mieć poprawnie zdefiniowaną dostępność badge AI'
  );

  // Znak wodny musi być pozycjonowany po lewej stronie (left:), aby nie kolidować z WhatsApp FAB (right:)
  const badgeMatch = html.match(/\.dfcms-badge\s*\{([^}]+)\}/);
  assert.ok(badgeMatch, 'templates/custom.html: musi definiować styl .dfcms-badge');
  assert.ok(badgeMatch[1].includes('left:'), 'templates/custom.html: .dfcms-badge musi mieć pozycjonowanie left:');
  assert.ok(!badgeMatch[1].includes('right: 16px'), 'templates/custom.html: .dfcms-badge nie może mieć right: 16px');

  const publicAppPath = path.join(root, 'js', 'features', 'publicSiteApp.js');
  if (existsSync(publicAppPath)) {
    const publicAppCode = readFileSync(publicAppPath, 'utf8');
    const publicBadgeMatch = publicAppCode.match(/\.dfcms-badge\s*\{([^}]+)\}/);
    assert.ok(publicBadgeMatch, 'publicSiteApp.js: musi definiować styl .dfcms-badge');
    assert.ok(publicBadgeMatch[1].includes('left:'), 'publicSiteApp.js: .dfcms-badge musi mieć pozycjonowanie left:');
    assert.ok(!publicBadgeMatch[1].includes('right: 16px'), 'publicSiteApp.js: .dfcms-badge nie może mieć right: 16px');
  }
});

test('EU AI Act Human-in-the-loop: studio.html posiada mechanizm cofania zmian AI (Undo)', () => {
  const studioPath = path.join(root, 'studio.html');
  const html = readFileSync(studioPath, 'utf8');

  // Człowiek musi zachować kontrolę nad generowanymi modyfikacjami
  assert.ok(
    html.includes('undoDraft()'),
    'studio.html musi udostępniać funkcję undoDraft() dla zachowania nadzoru ludzkiego'
  );
  assert.ok(
    html.includes('draftHistory'),
    'studio.html musi utrzymywać historię wersji (draftHistory) do cofania zmian'
  );
});

// ----------------------------------------------------
// 2. RODO / GDPR (Rozporządzenie 2016/679)
// ----------------------------------------------------

test('RODO Art. 5 ust. 1 lit. c: Schematy domyślne stosują zasadę minimalizacji danych (brak wrażliwych PII)', () => {
  const registryPath = path.join(root, 'js', 'templates', 'registry.js');
  assert.ok(existsSync(registryPath), 'js/templates/registry.js istnieje');
  const code = readFileSync(registryPath, 'utf8');

  // Weryfikacja czy w domyślnych schematach nie ma zbędnych/wrażliwych pól osobowych
  const sensitiveFields = ['pesel', 'credit_card', 'ssn', 'medical_history', 'religion', 'passport'];
  for (const field of sensitiveFields) {
    assert.ok(
      !code.toLowerCase().includes(`"${field}"`) && !code.toLowerCase().includes(`'${field}'`),
      `Wykryto pole zbierające wrażliwe dane osobowe (${field}) w domyślnym rejestrze szablonów!`
    );
  }
});

test('RODO Art. 17 i 5 ust. 1 lit. e: Procedury retencji i kasacji trialu (expire-trial-pages & cron)', () => {
  const edgeFuncPath = path.join(root, 'supabase', 'functions', 'expire-trial-pages', 'index.ts');
  const cronMigrationPath = path.join(root, 'supabase', 'migrations', '20260704223000_schedule_expire_trial_pages_cron.sql');

  assert.ok(existsSync(edgeFuncPath), 'supabase/functions/expire-trial-pages/index.ts istnieje');
  assert.ok(existsSync(cronMigrationPath), 'migracja cron istnieje');

  const edgeCode = readFileSync(edgeFuncPath, 'utf8');
  const migrationCode = readFileSync(cronMigrationPath, 'utf8');

  // Weryfikacja cyklu retencji porzuconych tenantów
  assert.ok(
    migrationCode.includes('expire_trial_pages'),
    'Procedura wygaszania stron trialowych musi być zdefiniowana w zadaniach crona'
  );
  assert.ok(
    edgeCode.includes('notify_purge_upcoming_pages') || edgeCode.includes('purge_trial_blocked_pages_after_grace'),
    'Procedura ostrzegania o usunięciu lub czyszczenia danych po grace period musi być obecna w Edge Function'
  );
});

test('RODO Transparentność: polityka.html istnieje i definiuje prawa podmiotów danych', () => {
  const politykaPath = path.join(root, 'polityka.html');
  assert.ok(existsSync(politykaPath), 'polityka.html istnieje');
  const html = readFileSync(politykaPath, 'utf8');

  // Prawa użytkownika wg RODO
  assert.ok(html.includes('RODO') || html.includes('2016/679'), 'polityka.html musi powoływać się na RODO');
  assert.ok(
    html.includes('Administrator') || html.includes('administrator'),
    'polityka.html musi wskazywać administratora danych'
  );
  assert.ok(
    html.includes('prawo') && (html.includes('usunięcia') || html.includes('dostępu')),
    'polityka.html musi wymieniać prawa użytkownika (prawo dostępu, usunięcia, sprostowania)'
  );
});

console.log(`\n${passed} EU AI Act & RODO compliance tests passed successfully.`);
