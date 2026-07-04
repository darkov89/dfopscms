;(function () {
  /**
   * Domeny platformy (hosting wielodomenowy + dev). Host spoza tej listy → szukanie po custom_domain.
   */
  const BASE_DOMAINS = [
    'staging.dfopscms.pages.dev',
    'staging.dfcms.pl',
    'dfcms.pl',
    'dfopscms.pl',
    'dfopscms.pages.dev',
    'localhost',
    '127.0.0.1',
  ];

  /**
   * Router legacy: apex / pages.dev / localhost z ?site= → `/templates/{theme}.html?site=…`.
   * Subdomeny tenantów i custom domeny → `/` (edge middleware robi wewnętrzny rewrite szablonu).
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

  function isSafeSlugValue(value) {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(String(value || '').trim());
  }

  function isApexOrStagingRoot(hostname) {
    if (typeof window.DFOPS_isPlatformApexHostname === 'function') {
      return window.DFOPS_isPlatformApexHostname(hostname, normalizeHostname);
    }
    return (
      hostname === 'dfcms.pl' ||
      hostname === 'dfopscms.pl' ||
      hostname === 'dfopscms.pages.dev' ||
      hostname === 'staging.dfcms.pl' ||
      hostname === 'staging.dfopscms.pages.dev'
    );
  }

  const normalizeHostname = window.DFOPS_normalizeHostname;

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

  /** Dla user.dfcms.pl / user.staging.dfopscms.pages.dev → slug; apex → null */
  function extractSubdomainAsSlug(hostname, bases) {
    if (typeof window.DFOPS_extractTenantSlugFromHostname === 'function') {
      const slug = window.DFOPS_extractTenantSlugFromHostname(hostname, normalizeHostname);
      return slug || null;
    }
    const sorted = (bases || []).slice().sort((a, b) => b.length - a.length);
    for (let i = 0; i < sorted.length; i++) {
      const base = sorted[i];
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
        if (slug && !isSafeSlugValue(slug)) {
          window.location.replace('index.html');
          return;
        }
        if (!slug) {
          slug = extractSubdomainAsSlug(hostname, baseDomains);
        }
        if (!slug || !isSafeSlugValue(slug)) {
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
      const theme = String(page.theme).trim().toLowerCase();
      let target =
        typeof window.DFOPS_publicHtmlPathForTheme === 'function'
          ? window.DFOPS_publicHtmlPathForTheme(theme)
          : theme === 'setup'
            ? '/setup.html'
            : '/templates/' + theme + '.html';
      if (isLocal || hostname.includes('pages.dev') || isApexOrStagingRoot(hostname)) {
        target += '?site=' + encodeURIComponent(page.slug);
      }
      window.location.replace(target);
    } catch (error) {
      show404();
    }
  }

  window.DFOPS_routeByThemeAndDomain = routeByThemeAndDomain;
})();
