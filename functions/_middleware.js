/**
 * Cloudflare Pages — globalny middleware (SEO + HTMLRewriter + Supabase).
 * Zmienne: SUPABASE_URL, SUPABASE_ANON_KEY
 * Opcjonalnie: SEO_DEBUG=1 — wstrzyknie <meta name="dfops-debug" …> (tylko diagnostyka).
 */

const STATIC_EXT = /\.(css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|map|json|xml|txt|pdf|webmanifest)$/i;

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
      return response;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') || !response.body) {
      return response;
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

    return rewriter.transform(response);
  } catch {
    return response;
  }
}
