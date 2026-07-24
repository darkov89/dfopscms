/**
 * UI platformy (landing / auth) — język interfejsu PL | EN.
 * SoT: localStorage `dfcms_ui_locale`. Opcjonalnie ?lang=en|pl.
 * Nie mylić z i18n treści witryn klientów (meta.locales / path /en).
 */
(function (root) {
  const STORAGE_KEY = 'dfcms_ui_locale';
  const ALLOWED = Object.freeze(['pl', 'en']);

  function normalizeLocale(raw) {
    const s = String(raw || '')
      .trim()
      .toLowerCase()
      .replace('_', '-');
    if (ALLOWED.includes(s)) return s;
    if (s.startsWith('en')) return 'en';
    if (s.startsWith('pl')) return 'pl';
    return '';
  }

  function localeFromQuery() {
    try {
      const q = new URL(window.location.href).searchParams.get('lang');
      return normalizeLocale(q);
    } catch {
      return '';
    }
  }

  function localeFromNavigator() {
    try {
      const list =
        typeof navigator !== 'undefined' && Array.isArray(navigator.languages)
          ? navigator.languages
          : [typeof navigator !== 'undefined' ? navigator.language : ''];
      for (let i = 0; i < list.length; i++) {
        const n = normalizeLocale(list[i]);
        if (n) return n;
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  function readStored() {
    try {
      return normalizeLocale(localStorage.getItem(STORAGE_KEY));
    } catch {
      return '';
    }
  }

  /** Zapisany wybór → ?lang= → navigator → pl. */
  function resolveUiLocale() {
    return readStored() || localeFromQuery() || localeFromNavigator() || 'pl';
  }

  function applyDocumentLang(locale) {
    const loc = normalizeLocale(locale) || 'pl';
    try {
      if (document.documentElement) document.documentElement.lang = loc;
    } catch {
      /* ignore */
    }
    return loc;
  }

  function getUiLocale() {
    return resolveUiLocale();
  }

  function setUiLocale(locale) {
    const loc = normalizeLocale(locale) || 'pl';
    try {
      localStorage.setItem(STORAGE_KEY, loc);
    } catch {
      /* ignore */
    }
    applyDocumentLang(loc);
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('lang') !== loc) {
        u.searchParams.set('lang', loc);
        window.history.replaceState({}, document.title, u.pathname + u.search + u.hash);
      }
    } catch {
      /* ignore */
    }
    return loc;
  }

  /**
   * Lookup zagnieżdżony: "nav.login" → copy.nav.login
   * Placeholders: {name} w stringu.
   */
  function lookup(obj, path) {
    if (!obj || !path) return undefined;
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function formatStr(str, vars) {
    if (!vars || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] != null ? String(vars[k]) : '{' + k + '}';
    });
  }

  function uiT(path, vars, locale) {
    const loc = normalizeLocale(locale) || getUiLocale();
    const pack = (root.DFOPS_UI_COPY && root.DFOPS_UI_COPY[loc]) || (root.DFOPS_UI_COPY && root.DFOPS_UI_COPY.pl) || {};
    let val = lookup(pack, path);
    if (val === undefined && loc !== 'pl' && root.DFOPS_UI_COPY && root.DFOPS_UI_COPY.pl) {
      val = lookup(root.DFOPS_UI_COPY.pl, path);
    }
    if (typeof val === 'string') return formatStr(val, vars);
    if (val != null && typeof val !== 'object') return String(val);
    return path;
  }

  /** Fragment Alpine: uiLocale + t() + setUiLocale + copy. */
  function uiI18nState(opts) {
    const initial = (opts && opts.locale) || getUiLocale();
    applyDocumentLang(initial);
    return {
      uiLocale: initial,
      get copy() {
        const pack =
          (root.DFOPS_UI_COPY && root.DFOPS_UI_COPY[this.uiLocale]) ||
          (root.DFOPS_UI_COPY && root.DFOPS_UI_COPY.pl) ||
          {};
        return pack;
      },
      t(path, vars) {
        return uiT(path, vars, this.uiLocale);
      },
      setUiLocale(loc) {
        const next = setUiLocale(loc);
        this.uiLocale = next;
        if (typeof this.onUiLocaleChange === 'function') {
          this.onUiLocaleChange(next);
        }
        return next;
      },
    };
  }

  // Wczesne ustawienie <html lang> (przed Alpine), jeśli skrypt jest w <head>.
  try {
    applyDocumentLang(resolveUiLocale());
  } catch {
    /* ignore */
  }

  root.DFOPS_UI_LOCALES = ALLOWED;
  root.DFOPS_UI_LOCALE_KEY = STORAGE_KEY;
  root.DFOPS_getUiLocale = getUiLocale;
  root.DFOPS_setUiLocale = setUiLocale;
  root.DFOPS_uiT = uiT;
  root.DFOPS_uiI18nState = uiI18nState;
  root.DFOPS_normalizeUiLocale = normalizeLocale;
})(typeof window !== 'undefined' ? window : globalThis);
