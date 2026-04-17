;(function () {
  /**
   * Domeny platformy (hosting wielodomenowy + dev). Host spoza tej listy → szukanie po custom_domain.
   */
  const BASE_DOMAINS = ['dfcms.pl', 'localhost', '127.0.0.1'];

  /**
   * Router przekierowuje na consultant.html / beauty.html.
   * Na domenach systemowych bez ?site= → index.html (landing marketingowy).
   * Na niestandardowej domenie (np. mojsalon.pl) → getPageByCustomDomain.
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

  function normalizeHostname(hostname) {
    return String(hostname || '')
      .replace(/^www\./i, '')
      .toLowerCase();
  }

  function mergeBaseDomains(cfg) {
    const merged = BASE_DOMAINS.concat((cfg && cfg.systemDomains) || []);
    return merged.filter(function (v, i, a) {
      return v && a.indexOf(v) === i;
    });
  }

  function isHostUnderBaseDomain(hostname, bases) {
    return bases.some(function (base) {
      return hostname === base || hostname.endsWith('.' + base);
    });
  }

  /** Dla user.dfcms.pl → 'user'; dla dokładnie dfcms.pl / localhost → null */
  function extractSubdomainAsSlug(hostname, bases) {
    for (let i = 0; i < bases.length; i++) {
      const base = bases[i];
      if (hostname === base) return null;
      const suffix = '.' + base;
      if (hostname.endsWith(suffix)) {
        const sub = hostname.slice(0, -suffix.length);
        return sub && sub.length ? sub : null;
      }
    }
    return null;
  }

  async function routeByThemeAndDomain() {
    const cfg = window.DFOPS_CONFIG || {};
    const repo = window.DFOPS_pageRepository;
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const hostname = normalizeHostname(window.location.hostname);
      const baseDomains = mergeBaseDomains(cfg);

      function isSystemRootHost(h) {
        return baseDomains.some(function (b) {
          return h === b;
        });
      }

      if (isSystemRootHost(hostname) && (!params.has('site') || !params.get('site')?.trim())) {
        window.location.replace('index.html');
        return;
      }

      let page = null;

      if (isHostUnderBaseDomain(hostname, baseDomains)) {
        let slug = params.get('site')?.trim();
        if (!slug) {
          slug = extractSubdomainAsSlug(hostname, baseDomains);
        }
        if (!slug) {
          window.location.replace('index.html');
          return;
        }
        const res = await repo.getPageBySlug(slug);
        if (res.error) throw res.error;
        page = res.data;
      } else {
        const res = await repo.getPageByCustomDomain(hostname);
        if (res.error) throw res.error;
        page = res.data;
      }

      if (!page || !page.theme || !page.slug) throw new Error('Strona nie istnieje');

      const localHosts = cfg.localHosts || [];
      const isLocal = localHosts.indexOf(window.location.hostname) !== -1;
      const slugFromSub = extractSubdomainAsSlug(hostname, baseDomains);
      let target = page.theme + '.html';
      if (isLocal || (isHostUnderBaseDomain(hostname, baseDomains) && !slugFromSub)) {
        target += '?site=' + encodeURIComponent(page.slug);
      }
      window.location.replace(target);
    } catch (error) {
      show404();
    }
  }

  window.DFOPS_routeByThemeAndDomain = routeByThemeAndDomain;
})();
