/**
 * Smoke tests — ręczne opinie vs Google cache + sekcje motywów.
 * Run: node scripts/test-reviews-appearance.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadIife(relPath) {
  const src = readFileSync(path.join(root, relPath), 'utf8');
  const sandbox = { window: {}, globalThis: {} };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(src, sandbox, { filename: path.basename(relPath) });
  return sandbox;
}

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

const themeCfg = loadIife('js/core/themeConfig.js');
const sync = loadIife('js/core/googlePlacesSync.js');

test('beauty/fitness/services mają sekcję ręcznych opinii', () => {
  for (const theme of ['beauty', 'fitness', 'services', 'consultant']) {
    assert.equal(themeCfg.DFOPS_themeHasSection(theme, 'reviews'), true, theme + ' reviews');
    assert.equal(themeCfg.DFOPS_adminTabVisible(theme, 'reviews'), true, theme + ' tab');
  }
});

test('gastro/care nie pokazują zakładki ręcznych opinii', () => {
  assert.equal(themeCfg.DFOPS_adminTabVisible('gastro', 'reviews'), false);
  assert.equal(themeCfg.DFOPS_adminTabVisible('care', 'reviews'), false);
});

test('sync Google zapisuje cached_reviews i nie rusza pl.reviews', () => {
  const api = sync.DFOPS_googlePlacesSync;
  assert.ok(api.applyGoogleReviewRowsToPl);
  const pl = {
    reviews: [{ author: 'Anna', content: 'Ręczna opinia', stars: 5 }],
    google_reviews: { place_id: 'ChIJtest' },
  };
  const rows = api.apiReviewsToContentRows([
    { author_name: 'Google User', text: 'Z Google', rating: 4, publishTime: '2026-01-01' },
  ]);
  api.applyGoogleReviewRowsToPl(pl, rows);
  assert.equal(pl.reviews[0].author, 'Anna');
  assert.equal(pl.google_reviews.cached_reviews.length, 1);
  assert.equal(pl.google_reviews.cached_reviews[0].author, 'Google User');
  assert.equal(api.googleCachedReviewRows(pl)[0].author, 'Google User');
});

test('googleCachedReviewRows zwraca pustą tablicę bez cache', () => {
  const api = sync.DFOPS_googlePlacesSync;
  assert.equal(api.googleCachedReviewRows({ google_reviews: {} }).length, 0);
  assert.equal(api.googleCachedReviewRows(null).length, 0);
});

if (!process.exitCode) {
  const cfgSandbox = {
    window: {
      DFOPS_normalizeHostname: (h) => String(h || '').toLowerCase(),
      location: { hostname: 'localhost' },
    },
  };
  cfgSandbox.globalThis = cfgSandbox.window;
  vm.runInNewContext(readFileSync(path.join(root, 'js/core/config.js'), 'utf8'), cfgSandbox, {
    filename: 'config.js',
  });

  test('ikona black-gold mapuje na smoky + barber', () => {
    const match = cfgSandbox.window.DFOPS_matchingStyleBundle('beauty', {
      color_preset: 'black-gold',
    });
    assert.equal(match.background_style, 'smoky');
    assert.equal(match.font_preset, 'barber');
  });

  test('opublikowana beauty z samym black-gold (tło default) dostaje zestaw ikony', () => {
    const resolved = cfgSandbox.window.DFOPS_resolvePublicAppearance('beauty', {
      color_preset: 'black-gold',
      background_style: 'soft',
      font_preset: 'poppins',
    });
    assert.equal(resolved.background_style, 'smoky');
    assert.equal(resolved.font_preset, 'barber');
  });

  test('własne tło z zaawansowanych nie jest nadpisywane zestawem ikony', () => {
    const resolved = cfgSandbox.window.DFOPS_resolvePublicAppearance('beauty', {
      color_preset: 'black-gold',
      background_style: 'glow',
      font_preset: 'poppins',
    });
    assert.equal(resolved.background_style, 'glow');
    assert.equal(resolved.font_preset, 'poppins');
  });

  test('services forest i ocean mają różne akcenty i tła', () => {
    const pal = cfgSandbox.window.DFOPS_CONFIG.servicesPresetPalette;
    assert.ok(pal.forest && pal.ocean);
    assert.notEqual(pal.forest.accent, pal.ocean.accent);
    assert.notEqual(pal.forest.bgA, pal.ocean.bgA);
  });
}

if (!process.exitCode) {
  console.log(`\n${passed} tests passed`);
}
