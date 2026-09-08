import test from 'node:test';
import assert from 'node:assert/strict';
import customThemeRules from '../js/core/customThemeRules.js';

test('customThemeRules: jawny theme_type quick_card jest zachowywany bez leczenia', () => {
  const content = { theme_type: 'quick_card', blocks: [{ type: 'cinematic_hero' }] };
  const res = customThemeRules.resolveThemeType(content);
  assert.equal(res.themeType, 'quick_card');
  assert.equal(res.healed, false);
});

test('customThemeRules: jawny theme_type cinematic jest zachowywany bez leczenia', () => {
  const content = { theme_type: 'cinematic', blocks: [{ type: 'quick_hero' }] };
  const res = customThemeRules.resolveThemeType(content);
  assert.equal(res.themeType, 'cinematic');
  assert.equal(res.healed, false);
});

test('customThemeRules: brak theme_type z blokami quick_hero rozstrzyga na quick_card i healed=true', () => {
  const content = { blocks: [{ type: 'quick_hero' }, { type: 'key_features' }] };
  const res = customThemeRules.resolveThemeType(content);
  assert.equal(res.themeType, 'quick_card');
  assert.equal(res.healed, true);
});

test('customThemeRules: brak theme_type z blokami cinematic_hero rozstrzyga na cinematic i healed=true', () => {
  const content = { blocks: [{ type: 'cinematic_hero' }] };
  const res = customThemeRules.resolveThemeType(content);
  assert.equal(res.themeType, 'cinematic');
  assert.equal(res.healed, true);
});

test('customThemeRules: pusty obiekt lub null bezpiecznie rozstrzyga na cinematic i healed=true', () => {
  const res1 = customThemeRules.resolveThemeType(null);
  assert.equal(res1.themeType, 'cinematic');
  assert.equal(res1.healed, true);

  const res2 = customThemeRules.resolveThemeType({});
  assert.equal(res2.themeType, 'cinematic');
  assert.equal(res2.healed, true);
});
