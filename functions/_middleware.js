import '../js/core/utils.js';
import '../js/core/publishedThemes.js';
import '../js/core/platformRouting.js';
import '../js/core/i18nLocales.js';

/**
 * Cloudflare Pages — globalny middleware (SEO + edge routing szablonów + HTMLRewriter + Supabase).
 * Zmienne: SUPABASE_URL, SUPABASE_ANON_KEY
 * Opcjonalnie: SEO_DEBUG=1 — wstrzyknie <meta name="dfops-debug" …> (tylko diagnostyka).
 * Telemetria edge rewrite: nagłówek `X-DFCMS-Debug` tylko gdy `SEO_DEBUG=1` lub `SEO_DEBUG=true`.
 *
 * Znak wodny DFCMS (trial / tier0) jest doklejany po stronie klienta w publicSiteApp.js
 * (Shadow DOM), po załadowaniu treści — nie w tym middleware.
 */

const STATIC_EXT = /\.(css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|map|json|xml|txt|pdf|webmanifest)$/i;

const PLATFORM_BASE_DOMAINS =
  typeof globalThis.DFOPS_PLATFORM_TENANT_BASE_DOMAINS !== 'undefined'
    ? globalThis.DFOPS_PLATFORM_TENANT_BASE_DOMAINS.slice().sort((a, b) => b.length - a.length)
    : [
        'staging.dfopscms.pages.dev',
        'staging.dfcms.pl',
        'dfopscms.pages.dev',
        'dfcms.pl',
        'dfopscms.pl',
        'localhost',
        '127.0.0.1',
      ];
const ALLOWED_THEMES = new Set(
  typeof globalThis.DFOPS_getPublishedThemeIds === 'function'
    ? globalThis.DFOPS_getPublishedThemeIds()
    : ['beauty', 'consultant', 'fitness', 'services', 'gastro', 'care'],
);
const normalizeHostname = globalThis.DFOPS_normalizeHostname;
const EDGE_ROUTE_PATHS = new Set([
  '/',
  '/index.html',
  '/index',
  '/router.html',
  '/router',
  '/polityka-prywatnosci',
  '/polityka-prywatnosci/',
]);

function enabledLocalesFromContent(content) {
  const meta = content && content.meta;
  const def =
    typeof globalThis.DFOPS_DEFAULT_SITE_LOCALE === 'string'
      ? globalThis.DFOPS_DEFAULT_SITE_LOCALE
      : 'pl';
  let list = meta && Array.isArray(meta.locales) ? meta.locales : null;
  if (!list || !list.length) {
    list = [];
    if (content && content.pl) list.push('pl');
    if (content && content.en) list.push('en');
    if (content && content.de) list.push('de');
  }
  const allowed =
    typeof globalThis.DFOPS_isAllowedSiteLocale === 'function'
      ? (c) => globalThis.DFOPS_isAllowedSiteLocale(c)
      : (c) => c === 'pl' || c === 'en' || c === 'de';
  const out = [];
  const seen = {};
  for (let i = 0; i < list.length; i++) {
    const c = String(list[i] || '')
      .trim()
      .toLowerCase();
    if (!c || seen[c] || !allowed(c)) continue;
    if (!content || typeof content[c] !== 'object' || !content[c]) continue;
    seen[c] = true;
    out.push(c);
  }
  if (!out.length) out.push(def);
  return out;
}

function defaultLocaleFromContent(content) {
  const meta = content && content.meta;
  const raw = meta && meta.defaultLocale ? String(meta.defaultLocale).trim().toLowerCase() : 'pl';
  const enabled = enabledLocalesFromContent(content);
  if (enabled.indexOf(raw) !== -1) return raw;
  return enabled[0] || 'pl';
}

