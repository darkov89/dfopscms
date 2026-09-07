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

// 9. Ekstrakcja metadanych wideo: Cloudflare Stream i MP4
test('extractVideoMeta: Cloudflare Stream oraz plik bezpośredni MP4', () => {
  const cf = registry.extractVideoMeta('https://iframe.videodelivery.net/d0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0');
  assert.equal(cf.provider, 'cloudflare_stream');
  assert.equal(cf.id, 'd0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0');
  assert.ok(cf.embedUrl.includes('iframe.videodelivery.net'));

  const mp4 = registry.extractVideoMeta('https://assets.example.com/videos/showreel.mp4?v=1');
  assert.equal(mp4.provider, 'direct');
  assert.equal(mp4.embedUrl, 'https://assets.example.com/videos/showreel.mp4?v=1');
});

// 10. Zmiana kolejności bloków (reorderBlocks)
test('reorderBlocks poprawnie zmienia kolejność i zachowuje pozostałe bloki', () => {
  const state = registry.createInitialCinematicState({ name: 'Twórca' });
  const initialIds = state.blocks.map(b => b.id);
  assert.ok(initialIds.length >= 3);

  // Odwróć kolejność pierwszych dwóch
  const newOrder = [initialIds[1], initialIds[0]];
  const res = registry.reorderBlocks(state.blocks, newOrder);

  assert.equal(res.success, true);
  assert.equal(res.blocks[0].id, initialIds[1]);
  assert.equal(res.blocks[1].id, initialIds[0]);
  assert.equal(res.blocks.length, initialIds.length, 'Długość tablicy bloków nie ulega zmianie');
});

// 11. Aktualizacja stylistyki globalnej (updateDesign)
test('updateDesign aktualizuje dozwolone właściwości designu', () => {
  const state = registry.createInitialCinematicState({ name: 'Twórca' });
  const res = registry.updateDesign(state, {
    accent_color: '#FF5733',
    palette: 'cinema_red',
    disallowed_key: 'hacked',
  });

  assert.equal(res.success, true);
  assert.equal(res.updatedDesign.accent_color, '#FF5733');
  assert.equal(res.updatedDesign.palette, 'cinema_red');
  assert.equal(res.updatedDesign.disallowed_key, undefined, 'Niedozwolone klucze są ignorowane');
});

// 12. Walidacja typów w applyBlockUpdate chroni przed uszkodzeniem tablic
test('applyBlockUpdate waliduje typ tablicy w polu items', () => {
  const state = registry.createInitialCinematicState({ name: 'Twórca' });

  // Próba nadpisania items stringiem, który nie jest JSON-em tablicy
  const resInvalid = registry.applyBlockUpdate(state.blocks, 'projects_grid', 'items', 'to-nie-tablica');
  assert.equal(resInvalid.success, false, 'Powinno odrzucić string zamiast tablicy');

  // Poprawny string JSON z tablicą powinien zostać sparsowany
  const resValidJson = registry.applyBlockUpdate(state.blocks, 'projects_grid', 'items', JSON.stringify([{ id: 'p1', title: 'Test' }]));
  assert.equal(resValidJson.success, true, 'Poprawny JSON z tablicą powinien przejść');
  assert.equal(resValidJson.updatedBlock.data.items[0].title, 'Test');
});

// 13. Nowe bloki: testimonials_grid, faq_accordion, pricing_tiers
test('nowe bloki: wstawianie i domyślne dane dla testimonials_grid, faq_accordion, pricing_tiers', () => {
  const state = registry.createInitialCinematicState({ name: 'Test' });

  // Testimonials
  const test1 = registry.insertBlock(state.blocks, null, 'testimonials_grid');
  assert.equal(test1.success, true);
  assert.equal(test1.insertedBlock.type, 'testimonials_grid');
  assert.equal(test1.insertedBlock.data.heading, 'Co mówią nasi klienci');
  assert.equal(Array.isArray(test1.insertedBlock.data.items), true);
  assert.equal(test1.insertedBlock.data.items.length, 3);

  // FAQ Accordion
  const test2 = registry.insertBlock(test1.blocks, test1.insertedBlock.id, 'faq_accordion');
  assert.equal(test2.success, true);
  assert.equal(test2.insertedBlock.type, 'faq_accordion');
  assert.equal(test2.insertedBlock.data.heading, 'Najczęściej zadawane pytania');
  assert.equal(test2.insertedBlock.data.items.length, 3);

  // Pricing Tiers
  const test3 = registry.insertBlock(test2.blocks, test2.insertedBlock.id, 'pricing_tiers');
  assert.equal(test3.success, true);
  assert.equal(test3.insertedBlock.type, 'pricing_tiers');
  assert.equal(test3.insertedBlock.data.heading, 'Przejrzysty cennik');
  assert.equal(test3.insertedBlock.data.items.length, 3);
  assert.equal(test3.insertedBlock.data.items[1].highlighted, true);

  // Mutacja pola w nowym bloku przez applyBlockUpdate
  const upd = registry.applyBlockUpdate(test3.blocks, test3.insertedBlock.id, 'heading', 'Nasz Cennik 2026');
  assert.equal(upd.success, true);
  assert.equal(upd.updatedBlock.data.heading, 'Nasz Cennik 2026');
});

