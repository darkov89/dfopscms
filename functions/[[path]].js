/**
 * Cloudflare Pages — catch-all middleware (HTMLRewriter + Supabase SEO dla botów).
 *
 * Wymagane zmienne środowiskowe (Settings → Environment variables):
 *   SUPABASE_URL       — np. https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY  — klucz anon (publiczny)
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
    if (!contentType.includes('text/html')) {
      return response;
    }

    if (!response.body) {
      return response;
    }

    const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/$/, '') : '';
    const anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY : '';
    if (!supabaseUrl || !anonKey) {
      return response;
    }

    const hostnameNorm = hostname.replace(/^www\./i, '').toLowerCase();
    const slugTrimmed = siteParam != null ? String(siteParam).trim() : '';

    let restUrl;
    if (slugTrimmed) {
      restUrl = `${supabaseUrl}/rest/v1/pages?slug=eq.${encodeURIComponent(slugTrimmed)}&select=content`;
    } else {
      restUrl = `${supabaseUrl}/rest/v1/pages?custom_domain=eq.${encodeURIComponent(hostnameNorm)}&select=content`;
    }

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
        /* charset na początku <head> (WAŻNE przy stream rewriting); OG na końcu sekcji */
        el.prepend('<meta charset="UTF-8">', { html: true });
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