/** Host z nagłówka (subdomeny SaaS) ma pierwszeństwo przed url.hostname po wewnętrznym rewrite CF. */
function parseForwardedHost(request) {
  const fwd = request.headers.get('Forwarded') || '';
  const m = fwd.match(/host=([^;,\s"]+)/i);
  if (!m) return '';
  return normalizeHostname(m[1].replace(/^"|"$/g, '').split(':')[0]);
}

function collectHostCandidates(request, url, cf) {
  const raw = [
    request.headers.get('Host'),
    request.headers.get('X-Forwarded-Host'),
    request.headers.get('X-Original-Host'),
    parseForwardedHost(request),
    cf && cf.hostMetadata && cf.hostMetadata.httpHost,
    cf && cf.hostname,
    url.hostname,
  ];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const h = normalizeHostname(String(raw[i] || '').split(',')[0].split(':')[0]);
    if (h && !seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

/** Preferuj host tenantowy (np. slug.staging.dfopscms.pages.dev) zamiast wewnętrznego pages.dev workera. */
function pickTenantHostname(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const h = candidates[i];
    if (
      typeof globalThis.DFOPS_isTenantPublicHostname === 'function' &&
      globalThis.DFOPS_isTenantPublicHostname(h, normalizeHostname)
    ) {
      return h;
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    const h = candidates[i];
    if (h.endsWith('.dfcms.pl') && h !== 'dfcms.pl' && h !== 'staging.dfcms.pl') return h;
  }
  for (let i = 0; i < candidates.length; i++) {
    const h = candidates[i];
    if (h.includes('dfcms.pl') || h.includes('dfopscms.pl')) return h;
  }
  for (let i = 0; i < candidates.length; i++) {
    const h = candidates[i];
    if (!h.includes('pages.dev')) return h;
  }
  return candidates[0] || '';
}

function getRequestHostname(request, url, cf) {
  return pickTenantHostname(collectHostCandidates(request, url, cf));
}

function isPlatformHost(hostnameNorm) {
  if (typeof globalThis.DFOPS_isHostUnderPlatform === 'function') {
    return globalThis.DFOPS_isHostUnderPlatform(hostnameNorm, normalizeHostname);
  }
  return PLATFORM_BASE_DOMAINS.some(
    (base) => hostnameNorm === base || hostnameNorm.endsWith('.' + base),
  );
}

/** Dla user.dfcms.pl / user.staging.dfopscms.pages.dev → slug; apex → '' */
function extractSubdomainSlug(hostnameNorm) {
  if (typeof globalThis.DFOPS_extractTenantSlugFromHostname === 'function') {
    return globalThis.DFOPS_extractTenantSlugFromHostname(hostnameNorm, normalizeHostname) || '';
  }
  for (const base of PLATFORM_BASE_DOMAINS) {
    if (hostnameNorm === base) return '';
    const suffix = '.' + base;
    if (hostnameNorm.endsWith(suffix)) {
      const sub = hostnameNorm.slice(0, -suffix.length);
      return sub && sub.length ? sub : '';
    }
  }
  return '';
}

function resolveSlug(siteParam, hostnameNorm, altHostnameNorm, candidates) {
  const safeSite = normalizeSiteParam(siteParam);
  if (safeSite) return safeSite;
  const hosts = [];
  const seen = new Set();
  for (const h of [hostnameNorm, altHostnameNorm].concat(candidates || [])) {
    const norm = normalizeHostname(h);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    hosts.push(norm);
  }
  for (const host of hosts) {
    if (!host || !isPlatformHost(host)) continue;
    const fromSub = extractSubdomainSlug(host);
    if (fromSub) return fromSub;
  }
  return '';
}

function normalizeSiteParam(siteParam) {
  const raw = String(siteParam || '').trim();
  if (!raw) return '';
  if (raw.includes('://') || raw.includes('/') || raw.includes('?') || raw.includes('&')) return '';
  const slug = raw.toLowerCase();
  return isSafeSlugValue(slug) ? slug : '';
}

/** Subdomena tenantowa platformy (nie apex staging/prod). */
function isTenantSubdomain(hostnameNorm) {
  if (typeof globalThis.DFOPS_isTenantPublicHostname === 'function') {
    return globalThis.DFOPS_isTenantPublicHostname(hostnameNorm, normalizeHostname);
  }
  if (!hostnameNorm) return false;
  return !!extractSubdomainSlug(hostnameNorm);
}

/** Niestandardowa domena klienta (poza platformą i pages.dev). */
function isCustomDomainHost(hostnameNorm) {
  if (!hostnameNorm || hostnameNorm.includes('pages.dev')) return false;
  return !isPlatformHost(hostnameNorm);
}

/** Subdomena SaaS lub custom domain — publiczny URL ma zostać na `/`. */
function isTenantPublicHost(hostnameNorm) {
  return isTenantSubdomain(hostnameNorm) || isCustomDomainHost(hostnameNorm);
}

function tenantNotFoundHtml() {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Strona nie istnieje — DFCMS</title>
</head>
<body style="margin:0;padding:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#121212;font-family:system-ui,sans-serif">
  <div style="text-align:center;padding:2rem;max-width:28rem">
    <h1 style="font-size:3.5rem;color:#D4AF37;letter-spacing:0.2em;margin:0 0 1rem">404</h1>
    <p style="font-size:1.125rem;color:#9ca3af;margin:0 0 2rem;font-weight:300;line-height:1.5">Ta strona nie istnieje lub nie została jeszcze opublikowana.</p>
    <a href="https://dfcms.pl/rejestracja.html" style="display:inline-block;padding:1rem 2rem;background:#D4AF37;color:#121212;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;font-size:0.875rem;text-decoration:none;border-radius:2px">Załóż własną stronę na DFCMS</a>
  </div>
</body>
</html>`;
}

function tenantNotFoundResponse(request) {
  return applySecurityHeaders(
    request,
    new Response(tenantNotFoundHtml(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  );
}

/** Soft-block: strona istnieje, ale publiczny widok zablokowany — bez content w odpowiedzi. */
function tenantSoftBlockedHtml(slug) {
  const safeSlug = isSafeSlugValue(slug) ? String(slug).trim().toLowerCase() : '';
  const panelHref = safeSlug
    ? `/admin.html?site=${encodeURIComponent(safeSlug)}`
    : '/admin.html';
  const cennikHref = 'https://dfcms.pl/index.html#cennik';
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Strona chwilowo niedostępna — DFCMS</title>
</head>
<body style="margin:0;padding:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#121212;font-family:system-ui,sans-serif">
  <div style="text-align:center;padding:2rem;max-width:28rem">
    <h1 style="font-size:1.75rem;color:#f3f4f6;margin:0 0 1rem;font-weight:700;line-height:1.3">Ta strona jest chwilowo niedostępna</h1>
    <p style="font-size:1rem;color:#9ca3af;margin:0 0 2rem;font-weight:300;line-height:1.5">Trwają prace techniczne albo witryna jest w aktualizacji. Spróbuj ponownie później — przepraszamy za utrudnienia.</p>
    <div style="display:flex;flex-direction:column;gap:0.75rem;align-items:center">
      <a href="${panelHref}" style="display:inline-block;padding:0.875rem 1.75rem;background:#D4AF37;color:#121212;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;font-size:0.8125rem;text-decoration:none;border-radius:2px">Panel właściciela</a>
      <a href="${cennikHref}" style="display:inline-block;padding:0.5rem 1rem;color:#9ca3af;font-size:0.875rem;text-decoration:underline">Cennik DFCMS</a>
    </div>
  </div>
</body>
</html>`;
}

function tenantSoftBlockedResponse(request, slug) {
  return applySecurityHeaders(
    request,
    new Response(tenantSoftBlockedHtml(slug), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  );
}

function isEdgeRoutePath(pathname) {
  if (EDGE_ROUTE_PATHS.has(pathname)) return true;
  const bare = pathname
    .replace(/\.html$/i, '')
    .replace(/^\/templates\//i, '')
    .replace(/^\//, '');
  return ALLOWED_THEMES.has(bare);
}

function applySecurityHeaders(request, response) {
  try {
    const url = new URL(request.url);
    const headers = new Headers(response.headers);

    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    headers.set('X-Frame-Options', 'DENY');

    if (url.protocol === 'https:') {
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
      "block-all-mixed-content",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://maps.googleapis.com https://js.stripe.com https://js-de.sentry-cdn.com https://browser.sentry-cdn.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob: https://maps.gstatic.com https://maps.googleapis.com",
      "frame-src 'self' https://www.google.com https://www.google.com/maps/ https://js.stripe.com https://calendly.com https://challenges.cloudflare.com",
      "connect-src 'self' https://*.supabase.co https://api.stripe.com https://maps.googleapis.com https://*.sentry.io https://js-de.sentry-cdn.com https://browser.sentry-cdn.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
    ].join('; ');
    headers.set('Content-Security-Policy', csp);

    const contentType = headers.get('Content-Type') || '';
    if (contentType.includes('text/html')) {
      headers.set('Cache-Control', 'private, no-store, must-revalidate');
    }
    headers.set('Vary', 'Host, Accept-Encoding');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

function stripHtmlMarkup(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function isSafeSlugValue(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || ''));
}

function isSafeHostnameValue(value) {
  const host = String(value || '');
  if (host.length < 1 || host.length > 253) return false;
  if (host.includes('..')) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

/**
 * Meta routingu (RPC) — slug/theme/blocked bez content.
 * Lookup po slug albo custom_domain (host tylko gdy brak slug i to domena klienta).
 */
async function fetchPublicSiteRoute(supabaseUrl, anonKey, slugTrimmed, hostnameNorm) {
  const safeSlug = String(slugTrimmed || '').trim().toLowerCase();
  const safeHost = String(hostnameNorm || '').trim().toLowerCase();

  if (!safeSlug && !safeHost) return null;
  if (safeSlug && !isSafeSlugValue(safeSlug)) return null;
  if (!safeSlug && !isCustomDomainHost(safeHost)) return null;
  if (!safeSlug && !isSafeHostnameValue(safeHost)) return null;

  const body = {
    p_slug: safeSlug || null,
    p_host: safeSlug ? null : safeHost,
  };
  const rpcUrl = `${supabaseUrl}/rest/v1/rpc/get_public_site_route`;
  const supaRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!supaRes.ok) return null;

  const rows = await supaRes.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row && typeof row === 'object' && row.slug ? row : null;
}

/** Pełny wiersz z content — tylko strony publicznie czytelne (RLS + filtry). */
async function fetchPageRow(supabaseUrl, anonKey, slugTrimmed, hostnameNorm) {
  const safeSlug = String(slugTrimmed || '').trim().toLowerCase();
  const safeHost = String(hostnameNorm || '').trim().toLowerCase();
  const billingGraceCutoff = new Date(Date.now() - 14 * 86400000).toISOString();

  if (!safeSlug && !safeHost) return null;
  if (safeSlug && !isSafeSlugValue(safeSlug)) return null;
  // Bez slug: tylko custom domain klienta — nie apex platformy (dfcms.pl / pages.dev).
  if (!safeSlug && !isCustomDomainHost(safeHost)) return null;
  if (!safeSlug && !isSafeHostnameValue(safeHost)) return null;

  const params = new URLSearchParams({
    select: 'content,theme',
    content: 'not.is.null',
    trial_blocked_at: 'is.null',
    or: `(billing_failed_at.is.null,billing_failed_at.gt.${billingGraceCutoff})`,
    limit: '1',
  });
  if (safeSlug) {
    params.set('slug', `eq.${safeSlug}`);
  } else {
    params.set('custom_domain', `eq.${safeHost}`);
  }
  const restUrl = `${supabaseUrl}/rest/v1/pages?${params.toString()}`;

  // Tablica JSON (nie object+json): 0 wierszy → 200 [] zamiast 406 (szum w logach Supabase).
  const supaRes = await fetch(restUrl, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
    },
  });

  if (!supaRes.ok) return null;

  const rows = await supaRes.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  return row && typeof row === 'object' ? row : null;
}

/** Wewnętrzny rewrite do pliku szablonu — bez Response.redirect (URL w przeglądarce bez zmian). */
async function fetchThemeAsset(env, request, theme, url) {
  if (!env.ASSETS) return null;
  const paths =
    theme === 'setup'
      ? ['/setup.html', '/setup']
      : [`/templates/${theme}.html`, `/templates/${theme}`, `/${theme}.html`, `/${theme}`];
  for (let i = 0; i < paths.length; i++) {
    const themeUrl = new URL(paths[i], request.url);
    themeUrl.search = url.search;
    const themeRequest = new Request(themeUrl.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'manual',
    });
    const themeResponse = await env.ASSETS.fetch(themeRequest);
    if (themeResponse.ok) return themeResponse;
  }
  return null;
}

function applySeoRewriter(htmlResponse, row, env, slugTrimmed, hostnameNorm, locale) {
  const content = row?.content;
  const def = defaultLocaleFromContent(content);
  const loc = locale || def;
  const enabled = enabledLocalesFromContent(content);
  const block = (content && content[loc]) || content?.pl || {};
  const seo = block.seo;

  const titleRaw = seo && seo.title != null ? String(seo.title) : '';
  const descRaw = seo && seo.description != null ? String(seo.description) : '';
  const ogImageRaw = seo && seo.ogImage != null ? String(seo.ogImage).trim() : '';

  const title = stripHtmlMarkup(titleRaw);
  const description = stripHtmlMarkup(descRaw);

  const titleEsc = escapeHtmlText(title);
  const descAttr = escapeAttr(description);
  const titleAttr = escapeAttr(title);
  const debugOn = env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true';
  const host = hostnameNorm || 'dfcms.pl';
  const buildPath =
    typeof globalThis.DFOPS_buildLocalizedPath === 'function'
      ? globalThis.DFOPS_buildLocalizedPath
      : (l, p, d) => (l && l !== d ? '/' + l + (p === '/' ? '' : p) : p);

  const rewriter = new HTMLRewriter();

  rewriter.on('html', {
    element(el) {
      el.setAttribute('lang', loc);
      el.setAttribute('data-dfcms-locale', loc);
    },
  });

  if (title) {
    rewriter.on('title', {
      element(el) {
        el.setInnerContent(titleEsc, { html: false });
      },
    });
  }

  rewriter.on('head', {
    element(el) {
      el.prepend('<meta charset="UTF-8">', { html: true });
      if (debugOn) {
        const msg = escapeAttr(`slug=${slugTrimmed || '-'} host=${hostnameNorm} loc=${loc} ok=1`);
        el.prepend(`<meta name="dfops-debug" content="${msg}">`, { html: true });
      }
      const parts = [];
      if (description) {
        parts.push(`<meta name="description" content="${descAttr}">`);
      }
      if (title) {
        parts.push(`<meta property="og:title" content="${titleAttr}">`);
        parts.push(`<meta property="og:locale" content="${escapeAttr(loc)}">`);
      }
      if (description) {
        parts.push(`<meta property="og:description" content="${descAttr}">`);
      }
      if (ogImageRaw) {
        parts.push(`<meta property="og:image" content="${escapeAttr(ogImageRaw)}">`);
      }
      // hreflang
      for (let i = 0; i < enabled.length; i++) {
        const hrefLoc = enabled[i];
        const path = buildPath(hrefLoc, '/', def);
        const href = `https://${host}${path === '' ? '/' : path}`;
        parts.push(
          `<link rel="alternate" hreflang="${escapeAttr(hrefLoc)}" href="${escapeAttr(href)}">`,
        );
      }
      const defaultHref = `https://${host}/`;
      parts.push(`<link rel="alternate" hreflang="x-default" href="${escapeAttr(defaultHref)}">`);
      const canonicalPath = buildPath(loc, '/', def);
      const canonical = `https://${host}${canonicalPath === '' ? '/' : canonicalPath}`;
      parts.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);

      if (parts.length) {
        el.append(parts.join(''), { html: true });
      }
    },
  });

  return rewriter.transform(htmlResponse);
}

async function serveThemedPage(request, env, row, slugTrimmed, hostnameNorm, url, locale) {
  const theme = String(row.theme).trim().toLowerCase();
  if (theme !== 'setup' && !ALLOWED_THEMES.has(theme)) return null;

  const themeResponse = await fetchThemeAsset(env, request, theme, url);
  if (!themeResponse?.ok) return null;

  const withSeo = applySeoRewriter(
    themeResponse,
    row,
    env,
    slugTrimmed,
    hostnameNorm,
    locale,
  );
  return applySecurityHeaders(request, withSeo);
}

export async function onRequest(context) {
  const { request, env, next, cf } = context;
  const url = new URL(request.url);
  const hostCandidates = collectHostCandidates(request, url, cf);
  const hostname = getRequestHostname(request, url, cf);
  const urlHostname = normalizeHostname(url.hostname);
  const siteParam = url.searchParams.get('site');

  if (STATIC_EXT.test(url.pathname)) {
    return applySecurityHeaders(request, await next());
  }

  if (url.pathname.startsWith('/api/')) {
    return applySecurityHeaders(request, await next());
  }

  let debugTrace = 'START';

  try {
    const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/$/, '') : '';
    const anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY : '';

    if (!supabaseUrl || !anonKey) {
      debugTrace = 'MISSING_ENV_VARS';
      throw new Error(debugTrace);
    }

    const parseLocale =
      typeof globalThis.DFOPS_parseLocaleFromPathname === 'function'
        ? globalThis.DFOPS_parseLocaleFromPathname
        : () => ({ locale: null, pathname: url.pathname, isPrefixed: false, unknownPrefix: '' });

    const localeInfo = parseLocale(url.pathname);
    // /pl → redirect na ścieżkę bez prefixu
    if (localeInfo.unknownPrefix === 'pl') {
      const dest = new URL(request.url);
      dest.pathname = localeInfo.pathname || '/';
      return Response.redirect(dest.toString(), 302);
    }

    const logicalPath = localeInfo.pathname || '/';
    const pathForEdge = localeInfo.isPrefixed ? logicalPath : url.pathname;
    if (!isEdgeRoutePath(pathForEdge)) {
      debugTrace = 'NOT_EDGE_ROUTE:' + url.pathname;
      throw new Error(debugTrace);
    }

    const hostnameNorm = hostname || urlHostname;
    const slugTrimmed = resolveSlug(siteParam, hostname, urlHostname, hostCandidates);
    const tenantSub = isTenantSubdomain(hostnameNorm);

    if (!slugTrimmed && !hostnameNorm) {
      debugTrace = 'NO_SLUG_OR_HOST';
      throw new Error(debugTrace);
    }

    const isPreview = url.searchParams.get('dfcms_preview') === '1';
    const routeHost = slugTrimmed ? '' : hostnameNorm;
    debugTrace = `FETCH_ROUTE|slug:${slugTrimmed}|host:${routeHost || hostnameNorm}`;
    const route = await fetchPublicSiteRoute(supabaseUrl, anonKey, slugTrimmed, routeHost || hostnameNorm);

    if (!route) {
      if (
        tenantSub ||
        isCustomDomainHost(hostnameNorm) ||
        (slugTrimmed && isSafeSlugValue(slugTrimmed))
      ) {
        return tenantNotFoundResponse(request);
      }
      debugTrace = `NO_ROW|slug:[${slugTrimmed}]|host:[${hostnameNorm}]`;
      throw new Error(debugTrace);
    }

    const routeSlug = String(route.slug || slugTrimmed || '').trim().toLowerCase();
    const theme = String(route.theme || '').trim().toLowerCase();
    if (!theme) {
      debugTrace = 'NO_THEME_IN_DB';
      throw new Error(debugTrace);
    }
    if (theme !== 'setup' && !ALLOWED_THEMES.has(theme)) {
      debugTrace = 'INVALID_THEME:' + theme;
      throw new Error(debugTrace);
    }

    if (route.blocked && !isPreview) {
      debugTrace = `SOFT_BLOCK|slug:${routeSlug}`;
      const blockedRes = tenantSoftBlockedResponse(request, routeSlug);
      if (env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true') {
        blockedRes.headers.set('X-DFCMS-Debug', debugTrace);
      }
      return blockedRes;
    }

    if (!env.ASSETS) {
      debugTrace = 'NO_ENV_ASSETS';
      throw new Error(debugTrace);
    }

    // Preview zablokowanej strony: szablon bez SEO z content (treść ładuje sesja właściciela).
    if (route.blocked && isPreview) {
      debugTrace = `PREVIEW_BLOCKED:${theme}|slug:${routeSlug}`;
      const themeResponse = await fetchThemeAsset(env, request, theme, url);
      if (!themeResponse?.ok) {
        debugTrace = 'ASSET_404';
        throw new Error(debugTrace);
      }
      const previewRes = new Response(themeResponse.body, themeResponse);
      if (env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true') {
        previewRes.headers.set('X-DFCMS-Debug', debugTrace);
      }
      return applySecurityHeaders(request, previewRes);
    }

    debugTrace = `FETCH_DB|slug:${routeSlug}|host:${hostnameNorm}`;
    const row = await fetchPageRow(supabaseUrl, anonKey, routeSlug || slugTrimmed, hostnameNorm);
    if (!row || !row.content) {
      // Meta mówi „live”, ale RLS/content niedostępne — nie ujawniaj soft-blocku z contentem.
      debugTrace = `LIVE_NO_CONTENT|slug:${routeSlug}`;
      if (
        tenantSub ||
        isCustomDomainHost(hostnameNorm) ||
        (slugTrimmed && isSafeSlugValue(slugTrimmed))
      ) {
        return tenantNotFoundResponse(request);
      }
      throw new Error(debugTrace);
    }

    const enabled = enabledLocalesFromContent(row.content);
    const def = defaultLocaleFromContent(row.content);
    let activeLocale = def;
    if (localeInfo.isPrefixed && localeInfo.locale) {
      if (enabled.indexOf(localeInfo.locale) === -1) {
        const dest = new URL(request.url);
        dest.pathname = logicalPath || '/';
        return Response.redirect(dest.toString(), 302);
      }
      activeLocale = localeInfo.locale;
    }

    debugTrace = `FETCH_ASSET:${theme}|loc:${activeLocale}`;
    const themeResponse = await fetchThemeAsset(env, request, theme, url);
    if (!themeResponse?.ok) {
      debugTrace = 'ASSET_404';
      throw new Error(debugTrace);
    }

    debugTrace = 'SUCCESS_REWRITE';
    const withSeo = applySeoRewriter(
      themeResponse,
      row,
      env,
      routeSlug || slugTrimmed,
      hostnameNorm,
      activeLocale,
    );
    const finalResponse = new Response(withSeo.body, withSeo);
    if (env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true') {
      finalResponse.headers.set('X-DFCMS-Debug', debugTrace);
    }

    return applySecurityHeaders(request, finalResponse);
  } catch (e) {
    const hostnameNorm = hostname || urlHostname;
    const parseLocale =
      typeof globalThis.DFOPS_parseLocaleFromPathname === 'function'
        ? globalThis.DFOPS_parseLocaleFromPathname
        : null;
    const logical = parseLocale ? parseLocale(url.pathname).pathname : url.pathname;
    if (
      isTenantPublicHost(hostnameNorm) &&
      (isEdgeRoutePath(url.pathname) || isEdgeRoutePath(logical || '/'))
    ) {
      const notFound = tenantNotFoundResponse(request);
      if (env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true') {
        notFound.headers.set('X-DFCMS-Debug', `FAIL[${debugTrace}]`);
      }
      return notFound;
    }
    const response = await next();
    const fallbackRes = new Response(response.body, response);
    if (env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true') {
      fallbackRes.headers.set('X-DFCMS-Debug', `FAIL[${debugTrace}]`);
    }
    return applySecurityHeaders(request, fallbackRes);
  }
}
