import '../js/core/utils.js';

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

const PLATFORM_BASE_DOMAINS = ['dfcms.pl', 'dfopscms.pl', 'dfopscms.pages.dev', 'localhost', '127.0.0.1'];
const ALLOWED_THEMES = new Set(['beauty', 'consultant', 'fitness', 'services', 'gastro', 'care']);
const normalizeHostname = globalThis.DFOPS_normalizeHostname;
const EDGE_ROUTE_PATHS = new Set([
  '/',
  '/index.html',
  '/index',
  '/router.html',
  '/router',
]);

/** Host z nagłówka (subdomeny SaaS) ma pierwszeństwo przed url.hostname po wewnętrznym rewrite CF. */
function parseForwardedHost(request) {
  const fwd = request.headers.get('Forwarded') || '';
  const m = fwd.match(/host=([^;,\s"]+)/i);
  if (!m) return '';
  return normalizeHostname(m[1].replace(/^"|"$/g, '').split(':')[0]);
}

function collectHostCandidates(request, url, cf) {
  const raw = [
    url.hostname,
    request.headers.get('Host'),
    request.headers.get('X-Forwarded-Host'),
    request.headers.get('X-Original-Host'),
    parseForwardedHost(request),
    cf && cf.hostMetadata && cf.hostMetadata.httpHost,
    cf && cf.hostname,
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

/** Preferuj tenant *.dfcms.pl zamiast wewnętrznego hosta pages.dev widzianego przez worker. */
function pickTenantHostname(candidates) {
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
  return PLATFORM_BASE_DOMAINS.some(
    (base) => hostnameNorm === base || hostnameNorm.endsWith('.' + base),
  );
}

/** Dla user.dfcms.pl → 'user'; dla gołego dfcms.pl / localhost → '' */
function extractSubdomainSlug(hostnameNorm) {
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

function resolveSlug(siteParam, hostnameNorm, altHostnameNorm) {
  if (siteParam != null && String(siteParam).trim()) {
    return String(siteParam).trim().toLowerCase();
  }
  for (const host of [hostnameNorm, altHostnameNorm]) {
    if (!host || !isPlatformHost(host)) continue;
    const fromSub = extractSubdomainSlug(host);
    if (fromSub) return fromSub;
  }
  return '';
}

function isEdgeRoutePath(pathname) {
  if (EDGE_ROUTE_PATHS.has(pathname)) return true;
  const bare = pathname.replace(/\.html$/i, '').replace(/^\//, '');
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

async function fetchPageRow(supabaseUrl, anonKey, slugTrimmed, hostnameNorm) {
  const safeSlug = String(slugTrimmed || '').trim().toLowerCase();
  const safeHost = String(hostnameNorm || '').trim().toLowerCase();
  const billingGraceCutoff = new Date(Date.now() - 14 * 86400000).toISOString();

  if (!safeSlug && !safeHost) return null;
  if (safeSlug && !isSafeSlugValue(safeSlug)) return null;
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

  const supaRes = await fetch(restUrl, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/vnd.pgrst.object+json',
    },
  });

  if (supaRes.status === 406) return null;
  if (!supaRes.ok) return null;

  const row = await supaRes.json();
  return row && typeof row === 'object' ? row : null;
}

async function fetchThemeAsset(env, request, theme, url, hostnameNorm) {
  if (!env.ASSETS) return null;
  const paths = [`/${theme}`, `/${theme}.html`];
  const assetOrigin = `https://${hostnameNorm || new URL(request.url).hostname}`;
  for (let i = 0; i < paths.length; i++) {
    const themeUrl = new URL(paths[i], assetOrigin);
    themeUrl.search = url.search;
    const themeRequest = new Request(themeUrl.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'follow',
    });
    const themeResponse = await env.ASSETS.fetch(themeRequest);
    if (themeResponse.ok) return themeResponse;
  }
  return null;
}

function applySeoRewriter(htmlResponse, row, env, slugTrimmed, hostnameNorm) {
  const seo = row?.content?.pl?.seo;
  if (!seo || typeof seo !== 'object') {
    return htmlResponse;
  }

  const titleRaw = seo.title != null ? String(seo.title) : '';
  const descRaw = seo.description != null ? String(seo.description) : '';
  const ogImageRaw = seo.ogImage != null ? String(seo.ogImage).trim() : '';

  const title = stripHtmlMarkup(titleRaw);
  const description = stripHtmlMarkup(descRaw);

  if (!title && !description && !ogImageRaw) {
    return htmlResponse;
  }

  const titleEsc = escapeHtmlText(title);
  const descAttr = escapeAttr(description);
  const titleAttr = escapeAttr(title);
  const debugOn = env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true';

  const rewriter = new HTMLRewriter();

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
        const msg = escapeAttr(`slug=${slugTrimmed || '-'} host=${hostnameNorm} ok=1`);
        el.prepend(`<meta name="dfops-debug" content="${msg}">`, { html: true });
      }
      const parts = [];
      if (description) {
        parts.push(`<meta name="description" content="${descAttr}">`);
      }
      if (title) {
        parts.push(`<meta property="og:title" content="${titleAttr}">`);
      }
      if (description) {
        parts.push(`<meta property="og:description" content="${descAttr}">`);
      }
      if (ogImageRaw) {
        parts.push(`<meta property="og:image" content="${escapeAttr(ogImageRaw)}">`);
      }
      if (parts.length) {
        el.append(parts.join(''), { html: true });
      }
    },
  });

  return rewriter.transform(htmlResponse);
}

async function serveThemedPage(request, env, row, slugTrimmed, hostnameNorm, url) {
  const theme = String(row.theme).trim().toLowerCase();
  if (!ALLOWED_THEMES.has(theme)) return null;

  const themeResponse = await fetchThemeAsset(env, request, theme, url, hostnameNorm);
  if (!themeResponse?.ok) return null;

  const withSeo = applySeoRewriter(themeResponse, row, env, slugTrimmed, hostnameNorm);
  return applySecurityHeaders(request, withSeo);
}

export async function onRequest(context) {
  const { request, env, next, cf } = context;
  const url = new URL(request.url);
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

    if (!isEdgeRoutePath(url.pathname)) {
      debugTrace = 'NOT_EDGE_ROUTE:' + url.pathname;
      throw new Error(debugTrace);
    }

    const hostnameNorm = hostname || urlHostname;
    const slugTrimmed = resolveSlug(siteParam, hostname, urlHostname);

    if (!slugTrimmed && !hostnameNorm) {
      debugTrace = 'NO_SLUG_OR_HOST';
      throw new Error(debugTrace);
    }

    debugTrace = `FETCH_DB|slug:${slugTrimmed}|host:${hostnameNorm}`;
    const row = await fetchPageRow(supabaseUrl, anonKey, slugTrimmed, hostnameNorm);

    if (!row) {
      debugTrace = `NO_ROW|slug:[${slugTrimmed}]|host:[${hostnameNorm}]`;
      throw new Error(debugTrace);
    }
    if (!row.theme) {
      debugTrace = 'NO_THEME_IN_DB';
      throw new Error(debugTrace);
    }

    const theme = String(row.theme).trim().toLowerCase();
    if (!ALLOWED_THEMES.has(theme)) {
      debugTrace = 'INVALID_THEME:' + theme;
      throw new Error(debugTrace);
    }

    debugTrace = `FETCH_ASSET:${theme}`;
    if (!env.ASSETS) {
      debugTrace = 'NO_ENV_ASSETS';
      throw new Error(debugTrace);
    }

    // Uproszczone, pancerne pobieranie z env.ASSETS
    const assetUrl = new URL(`/${theme}.html`, request.url);
    const assetReqOpts = { method: 'GET', headers: request.headers };
    let themeResponse = await env.ASSETS.fetch(new Request(assetUrl, assetReqOpts));

    if (!themeResponse.ok) {
      // Fallback bez .html
      const assetUrlNoExt = new URL(`/${theme}`, request.url);
      themeResponse = await env.ASSETS.fetch(new Request(assetUrlNoExt, assetReqOpts));
      if (!themeResponse.ok) {
        debugTrace = 'ASSET_404:' + themeResponse.status;
        throw new Error(debugTrace);
      }
    }

    debugTrace = 'SUCCESS_REWRITE';
    const withSeo = applySeoRewriter(themeResponse, row, env, slugTrimmed, hostnameNorm);
    const finalResponse = new Response(withSeo.body, withSeo);
    if (env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true') {
      finalResponse.headers.set('X-DFCMS-Debug', debugTrace);
    }

    return applySecurityHeaders(request, finalResponse);
  } catch (e) {
    // FALLBACK
    const response = await next();
    const fallbackRes = new Response(response.body, response);
    if (env.SEO_DEBUG === '1' || env.SEO_DEBUG === 'true') {
      fallbackRes.headers.set('X-DFCMS-Debug', `FAIL[${debugTrace}]`);
    }
    return applySecurityHeaders(request, fallbackRes);
  }
}