// 14. Metadane katalogu sekcji (catalog_group, icon, summary, required_fields)
test('katalog sekcji: kompletność metadanych i zachowanie category', () => {
  const defs = Object.values(registry.BLOCK_DEFINITIONS);
  assert.equal(defs.length, 18, 'Wszystkie 18 bloków powinno być zdefiniowane');

  const validGroups = new Set(['hero', 'offer', 'trust', 'contact', 'info']);
  const validCategories = new Set(['cinematic', 'quick_card', 'universal']);

  for (const def of defs) {
    assert.ok(def.type, `Typ bloku musi być zdefiniowany: ${def.label}`);
    assert.ok(validCategories.has(def.category), `Pole category musi być nienaruszone: ${def.category} dla ${def.type}`);
    assert.ok(validGroups.has(def.catalog_group), `Pole catalog_group musi być poprawne: ${def.catalog_group} dla ${def.type}`);
    assert.ok(typeof def.icon === 'string' && def.icon.length > 0, `Pole icon musi być obecne dla ${def.type}`);
    assert.ok(typeof def.summary === 'string' && def.summary.length > 0, `Pole summary musi być obecne dla ${def.type}`);
    assert.ok(Array.isArray(def.required_fields), `Pole required_fields musi być tablicą dla ${def.type}`);
    assert.equal(typeof def.allow_multiple, 'boolean', `Pole allow_multiple musi być boolean dla ${def.type}`);

    if (def.required_fields.length > 0) {
      assert.ok(def.required_fields[0].key, `required_field musi mieć key dla ${def.type}`);
      assert.ok(def.required_fields[0].ask, `required_field musi mieć ask dla ${def.type}`);
    }
  }
});

// 15. getCatalogGroups i getCatalogBlocks z adnotacją obecności na stronie
test('getCatalogGroups i getCatalogBlocks poprawnie wyliczają obecność na stronie', () => {
  const groups = registry.getCatalogGroups();
  assert.ok(Array.isArray(groups), 'getCatalogGroups zwraca tablicę');
  assert.ok(groups.length >= 6, 'Powinno być co najmniej 6 grup katalogu');
  assert.equal(groups[0].id, 'all');

  const fakeBlocks = [
    { id: 'b1', type: 'quick_hero' },
    { id: 'b2', type: 'pricing_tiers' },
    { id: 'b3', type: 'pricing_tiers' },
  ];

  const catalog = registry.getCatalogBlocks(fakeBlocks);
  assert.equal(catalog.length, 18);

  const heroItem = catalog.find((c) => c.type === 'quick_hero');
  assert.ok(heroItem);
  assert.equal(heroItem.isOnPage, true);
  assert.equal(heroItem.countOnPage, 1);

  const pricingItem = catalog.find((c) => c.type === 'pricing_tiers');
  assert.ok(pricingItem);
  assert.equal(pricingItem.isOnPage, true);
  assert.equal(pricingItem.countOnPage, 2);

  const contactItem = catalog.find((c) => c.type === 'minimal_contact');
  assert.ok(contactItem);
  assert.equal(contactItem.isOnPage, false);
  assert.equal(contactItem.countOnPage, 0);
});

