const STATIC_EXT = /\.(css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|map|json|xml|txt|pdf|webmanifest)$/i;

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Przepuszczamy pliki statyczne
  if (STATIC_EXT.test(url.pathname)) {
    return next();
  }

  let response;
  try { 
    response = await next(); 
  } catch { 
    return new Response('Błąd serwera', { status: 502 }); 
  }
  
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let debugMsg = "Inicjalizacja skryptu";
  let seoData = null;

  try {
    const supabaseUrl = env.SUPABASE_URL ? env.SUPABASE_URL.replace(/\/$/, '') : '';
    const anonKey = env.SUPABASE_ANON_KEY || '';
    
    if (!supabaseUrl || !anonKey) {
      debugMsg = "BLAD: Brak zmiennych srodowiskowych (Dodaj je w zakladce Preview i Production w CF!)";
    } else {
      const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
      const siteParam = url.searchParams.get('site');
      const slugTrimmed = siteParam ? siteParam.trim() : '';

      const restUrl = slugTrimmed 
        ? `${supabaseUrl}/rest/v1/pages?slug=eq.${encodeURIComponent(slugTrimmed)}&select=content`
        : `${supabaseUrl}/rest/v1/pages?custom_domain=eq.${encodeURIComponent(hostname)}&select=content`;

      const supaRes = await fetch(restUrl, {
        headers: { 
            'apikey': anonKey, 
            'Authorization': `Bearer ${anonKey}`, 
            'Accept': 'application/json' 
        }
      });

      if (!supaRes.ok) {
        debugMsg = `BLAD BAZY: HTTP ${supaRes.status} (Sprawdz reguly RLS w Supabase)`;
      } else {
        const rows = await supaRes.json();
        if (!rows || rows.length === 0) {
          debugMsg = `BLAD: Baza nie zwrocila zadnego wiersza dla slug=${slugTrimmed}`;
        } else {
          seoData = rows[0]?.content?.pl?.seo;
          debugMsg = seoData ? "SUKCES: Znaleziono i wstrzyknieto tagi SEO!" : "BLAD: Jest wiersz, ale brak sciezki content.pl.seo";
        }
      }
    }
  } catch (err) {
    debugMsg = `WYJATEK KRYTYCZNY: ${err.message}`;
  }

  // Wstrzykiwanie modyfikacji do HTML
  const rewriter = new HTMLRewriter();
  
  rewriter.on('head', {
    element(el) {
      // TEN TAG POWIE NAM PRAWDE:
      el.prepend(`<meta name="dfops-debug" content="${debugMsg}">`, { html: true });
      
      if (seoData) {
        if (seoData.description) {
            el.append(`<meta name="description" content="${seoData.description}">`, { html: true });
            el.append(`<meta property="og:description" content="${seoData.description}">`, { html: true });
        }
        if (seoData.ogImage) {
            el.append(`<meta property="og:image" content="${seoData.ogImage}">`, { html: true });
        }
      }
    }
  });

  if (seoData && seoData.title) {
    rewriter.on('title', {
      element(el) {
        el.setInnerContent(seoData.title);
      }
    });
    rewriter.on('head', {
      element(el) {
          el.append(`<meta property="og:title" content="${seoData.title}">`, { html: true });
      }
    });
  }

  return rewriter.transform(response);
}