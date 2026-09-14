/**
 * Testy dla logiki blokady okresu testowego (js/core/trialBlocking.js)
 * Uruchomienie: node scripts/test-trial-blocking.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadTrialBlocking() {
  const sandbox = { module: { exports: {} }, console, globalThis: {} };
  sandbox.globalThis = sandbox;
  const src = readFileSync(path.join(root, 'js/core/trialBlocking.js'), 'utf8');
  vm.runInNewContext(src, sandbox, { filename: 'trialBlocking.js' });
  return sandbox.module.exports;
}

const { shouldBlockPublicPageView } = loadTrialBlocking();
assert.ok(typeof shouldBlockPublicPageView === 'function', 'shouldBlockPublicPageView function exists');

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

test('świeża strona AI Studio z content=null i draft_content (dzisiejszy trial) NIE jest blokowana', () => {
  const page = {
    slug: 'moja-firma',
    theme: 'custom',
    content: null,
    draft_content: {
      pl: {
        settings: {
          subscription: {
            plan: 'trial',
            trial_started_at: new Date().toISOString(),
          },
        },
      },
    },
    created_at: new Date().toISOString(),
    trial_blocked_at: null,
  };
  assert.equal(shouldBlockPublicPageView(page), false);
});

test('świeża strona bez subscription, ale z created_at (now) NIE jest blokowana', () => {
  const page = {
    slug: 'moja-firma',
    content: null,
    created_at: new Date().toISOString(),
    trial_blocked_at: null,
  };
  assert.equal(shouldBlockPublicPageView(page), false);
});

test('strona starsza niż 14 dni z trialem JEST blokowana', () => {
  const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString();
  const page = {
    slug: 'stara-firma',
    content: {
      pl: {
        settings: {
          subscription: {
            plan: 'trial',
            trial_started_at: fifteenDaysAgo,
          },
        },
      },
    },
    trial_blocked_at: null,
  };
  assert.equal(shouldBlockPublicPageView(page), true);
});

test('strona z jawnym trial_blocked_at JEST blokowana bez względu na daty', () => {
  const page = {
    slug: 'zablokowana-firma',
    content: {
      pl: {
        settings: {
          subscription: {
            plan: 'trial',
            trial_started_at: new Date().toISOString(),
          },
        },
      },
    },
    trial_blocked_at: new Date().toISOString(),
  };
  assert.equal(shouldBlockPublicPageView(page), true);
});

test('płatny plan (tier0 / tier1) NIE jest blokowany', () => {
  const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString();
  const page = {
    slug: 'platna-firma',
    billing_plan: 'tier1',
    content: {
      pl: {
        settings: {
          subscription: {
            plan: 'tier1',
            trial_started_at: fifteenDaysAgo,
          },
        },
      },
    },
    trial_blocked_at: null,
  };
  assert.equal(shouldBlockPublicPageView(page), false);
});

test('katalog demo NIE jest blokowany', () => {
  const page = {
    slug: 'demo',
    content: {
      pl: {
        settings: {
          is_demo_catalog: true,
        },
      },
    },
  };
  assert.equal(shouldBlockPublicPageView(page), false);
});

console.log(`\n${passed} tests passed successfully!`);
