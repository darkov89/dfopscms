;(function () {
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

  window.DFOPS_deepClone = deepClone;
  window.DFOPS_fillDefaults = fillDefaults;
  window.DFOPS_mergeContentWithTemplate = mergeContentWithTemplate;
})();

