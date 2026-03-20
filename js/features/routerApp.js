;(function () {
  /**
   * Router tylko przekierowuje na consultant.html / beauty.html.
   * Title, meta description i Open Graph ustawiane są po załadowaniu treści
   * w createPublicSiteApp().init() → DFOPS_applyDocumentSeo (publicSiteApp.js).
   */
  async function routeByThemeAndDomain() {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    const statusEl = document.getElementById('status');
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const hostname = window.location.hostname.replace(/^www\./, '').toLowerCase();

      // Domeny systemowe (nasz landing sprzedażowy). Z ?site= nadal idziemy w bazę (testy / podgląd).
      const systemDomains = ['dfcms.pl', 'dfopscms.pl', 'dfopscms.pages.dev', 'localhost', '127.0.0.1'];
      if (systemDomains.includes(hostname) && !params.has('site')) {
        window.location.replace('landing.html');
        return;
      }

      let page = null;
      if (!params.has('site') && !cfg.localHosts.includes(hostname) && hostname !== cfg.appDomain) {
        const { data, error } = await repo.getPageByCustomDomain(hostname);
        if (error) throw error;
        page = data;
      } else {
        const slug = params.get('site') || 'moj-test';
        const { data, error } = await repo.getPageBySlug(slug);
        if (error) throw error;
        page = data;
      }

      if (!page || !page.theme || !page.slug) throw new Error('Strona nie istnieje');
      window.location.replace(`${page.theme}.html?site=${encodeURIComponent(page.slug)}`);
    } catch (error) {
      if (statusEl) {
        statusEl.innerText = '404 - STRONA NIE ISTNIEJE';
        statusEl.classList.remove('pulse');
        statusEl.style.color = '#ff4444';
      }
    }
  }

  window.DFOPS_routeByThemeAndDomain = routeByThemeAndDomain;
})();

