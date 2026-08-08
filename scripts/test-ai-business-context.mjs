/**
 * Smoke + security tests — js/core/aiBusinessContext.js
 * Run: node scripts/test-ai-business-context.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcPath = path.join(root, 'js/core/aiBusinessContext.js');
const src = readFileSync(srcPath, 'utf8');

const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.runInNewContext(src, sandbox, { filename: 'aiBusinessContext.js' });

const api = sandbox.DFOPS_aiBusinessContext;
assert.ok(api, 'DFOPS_aiBusinessContext exported');

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

// --- Smoke ---
test('industryFromPlace: primaryTypeDisplayName', () => {
  const ind = api.industryFromPlace({
    primaryTypeDisplayName: { text: 'Warsztat samochodowy' },
    types: ['establishment'],
  });
  assert.equal(ind, 'Warsztat samochodowy');
  assert.equal(api.hasClearIndustryCategory({ primaryTypeDisplayName: 'Salon fryzjerski' }), true);
});

test('industryFromPlace: rejects generic types only', () => {
  assert.equal(api.industryFromPlace({ types: ['establishment', 'point_of_interest'] }), '');
  assert.equal(api.hasClearIndustryCategory({ types: ['geocode'] }), false);
});

test('industryFromPlace: humanizes primaryType', () => {
  assert.equal(api.industryFromPlace({ primaryType: 'car_repair' }), 'car repair');
});

test('guessCityFromAddress: PL formatted', () => {
  assert.equal(
    api.guessCityFromAddress('ul. Piękna 12, 00-001 Warszawa, Polska'),
    'Warszawa',
  );
});

test('compose + buildDefaultAiContext', () => {
  const composed = api.composeAiBusinessContext({
    business_name: 'AutoMax',
    business_category: 'Warsztat',
    city: 'Kraków',
  });
  assert.equal(composed, 'AutoMax — Warsztat — Kraków');

  const fromSaved = api.buildDefaultAiContext({
    ai_business_context: 'Salon kosmetyczny Glamour w Gdańsku',
    business_name: 'ignored',
  });
  assert.equal(fromSaved, 'Salon kosmetyczny Glamour w Gdańsku');

  const legacy = api.buildDefaultAiContext({
    business_name: 'Studio Fit',
    business_category: 'Siłownia',
    city: 'Poznań',
  });
  assert.equal(legacy, 'Studio Fit — Siłownia — Poznań');
});

test('applyPlaceToAiBusinessSettings writes ai_business_context', () => {
  const settings = {};
  const r = api.applyPlaceToAiBusinessSettings(settings, {
    name: 'Bar Kawowy',
    address: 'Rynek 1, Wrocław, Polska',
    category: 'Kawiarnia',
  });
  assert.equal(r.needsManualIndustry, false);
  assert.match(settings.ai_business_context, /Bar Kawowy/);
  assert.match(settings.ai_business_context, /Kawiarnia/);
  assert.equal(settings.city, 'Wrocław');
  assert.equal(settings.business_category, 'Kawiarnia');
});

test('applyPlace without category → needsManualIndustry', () => {
  const settings = {};
  const r = api.applyPlaceToAiBusinessSettings(settings, {
    name: 'Firma XYZ',
    address: 'Łódź',
    types: ['establishment'],
  });
  assert.equal(r.needsManualIndustry, true);
});

test('applyManualIndustryToSettings', () => {
  const settings = { business_name: 'ABC', city: 'Lublin' };
  const r = api.applyManualIndustryToSettings(settings, 'Warsztat samochodowy');
  assert.equal(r.ok, true);
  assert.equal(settings.business_category, 'Warsztat samochodowy');
  assert.match(settings.ai_business_context, /Warsztat samochodowy/);
});

// --- Security ---
test('strip HTML / script from industry', () => {
  const ind = api.industryFromPlace({
    category: '<script>alert(1)</script>Salon',
  });
  assert.ok(!ind.includes('<script>'));
  assert.ok(!ind.includes('</script>'));
  assert.match(ind, /Salon/);
});

test('clampText enforces CONTEXT_MAX', () => {
  const long = 'x'.repeat(2000);
  const out = api.clampText(long, api.CONTEXT_MAX);
  assert.ok(out.length <= api.CONTEXT_MAX);
});

test('control chars stripped', () => {
  const out = api.clampText('Foo\u0000Bar\nBaz');
  assert.ok(!out.includes('\u0000'));
  assert.equal(out, 'Foo Bar Baz');
});

test('prototype pollution: settings stay own props', () => {
  const settings = {};
  api.applyManualIndustryToSettings(settings, '__proto__');
  assert.equal(Object.prototype.polluted, undefined);
  // Industry key "__proto__" is a string value, not an accessor attack via our assign path
  assert.equal(typeof settings.business_category, 'string');
});

test('compose ignores non-objects / null', () => {
  assert.equal(api.composeAiBusinessContext(null), '');
  assert.equal(api.buildDefaultAiContext(undefined), '');
  assert.equal(api.industryFromPlace(null), '');
});

test('context independent from template theme name', () => {
  const settings = {
    theme: 'beauty',
    business_name: 'Garage Pro',
    business_category: 'Mechanika',
    city: 'Gdynia',
  };
  const ctx = api.buildDefaultAiContext(settings);
  assert.ok(!ctx.toLowerCase().includes('beauty'));
  assert.match(ctx, /Mechanika/);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests failed');
  process.exit(1);
}