// 16. Test replaceBlockItems
test('replaceBlockItems poprawnie zastępuje tablicę items w bloku', () => {
  const state = registry.createInitialCinematicState({ name: 'Test' });
  const ins = registry.insertBlock(state.blocks, null, 'services_list');
  assert.equal(ins.success, true);
  const blockId = ins.insertedBlock.id;

  const newItems = [
    { id: 's1', title: 'Strzyżenie męskie', price: '90 zł', duration: '45 min', description: 'Precyzyjne cięcie i stylizacja' },
    { id: 's2', title: 'Trymowanie brody', price: '60 zł', duration: '30 min', description: 'Gorący ręcznik i kontur' },
  ];

  const res = registry.replaceBlockItems(ins.blocks, blockId, newItems);
  assert.equal(res.success, true);
  assert.equal(res.updatedBlock.data.items.length, 2);
  assert.equal(res.updatedBlock.data.items[0].title, 'Strzyżenie męskie');
  assert.equal(res.updatedBlock.data.items[1].price, '60 zł');

  // Próba podania nie-tablicy
  const resBad = registry.replaceBlockItems(ins.blocks, blockId, 'nie-tablica');
  assert.equal(resBad.success, false);
});

// 17. Test wstawiania 6 nowych bloków branżowych z szablonów DFCMS
test('6 nowych bloków (trust_stats, services_list, booking_cta, location_map, gallery_grid, google_reviews)', () => {
  const state = registry.createInitialCinematicState({ name: 'Firma Testowa' });
  const newTypes = [
    'trust_stats',
    'services_list',
    'booking_cta',
    'location_map',
    'gallery_grid',
    'google_reviews',
  ];

  let currentBlocks = state.blocks;
  for (const t of newTypes) {
    const res = registry.insertBlock(currentBlocks, null, t);
    assert.equal(res.success, true, `Wstawianie bloku ${t} powiodło się`);
    assert.equal(res.insertedBlock.type, t);
    assert.ok(res.insertedBlock.data, `Blok ${t} posiada obiekt data`);
    assert.ok(typeof res.insertedBlock.data.heading === 'string', `Blok ${t} posiada nagłówek`);

    const def = registry.BLOCK_DEFINITIONS[t];
    assert.ok(def, `BLOCK_DEFINITIONS ma definicję dla ${t}`);
    assert.ok(def.required_fields.length > 0, `Blok ${t} posiada required_fields do interakcji jak z programistą`);
    currentBlocks = res.blocks;
  }

  assert.equal(currentBlocks.length, state.blocks.length + 6);
});

