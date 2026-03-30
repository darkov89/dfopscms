;(function () {
  function supabase() {
    return window.DFOPS_getSupabaseClient();
  }

  /**
   * Sanityzuje HTML, usuwając tagi i atrybuty niebezpieczne dla XSS.
   * Używa DOMParser (bez zewnętrznych bibliotek).
   */
  /**
   * Wyciąga URL z wklejonego iframe lub zwraca goły https URL (jak publicSiteApp.extractEmbedUrl).
   */
  function extractEmbedSrcOrUrl(raw) {
    if (raw == null || raw === '') return '';
    let value = String(raw).trim();
    if (!value) return '';
    try {
      if (/%3C|%3E|%22|%27/i.test(value)) value = decodeURIComponent(value);
    } catch (_) {}
    const iframeSrc = value.match(/src\s*=\s*["']([^"']+)["']/i);
    if (iframeSrc?.[1]) {
      return iframeSrc[1]
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/gi, '&')
        .trim();
    }
    if (/^https?:\/\//i.test(value)) {
      return value
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/gi, '&')
        .replace(/^"(.*)"$/, '$1')
        .trim();
    }
    return '';
  }

  function isGoogleMapsEmbedHttpsUrl(urlString) {
    try {
      const u = new URL(urlString);
      if (u.protocol !== 'https:') return false;
      const h = u.hostname.toLowerCase();
      const path = u.pathname || '';
      if (h === 'google.com' || h.endsWith('.google.com')) {
        return path.includes('/maps/embed');
      }
      if (h === 'maps.googleapis.com' || h.endsWith('.googleapis.com')) {
        return path.includes('maps') || path.includes('embed');
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Google-hosted https (widget opinii, rzadkie ścieżki) — bez javascript:/data: */
  function isGoogleHostedHttpsUrl(urlString) {
    try {
      const u = new URL(urlString);
      if (u.protocol !== 'https:') return false;
      const h = u.hostname.toLowerCase();
      return (
        h === 'google.com' ||
        h.endsWith('.google.com') ||
        h === 'googleapis.com' ||
        h.endsWith('.googleapis.com')
      );
    } catch {
      return false;
    }
  }

  function sanitizeGoogleMapEmbedField(raw) {
    const extracted = extractEmbedSrcOrUrl(raw);
    if (!extracted) return '';
    return isGoogleMapsEmbedHttpsUrl(extracted) ? extracted : '';
  }

  function sanitizeGoogleReviewsEmbedField(raw) {
    const extracted = extractEmbedSrcOrUrl(raw);
    if (!extracted) return '';
    return isGoogleHostedHttpsUrl(extracted) ? extracted : '';
  }

  /** Place ID z Google (Places API) — bez HTML/znaków specjalnych w query. */
  function sanitizeMapPlaceId(raw) {
    if (typeof raw !== 'string') return '';
    let s = raw.trim();
    if (!s) return '';
    if (s.startsWith('places/')) s = s.slice('places/'.length);
    if (s.length > 512 || s.length < 4) return '';
    if (/[<>'"&\s]/.test(s)) return '';
    return s;
  }

  function sanitizeHtml(htmlString) {
    if (typeof htmlString !== 'string') return htmlString;
    const trimmed = htmlString.trim();
    if (!trimmed) return '';
    // Plain https URL (map embed, og:image, galeria…): nie parsuj jako HTML —
    // znak & w query jest wtedy traktowany jak encja i wartość jest obcinana lub niszczona.
    if (!/[<]/.test(trimmed) && /^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
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

  function sanitizeContent(obj, keyHint) {
    if (obj == null) return obj;
    if (typeof obj === 'string') {
      if (keyHint === 'map_embed_url') return sanitizeGoogleMapEmbedField(obj);
      if (keyHint === 'map_place_id') return sanitizeMapPlaceId(obj);
      if (keyHint === 'embed_url') return sanitizeGoogleReviewsEmbedField(obj);
      return sanitizeHtml(obj);
    }
    if (Array.isArray(obj)) return obj.map((x) => sanitizeContent(x));
    if (typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) {
        out[k] = sanitizeContent(obj[k], k);
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

