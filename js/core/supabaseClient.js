;(function () {
  let client = null;
  /** Ostatnia wartość „Zapamiętaj mnie” użyta przy tworzeniu klienta — przy zmianie trzeba odświeżyć storage Auth. */
  let cachedAuthRemember = null;

  function readRememberFlag() {
    try {
      return window.localStorage.getItem('dfops_remember') === 'true';
    } catch (e) {
      return false;
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

  function getSupabaseClient() {
    if (maybeExpireRememberedSession()) {
      client = null;
      cachedAuthRemember = null;
    }
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
    const remember = readRememberFlag();
    if (client && cachedAuthRemember === remember) return client;
    client = null;
    cachedAuthRemember = remember;
    client = window.supabase.createClient(url, key, {
      auth: {
        storage: remember ? window.localStorage : window.sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
    return client;
  }

  function resetSupabaseClient() {
    client = null;
    cachedAuthRemember = null;
  }

  window.DFOPS_getSupabaseClient = getSupabaseClient;
  window.DFOPS_resetSupabaseClient = resetSupabaseClient;
})();
