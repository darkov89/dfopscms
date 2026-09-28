/**
 * Unit + Security + Compliance Tests dla Personal Presence Engine
 * Sprawdza:
 * 1. Schemat Digital Twin i sanitizację sygnałów (digitalTwinSchema.js)
 * 2. Obronę przed Prototype Pollution w sygnałach i propozycjach
 * 3. Minimalizację danych RODO (stripowanie e-maili)
 * 4. Korelację sygnałów i generowanie propozycji przez kuratora (presenceRules.js)
 * 5. Aplikowanie i odrzucanie propozycji (Human-in-the-loop)
 *
 * Uruchom: node scripts/test-presence-engine.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadModule(relativePath, exportKey) {
  const code = readFileSync(path.join(root, relativePath), 'utf8');
  const sandbox = { window: {}, globalThis: {} };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox, { filename: relativePath });
  return sandbox[exportKey];
}

const twinSchema = loadModule('js/core/digitalTwinSchema.js', 'DFOPS_digitalTwinSchema');
const presenceRules = loadModule('js/core/presenceRules.js', 'DFOPS_presenceRules');

assert.ok(twinSchema, 'DFOPS_digitalTwinSchema wyeksportowane');
assert.ok(presenceRules, 'DFOPS_presenceRules wyeksportowane');

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

// 1. Digital Twin Schema
test('createInitialDigitalTwin generuje poprawną strukturę i oczyszcza wejście', () => {
  const twin = twinSchema.createInitialDigitalTwin('Pracownia Drewna', 'Stolarstwo meblowe', 'Gdynia', {
    skills: ['Meble dębowe', 'Stoły na zamówienie'],
    toneOfVoice: 'rzemieślniczy-minimalizm',
  });

  assert.equal(twin.version, 1);
  assert.equal(twin.identity.businessName, 'Pracownia Drewna');
  assert.equal(twin.identity.category, 'Stolarstwo meblowe');
  assert.equal(twin.identity.city, 'Gdynia');
  assert.equal(twin.identity.toneOfVoice, 'rzemieślniczy-minimalizm');
  assert.deepEqual(twin.facts.skills, ['Meble dębowe', 'Stoły na zamówienie']);

  const validation = twinSchema.validateDigitalTwin(twin);
  assert.ok(validation.valid, 'Stworzony Digital Twin jest w 100% poprawny');
});

// 2. Ochrona przed Prototype Pollution
test('digitalTwinSchema odrzuca próby Prototype Pollution w extras i payloadach', () => {
  const maliciousExtras = JSON.parse('{"__proto__":{"polluted":true},"tagline":"Bezpieczny"}');
  const twin = twinSchema.createInitialDigitalTwin('Test', 'Test', 'Test', maliciousExtras);

  assert.equal(twin.identity.tagline, 'Bezpieczny');
  assert.equal({}.polluted, undefined, 'Brak zanieczyszczenia globalnego prototypu!');
});

// 3. RODO: Minimalizacja danych w sygnałach
test('normalizeSignal maskuje prywatne adresy e-mail i usuwa niebezpieczne dane', () => {
  const rawSignal = {
    source: 'google_reviews',
    scope: 'public',
    payload: {
      text: 'Świetny stół! Mój mail kontaktowy to jan.kowalski@example.com dla potwierdzenia.',
      author_name: 'Jan Kowalski',
      rating: 5,
      media_urls: ['https://example.com/foto1.jpg', 'javascript:alert(1)'],
    },
  };

  const norm = twinSchema.normalizeSignal(rawSignal);
  assert.ok(!norm.payload.text.includes('jan.kowalski@example.com'), 'Email został usunięty');
  assert.ok(norm.payload.text.includes('[email-masked]'), 'Email został zamaskowany');
  assert.equal(norm.payload.rating, 5);
  assert.deepEqual(norm.payload.media_urls, ['https://example.com/foto1.jpg'], 'Odrzucono podejrzane URL (javascript:)');
});

// 4. Korelacja sygnałów (Instagram + Google Review)
test('correlateSignals łączy różne sygnały o wspólnych słowach kluczowych w kandydata na Case Study', () => {
  const sig1 = twinSchema.normalizeSignal({
    id: 'sig-ig-1',
    source: 'instagram',
    payload: {
      text: 'Dębowy stół jadalniany wreszcie gotowy do odbioru.',
      media_urls: ['https://example.com/stol.jpg'],
    },
  });

  const sig2 = twinSchema.normalizeSignal({
    id: 'sig-gr-2',
    source: 'google_reviews',
    payload: {
      text: 'Zamówiony dębowy stół prezentuje się zjawiskowo w jadalni!',
      author_name: 'Pani Anna',
      rating: 5,
    },
  });

  const clusters = presenceRules.correlateSignals([sig1, sig2]);
  assert.equal(clusters.length, 1);
  assert.ok(clusters[0].isCaseStudyCandidate, 'Wykryto kandydata na Case Study!');
  assert.equal(clusters[0].signals.length, 2, 'Klastry zawierają oba skorelowane sygnały');
});

// 5. Generowanie propozycji kuratora
test('generateProposalFromSignal generuje poprawny diff dla opinii Google', () => {
  const signal = twinSchema.normalizeSignal({
    id: 'sig-review-123',
    source: 'google_reviews',
    payload: {
      text: 'Znakomita współpraca i terminowość.',
      author_name: 'Marek Nowak',
      rating: 5,
    },
  });

  const proposal = presenceRules.generateProposalFromSignal(signal);
  assert.equal(proposal.type, 'review_spotlight');
  assert.equal(proposal.diff_patch.target, 'testimonials_grid');
  assert.equal(proposal.diff_patch.data.author, 'Marek Nowak');
  assert.equal(proposal.evidence_signal_ids.length, 1);
  assert.equal(proposal.evidence_signal_ids[0], 'sig-review-123');
});

// 6. Aplikowanie propozycji do bloków Studio (Human-in-the-loop)
test('applyProposalToContent bezpiecznie dopisuje opinię do istniejącego bloku testimonials_grid', () => {
  const initialContent = {
    blocks: [
      { id: 'b1', type: 'quick_hero', title: 'Witaj' },
      { id: 'b2', type: 'testimonials_grid', items: [{ author: 'Ktoś', text: 'Stara opinia', rating: 5 }] },
    ],
  };

  const proposal = {
    diff_patch: {
      target: 'testimonials_grid',
      operation: 'append_item',
      data: { author: 'Nowy Klient', text: 'Nowa opinia z presence engine', rating: 5 },
    },
  };

  const result = presenceRules.applyProposalToContent(initialContent, proposal);
  assert.ok(result.ok, 'Aplikacja powiodła się');
  assert.equal(result.updatedContent.blocks[1].items.length, 2);
  assert.equal(result.updatedContent.blocks[1].items[1].author, 'Nowy Klient');
  assert.equal(initialContent.blocks[1].items.length, 1, 'Oryginalny stan pozostał niemutowalny');
});

// 7. Odrzucenie propozycji (Feedback loop)
test('rejectProposal oznacza propozycję jako odrzuconą i zapisuje powód', () => {
  const proposal = twinSchema.createPresenceProposal({
    page_id: 'page-1',
    user_id: 'user-1',
    type: 'new_project_case_study',
    title: 'Projekt stołu',
    summary: 'Propozycja case study',
  });

  const rejected = presenceRules.rejectProposal(proposal, 'Zdjęcie jest nieaktualne');
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.rejected_at);
  assert.equal(rejected.rejection_reason, 'Zdjęcie jest nieaktualne');
});

console.log(`\n${passed} Personal Presence Engine tests passed successfully.`);
