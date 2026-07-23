/**
 * Hydrate / meta / sync dla wielojęzycznej treści pages.content.
 * Runtime: top-level klucze locale (pl, en, de) — kompatybilne z publicSiteApp.
 * meta.locales = włączone języki; settings/contact fakty sync z defaultLocale.
 */
;(function () {
  const ALLOWED =
    typeof window.DFOPS_ALLOWED_SITE_LOCALES !== 'undefined'
      ? window.DFOPS_ALLOWED_SITE_LOCALES
      : ['pl', 'en', 'de'];
  const DEFAULT =
    typeof window.DFOPS_DEFAULT_SITE_LOCALE !== 'undefined'
      ? window.DFOPS_DEFAULT_SITE_LOCALE
      : 'pl';

  function deepClone(v) {
    if (typeof window.DFOPS_deepClone === 'function') return window.DFOPS_deepClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  function isLocaleKey(k) {
    return ALLOWED.indexOf(String(k || '').toLowerCase()) !== -1;
  }

  function ensureMeta(content) {
    if (!content || typeof content !== 'object') return content;
    if (!content.meta || typeof content.meta !== 'object') content.meta = {};
    const def = String(content.meta.defaultLocale || DEFAULT)
      .trim()
      .toLowerCase();
    content.meta.defaultLocale = isLocaleKey(def) ? def : DEFAULT;
    let list = Array.isArray(content.meta.locales) ? content.meta.locales : [];
    list = list
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x) => isLocaleKey(x));
    if (list.indexOf(content.meta.defaultLocale) === -1) {
      list.unshift(content.meta.defaultLocale);
    }
    // Zawsze miej co najmniej default
    if (!list.length) list = [content.meta.defaultLocale];
    // Dedup
    const seen = {};
    content.meta.locales = list.filter((x) => {
      if (seen[x]) return false;
      seen[x] = true;
      return true;
    });
    return content;
  }

  function enabledLocales(content) {
    ensureMeta(content);
    return (content.meta.locales || [DEFAULT]).slice();
  }

  function defaultLocale(content) {
    ensureMeta(content);
    return content.meta.defaultLocale || DEFAULT;
  }

  /** Pola „shared” kopiowane z default → inne locale (fakty / settings). */
  function syncSharedIntoLocales(content) {
    if (!content || typeof content !== 'object') return content;
    ensureMeta(content);
    const def = defaultLocale(content);
    const src = content[def];
    if (!src || typeof src !== 'object') return content;

    const enabled = enabledLocales(content);
    for (let i = 0; i < enabled.length; i++) {
      const loc = enabled[i];
      if (loc === def) continue;
      if (!content[loc] || typeof content[loc] !== 'object') continue;
      const dst = content[loc];
      if (src.settings && typeof src.settings === 'object') {
        dst.settings = deepClone(src.settings);
      }
      if (src.contact && typeof src.contact === 'object') {
        if (!dst.contact || typeof dst.contact !== 'object') dst.contact = {};
        const keys = [
          'phone',
          'email',
          'address',
          'booking_url',
          'bookingUrl',
          'booksyUrl',
          'booksyIframeUrl',
          'map_embed_url',
          'map_place_id',
          'whatsapp',
          'messenger',
        ];
        for (let k = 0; k < keys.length; k++) {
          const key = keys[k];
          if (src.contact[key] !== undefined) dst.contact[key] = src.contact[key];
        }
      }
      if (src.social && typeof src.social === 'object') {
        dst.social = deepClone(src.social);
      }
      if (src.google_reviews && typeof src.google_reviews === 'object') {
        if (!dst.google_reviews || typeof dst.google_reviews !== 'object') {
          dst.google_reviews = deepClone(src.google_reviews);
        } else {
          ['embed_url', 'place_query', 'place_id', 'max_reviews'].forEach((key) => {
            if (src.google_reviews[key] !== undefined) {
              dst.google_reviews[key] = src.google_reviews[key];
            }
          });
        }
      }
      if (src.gallery && typeof src.gallery === 'object' && Array.isArray(src.gallery.images)) {
        if (!dst.gallery || typeof dst.gallery !== 'object') dst.gallery = { title: '', images: [] };
        dst.gallery.images = deepClone(src.gallery.images);
      }
    }
    return content;
  }

  function cloneLocaleFromSource(content, sourceLocale, targetLocale) {
    ensureMeta(content);
    const srcKey = String(sourceLocale || defaultLocale(content)).toLowerCase();
    const dstKey = String(targetLocale || '').toLowerCase();
    if (!isLocaleKey(dstKey)) return null;
    const src = content[srcKey];
    if (!src || typeof src !== 'object') return null;
    content[dstKey] = deepClone(src);
    if (content.meta.locales.indexOf(dstKey) === -1) {
      content.meta.locales.push(dstKey);
    }
    syncSharedIntoLocales(content);
    return content[dstKey];
  }

  function removeLocale(content, locale) {
    ensureMeta(content);
    const loc = String(locale || '').toLowerCase();
    const def = defaultLocale(content);
    if (!isLocaleKey(loc) || loc === def) return false;
    delete content[loc];
    content.meta.locales = content.meta.locales.filter((x) => x !== loc);
    return true;
  }

  /**
   * Po normalizeContent: dopnij meta; upewnij się że włączone locale mają obiekt.
   * Nie tworzy EN/DE automatycznie — tylko meta + sync.
   */
  function finalizeI18nContent(content) {
    if (!content || typeof content !== 'object') return content;
    ensureMeta(content);
    const def = defaultLocale(content);
    if (!content[def] || typeof content[def] !== 'object') {
      if (content.pl && typeof content.pl === 'object') {
        content.meta.defaultLocale = 'pl';
      }
    }
    const enabled = enabledLocales(content);
    for (let i = 0; i < enabled.length; i++) {
      const loc = enabled[i];
      if (!content[loc] || typeof content[loc] !== 'object') {
        if (loc !== def && content[def]) {
          content[loc] = deepClone(content[def]);
        }
      }
    }
    syncSharedIntoLocales(content);
    return content;
  }

  function prepareContentForSave(content) {
    return finalizeI18nContent(content);
  }

  window.DFOPS_ensureI18nMeta = ensureMeta;
  window.DFOPS_enabledLocales = enabledLocales;
  window.DFOPS_defaultLocale = defaultLocale;
  window.DFOPS_syncSharedIntoLocales = syncSharedIntoLocales;
  window.DFOPS_cloneLocaleFromSource = cloneLocaleFromSource;
  window.DFOPS_removeLocale = removeLocale;
  window.DFOPS_finalizeI18nContent = finalizeI18nContent;
  window.DFOPS_prepareContentForSave = prepareContentForSave;
})();
