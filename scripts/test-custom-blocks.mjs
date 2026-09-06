/**
 * Smoke testy dla silnika blokowego Custom AI Sites (js/core/customBlocksRegistry.js)
 * Uruchomienie: node scripts/test-custom-blocks.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadRegistry() {
  const sandbox = { module: { exports: {} }, console, globalThis: {} };
  sandbox.globalThis = sandbox;
  const src = readFileSync(path.join(root, 'js/core/customBlocksRegistry.js'), 'utf8');
  vm.runInNewContext(src, sandbox, { filename: 'customBlocksRegistry.js' });
  return sandbox.module.exports;
}

const registry = loadRegistry();
assert.ok(registry, 'customBlocksRegistry poprawnie wyeksportowany');

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

// 1. Ekstrakcja metadanych wideo
test('extractVideoMeta: Vimeo URL', () => {
  const meta = registry.extractVideoMeta('https://vimeo.com/76979871');
  assert.equal(meta.provider, 'vimeo');
  assert.equal(meta.id, '76979871');
  assert.match(meta.embedUrl, /player\.vimeo\.com\/video\/76979871/);
});

test('extractVideoMeta: YouTube URL', () => {
  const meta = registry.extractVideoMeta('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(meta.provider, 'youtube');
  assert.equal(meta.id, 'dQw4w9WgXcQ');
  assert.match(meta.embedUrl, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
});

// 2. Generowanie stanu początkowego Filmowego
test('createInitialCinematicState generuje poprawny zestaw bloków', () => {
  const state = registry.createInitialCinematicState({
    name: 'Jan Kowalski',
    role: 'Director of Photography',
    video_url: 'https://vimeo.com/76979871',
    phone: '+48 500 600 700',
  });

  assert.equal(state.theme_type, 'cinematic');
  assert.equal(state.blocks.length, 5);

  const hero = state.blocks.find((b) => b.type === 'cinematic_hero');
  assert.ok(hero, 'Blok cinematic_hero istnieje');
  assert.equal(hero.data.title, 'Jan Kowalski');
  assert.equal(hero.data.subtitle, 'Director of Photography');
  assert.equal(hero.data.video_provider, 'vimeo');
  assert.equal(hero.data.video_id, '76979871');

  const contact = state.blocks.find((b) => b.type === 'minimal_contact');
  assert.ok(contact, 'Blok minimal_contact istnieje');
  assert.equal(contact.data.phone, '+48 500 600 700');
});

// 3. Generowanie stanu początkowego Wizytówki
test('createInitialQuickCardState generuje poprawny zestaw bloków', () => {
  const state = registry.createInitialQuickCardState({
    business_name: 'Elektryk Poznań',
    specialty: 'Pogotowie 24h',
    phone: '+48 600 100 200',
    city: 'Poznań',
  });

  assert.equal(state.theme_type, 'quick_card');
  assert.equal(state.blocks.length, 4);

  const hero = state.blocks.find((b) => b.type === 'quick_hero');
  assert.ok(hero, 'Blok quick_hero istnieje');
  assert.equal(hero.data.title, 'Elektryk Poznań');
  assert.equal(hero.data.city, 'Poznań');
  assert.equal(hero.data.phone, '+48 600 100 200');
});

// 4. Atomowa modyfikacja bloków (applyBlockUpdate)
test('applyBlockUpdate zmienia tylko wskazane pole bez ruszania innych', () => {
  const state = registry.createInitialCinematicState({ name: 'Tomasz Kot' });
  const initialCount = state.blocks.length;

  const res = registry.applyBlockUpdate(state.blocks, 'hero_cinematic', 'title', 'Krzysztof Kieślowski');
  assert.equal(res.success, true);
  assert.equal(res.blocks.length, initialCount);

  const updatedHero = res.blocks.find((b) => b.id === 'hero_cinematic');
  assert.equal(updatedHero.data.title, 'Krzysztof Kieślowski');
  // Upewnij się, że inne dane pozostały nietknięte
  assert.equal(updatedHero.data.subtitle, 'Director & Cinematographer');
  assert.equal(updatedHero.data.video_provider, 'vimeo');
});

// 5. Wstawianie i usuwanie bloków (insertBlock & removeBlock)
test('insertBlock wstawia blok we właściwe miejsce', () => {
  const state = registry.createInitialCinematicState({ name: 'Test' });
  const res = registry.insertBlock(state.blocks, 'hero_cinematic', 'awards_strip', { heading: 'Nowe Festiwale' });

  assert.equal(res.success, true);
  assert.equal(res.blocks.length, state.blocks.length + 1);
  assert.equal(res.blocks[1].type, 'awards_strip');
  assert.equal(res.blocks[1].data.heading, 'Nowe Festiwale');

  // Usuń wstawiony blok
  const removeRes = registry.removeBlock(res.blocks, res.insertedBlock.id);
  assert.equal(removeRes.success, true);
  assert.equal(removeRes.blocks.length, state.blocks.length);
});

// 6. Integralność metadanych subskrypcji i okresu próbnego (trial_started_at + plan: trial)
test('Stany początkowe zawierają pl.settings.subscription.trial_started_at oraz plan: trial', () => {
  const cinematic = registry.createInitialCinematicState({ name: 'Twórca' });
  const quick = registry.createInitialQuickCardState({ business_name: 'Firma' });

  assert.equal(cinematic.pl?.settings?.subscription?.plan, 'trial', 'Cinematic musi mieć plan: trial dla crona expire_trial_pages');
  assert.equal(quick.pl?.settings?.subscription?.plan, 'trial', 'QuickCard musi mieć plan: trial dla crona expire_trial_pages');

  assert.ok(cinematic.pl?.settings?.subscription?.trial_started_at, 'Cinematic posiada trial_started_at');
  assert.ok(quick.pl?.settings?.subscription?.trial_started_at, 'QuickCard posiada trial_started_at');

  const tsCinematic = Date.parse(cinematic.pl.settings.subscription.trial_started_at);
  assert.ok(!Number.isNaN(tsCinematic), 'trial_started_at w Cinematic to poprawny timestamp ISO');

  const tsQuick = Date.parse(quick.pl.settings.subscription.trial_started_at);
  assert.ok(!Number.isNaN(tsQuick), 'trial_started_at w QuickCard to poprawny timestamp ISO');
});

// 7. Odporność na Prototype Pollution w mutacjach bloków
test('applyBlockUpdate odrzuca próby Prototype Pollution', () => {
  const state = registry.createInitialCinematicState({ name: 'Test' });

  const res1 = registry.applyBlockUpdate(state.blocks, 'hero_cinematic', '__proto__.polluted', 'yes');
  assert.equal(res1.success, false, 'Próba __proto__ powinna zwrócić false');
  assert.equal(Object.prototype.polluted, undefined, 'Object.prototype nie może być skażony');

  const res2 = registry.applyBlockUpdate(state.blocks, 'hero_cinematic', 'constructor.prototype.polluted', 'yes');
  assert.equal(res2.success, false, 'Próba constructor powinna zwrócić false');
  assert.equal(Object.prototype.polluted, undefined, 'Object.prototype nie może być skażony');
});

// 8. Wypełnianie domyślnych pól schematu przy dodawaniu nowego bloku
test('insertBlock wypełnia pełne domyślne pola ze schematu', () => {
  const state = registry.createInitialQuickCardState({ business_name: 'Firma' });
  const res = registry.insertBlock(state.blocks, null, 'key_features', { heading: 'Atuty Biznesu' });

  assert.equal(res.success, true);
  const inserted = res.insertedBlock;
  assert.equal(inserted.type, 'key_features');
  assert.equal(inserted.data.heading, 'Atuty Biznesu');
  assert.ok(Array.isArray(inserted.data.items), 'data.items musi być tablicą');
  assert.equal(inserted.data.items.length, 3, 'data.items posiada 3 domyślne pozycje');
});

console.log(`\n${passed} tests passed successfully!`);
