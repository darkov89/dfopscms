;(function () {
  /**
   * DFCMS Smart Booking Module — kontrakt treści.
   * Klucze: `settings.booking_mode` ('schedule' | 'embed' | 'button' | 'both') + `contact.booking_url`.
   * Każdy szablon publiczny MUSI mieć jeden ustandaryzowany blok rezerwacji, sterowany trybem:
   * - 'schedule' → natywny widok branżowy (grafik fitness, karta CTA consultant; brak sekcji rezerwacji),
   * - 'embed'    → osadzony iframe z `booking_url` (np. Calendly; Booksy blokuje X-Frame-Options),
   * - 'button'   → duża karta CTA z linkiem zewnętrznym (Booksy, Google Booking, ZnanyLekarz, …),
   * - 'both'     → natywny widok + karta CTA pod nim.
   * Migracja: legacy `contact.booksyUrl` / `bookingUrl` → `booking_url`; brak trybu → inferencja
   * (Calendly = embed, inny URL = button, pusty = schedule) w `contentUpgrader.js` i `adminApp.js`.
   */
  const CONTACT_BOOKING_DEFAULTS = { booking_url: '', booking_mode: 'schedule' };

  /**
   * Silnik Wzrostu (G3) — kontrakt `pages.content.pl.settings.growth`.
   * Zapis WYŁĄCZNIE w `draft_content` (autosave panelu) — patrz docs/specs/growth.md §7.
   * `dismissed_rule_ids` — max 50 ID (obcinane w growthPanel.js); `last_shown_rule_id` + `last_shown_at`
   * sterują rotacją tygodniową rekomendacji.
   */
  const GROWTH_SETTINGS_DEFAULTS = {
    dismissed_rule_ids: [],
    last_shown_rule_id: '',
    last_shown_at: '',
    onboarding_growth_seen: false,
  };

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function fillDefaults(target, defaults) {
    if (target === null || target === undefined) return deepClone(defaults);
    if (Array.isArray(defaults)) return Array.isArray(target) ? target : deepClone(defaults);
    if (typeof defaults !== 'object' || defaults === null) return target ?? defaults;
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return deepClone(defaults);

    const out = target;
    for (const key of Object.keys(defaults)) {
      if (!(key in out) || out[key] === undefined || out[key] === null) out[key] = deepClone(defaults[key]);
      else out[key] = fillDefaults(out[key], defaults[key]);
    }
    return out;
  }

  /** Merge user JSON with template defaults (theme + fillDefaults). */
  function mergeContentWithTemplate(theme, content) {
    const getT = window.DFOPS_getTemplate;
    if (typeof getT !== 'function') throw new Error('Brak DFOPS_getTemplate');
    const resolve =
      typeof window.DFOPS_resolveTemplateKeyForMerge === 'function'
        ? window.DFOPS_resolveTemplateKeyForMerge
        : function (t) {
            return t;
          };
    const base = getT(resolve(theme));
    const normalized = fillDefaults(content ? deepClone(content) : {}, base);
    if (!normalized.pl) normalized.pl = {};
    if (!normalized.pl.settings) normalized.pl.settings = {};
    if (!normalized.pl.settings.template_version) {
      normalized.pl.settings.template_version = window.DFOPS_LATEST_TEMPLATE_VERSION || 1;
    }
    if (normalized.pl.settings.onboarding_completed === undefined) {
      normalized.pl.settings.onboarding_completed = false;
    }
    if (!normalized.pl.settings.analytics || typeof normalized.pl.settings.analytics !== 'object') {
      normalized.pl.settings.analytics = { gtm_id: '', fb_pixel_id: '' };
    } else {
      if (normalized.pl.settings.analytics.gtm_id === undefined || normalized.pl.settings.analytics.gtm_id === null) {
        normalized.pl.settings.analytics.gtm_id = '';
      }
      if (
        normalized.pl.settings.analytics.fb_pixel_id === undefined ||
        normalized.pl.settings.analytics.fb_pixel_id === null
      ) {
        normalized.pl.settings.analytics.fb_pixel_id = '';
      }
    }
    return normalized;
  }

  window.DFOPS_CONTACT_BOOKING_DEFAULTS = CONTACT_BOOKING_DEFAULTS;
  window.DFOPS_GROWTH_SETTINGS_DEFAULTS = GROWTH_SETTINGS_DEFAULTS;
  window.DFOPS_deepClone = deepClone;
  window.DFOPS_fillDefaults = fillDefaults;
  window.DFOPS_mergeContentWithTemplate = mergeContentWithTemplate;
})();

