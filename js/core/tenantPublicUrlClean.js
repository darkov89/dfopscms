/**
 * Natychmiast po wejściu na subdomenę tenant / custom domain: ukryj /templates/{motyw} w pasku adresu.
 * Edge rewrite (wildcard *.dfcms.pl) serwuje szablon pod `/`; bez wildcardu router robi hop → ten skrypt sprząta URL.
 */
;(function () {
  function normalizeHostname(hostname) {
    if (typeof window.DFOPS_normalizeHostname === 'function') {
      return window.DFOPS_normalizeHostname(hostname);
    }
    return String(hostname || '')
      .trim()
      .toLowerCase()
      .replace(/^www\./i, '');
  }

  function isTenantPublicHost(hostname) {
    if (typeof window.DFOPS_isTenantPublicHostname === 'function') {
      return window.DFOPS_isTenantPublicHostname(hostname, normalizeHostname);
    }
    const h = normalizeHostname(hostname);
    if (!h || h === 'dfcms.pl' || h === 'staging.dfcms.pl') return false;
    return h.endsWith('.dfcms.pl') || h.endsWith('.dfopscms.pl');
  }

  function isPublishedThemePathname(pathname) {
    const themes =
      window.DFOPS_PUBLISHED_THEME_IDS ||
      (typeof window.DFOPS_getPublishedThemeIds === 'function' ? window.DFOPS_getPublishedThemeIds() : []);
    const bare = String(pathname || '')
      .replace(/\.html$/i, '')
      .replace(/^\/templates\//i, '')
      .replace(/^\//, '')
      .toLowerCase();
    return themes.indexOf(bare) !== -1;
  }

  function shouldNormalizeTenantPathname(pathname) {
    const path = String(pathname || '/');
    if (path === '/' || path === '') return false;
    if (path === '/index.html' || path === '/index' || path === '/router.html' || path === '/router') {
      return true;
    }
    if (/^\/templates\/[a-z0-9-]+(\.html)?$/i.test(path)) return true;
    return isPublishedThemePathname(path);
  }

  function cleanTenantPublicUrlEarly() {
    try {
      const u = new URL(window.location.href);
      const h = normalizeHostname(u.hostname);
      if (!isTenantPublicHost(h)) return;

      let changed = false;
      const siteQs = u.searchParams.get('site');
      if (siteQs && String(siteQs).trim()) {
        u.searchParams.delete('site');
        changed = true;
      }

      if (shouldNormalizeTenantPathname(u.pathname)) {
        u.pathname = '/';
        changed = true;
      }

      if (!changed) return;
      const qs = u.searchParams.toString();
      history.replaceState(null, '', u.pathname + (qs ? '?' + qs : '') + u.hash);
    } catch (_) {
      /* ignore */
    }
  }

  cleanTenantPublicUrlEarly();
  window.DFOPS_cleanTenantPublicUrlEarly = cleanTenantPublicUrlEarly;
})();
