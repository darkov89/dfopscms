/**
 * Zero-Friction Context-Driven AI — czysta logika kontekstu branżowego.
 * Bez Alpine / Supabase UI. Zapis docelowy: draft_content.pl.settings.ai_business_context
 */
;(function (g) {
  const CONTEXT_MAX = 500;
  const INDUSTRY_MAX = 80;
  const GENERIC_PLACE_TYPES = new Set([
    'establishment',
    'point_of_interest',
    'geocode',
    'political',
    'premise',
    'street_address',
    'route',
    'plus_code',
    'subpremise',
    'neighborhood',
    'locality',
    'postal_code',
    'country',
    'administrative_area_level_1',
    'administrative_area_level_2',
    'administrative_area_level_3',
  ]);

  function stripControlAndHtml(raw) {
    return String(raw == null ? '' : raw)
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function clampText(raw, max) {
    const s = stripControlAndHtml(raw);
    if (!s) return '';
    const lim = Number.isFinite(max) && max > 0 ? max : CONTEXT_MAX;
    return s.length > lim ? s.slice(0, lim).trim() : s;
  }

  function humanizeTypeKey(key) {
    const k = String(key || '')
      .trim()
      .toLowerCase();
    if (!k || GENERIC_PLACE_TYPES.has(k)) return '';
    return k.replace(/_/g, ' ');
  }

  function localizedText(value) {
    if (typeof value === 'string') return clampText(value, INDUSTRY_MAX);
    if (value && typeof value === 'object' && typeof value.text === 'string') {
      return clampText(value.text, INDUSTRY_MAX);
    }
    return '';
  }

  /**
   * Wyciąga czytelną kategorię branżową z wyniku Places (listPlaces / details).
   * Pusty string = brak jasnej kategorii → UI fallback.
   */
  function industryFromPlace(place) {
    if (!place || typeof place !== 'object') return '';

    const fromCategory = clampText(place.category, INDUSTRY_MAX);
    if (fromCategory) return fromCategory;

    const fromDisplay = localizedText(place.primaryTypeDisplayName);
    if (fromDisplay) return fromDisplay;

    const fromPrimary = humanizeTypeKey(place.primaryType);
    if (fromPrimary) return clampText(fromPrimary, INDUSTRY_MAX);

    const types = Array.isArray(place.types) ? place.types : [];
    for (let i = 0; i < types.length; i++) {
      const label = humanizeTypeKey(types[i]);
      if (label) return clampText(label, INDUSTRY_MAX);
    }
    return '';
  }

  function hasClearIndustryCategory(place) {
    return industryFromPlace(place).length > 0;
  }

  /** Heurystyka miasta z formattedAddress (PL/EU). */
  function guessCityFromAddress(address) {
    const parts = String(address || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return '';

    const withoutCountry = parts.filter(
      (p) => !/^(polska|poland|deutschland|germany|czechia|česko|slovakia|österreich|austria)$/i.test(p),
    );
    const pool = withoutCountry.length ? withoutCountry : parts;

    for (let i = pool.length - 1; i >= 0; i--) {
      let p = pool[i].replace(/^\d{2}-\d{3}\s+/, '').trim();
      p = p.replace(/^\d{5}\s+/, '').trim();
      if (!p) continue;
      if (/^(ul\.|al\.|pl\.|os\.|ulica|aleja)\b/i.test(p)) continue;
      if (/^\d+[a-z]?(\/\d+)?$/i.test(p)) continue;
      return clampText(p, 80);
    }
    return '';
  }

  /**
   * Składa jeden ciąg kontekstu biznesowego (nazwa + branża + miasto).
   */
  function composeAiBusinessContext(parts) {
    const src = parts && typeof parts === 'object' ? parts : {};
    const name = clampText(src.business_name || src.name, 120);
    const industry = clampText(src.business_category || src.industry || src.category, INDUSTRY_MAX);
    const city = clampText(src.city, 80);
    const chunks = [];
    if (name) chunks.push(name);
    if (industry) chunks.push(industry);
    if (city) chunks.push(city);
    return clampText(chunks.join(' — '), CONTEXT_MAX);
  }

  /**
   * defaultContext do pre-fill modala AI:
   * 1) settings.ai_business_context
   * 2) sklejka business_name + business_category + city (stare strony)
   */
  function buildDefaultAiContext(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const saved = clampText(s.ai_business_context, CONTEXT_MAX);
    if (saved) return saved;
    return composeAiBusinessContext({
      business_name: s.business_name,
      business_category: s.business_category,
      city: s.city,
    });
  }

  /**
   * Zapisuje kontekst z Places (lub ręcznej branży) do settings.
   * @returns {{ ok: boolean, needsManualIndustry: boolean, context: string }}
   */
  function applyPlaceToAiBusinessSettings(settings, place, opts) {
    const s = settings && typeof settings === 'object' ? settings : null;
    if (!s) {
      return { ok: false, needsManualIndustry: true, context: '' };
    }
    const options = opts && typeof opts === 'object' ? opts : {};
    const manualIndustry = clampText(options.manualIndustry, INDUSTRY_MAX);
    const placeObj = place && typeof place === 'object' ? place : {};

    const name = clampText(placeObj.name || options.business_name || s.business_name, 120);
    const address = clampText(placeObj.address || options.address || '', 200);
    let industry = industryFromPlace(placeObj);
    if (!industry && manualIndustry) industry = manualIndustry;

    const city =
      clampText(options.city || s.city, 80) ||
      guessCityFromAddress(address) ||
      guessCityFromAddress(s.city);

    if (name && !clampText(s.business_name, 120)) {
      s.business_name = name;
    }
    if (industry) s.business_category = industry;
    if (city) s.city = city;

    const context = composeAiBusinessContext({
      business_name: name || s.business_name,
      business_category: industry || s.business_category,
      city: city || s.city,
    });

    const needsManualIndustry = !industry;
    if (context) s.ai_business_context = context;

    return { ok: !!context || !needsManualIndustry, needsManualIndustry, context };
  }

  function applyManualIndustryToSettings(settings, manualIndustry, extras) {
    const s = settings && typeof settings === 'object' ? settings : null;
    if (!s) return { ok: false, context: '' };
    const industry = clampText(manualIndustry, INDUSTRY_MAX);
    if (!industry) return { ok: false, context: String(s.ai_business_context || '').trim() };

    const extra = extras && typeof extras === 'object' ? extras : {};
    s.business_category = industry;
    const context = composeAiBusinessContext({
      business_name: extra.business_name || s.business_name,
      business_category: industry,
      city: extra.city || s.city,
    });
    if (context) s.ai_business_context = context;
    return { ok: true, context };
  }

  g.DFOPS_aiBusinessContext = {
    CONTEXT_MAX,
    INDUSTRY_MAX,
    stripControlAndHtml,
    clampText,
    industryFromPlace,
    hasClearIndustryCategory,
    guessCityFromAddress,
    composeAiBusinessContext,
    buildDefaultAiContext,
    applyPlaceToAiBusinessSettings,
    applyManualIndustryToSettings,
  };
})(typeof window !== 'undefined' ? window : globalThis);
