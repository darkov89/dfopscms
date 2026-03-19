;(function () {
  let client = null;

  function getSupabaseClient() {
    if (client) return client;
    const cfg = window.DFOPS_CONFIG;
    if (!cfg) throw new Error('Brak DFOPS_CONFIG');
    if (!window.supabase || !window.supabase.createClient) throw new Error('Brak supabase-js');
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return client;
  }

  window.DFOPS_getSupabaseClient = getSupabaseClient;
})();

