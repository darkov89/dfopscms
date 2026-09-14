/**
 * DFCMS — Handoff pól między szablonem branżowym (pl.*) a draftem AI Studio (blocks).
 * Czyste funkcje: bez Alpine, DOM i Supabase.
 */
;(function (root) {
  'use strict';

  const CLASSIC_THEMES = ['beauty', 'consultant', 'fitness', 'services', 'gastro', 'care'];

  function str(v) {
    return v == null ? '' : String(v).trim();
  }

  function emptyHandoff() {
    return {
      name: '',
      business_name: '',
      role: '',
      specialty: '',
      tagline: '',
      phone: '',
      email: '',
      city: '',
      whatsapp: '',
      hours: '',
      video_url: '',
      address: '',
    };
  }

  /**
   * Wybiera najlepsze źródło JSON do odczytu handoffu (bloki Studio mają pierwszeństwo).
   */
  function pickHandoffSource(content, rawDraft, published) {
    const candidates = [content, rawDraft, published];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c && Array.isArray(c.blocks) && c.blocks.length) return c;
    }
    for (let j = 0; j < candidates.length; j++) {
      const c = candidates[j];
      if (c && c.pl && typeof c.pl === 'object') return c;
    }
    return content || rawDraft || published || {};
  }

  function extractFromBlocks(blocks, out) {
    const list = Array.isArray(blocks) ? blocks : [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const d = b && b.data && typeof b.data === 'object' ? b.data : null;
      if (!d) continue;
      const type = b.type;
      if (type === 'quick_hero' || type === 'cinematic_hero') {
        if (str(d.title) && !out.name) out.name = str(d.title);
        if (str(d.subtitle)) {
          if (!out.role) out.role = str(d.subtitle);
          if (!out.specialty) out.specialty = str(d.subtitle);
        }
        if (str(d.tagline) && !out.tagline) out.tagline = str(d.tagline);
        if (str(d.phone) && !out.phone) out.phone = str(d.phone);
        if (str(d.city) && !out.city) out.city = str(d.city);
        if (str(d.whatsapp) && !out.whatsapp) out.whatsapp = str(d.whatsapp);
        if (str(d.video_url) && !out.video_url) out.video_url = str(d.video_url);
      }
      if (type === 'quick_contact_card' || type === 'minimal_contact') {
        if (str(d.company_name) && !out.business_name) out.business_name = str(d.company_name);
        if (str(d.phone) && !out.phone) out.phone = str(d.phone);
        if (str(d.email) && !out.email) out.email = str(d.email);
        if (str(d.city) && !out.city) out.city = str(d.city);
        if (str(d.hours) && !out.hours) out.hours = str(d.hours);
        if (str(d.address) && !out.address) out.address = str(d.address);
        if (str(d.whatsapp) && !out.whatsapp) out.whatsapp = str(d.whatsapp);
      }
    }
  }

  function extractFromClassicPl(pl, out) {
    if (!pl || typeof pl !== 'object') return;
    const settings = pl.settings && typeof pl.settings === 'object' ? pl.settings : {};
    const contact = pl.contact && typeof pl.contact === 'object' ? pl.contact : {};
    const hero = pl.hero && typeof pl.hero === 'object' ? pl.hero : {};
    const nav = pl.nav && typeof pl.nav === 'object' ? pl.nav : {};
    if (str(settings.business_name) && !out.business_name) out.business_name = str(settings.business_name);
    if (str(nav.logo) && !out.business_name) out.business_name = str(nav.logo);
    if (str(hero.name) && !out.name) out.name = str(hero.name);
    if (str(hero.headline) && !out.tagline) out.tagline = str(hero.headline);
    if (str(hero.subheadline) && !out.specialty) out.specialty = str(hero.subheadline);
    if (str(settings.city) && !out.city) out.city = str(settings.city);
    if (str(contact.phone) && !out.phone) out.phone = str(contact.phone);
    if (str(contact.email) && !out.email) out.email = str(contact.email);
    if (str(contact.whatsapp) && !out.whatsapp) out.whatsapp = str(contact.whatsapp);
    if (str(contact.address) && !out.address) out.address = str(contact.address);
    if (str(contact.city) && !out.city) out.city = str(contact.city);
    const hours = contact.hours || contact.opening_hours;
    if (str(hours) && !out.hours) out.hours = str(hours);
  }

  /**
   * Wyciąga pola kontaktowe / nazwę z JSON-u strony (bloki Studio albo pl szablonu).
   */
  function extractHandoffAnswers(source) {
    const out = emptyHandoff();
    if (!source || typeof source !== 'object') return out;
    if (Array.isArray(source.blocks)) extractFromBlocks(source.blocks, out);
    if (source.pl) extractFromClassicPl(source.pl, out);
    if (!out.business_name) out.business_name = out.name;
    if (!out.name) out.name = out.business_name;
    if (!out.whatsapp && out.phone) out.whatsapp = out.phone.replace(/\s+/g, '');
    return out;
  }

  function isClassicTheme(theme) {
    return CLASSIC_THEMES.indexOf(String(theme || '').trim().toLowerCase()) !== -1;
  }

  /**
   * cinematic vs quick_card przy konwersji do Studio.
   */
  function preferredStudioKind(source, currentTheme) {
    const src = source && typeof source === 'object' ? source : {};
    if (src.theme_type === 'cinematic' || src.theme_type === 'quick_card') return src.theme_type;
    const blocks = Array.isArray(src.blocks) ? src.blocks : [];
    const hasCinematic = blocks.some((b) => b && b.type === 'cinematic_hero');
    const hasQuick = blocks.some((b) => b && b.type === 'quick_hero');
    if (hasCinematic && !hasQuick) return 'cinematic';
    if (hasQuick) return 'quick_card';
    return 'quick_card';
  }

  /**
   * Nakłada handoff na świeżo zmergowany content szablonu branżowego.
   */
  function applyHandoffToClassicContent(merged, handoff) {
    const m = merged && typeof merged === 'object' ? merged : {};
    if (!m.pl || typeof m.pl !== 'object') m.pl = {};
    const h = handoff && typeof handoff === 'object' ? handoff : emptyHandoff();
    if (!m.pl.contact || typeof m.pl.contact !== 'object') m.pl.contact = {};
    if (!m.pl.nav || typeof m.pl.nav !== 'object') m.pl.nav = {};
    if (!m.pl.hero || typeof m.pl.hero !== 'object') m.pl.hero = {};
    if (!m.pl.settings || typeof m.pl.settings !== 'object') m.pl.settings = {};

    const name = str(h.business_name) || str(h.name);
    if (str(h.phone)) m.pl.contact.phone = str(h.phone);
    if (str(h.email)) m.pl.contact.email = str(h.email);
    if (str(h.whatsapp)) m.pl.contact.whatsapp = str(h.whatsapp);
    if (str(h.address)) m.pl.contact.address = str(h.address);
    if (str(h.hours)) m.pl.contact.hours = str(h.hours);
    if (name) {
      if (!str(m.pl.nav.logo)) m.pl.nav.logo = name;
      if (!str(m.pl.settings.business_name)) m.pl.settings.business_name = name;
      if (!str(m.pl.hero.name)) m.pl.hero.name = name;
    }
    if (str(h.city) && !str(m.pl.settings.city)) m.pl.settings.city = str(h.city);
    if (str(h.tagline) && !str(m.pl.hero.headline)) m.pl.hero.headline = str(h.tagline);
    if (str(h.specialty) && !str(m.pl.hero.subheadline)) m.pl.hero.subheadline = str(h.specialty);
    return m;
  }

  const api = {
    CLASSIC_THEMES,
    pickHandoffSource,
    extractHandoffAnswers,
    isClassicTheme,
    preferredStudioKind,
    applyHandoffToClassicContent,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DFOPS_studioHandoffRules = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
