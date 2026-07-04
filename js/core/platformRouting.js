/**
 * Routing subdomen tenantów — wspólne dla przeglądarki i Cloudflare Workers.
 * Tenant: `{slug}.{tenantBase}`; tenantBase zależy od hosta panelu / preview (prod vs staging).
 */
;(function () {
  const PLATFORM_TENANT_BASE_DOMAINS = [
    'staging.dfopscms.pages.dev',
    'staging.dfcms.pl',
    'dfopscms.pages.dev',
    'dfcms.pl',
    'dfopscms.pl',
    'localhost',
    '127.0.0.1',
  ];

  const PLATFORM_APEX_HOSTS = new Set(PLATFORM_TENANT_BASE_DOMAINS);

  function sortedTenantBases() {
    return PLATFORM_TENANT_BASE_DOMAINS.slice().sort((a, b) => b.length - a.length);
  }

  function normHost(hostname, normalizeFn) {
    const raw = String(hostname || '').trim();
    if (typeof normalizeFn === 'function') return normalizeFn(raw);
    return raw.toLowerCase().replace(/^www\./i, '');
  }

  function resolveTenantBaseFromHostname(hostname, normalizeFn) {
    const h = normHost(hostname, normalizeFn);
    if (!h) return 'dfcms.pl';
    for (const base of sortedTenantBases()) {
      if (h === base) return base;
      const suffix = '.' + base;
      if (h.endsWith(suffix)) return base;
    }
    return 'dfcms.pl';
  }

  function extractTenantSlugFromHostname(hostname, normalizeFn) {
    const h = normHost(hostname, normalizeFn);
    if (!h || PLATFORM_APEX_HOSTS.has(h)) return '';
    for (const base of sortedTenantBases()) {
      const suffix = '.' + base;
      if (h.endsWith(suffix)) {
        const sub = h.slice(0, -suffix.length);
        return sub && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sub) ? sub : '';
      }
    }
    return '';
  }

  function isTenantPublicHostname(hostname, normalizeFn) {
    return !!extractTenantSlugFromHostname(hostname, normalizeFn);
  }

  function isPlatformApexHostname(hostname, normalizeFn) {
    return PLATFORM_APEX_HOSTS.has(normHost(hostname, normalizeFn));
  }

  function isHostUnderPlatform(hostname, normalizeFn) {
    const h = normHost(hostname, normalizeFn);
    if (!h) return false;
    if (PLATFORM_APEX_HOSTS.has(h)) return true;
    return !!extractTenantSlugFromHostname(h, normalizeFn);
  }

  /** CF Pages preview nie ma wildcardu `*.staging…pages.dev` — tenant tylko przez `?site=` na apexie. */
  function tenantBaseUsesSubdomainRouting(base) {
    return !String(base || '').includes('pages.dev');
  }

  function buildTenantPublicSiteUrl(slug, hostname, normalizeFn, theme) {
    const s = String(slug || '').trim().toLowerCase();
    if (!s || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return '';
    const base = resolveTenantBaseFromHostname(hostname, normalizeFn);
    const t = String(theme || '').trim().toLowerCase();
    if (base === 'localhost' || base === '127.0.0.1') return '';
    if (!tenantBaseUsesSubdomainRouting(base)) {
      const path = t === 'setup' ? '/setup.html' : '/';
      return `https://${base}${path}?site=${encodeURIComponent(s)}`;
    }
    return `https://${s}.${base}/`;
  }

  function publicHtmlPathForTheme(theme) {
    const t = String(theme || '').trim().toLowerCase();
    if (t === 'setup') return '/setup.html';
    if (t && t !== 'setup') return `/templates/${t}.html`;
    return '/';
  }

  function formatTenantHostname(slug, hostname, normalizeFn) {
    const s = String(slug || '').trim().toLowerCase();
    if (!s) return '';
    const base = resolveTenantBaseFromHostname(hostname, normalizeFn);
    if (base === 'localhost' || base === '127.0.0.1') return s;
    if (!tenantBaseUsesSubdomainRouting(base)) {
      return `${base}/?site=${s}`;
    }
    return `${s}.${base}`;
  }

  globalThis.DFOPS_PLATFORM_TENANT_BASE_DOMAINS = PLATFORM_TENANT_BASE_DOMAINS;
  globalThis.DFOPS_resolveTenantBaseFromHostname = resolveTenantBaseFromHostname;
  globalThis.DFOPS_extractTenantSlugFromHostname = extractTenantSlugFromHostname;
  globalThis.DFOPS_isTenantPublicHostname = isTenantPublicHostname;
  globalThis.DFOPS_isPlatformApexHostname = isPlatformApexHostname;
  globalThis.DFOPS_isHostUnderPlatform = isHostUnderPlatform;
  globalThis.DFOPS_buildTenantPublicSiteUrl = buildTenantPublicSiteUrl;
  globalThis.DFOPS_formatTenantHostname = formatTenantHostname;
  globalThis.DFOPS_tenantBaseUsesSubdomainRouting = tenantBaseUsesSubdomainRouting;
  globalThis.DFOPS_publicHtmlPathForTheme = publicHtmlPathForTheme;
})();
