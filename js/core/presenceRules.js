/**
 * presenceRules.js — Reguły biznesowe kuratora Personal Presence Engine.
 * Czyste funkcje (pure functions), 100% testowalne w Node.js, bez Alpine/DOM.
 */
;(function (g) {
  'use strict';

  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  function safeDeepClone(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(safeDeepClone);
    const copy = {};
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      copy[key] = safeDeepClone(obj[key]);
    }
    return copy;
  }

  function extractKeywords(text) {
    if (!text || typeof text !== 'string') return [];
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4);
  }

  /**
   * Korelacja sygnałów z różnych źródeł (np. zdjęcie z IG + opinia z Google Places).
   */
  function correlateSignals(signals) {
    if (!Array.isArray(signals) || signals.length === 0) return [];

    const clusters = [];
    const usedIds = new Set();

    for (let i = 0; i < signals.length; i++) {
      const s1 = signals[i];
      if (!s1 || usedIds.has(s1.id)) continue;

      const cluster = {
        clusterId: `cluster-${s1.id || i}`,
        signals: [s1],
        keywords: extractKeywords(s1.payload?.text),
        isCaseStudyCandidate: false,
      };
      usedIds.add(s1.id);

      for (let j = i + 1; j < signals.length; j++) {
        const s2 = signals[j];
        if (!s2 || usedIds.has(s2.id)) continue;

        // Jeśli sygnały pochodzą z różnych źródeł (np. instagram + google_reviews)
        if (s1.source !== s2.source) {
          const kw2 = extractKeywords(s2.payload?.text);
          const hasCommonKeywords = cluster.keywords.some((k) => kw2.includes(k));

          if (hasCommonKeywords) {
            cluster.signals.push(s2);
            usedIds.add(s2.id);
            cluster.isCaseStudyCandidate = true;
          }
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Generuje propozycję aktualizacji na podstawie pojedynczego lub skorelowanego sygnału.
   */
  function generateProposalFromSignal(signal, currentTwin) {
    if (!signal || typeof signal !== 'object') {
      throw new Error('Sygnał jest wymagany do wygenerowania propozycji');
    }

    const payload = signal.payload || {};
    const text = payload.text || '';
    const rating = payload.rating;
    const author = payload.author_name || 'Klient';
    const media = Array.isArray(payload.media_urls) ? payload.media_urls : [];

    // Przypadek 1: Wysoka ocena z Google Reviews (Social Proof)
    if (signal.source === 'google_reviews' && rating && rating >= 4) {
      return {
        type: 'review_spotlight',
        title: `Nowa rekomendacja od ${author} (${rating}★)`,
        summary: `Klient wystawił ocenę ${rating}/5 z treścią: "${text.slice(0, 100)}...". Propozycja dodania do sekcji opinii.`,
        evidence_signal_ids: signal.id ? [signal.id] : [],
        diff_patch: {
          target: 'testimonials_grid',
          operation: 'append_item',
          data: {
            author,
            text,
            rating,
            source: 'Google',
            date: payload.timestamp ? payload.timestamp.slice(0, 10) : new Date().toISOString().slice(0, 10),
          },
        },
      };
    }

    // Przypadek 2: Instagram lub zrzut zdjęć realizacji (Case Study / Portfolio)
    if ((signal.source === 'instagram' || signal.source === 'drive' || signal.source === 'direct_note') && media.length > 0) {
      const titleCandidate = text ? text.split('\n')[0].slice(0, 60) : 'Nowa realizacja';
      return {
        type: 'new_project_case_study',
        title: `Nowa realizacja: ${titleCandidate}`,
        summary: `Wykryto ${media.length} zdjęć nowej realizacji. Propozycja dodania projektu do galerii.`,
        evidence_signal_ids: signal.id ? [signal.id] : [],
        diff_patch: {
          target: 'gallery_grid',
          operation: 'append_item',
          data: {
            title: titleCandidate,
            description: text.slice(0, 250),
            image_url: media[0],
            tags: extractKeywords(text).slice(0, 3),
          },
        },
      };
    }

    // Przypadek 3: Ogólna notatka lub aktualizacja osi czasu (Timeline Update)
    return {
      type: 'timeline_update',
      title: 'Aktualizacja osi czasu / profilu',
      summary: text ? `Nowa aktywność: "${text.slice(0, 120)}..."` : 'Nowa aktywność w profilu',
      evidence_signal_ids: signal.id ? [signal.id] : [],
      diff_patch: {
        target: 'timeline',
        operation: 'append_item',
        data: {
          date: new Date().toISOString().slice(0, 10),
          text: text.slice(0, 300),
        },
      },
    };
  }

  /**
   * Bezpiecznie aplikuje zatwierdzoną propozycję kuratora do struktury contentu.
   * Obsługuje zarówno tablicę bloków Studio (customBlocks), jak i klasyczny obiekt sekcji.
   */
  function applyProposalToContent(rawContent, proposal) {
    if (!rawContent || typeof rawContent !== 'object') {
      return { ok: false, error: 'Nieprawidłowa struktura contentu' };
    }
    if (!proposal || typeof proposal !== 'object' || !proposal.diff_patch) {
      return { ok: false, error: 'Brak danych propozycji lub diff_patch' };
    }

    const content = safeDeepClone(rawContent);
    const { target, operation, data } = proposal.diff_patch;

    if (!target || !data) {
      return { ok: false, error: 'Niekompletny diff_patch' };
    }

    // 1. Sprawdź, czy mamy strukturę blokową Studio (np. content.blocks: Array)
    if (Array.isArray(content.blocks)) {
      const block = content.blocks.find((b) => b && b.type === target);
      if (block) {
        if (!Array.isArray(block.items)) {
          block.items = [];
        }
        if (operation === 'append_item') {
          block.items.push(safeDeepClone(data));
        }
      } else {
        // Blok docelowy jeszcze nie istnieje na stronie — utwórzmy go elegancko na końcu
        content.blocks.push({
          id: `block-${target}-${Date.now()}`,
          type: target,
          title: target === 'testimonials_grid' ? 'Opinie klientów' : 'Nasze realizacje',
          items: [safeDeepClone(data)],
        });
      }
      return { ok: true, updatedContent: content };
    }

    // 2. Jeśli to klasyczna struktura sekcyjna (np. content.pl lub content.testimonials)
    const locale = content.pl ? content.pl : content;
    if (operation === 'append_item') {
      if (!Array.isArray(locale[target])) {
        locale[target] = [];
      }
      locale[target].push(safeDeepClone(data));
      return { ok: true, updatedContent: content };
    }

    return { ok: false, error: `Nieobsługiwana operacja: ${operation}` };
  }

  /**
   * Odrzucenie propozycji przez użytkownika (Human-in-the-loop feedback).
   */
  function rejectProposal(proposal, reason = '') {
    if (!proposal || typeof proposal !== 'object') {
      throw new Error('Propozycja musi być obiektem');
    }
    const clean = safeDeepClone(proposal);
    clean.status = 'rejected';
    clean.rejected_at = new Date().toISOString();
    if (reason) {
      clean.rejection_reason = String(reason).slice(0, 200);
    }
    return clean;
  }

  g.DFOPS_presenceRules = {
    safeDeepClone,
    extractKeywords,
    correlateSignals,
    generateProposalFromSignal,
    applyProposalToContent,
    rejectProposal,
  };
})(typeof window !== 'undefined' ? window : globalThis);
