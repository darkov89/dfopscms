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

  function normalizeContent(theme, content) {
    const getT = window.DFOPS_getTemplate;
    if (typeof getT !== 'function') throw new Error('Brak DFOPS_getTemplate');
    const base = getT(theme);
    const normalized = fillDefaults(content ? deepClone(content) : {}, base);
    if (!normalized.pl) normalized.pl = {};
    if (!normalized.pl.settings) normalized.pl.settings = {};
    if (!normalized.pl.settings.template_version) {
      normalized.pl.settings.template_version = window.DFOPS_LATEST_TEMPLATE_VERSION || 1;
    }
    return normalized;
  }

  window.DFOPS_deepClone = deepClone;
  window.DFOPS_fillDefaults = fillDefaults;
  window.DFOPS_normalizeContent = normalizeContent;
})();

