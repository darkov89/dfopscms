;(function () {
  function supabase() {
    return window.DFOPS_getSupabaseClient();
  }

  async function getPageBySlug(slug) {
    const { data, error } = await supabase()
      .from('pages')
      .select('slug, theme, content, color_preset, custom_domain, user_id')
      .eq('slug', slug)
      .maybeSingle();
    return { data, error };
  }

  async function getPageByCustomDomain(hostname) {
    const { data, error } = await supabase()
      .from('pages')
      .select('slug, theme, content, color_preset, custom_domain')
      .eq('custom_domain', hostname)
      .maybeSingle();
    return { data, error };
  }

  async function isSlugAvailable(slug) {
    const { data, error } = await supabase().from('pages').select('slug').eq('slug', slug).maybeSingle();
    if (error) return { available: false, error };
    return { available: !data, error: null };
  }

  async function getCurrentUserPage(userId) {
    const { data, error } = await supabase()
      .from('pages')
      .select('slug, theme, content, color_preset, custom_domain')
      .eq('user_id', userId)
      .single();
    return { data, error };
  }

  async function saveCurrentUserPage(userId, payload) {
    const { data, error } = await supabase()
      .from('pages')
      .update(payload)
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    return { data, error };
  }

  async function createPage(payload) {
    const { data, error } = await supabase().from('pages').insert(payload).select().maybeSingle();
    return { data, error };
  }

  window.DFOPS_pageRepository = {
    getPageBySlug,
    getPageByCustomDomain,
    isSlugAvailable,
    getCurrentUserPage,
    saveCurrentUserPage,
    createPage,
  };
})();

