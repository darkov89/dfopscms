/**
 * Cloudflare Pages — globalny middleware (SEO + edge routing szablonów + HTMLRewriter + Supabase).
 * Zmienne: SUPABASE_URL, SUPABASE_ANON_KEY
 * Opcjonalnie: SEO_DEBUG=1 — wstrzyknie <meta name="dfops-debug" …> (tylko diagnostyka).
 *
 * Znak wodny DFCMS (trial / tier0) jest doklejany po stronie klienta w publicSiteApp.js
 * (Shadow DOM), po załadowaniu treści — nie w tym middleware.
 */

const STATIC_EXT = /\.(css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|map|json|xml|txt|pdf|webmanifest)$/i;

const PLATFORM_BASE_DOMAINS = ['dfcms.pl', 'localhost', '127.0.0.1'];
const ALLOWED_THEMES = new Set(['beauty', 'consultant', 'fitness', 'services']);
const EDGE_ROUTE_PATHS = new Set([
  '/',
  '/index.html',
  '/index',
  '/router.html',
  '/router',
]);

function normalizeHostname(hostname) {
  return String(hostname || '')
    .replace(/^www\./i, '')
    .toLowerCase();
}

/** Host z nagłówka (subdomeny SaaS) ma pierwszeństwo przed url.hostname po wewnętrznym rewrite CF. */
function getRequestHostname(request, url) {
  const raw =
    request.headers.get('Host') ||
    request.headers.get('X-Forwarded-Host') ||
    url.hostname ||
    '';
  return normalizeHostname(String(raw).split(':')[0]);
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

function resolveSlug(siteParam, hostnameNorm) {
  let slugTrimmed = siteParam != null ? String(siteParam).trim() : '';
  if (!slugTrimmed && isPlatformHost(hostnameNorm)) {
    slugTrimmed = extractSubdomainSlug(hostnameNorm);
  }
  return slugTrimmed;
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
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
      "block-all-mixed-content",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' https: blob:",
      "connect-src 'self' https://*.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "frame-src https://www.google.com",
    ].join('; ');
    headers.set('Content-Security-Policy', csp);

    headers.set('Cache-Control', 'private, no-store, must-revalidate');
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

async function fetchPageRow(supabaseUrl, anonKey, slugTrimmed, hostnameNorm) {
  const restUrl = slugTrimmed
    ? `${supabaseUrl}/rest/v1/pages?slug=eq.${encodeURIComponent(slugTrimmed)}&select=content,theme`
    : `${supabaseUrl}/rest/v1/pages?custom_domain=eq.${encodeURIComponent(hostnameNorm)}&select=content,theme`;

  const supaRes = await fetch(restUrl, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
    },
  });

  if (!supaRes.ok) return null;

  const rows = await supaRes.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
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
  const { request, env, next } = context;
  const url = new URL(request.url);
  const hostname = getRequestHostname(request, url);
  const siteParam = url.searchParams.get('site');

  if (STATIC_EXT.test(url.pathname)) {
    return next();
  }

  const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/$/, '') : '';
  const anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY : '';

  if (supabaseUrl && anonKey && isEdgeRoutePath(url.pathname)) {
    try {
      const hostnameNorm = normalizeHostname(hostname);
      const slugTrimmed = resolveSlug(siteParam, hostnameNorm);
      const row = await fetchPageRow(supabaseUrl, anonKey, slugTrimmed, hostnameNorm);

      if (row?.theme && env.ASSETS) {
        const themed = await serveThemedPage(request, env, row, slugTrimmed, hostnameNorm, url);
        if (themed) return themed;
      }
    } catch {
      /* fallback do next() */
    }
  }

  let response;
  try {
    response = await next();
  } catch {
    return new Response('Upstream error', { status: 502 });
  }

  try {
    if (request.method === 'HEAD' || request.method === 'OPTIONS') {
      return applySecurityHeaders(request, response);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') || !response.body) {
      return applySecurityHeaders(request, response);
    }

    if (!supabaseUrl || !anonKey) {
      return applySecurityHeaders(request, response);
    }

    const hostnameNorm = normalizeHostname(hostname);
    const slugTrimmed = resolveSlug(siteParam, hostnameNorm);
    const row = await fetchPageRow(supabaseUrl, anonKey, slugTrimmed, hostnameNorm);

    let htmlResponse = response;

    if (row?.theme && isEdgeRoutePath(url.pathname) && env.ASSETS) {
      const themeResponse = await fetchThemeAsset(env, request, String(row.theme).trim().toLowerCase(), url, hostnameNorm);
      if (themeResponse?.ok) {
        htmlResponse = themeResponse;
      }
    }

    const withSeo = applySeoRewriter(htmlResponse, row, env, slugTrimmed, hostnameNorm);
    return applySecurityHeaders(request, withSeo);
  } catch {
    return applySecurityHeaders(request, response);
  }
}
