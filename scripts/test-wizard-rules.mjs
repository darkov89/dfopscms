/**
 * Smoke tests — js/core/wizardRules.js (+ themeConfig for gastro/beauty steps).
 * Run: node scripts/test-wizard-rules.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadScripts(relPaths) {
  const sandbox = { window: {}, globalThis: {}, console };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  for (const rel of relPaths) {
    const src = readFileSync(path.join(root, rel), 'utf8');
    vm.runInNewContext(src, sandbox, { filename: path.basename(rel) });
  }
  return sandbox;
}

function createFakeStorage() {
  const data = Object.create(null);
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem(k, v) {
      data[k] = String(v);
    },
    removeItem(k) {
      delete data[k];
    },
  };
}

const api = loadScripts(['js/core/themeConfig.js', 'js/core/wizardRules.js']);

assert.ok(typeof api.DFOPS_validateWizardStep === 'function', 'DFOPS_validateWizardStep exported');
assert.equal(api.DFOPS_WIZARD_STATE_VERSION, 2);
assert.equal(api.DFOPS_WIZARD_STEP_COUNT, 6);
assert.equal(api.DFOPS_WIZARD_STATE_STORAGE_PREFIX, 'dfops_wizard_state_v1:');

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

const PREFIX = api.DFOPS_WIZARD_STATE_STORAGE_PREFIX;

function beautyTmpl() {
  return {
    pl: {
      hero: { headline: 'Przykładowe hasło', description: 'Przykładowy opis', name: 'Studio Demo' },
      settings: { business_name: 'Studio Demo' },
      seo: { title: 'Studio Demo — salon', description: 'Przykładowy opis SEO' },
      manifesto: { label: 'O nas', title: 'Kim jesteśmy', text: 'Lorem manifesto' },
      services: [{ title: 'Usługa demo', desc: 'Opis', price: '100 zł' }],
      contact: { cta: { button_url: 'https://calendly.com/demo' } },
    },
  };
}

function gastroTmpl() {
  return {
    pl: {
      menu_items: [{ name: 'Pierogi', price: '28 zł' }],
      seo: { title: '', description: '' },
    },
  };
}

function fitnessTmpl() {
  return {
    pl: {
      schedule: [{ day: 'Poniedziałek', time: '18:00', note: 'HIIT' }],
    },
  };
}

test('gastro: bez about, oferta = menu_items', () => {
  const ids = api.DFOPS_getActiveWizardStepIds('gastro');
  assert.equal(ids.join(','), 'template,brand,hero,offer,contact');
  assert.equal(ids.includes('about'), false);
  assert.equal(api.DFOPS_wizardOfferSection('gastro'), 'menu');
  assert.equal(api.DFOPS_wizardStepIdAtIndex('gastro', 4), 'offer');
  assert.equal(api.DFOPS_wizardStepIdAtIndex('gastro', 5), 'contact');
});

test('beauty: services + about w ścieżce kreatora', () => {
  const ids = api.DFOPS_getActiveWizardStepIds('beauty');
  assert.equal(ids.join(','), 'template,brand,hero,offer,about,contact');
  assert.equal(api.DFOPS_wizardOfferSection('beauty'), 'services');
  assert.equal(api.DFOPS_wizardStepIdAtIndex('beauty', 4), 'offer');
  assert.equal(api.DFOPS_wizardStepIdAtIndex('beauty', 5), 'about');
});

test('WIZARD_STATE_VERSION v1→v2 gdy step >= 4 (beauty → contact=6)', () => {
  const store = createFakeStorage();
  store.setItem(
    PREFIX + 'salon',
    JSON.stringify({ v: 1, step: 4, theme: 'beauty' }),
  );
  const read = api.DFOPS_readWizardStateFromStorage('salon', store);
  assert.equal(read.theme, 'beauty');
  assert.equal(read.step, 6);
  assert.equal(api.DFOPS_wizardStepIdAtIndex('beauty', read.step), 'contact');
});

test('WIZARD_STATE_VERSION v1→v2 gastro (brak about → contact=5)', () => {
  const store = createFakeStorage();
  store.setItem(
    PREFIX + 'bistro',
    JSON.stringify({ v: 1, step: 4, theme: 'gastro' }),
  );
  const read = api.DFOPS_readWizardStateFromStorage('bistro', store);
  assert.equal(read.theme, 'gastro');
  assert.equal(read.step, 5);
  assert.equal(api.DFOPS_wizardStepIdAtIndex('gastro', read.step), 'contact');
});

test('v1 step < 4 nie skacze na koniec', () => {
  const store = createFakeStorage();
  store.setItem(
    PREFIX + 'early',
    JSON.stringify({ v: 1, step: 3, theme: 'beauty' }),
  );
  const read = api.DFOPS_readWizardStateFromStorage('early', store);
  assert.equal(read.step, 3);
  assert.equal(api.DFOPS_wizardStepIdAtIndex('beauty', 3), 'hero');
});

test('v2 zapisany krok 4 zostaje (beauty = offer)', () => {
  const store = createFakeStorage();
  store.setItem(
    PREFIX + 'v2ok',
    JSON.stringify({ v: 2, step: 4, theme: 'beauty' }),
  );
  const read = api.DFOPS_readWizardStateFromStorage('v2ok', store);
  assert.equal(read.step, 4);
});

test('read/write/clear z fake localStorage', () => {
  const store = createFakeStorage();
  api.DFOPS_writeWizardStateToStorage('myslug', 2, 'care', store);
  const raw = JSON.parse(store.getItem(PREFIX + 'myslug'));
  assert.equal(raw.v, 2);
  assert.equal(raw.step, 2);
  assert.equal(raw.theme, 'care');
  assert.equal(typeof raw.ts, 'number');

  const read = api.DFOPS_readWizardStateFromStorage('myslug', store);
  assert.equal(read.step, 2);
  assert.equal(read.theme, 'care');

  api.DFOPS_clearWizardStateFromStorage('myslug', store);
  assert.equal(store.getItem(PREFIX + 'myslug'), null);
  assert.equal(api.DFOPS_readWizardStateFromStorage('myslug', store), null);
});

test('read: nieznany motyw w storage → null', () => {
  const store = createFakeStorage();
  store.setItem(PREFIX + 'x', JSON.stringify({ v: 2, step: 1, theme: 'unknown-theme' }));
  assert.equal(api.DFOPS_readWizardStateFromStorage('x', store), null);
});

test('placeholdery: pusty i kopia szablonu', () => {
  assert.equal(api.DFOPS_isWizardPlaceholder('', 'Hasło demo'), true);
  assert.equal(api.DFOPS_isWizardPlaceholder('Hasło demo', 'Hasło demo'), true);
  assert.equal(api.DFOPS_isWizardPlaceholder('<p>Hasło demo</p>', 'Hasło demo'), true);
  assert.equal(api.DFOPS_isWizardPlaceholder('Moje hasło', 'Hasło demo'), false);
  assert.equal(api.DFOPS_normWizardText('  <b>Ala</b>  Ma  '), 'ala ma');
});

test('servicesMatchTemplate / menuItemsMatchTemplate / schedulesMatchTemplate', () => {
  const svc = [{ title: 'Manicure', desc: 'Hybryda', price: '80' }];
  assert.equal(api.DFOPS_servicesMatchTemplate(svc, svc), true);
  assert.equal(api.DFOPS_servicesMatchTemplate([{ title: 'Inna', desc: 'Hybryda', price: '80' }], svc), false);

  const menu = [{ name: 'Żurek', price: '22' }];
  assert.equal(api.DFOPS_menuItemsMatchTemplate(menu, menu), true);
  assert.equal(api.DFOPS_menuItemsMatchTemplate([{ name: 'Barszcz', price: '22' }], menu), false);

  const sch = [{ day: 'Wtorek', time: '19:00', note: 'Yoga' }];
  assert.equal(api.DFOPS_schedulesMatchTemplate(sch, sch), true);
  assert.equal(api.DFOPS_schedulesMatchTemplate([], sch), false);
  assert.equal(api.DFOPS_schedulesMatchTemplate([], []), true);
});

test('finalizeWizardContent: beauty filtruje usługi i flagi', () => {
  api.DFOPS_getTemplate = () => beautyTmpl();
  const pl = {
    nav: { logo: 'Glamour' },
    settings: {},
    hero: { headline: 'Nasze hasło', description: 'Robimy paznokcie' },
    services: [{ title: 'Manicure', desc: '', price: '' }, { title: '   ', desc: 'x', price: '1' }],
    manifesto: { text: 'O salonie' },
    gallery: { images: ['a.jpg'] },
    faq: [{ q: 'Ile trwa?' }],
    reviews: [{ author: 'Ania' }],
    google_reviews: {},
    contact: {
      booking_url: 'https://booksy.com/glamour',
      cta: { enabled: true, button_url: 'https://calendly.com/' },
    },
  };
  api.DFOPS_finalizeWizardContent(pl, 'beauty');
  assert.equal(pl.services.length, 1);
  assert.equal(pl.services[0].title, 'Manicure');
  assert.equal(pl.settings.showServices, true);
  assert.equal(pl.settings.showManifesto, true);
  assert.equal(pl.settings.showGallery, true);
  assert.equal(pl.settings.showFaq, true);
  assert.equal(pl.settings.showReviews, true);
  assert.equal(pl.contact.cta.enabled, false);
  assert.equal(pl.contact.bookingUrl, 'https://booksy.com/glamour');
  assert.equal(pl.settings.business_name, 'Glamour');
  assert.match(pl.seo.title, /Glamour/);
  delete api.DFOPS_getTemplate;
});

test('finalizeWizardContent: gastro filtruje menu_items, nie steruje showServices', () => {
  api.DFOPS_getTemplate = () => gastroTmpl();
  const pl = {
    nav: { logo: 'Bistro' },
    settings: { showServices: true },
    hero: { description: 'Kuchnia domowa' },
    services: [{ title: 'Nie ta sekcja' }],
    menu_items: [{ name: 'Żurek', price: '18' }, { name: '', price: '0' }],
    manifesto: { text: '' },
    contact: {},
  };
  api.DFOPS_finalizeWizardContent(pl, 'gastro');
  assert.equal(pl.menu_items.length, 1);
  assert.equal(pl.menu_items[0].name, 'Żurek');
  assert.equal(pl.settings.showServices, true);
  assert.equal(pl.settings.showManifesto, false);
  delete api.DFOPS_getTemplate;
});

test('finalizeWizardContent: fitness czyści grafik-placeholder', () => {
  api.DFOPS_getTemplate = () => fitnessTmpl();
  const pl = {
    settings: {},
    schedule: [{ day: 'Poniedziałek', time: '18:00', note: 'HIIT' }],
  };
  api.DFOPS_finalizeWizardContent(pl, 'fitness');
  assert.ok(Array.isArray(pl.schedule));
  assert.equal(pl.schedule.length, 0);
  delete api.DFOPS_getTemplate;
});

test('validateWizardStep per stepId', () => {
  const empty = { nav: {}, hero: {}, services: [], menu_items: [], manifesto: {}, contact: {} };
  assert.equal(api.DFOPS_validateWizardStep(empty, '', 'template'), 'Wybierz szablon branżowy.');
  assert.equal(api.DFOPS_validateWizardStep(empty, 'beauty', 'template'), null);

  assert.match(api.DFOPS_validateWizardStep(empty, 'beauty', 'brand'), /nazwę firmy/);
  assert.equal(api.DFOPS_validateWizardStep({ nav: { logo: 'Glamour' } }, 'beauty', 'brand'), null);

  api.DFOPS_getTemplate = () => beautyTmpl();
  assert.match(api.DFOPS_validateWizardStep({ hero: {} }, 'beauty', 'hero'), /hasło/);
  assert.match(
    api.DFOPS_validateWizardStep(
      { hero: { headline: 'Przykładowe hasło', description: 'x' } },
      'beauty',
      'hero',
    ),
    /hasło/,
  );
  assert.match(
    api.DFOPS_validateWizardStep(
      { hero: { headline: 'Nasze hasło', description: '' } },
      'beauty',
      'hero',
    ),
    /opis/,
  );
  assert.equal(
    api.DFOPS_validateWizardStep(
      { hero: { headline: 'Nasze hasło', description: 'Robimy paznokcie' } },
      'beauty',
      'hero',
    ),
    null,
  );
  delete api.DFOPS_getTemplate;

  assert.match(api.DFOPS_validateWizardStep({ services: [] }, 'beauty', 'offer'), /usługę/);
  assert.equal(
    api.DFOPS_validateWizardStep({ services: [{ title: 'Manicure' }] }, 'beauty', 'offer'),
    null,
  );

  assert.match(api.DFOPS_validateWizardStep({ menu_items: [] }, 'gastro', 'offer'), /danie/);
  assert.equal(
    api.DFOPS_validateWizardStep({ menu_items: [{ name: 'Żurek' }] }, 'gastro', 'offer'),
    null,
  );

  assert.match(api.DFOPS_validateWizardStep({ manifesto: { text: '' } }, 'beauty', 'about'), /O nas/);
  assert.equal(
    api.DFOPS_validateWizardStep({ manifesto: { text: 'Salon od 2010.' } }, 'beauty', 'about'),
    null,
  );

  assert.match(api.DFOPS_validateWizardStep({ contact: {} }, 'beauty', 'contact'), /telefonu lub e-mail/);
  assert.equal(
    api.DFOPS_validateWizardStep({ contact: { phone: '500100200' } }, 'beauty', 'contact'),
    null,
  );
  assert.equal(
    api.DFOPS_validateWizardStep({ contact: { email: 'a@b.pl' } }, 'gastro', 'contact'),
    null,
  );
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests failed');
  process.exit(1);
}
