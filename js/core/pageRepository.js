;(function () {
  function supabase() {
    return window.DFOPS_getSupabaseClient();
  }

  /**
   * Sanityzuje HTML, usuwając tagi i atrybuty niebezpieczne dla XSS.
   * Używa DOMPurify (CDN) — polityka jest celowo restrykcyjna (SaaS).
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

  const DOMPURIFY_CONFIG = {
    // Tagi dozwolone (wystarczające dla treści marketingowych / regulaminów).
    ALLOWED_TAGS: [
      'a',
      'b',
      'blockquote',
      'br',
      'code',
      'div',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'i',
      'img',
      'li',
      'ol',
      'p',
      'pre',
      'span',
      'strong',
      'u',
      'ul',
    ],
    // Atrybuty ograniczone do bezpiecznego podzbioru.
    ALLOWED_ATTR: [
      'alt',
      'class',
      'decoding',
      'height',
      'href',
      'id',
      'loading',
      'rel',
      'role',
      'src',
      'target',
      'title',
      'width',
      // Alpine/Tailwind: nie przepuszczamy x-* (to nie jest potrzebne w treści),
      // ale wspieramy a11y i data-*.
      'aria-label',
      'aria-hidden',
      'aria-describedby',
      'aria-controls',
      'aria-expanded',
      'data-*',
    ],
    // Bezpieczne zachowanie linków.
    ADD_ATTR: ['rel'],
    // Twarde zakazy: SVG/MathML i wektory osadzeń.
    FORBID_TAGS: [
      'base',
      'embed',
      'form',
      'iframe',
      'input',
      'link',
      'math',
      'meta',
      'object',
      'script',
      'style',
      'svg',
      'textarea',
    ],
    FORBID_ATTR: [
      'style',
      'srcset',
      'xlink:href',
    ],
    // Blokujemy data: i javascript: (wymóg bezpieczeństwa).
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  };

  function isSafeUrlForAttr(attrName, urlString) {
    if (!urlString) return false;
    const raw = String(urlString).trim();
    if (!raw) return false;
    // DOMPurify domyślnie blokuje javascript:, ale dodatkowo blokujemy data: oraz vbscript:.
    if (/^\s*(?:javascript|data|vbscript):/i.test(raw)) return false;
    // Dopuszczamy tylko https/http oraz względne ścieżki.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
      try {
        const u = new URL(raw);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      } catch {
        return false;
      }
    }
    // Dodatkowo: dla img/src wymagamy https/http.
    if (attrName === 'src') {
      if (!/^https?:\/\//i.test(raw)) return false;
    }
    return true;
  }

  function sanitizeHtml(htmlString) {
    if (htmlString == null) return '';
    const input = typeof htmlString === 'string' ? htmlString : String(htmlString);
    const trimmed = input.trim();
    if (!trimmed) return '';

    // Plain https URL (map embed, og:image, galeria…): nie parsuj jako HTML —
    // znak & w query jest wtedy traktowany jak encja i wartość jest obcinana lub niszczona.
    if (!/[<]/.test(trimmed) && /^https?:\/\//i.test(trimmed)) {
      // Blokujemy data:/javascript: niezależnie.
      return isSafeUrlForAttr('src', trimmed) ? trimmed : '';
    }

    const purifier = window.DOMPurify;
    if (!purifier || typeof purifier.sanitize !== 'function') {
      // Fail-closed: bez DOMPurify nie renderujemy HTML (tylko pusty string),
      // aby nie dopuścić do XSS przy brakującej bibliotece.
      return '';
    }

    // Hooki są globalne, więc rejestrujemy je tylko raz.
    if (!window.__DFOPS_DOMPURIFY_HOOKS__) {
      window.__DFOPS_DOMPURIFY_HOOKS__ = true;

      purifier.addHook('afterSanitizeAttributes', function (node) {
        if (!node || !node.getAttribute) return;
        // Href/src: usuń niebezpieczne protokoły.
        const href = node.getAttribute('href');
        if (href && !isSafeUrlForAttr('href', href)) node.removeAttribute('href');
        const src = node.getAttribute('src');
        if (src && !isSafeUrlForAttr('src', src)) node.removeAttribute('src');

        // target=_blank => rel noopener noreferrer.
        const target = node.getAttribute('target');
        if (target && String(target).toLowerCase() === '_blank') {
          const rel = (node.getAttribute('rel') || '').toLowerCase();
          const needs = ['noopener', 'noreferrer'];
          const relParts = rel ? rel.split(/\s+/).filter(Boolean) : [];
          for (const n of needs) if (!relParts.includes(n)) relParts.push(n);
          node.setAttribute('rel', relParts.join(' ').trim());
        }
      });

      // Blokujemy CSS/JS w atrybutach (event handlers i style) nawet jeśli ktoś je przemyci.
      purifier.addHook('uponSanitizeAttribute', function (node, data) {
        if (!data || !data.attrName) return;
        if (/^on/i.test(data.attrName)) {
          data.keepAttr = false;
          return;
        }
        if (data.attrName === 'style') {
          data.keepAttr = false;
          return;
        }
        if (data.attrName === 'href' || data.attrName === 'src' || data.attrName === 'xlink:href') {
          if (!isSafeUrlForAttr(data.attrName === 'href' ? 'href' : 'src', data.attrValue)) {
            data.keepAttr = false;
          }
        }
      });
    }

    return purifier.sanitize(input, DOMPURIFY_CONFIG);
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
      .select('slug, theme, content, color_preset, custom_domain, user_id, trial_blocked_at, billing_failed_at')
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
      .select('id, slug, theme, content, color_preset, custom_domain, custom_domain_status, trial_blocked_at, billing_failed_at')
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

