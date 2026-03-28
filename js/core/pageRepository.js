;(function () {
  function supabase() {
    return window.DFOPS_getSupabaseClient();
  }

  /**
   * Sanityzuje HTML, usuwając tagi i atrybuty niebezpieczne dla XSS.
   * Używa DOMParser (bez zewnętrznych bibliotek).
   */
  function sanitizeHtml(htmlString) {
    if (typeof htmlString !== 'string') return htmlString;
    try {
      const doc = new DOMParser().parseFromString(htmlString, 'text/html');
      const removeTags = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM'];
      const walk = (node) => {
        if (!node || !node.nodeType) return;
        if (node.nodeType === 1) {
          const tag = (node.tagName || '').toUpperCase();
          if (removeTags.includes(tag)) {
            node.parentNode?.removeChild(node);
            return;
          }
          const attrs = Array.from(node.attributes || []);
          attrs.forEach((a) => {
            if (/^on/i.test(a.name)) node.removeAttribute(a.name);
          });
        }
        const children = Array.from(node.childNodes || []);
        children.forEach((c) => walk(c));
      };
      walk(doc.body);
      return doc.body ? doc.body.innerHTML : '';
    } catch {
      return htmlString;
    }
  }

  function sanitizeContent(obj) {
    if (obj == null) return obj;
    if (typeof obj === 'string') return sanitizeHtml(obj);
    if (Array.isArray(obj)) return obj.map((x) => sanitizeContent(x));
    if (typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) {
        out[k] = sanitizeContent(obj[k]);
      }
      return out;
    }
    return obj;
  }

  async function getPageBySlug(slug) {
    const { data, error } = await supabase()
      .from('pages')
      .select('slug, theme, content, color_preset, custom_domain, user_id')
      .eq('slug', slug)
      .maybeSingle();
    return { data, error };
  }

  /**
   * Strona przypisana do niestandardowej domeny (SaaS). Kolumny: custom_domain, custom_domain_status.
   * Hostname bez www — normalizuj przed wywołaniem (np. w routerze).
   */
  async function getPageByCustomDomain(domain) {
    const normalized =
      typeof domain === 'string'
        ? domain.replace(/^www\./i, '').toLowerCase().trim()
        : domain;
    const { data, error } = await supabase()
      .from('pages')
      .select('*')
      .eq('custom_domain', normalized)
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
      .select('id, slug, theme, content, color_preset, custom_domain')
      .eq('user_id', userId)
      .maybeSingle();
    return { data: data || null, error };
  }

  async function saveCurrentUserPage(userId, payload) {
    const safe = { ...payload };
    if (safe.content) safe.content = sanitizeContent(safe.content);
    const { data, error } = await supabase()
      .from('pages')
      .update(safe)
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    return { data, error };
  }

  async function createPage(payload) {
    const safe = { ...payload };
    if (safe.content) safe.content = sanitizeContent(safe.content);
    const { data, error } = await supabase().from('pages').insert(safe).select().maybeSingle();
    return { data, error };
  }

  window.DFOPS_pageRepository = {
    getPageBySlug,
    getPageByCustomDomain,
    isSlugAvailable,
    getCurrentUserPage,
    saveCurrentUserPage,
    createPage,
    sanitizeHtml,
  };
})();

