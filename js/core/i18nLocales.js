/**
 * Locale allowlist — Workers-safe (middleware) + panel/public.
 * Przy nowym języku: dodaj kod tutaj + etykietę w i18nContent (panel).
 */
;(function (root) {
  const ALLOWED_SITE_LOCALES = ['pl', 'en', 'de'];
  const DEFAULT_SITE_LOCALE = 'pl';

  const LOCALE_LABELS = {
    pl: 'Polski',
    en: 'English',
    de: 'Deutsch',
  };

  function isAllowedSiteLocale(code) {
    const c = String(code || '')
      .trim()
      .toLowerCase();
    return ALLOWED_SITE_LOCALES.indexOf(c) !== -1;
  }

  /**
   * Z pathname wyciąga locale (jeśli prefix) i ścieżkę bez prefixu.
   * /en → { locale:'en', pathname:'/', isPrefixed:true }
   * /en/polityka-prywatnosci → { locale:'en', pathname:'/polityka-prywatnosci', … }
   * / → { locale:null, pathname:'/', isPrefixed:false }  // default — resolve później
   * /fr → { locale:null, pathname:'/fr', unknownPrefix:'fr' } gdy fr nie na allowliście jako locale
   *
   * Uwaga: segmenty z allowlisty niekolidujące z theme ids (beauty itd.) — locale ≠ theme.
   */
  function parseLocaleFromPathname(pathname) {
    const raw = String(pathname || '/') || '/';
    const path = raw.startsWith('/') ? raw : '/' + raw;
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) {
      return { locale: null, pathname: '/', isPrefixed: false, unknownPrefix: '' };
    }
    const first = parts[0].toLowerCase();
    // Domyślny locale nigdy nie ma prefixu — /pl → traktuj jako zbędny prefix (redirect w middleware).
    if (first === DEFAULT_SITE_LOCALE) {
      const rest = parts.slice(1);
      const restPath = rest.length ? '/' + rest.join('/') : '/';
      return {
        locale: null,
        pathname: restPath,
        isPrefixed: false,
        unknownPrefix: DEFAULT_SITE_LOCALE,
      };
    }
    if (isAllowedSiteLocale(first)) {
      const rest = parts.slice(1);
      const restPath = rest.length ? '/' + rest.join('/') : '/';
      return { locale: first, pathname: restPath, isPrefixed: true, unknownPrefix: '' };
    }
    return { locale: null, pathname: path, isPrefixed: false, unknownPrefix: '' };
  }

  function localePathPrefix(locale, defaultLocale) {
    const loc = String(locale || '')
      .trim()
      .toLowerCase();
    const def = String(defaultLocale || DEFAULT_SITE_LOCALE)
      .trim()
      .toLowerCase() || DEFAULT_SITE_LOCALE;
    if (!loc || loc === def) return '';
    return '/' + loc;
  }

  function buildLocalizedPath(locale, pathname, defaultLocale) {
    const prefix = localePathPrefix(locale, defaultLocale);
    let p = String(pathname || '/') || '/';
    if (!p.startsWith('/')) p = '/' + p;
    if (p === '/') return prefix || '/';
    return (prefix || '') + p;
  }

  root.DFOPS_ALLOWED_SITE_LOCALES = ALLOWED_SITE_LOCALES;
  root.DFOPS_DEFAULT_SITE_LOCALE = DEFAULT_SITE_LOCALE;
  root.DFOPS_SITE_LOCALE_LABELS = LOCALE_LABELS;
  root.DFOPS_isAllowedSiteLocale = isAllowedSiteLocale;
  root.DFOPS_parseLocaleFromPathname = parseLocaleFromPathname;
  root.DFOPS_localePathPrefix = localePathPrefix;
  root.DFOPS_buildLocalizedPath = buildLocalizedPath;
})(typeof globalThis !== 'undefined' ? globalThis : window);
