;(function () {
  function extractEmbedUrl(rawValue) {
    if (!rawValue) return '';
    let value = String(rawValue).trim();
    if (!value) return '';

    // Handle encoded iframe/html pasted into input
    try {
      if (/%3C|%3E|%22|%27/i.test(value)) value = decodeURIComponent(value);
    } catch (_) {
      // keep original value when decoding fails
    }

    // If user pasted full iframe HTML, extract src
    const iframeSrc = value.match(/src\s*=\s*["']([^"']+)["']/i);
    if (iframeSrc?.[1]) {
      return iframeSrc[1]
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/gi, '&')
        .trim();
    }

    // If user pasted plain URL, normalize common HTML-escaped chars
    if (/^https?:\/\//i.test(value)) {
      return value
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/gi, '&')
        .replace(/^"(.*)"$/, '$1')
        .trim();
    }

    return '';
  }

  function normalizeEmbedFields(content) {
    const langs = Object.keys(content || {});
    for (const l of langs) {
      if (!content[l]) continue;
      const c = content[l];
      if (c.contact?.map_embed_url) c.contact.map_embed_url = extractEmbedUrl(c.contact.map_embed_url);
      if (c.google_reviews?.embed_url) c.google_reviews.embed_url = extractEmbedUrl(c.google_reviews.embed_url);
    }
  }

  function createPublicSiteApp(expectedTheme) {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    return {
      lang: 'pl',
      content: null,
      bazaBlad: false,
      theme: expectedTheme,
      slug: null,
      async init() {
        try {
          const url = new URL(window.location.href);
          const urlParams = url.searchParams;
          const hostname = window.location.hostname.replace(/^www\./, '').toLowerCase();

          let page = null;
          if (!urlParams.has('site') && !cfg.localHosts.includes(hostname) && hostname !== cfg.appDomain) {
            const { data, error } = await repo.getPageByCustomDomain(hostname);
            if (error) throw error;
            page = data;
          } else {
            const currentSlug = urlParams.get('site') || 'moj-test';
            const { data, error } = await repo.getPageBySlug(currentSlug);
            if (error) throw error;
            page = data;
          }

          if (!page) throw new Error('Brak strony');
          if (expectedTheme && page.theme && page.theme !== expectedTheme) {
            window.location.replace(`${page.theme}.html?site=${encodeURIComponent(page.slug)}`);
            return;
          }

          this.slug = page.slug;
          this.theme = page.theme || expectedTheme;
          this.content = window.DFOPS_normalizeContent(this.theme, page.content);
          normalizeEmbedFields(this.content);
          window.DFOPS_applyThemeStyling(this.content?.pl?.settings, this.theme, 'public');

          const userLang = navigator.language.slice(0, 2);
          this.lang = this.content[userLang] ? userLang : (Object.keys(this.content)[0] || 'pl');
        } catch (error) {
          console.error('Błąd krytyczny aplikacji:', error);
          this.bazaBlad = true;
        }
      },
    };
  }

  window.createPublicSiteApp = createPublicSiteApp;
})();

