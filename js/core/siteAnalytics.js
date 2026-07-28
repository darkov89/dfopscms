// Silnik Wzrostu (G1) — tracking konwersji publicznych (telefon/rezerwacja/WhatsApp).
// Wzorzec: IIFE + window.DFOPS_* (jak js/core/analytics.js), ale osobny moduł —
// stary DFOPS_trackEvent (panel) NIE jest używany przez Silnik Wzrostu.
// Kontrakt: docs/specs/growth.md §5.1.
;(function () {
  const DEBOUNCE_MS = 2000;
  const lastSentAt = new Map();

  function isPreview() {
    if (window.DFOPS_IS_PREVIEW === true) return true;
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('dfcms_preview') === '1') return true;
    } catch (_e) {
      /* noop */
    }
    return false;
  }

  function resolveSlug() {
    if (typeof window.DFOPS_getCurrentSiteSlug === 'function') {
      const fromHelper = window.DFOPS_getCurrentSiteSlug();
      if (fromHelper) return String(fromHelper).trim();
    }
    const app = window.DFOPS_publicSiteAppInstance;
    if (app && app.slug) return String(app.slug).trim();
    try {
      const params = new URLSearchParams(window.location.search || '');
      const fromQuery = params.get('site');
      if (fromQuery) return String(fromQuery).trim();
    } catch (_e) {
      /* noop */
    }
    return '';
  }

  function resolveEndpoint() {
    const cfg = window.DFOPS_CONFIG;
    if (cfg && typeof cfg.conversionEventsEndpoint === 'string' && cfg.conversionEventsEndpoint) {
      return cfg.conversionEventsEndpoint;
    }
    const base = window.DFOPS_SUPABASE_URL;
    return base ? `${base}/functions/v1/record-site-event` : '';
  }

  /**
   * window.DFOPS_recordConversionEvent(eventName, source)
   * `eventName` = wartość kolumny `event_name` (phone_click, booking_click, whatsapp_click, …).
   * Cicha porażka — nigdy nie przerywa nawigacji użytkownika (np. `tel:` / `wa.me`).
   */
  function recordConversionEvent(eventName, source) {
    try {
      if (isPreview()) return;
      const name = String(eventName || '').trim();
      if (!name) return;
      const slug = resolveSlug();
      if (!slug) return;

      const key = `${slug}:${name}:${source || ''}`;
      const now = Date.now();
      const last = lastSentAt.get(key) || 0;
      if (now - last < DEBOUNCE_MS) return;
      lastSentAt.set(key, now);

      const endpoint = resolveEndpoint();
      if (!endpoint || typeof fetch !== 'function') return;

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, event_type: name, source: source || '' }),
        keepalive: true,
      }).catch((e) => {
        if (typeof console !== 'undefined' && console.debug) console.debug('[DFOPS siteAnalytics]', e);
      });
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) console.debug('[DFOPS siteAnalytics]', e);
    }
  }

  window.DFOPS_recordConversionEvent = recordConversionEvent;
})();
