/**
 * Cloudflare Pages — globalny middleware (SEO + HTMLRewriter + Supabase).
 * Zmienne: SUPABASE_URL, SUPABASE_ANON_KEY
 * Opcjonalnie: SEO_DEBUG=1 — wstrzyknie <meta name="dfops-debug" …> (tylko diagnostyka).
 *
 * Znak wodny DFOPSCMS (trial / tier0) jest doklejany po stronie klienta w publicSiteApp.js
 * (Shadow DOM), po załadowaniu treści — nie w tym middleware.
 */

const STATIC_EXT = /\.(css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|map|json|xml|txt|pdf|webmanifest)$/i;

function applySecurityHeaders(request, response) {
  try {
    const url = new URL(request.url);
    const headers = new Headers(response.headers);

    // Baseline hardening
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // Clickjacking protection (legacy + modern)
    headers.set('X-Frame-Options', 'DENY');

    // HSTS only on HTTPS
    if (url.protocol === 'https:') {
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // CSP: strong baseline compatible with current CDN-based build.
    // Note: inline scripts are required because pages embed Tailwind config in <script>.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
      "block-all-mixed-content",

      // Scripts: self + required CDNs. 'unsafe-inline' needed for Tailwind config blocks.
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",

      // Styles: self + Google Fonts. 'unsafe-inline' needed for inline <style> blocks.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

      // Fonts: Google Fonts
      "font-src 'self' https://fonts.gstatic.com",

      // Images: only https/self (no data:). Allow blob: for runtime-created previews if needed.
      "img-src 'self' https: blob:",

      // Network: Supabase + same origin
      "connect-src 'self' https://*.supabase.co",

      // Frames: allow Google Maps embed if used
      "frame-src https://www.google.com",
    ].join('; ');
    headers.set('Content-Security-Policy', csp);

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

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const hostname = url.hostname;
  const siteParam = url.searchParams.get('site');

  if (STATIC_EXT.test(url.pathname)) {
    return next();
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

    const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/$/, '') : '';
    const anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY : '';
    if (!supabaseUrl || !anonKey) {
      return response;
    }

    const hostnameNorm = hostname.replace(/^www\./i, '').toLowerCase();
    const slugTrimmed = siteParam != null ? String(siteParam).trim() : '';

    const restUrl = slugTrimmed
      ? `${supabaseUrl}/rest/v1/pages?slug=eq.${encodeURIComponent(slugTrimmed)}&select=content`
      : `${supabaseUrl}/rest/v1/pages?custom_domain=eq.${encodeURIComponent(hostnameNorm)}&select=content`;

    const supaRes = await fetch(restUrl, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
    });

    if (!supaRes.ok) {
      return response;
    }

    const rows = await supaRes.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const seo = row?.content?.pl?.seo;
    if (!seo || typeof seo !== 'object') {
      return response;
    }

    const titleRaw = seo.title != null ? String(seo.title) : '';
    const descRaw = seo.description != null ? String(seo.description) : '';
    const ogImageRaw = seo.ogImage != null ? String(seo.ogImage).trim() : '';

    const title = stripHtmlMarkup(titleRaw);
    const description = stripHtmlMarkup(descRaw);

    if (!title && !description && !ogImageRaw) {
      return response;
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

    return applySecurityHeaders(request, rewriter.transform(response));
  } catch {
    return applySecurityHeaders(request, response);
  }
}
