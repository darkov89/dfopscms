;(function () {
  /**
   * Router przekierowuje na consultant.html / beauty.html.
   * Na domenach systemowych bez ?site= → landing.html.
   */
  function show404() {
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;padding:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#121212;font-family:sans-serif';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;padding:2rem';
    wrap.innerHTML = `
      <h1 style="font-size:3.5rem;color:#D4AF37;letter-spacing:0.2em;margin-bottom:1rem">404</h1>
      <p style="font-size:1.25rem;color:#9ca3af;margin-bottom:2rem;font-weight:300">Strona nie istnieje</p>
      <a href="https://dfcms.pl/rejestracja.html" style="display:inline-block;padding:1rem 2rem;background:#D4AF37;color:#121212;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;font-size:0.875rem;text-decoration:none;border-radius:2px">
        Załóż własną stronę na DFCMS
      </a>
    `;
    document.body.appendChild(wrap);
  }

  async function routeByThemeAndDomain() {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const hostname = window.location.hostname.replace(/^www\./, '').toLowerCase();
      const systemDomains = cfg.systemDomains || ['dfcms.pl', 'localhost', '127.0.0.1'];

      if (systemDomains.includes(hostname) && (!params.has('site') || !params.get('site')?.trim())) {
        window.location.replace('landing.html');
        return;
      }

      let page = null;
      if (!params.has('site') && !cfg.localHosts.includes(hostname) && hostname !== cfg.appDomain) {
        const { data, error } = await repo.getPageByCustomDomain(hostname);
        if (error) throw error;
        page = data;
      } else {
        const slug = params.get('site')?.trim();
        if (!slug) {
          window.location.replace('landing.html');
          return;
        }
        const { data, error } = await repo.getPageBySlug(slug);
        if (error) throw error;
        page = data;
      }

      if (!page || !page.theme || !page.slug) throw new Error('Strona nie istnieje');
      window.location.replace(`${page.theme}.html?site=${encodeURIComponent(page.slug)}`);
    } catch (error) {
      show404();
    }
  }

  window.DFOPS_routeByThemeAndDomain = routeByThemeAndDomain;
})();

