import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import studioHandoffRules from '../js/core/studioHandoffRules.js';

test('extractHandoffAnswers: z szablonu branżowego bierze kontakt i nazwę', () => {
  const content = {
    pl: {
      settings: { business_name: 'Hydraulika Darek', city: 'Kraków' },
      nav: { logo: 'Hydraulika Darek' },
      hero: { name: 'Hydraulika Darek', headline: 'Awaria? Jedziemy.' },
      contact: { phone: '+48 600 111 222', email: 'a@b.pl', whatsapp: '48600111222' },
    },
  };
  const h = studioHandoffRules.extractHandoffAnswers(content);
  assert.equal(h.business_name, 'Hydraulika Darek');
  assert.equal(h.name, 'Hydraulika Darek');
  assert.equal(h.phone, '+48 600 111 222');
  assert.equal(h.email, 'a@b.pl');
  assert.equal(h.city, 'Kraków');
  assert.equal(h.whatsapp, '48600111222');
});

test('extractHandoffAnswers: z bloków Studio (quick_hero + contact) nie gubi telefonu', () => {
  const draft = {
    theme_type: 'quick_card',
    blocks: [
      { type: 'quick_hero', data: { title: 'Studio Kino', subtitle: 'Operator', phone: '500 600 700', city: 'Gdańsk' } },
      { type: 'quick_contact_card', data: { company_name: 'Studio Kino', email: 'x@y.pl', hours: '9–17' } },
    ],
  };
  const h = studioHandoffRules.extractHandoffAnswers(draft);
  assert.equal(h.name, 'Studio Kino');
  assert.equal(h.business_name, 'Studio Kino');
  assert.equal(h.phone, '500 600 700');
  assert.equal(h.email, 'x@y.pl');
  assert.equal(h.city, 'Gdańsk');
  assert.equal(h.hours, '9–17');
  assert.equal(h.specialty, 'Operator');
});

test('pickHandoffSource: bloki w drafcie wygrywają ze szkieletem pl w content', () => {
  const content = { pl: { contact: { phone: '111' } } };
  const draft = { blocks: [{ type: 'quick_hero', data: { title: 'Z bloków', phone: '222' } }] };
  const src = studioHandoffRules.pickHandoffSource(content, draft, null);
  assert.equal(src, draft);
  assert.equal(studioHandoffRules.extractHandoffAnswers(src).phone, '222');
});

test('applyHandoffToClassicContent: uzupełnia kontakt i logo w zmergowanym szablonie', () => {
  const merged = { pl: { contact: {}, nav: {}, hero: {}, settings: {} } };
  const out = studioHandoffRules.applyHandoffToClassicContent(merged, {
    business_name: 'Firma X',
    phone: '123',
    email: 'f@x.pl',
    city: 'Poznań',
  });
  assert.equal(out.pl.contact.phone, '123');
  assert.equal(out.pl.contact.email, 'f@x.pl');
  assert.equal(out.pl.nav.logo, 'Firma X');
  assert.equal(out.pl.settings.business_name, 'Firma X');
  assert.equal(out.pl.settings.city, 'Poznań');
});

test('preferredStudioKind: cinematic_hero → cinematic, w przeciwnym razie quick_card', () => {
  assert.equal(
    studioHandoffRules.preferredStudioKind({ blocks: [{ type: 'cinematic_hero', data: {} }] }),
    'cinematic'
  );
  assert.equal(
    studioHandoffRules.preferredStudioKind({ pl: { contact: {} } }, 'beauty'),
    'quick_card'
  );
});

test('kreator.html: INSERT strony nie wysyła billing_plan (GRANT authenticated tego zabrania)', () => {
  const html = readFileSync(path.join(process.cwd(), 'kreator.html'), 'utf8');
  assert.equal(
    /billing_plan\s*:/.test(html),
    false,
    'kreator.html nie może wstawiać pages.billing_plan — kolumna jest tylko dla service_role'
  );
});

test('extractHandoffAnswers: rozpakowuje obiekty i nigdy nie zwraca [object Object]', () => {
  const draft = {
    blocks: [
      {
        type: 'quick_hero',
        data: {
          title: { text: 'Studio Foto' },
          subtitle: { title: 'Fotografia Biznesowa' },
          phone: '[object Object]',
          city: { value: 'Wrocław' },
        },
      },
    ],
  };
  const h = studioHandoffRules.extractHandoffAnswers(draft);
  assert.equal(h.name, 'Studio Foto');
  assert.equal(h.specialty, 'Fotografia Biznesowa');
  assert.equal(h.phone, '');
  assert.equal(h.city, 'Wrocław');
});
