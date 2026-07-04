;(function () {
  let client = null;

  const PREVIEW_AUTH_PREFIX = 'dfops_preview_auth:';
  const PREVIEW_AUTH_TS_KEY = 'dfops_preview_auth_ts';
  const PREVIEW_AUTH_TTL_MS = 30 * 60 * 1000;

  function readRememberFlag() {
    try {
      return window.localStorage.getItem('dfops_remember') === 'true';
    } catch (e) {
      return false;
    }
  }

  function isPreviewSurface() {
    try {
      return new URLSearchParams(window.location.search).get('dfcms_preview') === '1';
    } catch (_) {
      return false;
    }
  }

  /**
   * Panel → nowa karta podglądu: sessionStorage nie jest współdzielony między kartami.
   * Kopiujemy token Supabase do localStorage (TTL 30 min), żeby `dfcms_preview=1` widział właściciela.
   */
  function mirrorAuthForPreviewHandoff() {
    try {
      const now = Date.now();
      for (const store of [window.sessionStorage, window.localStorage]) {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (!key || !key.includes('-auth-token')) continue;
          const val = store.getItem(key);
          if (val) window.localStorage.setItem(PREVIEW_AUTH_PREFIX + key, val);
        }
      }
      window.localStorage.setItem(PREVIEW_AUTH_TS_KEY, String(now));
    } catch (_) {
      /* ignore */
    }
  }

  function readPreviewAuthMirror(storageKey) {
    try {
      const ts = parseInt(window.localStorage.getItem(PREVIEW_AUTH_TS_KEY) || '0', 10);
      if (!ts || Date.now() - ts > PREVIEW_AUTH_TTL_MS) return null;
      return window.localStorage.getItem(PREVIEW_AUTH_PREFIX + storageKey);
    } catch (_) {
      return null;
    }
  }

  /**
   * Przy włączonym „Zapamiętaj mnie” — sesja max 24h (frontend).
   * Przy braku znacznika czasu lub wygaśnięciu — czyścimy storage i wymuszamy ponowne logowanie.
   */
  function maybeExpireRememberedSession() {
    try {
      const remember = window.localStorage.getItem('dfops_remember') === 'true';
      const loginTime = parseInt(window.localStorage.getItem('dfops_login_time') || '0', 10);
      if (!remember || !loginTime) return false;
      const hoursPassed = (Date.now() - loginTime) / (1000 * 60 * 60);
      if (hoursPassed > 24) {
        window.localStorage.clear();
        window.sessionStorage.clear();
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  function selectedAuthStorage() {
    return readRememberFlag() ? window.localStorage : window.sessionStorage;
  }

  const authStorage = {
    getItem(key) {
      if (isPreviewSurface() && key && String(key).includes('-auth-token')) {
        const mirrored = readPreviewAuthMirror(key);
        if (mirrored != null) return mirrored;
      }
      const primary = selectedAuthStorage().getItem(key);
      if (primary != null) return primary;
      const alt = selectedAuthStorage() === window.localStorage ? window.sessionStorage : window.localStorage;
      return alt.getItem(key);
    },
    setItem(key, value) {
      selectedAuthStorage().setItem(key, value);
    },
    removeItem(key) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
      try {
        window.localStorage.removeItem(PREVIEW_AUTH_PREFIX + key);
      } catch (_) {
        /* ignore */
      }
    },
  };

  function getSupabaseClient() {
    maybeExpireRememberedSession();
    const cfg = window.DFOPS_CONFIG;
    if (!cfg) throw new Error('Brak DFOPS_CONFIG');
    const url = typeof cfg.supabaseUrl === 'string' ? cfg.supabaseUrl.trim() : '';
    const key = typeof cfg.supabaseAnonKey === 'string' ? cfg.supabaseAnonKey.trim() : '';
    if (!url || !key) {
      throw new Error(
        'Brak konfiguracji Supabase. Sprawdź SUPABASE_URL_* w js/core/config.js (staging vs production).',
      );
    }
    if (!window.supabase || !window.supabase.createClient) throw new Error('Brak supabase-js');
    if (client) return client;
    client = window.supabase.createClient(url, key, {
      auth: {
        storage: authStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
    return client;
  }

  function resetSupabaseClient() {
    client = null;
    maybeExpireRememberedSession();
  }

  window.DFOPS_getSupabaseClient = getSupabaseClient;
  window.DFOPS_resetSupabaseClient = resetSupabaseClient;
  window.DFOPS_mirrorAuthForPreviewHandoff = mirrorAuthForPreviewHandoff;
})();