// 18. Synchronizacja kluczy bloków między customBlocksRegistry a customBlockDefaults.ts (Edge)
test('BLOCK_DEFINITIONS w registry oraz BLOCK_DEFAULTS w Edge Functions mają identyczny zestaw 18 kluczy', () => {
  const tsSrc = readFileSync(path.join(root, 'supabase/functions/_shared/customBlockDefaults.ts'), 'utf8');
  const jsSrc = tsSrc
    .replace(/export\s+const\s+BLOCK_DEFAULTS[\s\S]*?=\s*\{/, 'const BLOCK_DEFAULTS = {') +
    '\nmodule.exports = BLOCK_DEFAULTS;';
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(jsSrc, sandbox);
  const edgeDefaults = sandbox.module.exports;

  const registryKeys = Object.keys(registry.BLOCK_DEFINITIONS).sort();
  const edgeKeys = Object.keys(edgeDefaults).sort();

  assert.equal(registryKeys.length, 18, 'Registry ma dokładnie 18 bloków');
  assert.equal(edgeKeys.length, 18, 'Edge defaults ma dokładnie 18 bloków');
  assert.equal(registryKeys.join(','), edgeKeys.join(','), 'Zestaw kluczy bloków musi być w 100% zsynchronizowany');
});

// 19. Soczewka EU AI Act: Brak fałszywego social proof (Tomasz/Magdalena) w blokach domyślnych
test('google_reviews: domyślny stan nie udaje fałszywych opinii ani nie podaje fałszywej oceny (EU AI Act)', () => {
  const def = registry.BLOCK_DEFINITIONS['google_reviews'];
  assert.ok(def, 'Definicja google_reviews istnieje');
  assert.equal(def.defaults.rating, null, 'Domyślna ocena w rejestrze musi być null');
  assert.equal(def.defaults.reviews_count, 0, 'Domyślna liczba opinii w rejestrze musi wynosić 0');
  assert.equal(Array.isArray(def.defaults.items), true, 'Domyślne opinie w rejestrze muszą być tablicą');
  assert.equal(def.defaults.items.length, 0, 'Domyślne opinie w rejestrze muszą być pustą tablicą [] (brak fake reviews)');

  // Sprawdzenie Edge defaults
  const tsSrc = readFileSync(path.join(root, 'supabase/functions/_shared/customBlockDefaults.ts'), 'utf8');
  assert.ok(tsSrc.includes('google_reviews: {'), 'Edge defaults zawiera google_reviews');
  assert.ok(tsSrc.includes('rating: null'), 'Edge defaults ma rating: null dla google_reviews');
  assert.ok(tsSrc.includes('items: []'), 'Edge defaults ma items: [] dla google_reviews');

  // Sprawdzenie szablonu templates/custom.html
  const customHtml = readFileSync(path.join(root, 'templates/custom.html'), 'utf8');
  assert.ok(
    customHtml.includes('!(block.data.items && block.data.items.length > 0)'),
    'Szablon posiada stan początkowy dla niepodłączonych opinii Google'
  );
  assert.ok(
    !customHtml.includes("x-text=\"block.data.rating || '4.9'\""),
    'Szablon nie może hardkodować fałszywej oceny 4.9 jako fallbacku'
  );
});

// 20. Zgodność kontraktów pól renderera z danymi szablonów (services_list, booking_cta, location_map, gallery_grid)
test('Kontrakty pól i interakcji w templates/custom.html są zgodne ze schematem', () => {
  const customHtml = readFileSync(path.join(root, 'templates/custom.html'), 'utf8');

  // services_list: srv.desc || srv.description
  assert.ok(
    customHtml.includes('srv.desc || srv.description'),
    'services_list obsługuje zarówno srv.desc jak i srv.description'
  );

  // booking_cta: button_text || cta_text
  assert.ok(
    customHtml.includes('block.data.button_text || block.data.cta_text'),
    'booking_cta obsługuje zarówno button_text jak i cta_text'
  );

  // location_map: whitespace-pre-line oraz getSafeMapEmbedUrl
  assert.ok(
    customHtml.includes('whitespace-pre-line'),
    'location_map stosuje whitespace-pre-line dla godzin'
  );
  assert.ok(
    customHtml.includes('getSafeMapEmbedUrl(block.data)'),
    'location_map dynamicznie generuje mapę przez getSafeMapEmbedUrl'
  );

  // gallery_grid: openImageLightbox zamiast modalOpen
  assert.ok(
    customHtml.includes('openImageLightbox(img.url, img.title)'),
    'gallery_grid otwiera dedykowany lightbox zdjęć'
  );
  assert.ok(
    customHtml.includes('x-show="imageLightboxOpen"'),
    'Szablon zawiera dedykowany modal imageLightboxOpen'
  );
});

// 21. Mapa śledzi address/city i ignoruje nieaktualny embed (E2E kontrakt Fala 3)
test('getSafeMapEmbedUrl: nowy adres wygrywa ze starym embedem Poznania', () => {
  assert.equal(typeof registry.getSafeMapEmbedUrl, 'function');

  const krakow = registry.getSafeMapEmbedUrl({
    address: 'Rynek Główny 1',
    city: 'Kraków',
    map_embed_url: 'https://maps.google.com/maps?q=Pozna%C5%84&t=&z=13&ie=UTF8&iwloc=&output=embed',
  });
  assert.ok(krakow.includes('output=embed'), 'URL mapy musi być embedem');
  assert.ok(krakow.includes(encodeURIComponent('Rynek Główny 1')), 'Embed musi zawierać nowy adres');
  assert.ok(!krakow.includes('Pozna'), 'Stary embed Poznania nie może zostać na iframe');

  const evil = registry.getSafeMapEmbedUrl({
    map_embed_url: 'https://evil.example/maps?output=embed',
  });
  assert.equal(evil, '', 'Obcy host nie może trafić do iframe mapy');

  const loc = registry.insertBlock([], null, 'location_map');
  assert.equal(loc.insertedBlock.data.map_embed_url, '', 'Domyślny blok nie wkleja sztywnego embedu Poznania');
});

console.log(`\n${passed} tests passed successfully!`);

