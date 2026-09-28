/**
 * digitalTwinSchema.js — Model tożsamości i schemat sygnałów Personal Presence Engine.
 * Czysta logika domenowa (Node.js + browser). Bez zależności od DOM / Alpine / Supabase UI.
 */
;(function (g) {
  'use strict';

  const SIGNAL_SOURCES = Object.freeze([
    'instagram',
    'google_reviews',
    'google_business',
    'drive',
    'direct_note',
    'linkedin',
  ]);

  const SIGNAL_SCOPES = Object.freeze(['public', 'work', 'direct']);

  const PROPOSAL_TYPES = Object.freeze([
    'new_project_case_study',
    'review_spotlight',
    'hero_focus_shift',
    'timeline_update',
    'offer_adjustment',
  ]);

  const PROPOSAL_STATUSES = Object.freeze([
    'pending',
    'applied',
    'rejected',
    'superseded',
  ]);

  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  /**
   * Głęboka sanityzacja obiektu pod kątem Prototype Pollution.
   */
  function stripPrototypePollution(input) {
    if (!input || typeof input !== 'object') return input;
    if (Array.isArray(input)) {
      return input.map(stripPrototypePollution);
    }
    const clean = {};
    for (const key of Object.keys(input)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      clean[key] = stripPrototypePollution(input[key]);
    }
    return clean;
  }

  /**
   * Bezpieczne oczyszczenie tekstu z HTML i znaków kontrolnych.
   */
  function sanitizeString(raw, maxLen = 1000) {
    if (raw == null) return '';
    if (typeof raw === 'object') {
      if (typeof raw.text === 'string') raw = raw.text;
      else if (typeof raw.title === 'string') raw = raw.title;
      else if (typeof raw.name === 'string') raw = raw.name;
      else return '';
    }
    const s = String(raw).trim();
    if (s === '[object Object]') return '';
    return s
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  /**
   * RODO: Minimalizacja danych w payloadach sygnałów.
   * Usuwa wykryte prywatne adresy e-mail czy numery PESEL/dowodów z publicznych sygnałów.
   */
  function stripSensitivePii(text) {
    if (!text || typeof text !== 'string') return '';
    // Maskowanie e-maili w treści recenzji / postu
    return text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email-masked]');
  }

  /**
   * Tworzy stan początkowy cyfrowego bliźniaka (Digital Twin).
   */
  function createInitialDigitalTwin(businessName = '', category = '', city = '', extras = {}) {
    const safeExtras = stripPrototypePollution(extras) || {};
    return {
      version: 1,
      identity: {
        businessName: sanitizeString(businessName, 120),
        category: sanitizeString(category, 80),
        city: sanitizeString(city, 80),
        toneOfVoice: sanitizeString(safeExtras.toneOfVoice || 'craftsman-minimal', 60),
        tagline: sanitizeString(safeExtras.tagline || '', 200),
      },
      facts: {
        skills: Array.isArray(safeExtras.skills) ? safeExtras.skills.map((s) => sanitizeString(s, 50)).filter(Boolean) : [],
        specializations: Array.isArray(safeExtras.specializations)
          ? safeExtras.specializations.map((s) => sanitizeString(s, 50)).filter(Boolean)
          : [],
        pricingIndications: sanitizeString(safeExtras.pricingIndications || '', 120),
      },
      sources: {
        instagram: { connected: false, username: '', lastSync: null },
        google_business: { connected: false, placeId: '', lastSync: null },
        google_drive: { connected: false, folderId: '', lastSync: null },
      },
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Walidacja obiektu Digital Twin.
   */
  function validateDigitalTwin(twin) {
    if (!twin || typeof twin !== 'object') {
      return { valid: false, errors: ['Brak obiektu Digital Twin'] };
    }
    const errors = [];
    if (twin.version !== 1) errors.push('Niepoprawna wersja Digital Twin');
    if (!twin.identity || typeof twin.identity !== 'object') {
      errors.push('Brak sekcji identity');
    } else {
      if (typeof twin.identity.businessName !== 'string') errors.push('Niepoprawne businessName');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Normalizuje surowy sygnał zewnętrzny do kontraktu PresenceSignal.
   */
  function normalizeSignal(rawSignal) {
    if (!rawSignal || typeof rawSignal !== 'object') {
      throw new Error('Sygnał musi być obiektem');
    }
    const safe = stripPrototypePollution(rawSignal);

    const source = SIGNAL_SOURCES.includes(safe.source) ? safe.source : 'direct_note';
    const scope = SIGNAL_SCOPES.includes(safe.scope) ? safe.scope : 'public';

    const rawPayload = safe.payload && typeof safe.payload === 'object' ? safe.payload : {};
    const text = stripSensitivePii(sanitizeString(rawPayload.text || '', 2000));

    const media_urls = Array.isArray(rawPayload.media_urls)
      ? rawPayload.media_urls
          .map((u) => sanitizeString(u, 500))
          .filter((u) => /^https?:\/\//i.test(u))
      : [];

    const rating = typeof rawPayload.rating === 'number' && rawPayload.rating >= 1 && rawPayload.rating <= 5
      ? Math.round(rawPayload.rating * 10) / 10
      : null;

    const author_name = sanitizeString(rawPayload.author_name || '', 100);

    return {
      id: safe.id ? String(safe.id) : null,
      page_id: safe.page_id ? String(safe.page_id) : null,
      user_id: safe.user_id ? String(safe.user_id) : null,
      source,
      scope,
      external_id: safe.external_id ? sanitizeString(safe.external_id, 255) : null,
      payload: {
        text,
        media_urls,
        rating,
        author_name,
        timestamp: safe.created_at || new Date().toISOString(),
        metadata: rawPayload.metadata && typeof rawPayload.metadata === 'object' ? stripPrototypePollution(rawPayload.metadata) : {},
      },
      created_at: safe.created_at || new Date().toISOString(),
    };
  }

  /**
   * Tworzy obiekt propozycji kuratora (PresenceProposal).
   */
  function createPresenceProposal(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('Parametry propozycji są wymagane');
    }
    const safe = stripPrototypePollution(params);
    const type = PROPOSAL_TYPES.includes(safe.type) ? safe.type : 'new_project_case_study';

    return {
      id: safe.id ? String(safe.id) : null,
      page_id: safe.page_id ? String(safe.page_id) : null,
      user_id: safe.user_id ? String(safe.user_id) : null,
      type,
      title: sanitizeString(safe.title || 'Nowa aktualizacja obecności', 160),
      summary: sanitizeString(safe.summary || '', 500),
      diff_patch: safe.diff_patch && typeof safe.diff_patch === 'object' ? safe.diff_patch : {},
      evidence_signal_ids: Array.isArray(safe.evidence_signal_ids)
        ? safe.evidence_signal_ids.map((id) => String(id)).filter(Boolean)
        : [],
      status: 'pending',
      created_at: new Date().toISOString(),
    };
  }

  g.DFOPS_digitalTwinSchema = {
    SIGNAL_SOURCES,
    SIGNAL_SCOPES,
    PROPOSAL_TYPES,
    PROPOSAL_STATUSES,
    stripPrototypePollution,
    sanitizeString,
    stripSensitivePii,
    createInitialDigitalTwin,
    validateDigitalTwin,
    normalizeSignal,
    createPresenceProposal,
  };
})(typeof window !== 'undefined' ? window : globalThis);
