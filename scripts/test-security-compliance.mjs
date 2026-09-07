/**
 * Security & Multi-Tenant Compliance Tests
 * Weryfikuje:
 * 1. Szczelność i obecność nagłówków Content Security Policy (CSP) w Cloudflare middleware
 * 2. Ochronę przed atakami Clickjacking (frame-ancestors)
 * 3. Ochronę przed atakami Prototype Pollution w operacjach na strukturach danych
 * 4. Izolację publicznego routingu i brak wycieku danych zablokowanych tenantów
 *
 * Uruchom: node scripts/test-security-compliance.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

// 1. Audyt Content Security Policy w functions/_middleware.js
test('CSP w functions/_middleware.js zawiera kluczowe dyrektywy bezpieczeństwa', () => {
  const middlewarePath = path.join(root, 'functions/_middleware.js');
  const code = readFileSync(middlewarePath, 'utf8');

  // Weryfikacja dyrektyw bazowych
  assert.ok(code.includes("object-src 'none'"), "Brak dyrektywy object-src 'none' w CSP");
  assert.ok(code.includes("base-uri 'self'"), "Brak dyrektywy base-uri 'self' w CSP");
  assert.ok(code.includes("form-action 'self'"), "Brak dyrektywy form-action 'self' w CSP");
  assert.ok(code.includes("frame-ancestors"), "Brak dyrektywy frame-ancestors w CSP (ochrona przed clickjacking)");

  // Ochrona przed dzikimi wildcardami w skryptach i połączeniach
  assert.ok(!code.includes("script-src *"), "Zabroniony wildcard script-src * w CSP");
  assert.ok(!code.includes("default-src *"), "Zabroniony wildcard default-src * w CSP");

  // Ochrona połączeń z backendem (musi wskazywać konkretne domeny Supabase i Stripe)
  assert.ok(code.includes('https://*.supabase.co'), 'CSP connect-src musi zezwalać na Supabase');
  assert.ok(code.includes('https://api.stripe.com'), 'CSP connect-src musi zezwalać na Stripe API');
});

// 2. Ochrona przed Clickjacking w middleware
test('Middleware dynamicznie ogranicza frame-ancestors w zależności od trybu preview', () => {
  const middlewarePath = path.join(root, 'functions/_middleware.js');
  const code = readFileSync(middlewarePath, 'utf8');

  // frame-ancestors 'none' dla ruchu publicznego, frame-ancestors 'self' wyłącznie dla podglądu
  assert.ok(
    code.includes("isPreviewMode ? \"frame-ancestors 'self'\" : \"frame-ancestors 'none'\""),
    'frame-ancestors musi blokować osadzanie w obcych ramkach iframe dla zwykłych gości'
  );
});

// 3. Ochrona nagłówków cache dla odpowiedzi HTML
test('Middleware narzuca Cache-Control no-store dla HTML, aby zapobiec wyciekowi danych w cache CDN', () => {
  const middlewarePath = path.join(root, 'functions/_middleware.js');
  const code = readFileSync(middlewarePath, 'utf8');

  assert.ok(
    code.includes("headers.set('Cache-Control', 'private, no-store, must-revalidate')"),
    'Brak nagłówka prywatnego Cache-Control dla dokumentów HTML w middleware'
  );
});

// 4. Odporność na Prototype Pollution w parserach danych
test('Mutatory stanu w js/core/ (customBlocksRegistry) blokują Prototype Pollution', () => {
  const customBlocksPath = path.join(root, 'js/core/customBlocksRegistry.js');
  const code = readFileSync(customBlocksPath, 'utf8');

  const sandbox = { module: { exports: {} }, console, globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'customBlocksRegistry.js' });

  const registry = sandbox.module.exports;
  const applyUpdate = registry && registry.applyBlockUpdate;
  assert.ok(typeof applyUpdate === 'function', 'applyBlockUpdate wyeksportowane');

  const block = { id: 'test', type: 'hero_cinematic', title: 'Start' };

  // Próba zanieczyszczenia prototypu obiektu
  const maliciousPaths = [
    '__proto__.polluted',
    'constructor.prototype.polluted',
    'prototype.polluted'
  ];

  for (const p of maliciousPaths) {
    applyUpdate(block, p, 'hacked');
  }

  // Weryfikacja czy Object.prototype jest czysty
  const testObj = {};
  assert.equal(testObj.polluted, undefined, 'Wykryto podatność Prototype Pollution!');
});

// 5. Izolacja tenantów i soft-block wygasłych trialów
test('trialBlocking uniemożliwia publiczne przeglądanie wygasłych i zablokowanych tenantów', () => {
  const trialPath = path.join(root, 'js/core/trialBlocking.js');
  const code = readFileSync(trialPath, 'utf8');

  const sandbox = { module: { exports: {} }, console, globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'trialBlocking.js' });

  const { shouldBlockPublicPageView } = sandbox.module.exports;
  assert.ok(typeof shouldBlockPublicPageView === 'function', 'shouldBlockPublicPageView wyeksportowane');

  // Strona z jawnym trial_blocked_at
  const blockedSite = {
    slug: 'zablokowany-tenant',
    trial_blocked_at: '2026-08-01T00:00:00Z',
    content: {
      pl: {
        settings: {
          subscription: {
            plan: 'trial',
            trial_started_at: '2026-07-01T00:00:00Z',
          },
        },
      },
    },
  };

  const isBlocked = shouldBlockPublicPageView(blockedSite);
  assert.equal(isBlocked, true, 'Zablokowana strona musi być blokowana dla ruchu publicznego');

  // Strona na aktywnym płatnym planie nie jest blokowana
  const paidSite = {
    slug: 'oplacony-tenant',
    billing_plan: 'tier0',
    trial_blocked_at: null,
  };
  const isPaidBlocked = shouldBlockPublicPageView(paidSite);
  assert.equal(isPaidBlocked, false, 'Opłacona strona nie może być blokowana');
});

console.log(`\n${passed} security compliance tests passed successfully.`);
