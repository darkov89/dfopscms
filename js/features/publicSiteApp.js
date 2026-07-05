;(function () {
  const normalizeHostname = window.DFOPS_normalizeHostname;

  function shouldBlockPublicPageView(page) {
    if (typeof window.DFOPS_shouldBlockPublicPageView === 'function') {
      return window.DFOPS_shouldBlockPublicPageView(page);
    }
    return true;
  }

  class DFCMSWatermark extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'closed' });
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
            <style>
                .dfcms-badge {
                    position: fixed !important;
                    bottom: 16px !important;
                    right: 16px !important;
                    background: #121212 !important;
                    color: #D4AF37 !important;
                    padding: 8px 12px !important;
                    font-family: system-ui, -apple-system, sans-serif !important;
                    font-size: 11px !important;
                    font-weight: 800 !important;
                    letter-spacing: 0.1em !important;
                    text-transform: uppercase !important;
                    border-radius: 4px !important;
                    text-decoration: none !important;
                    z-index: 2147483647 !important;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
                    transition: transform 0.2s ease, background 0.2s ease !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 6px !important;
                    pointer-events: auto !important;
                }
                .dfcms-badge:hover { background: #000 !important; transform: translateY(-2px) !important; }
            </style>
            <a href="https://dfcms.pl?ref=watermark" target="_blank" rel="noopener noreferrer" class="dfcms-badge">⚡ Stworzono w DFCMS</a>
        `;
      shadow.appendChild(wrapper);
    }
  }
  if (!customElements.get('dfcms-watermark')) {
    customElements.define('dfcms-watermark', DFCMSWatermark);
  }

  function initWatermark(plan) {
    const show =
      typeof window.DFOPS_planShowsWatermark === 'function'
        ? window.DFOPS_planShowsWatermark(plan)
        : (plan || 'trial') === 'trial' || (plan || 'trial') === 'tier0';
    if (show) {
      if (!document.querySelector('dfcms-watermark')) {
        document.body.appendChild(document.createElement('dfcms-watermark'));
      }
    } else {
      const badge = document.querySelector('dfcms-watermark');
      if (badge) badge.remove();
    }
  }

  window.DFOPS_initWatermark = initWatermark;

  /** Baner na podglądzie właściciela, gdy strona publiczna jest zablokowana (trial / billing). */
  function injectPrivatePreviewBanner(subscriptionPanelUrl) {
    if (document.getElementById('dfcms-private-preview-banner')) return;
    const el = document.createElement('div');
    el.id = 'dfcms-private-preview-banner';
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#7f1d1d;color:#fff;text-align:center;padding:10px 16px;font:600 12px/1.4 system-ui,-apple-system,sans-serif;letter-spacing:0.02em;box-shadow:0 2px 8px rgba(0,0,0,.2);';
    const msg = document.createElement('span');
    msg.textContent =
      'Podgląd prywatny — strona niewidoczna dla gości (wygasły trial lub brak płatności). ';
    el.appendChild(msg);
    const url = typeof subscriptionPanelUrl === 'string' ? subscriptionPanelUrl.trim() : '';
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = 'Przejdź do subskrypcji';
      a.style.cssText = 'color:#fde68a;text-decoration:underline;margin-left:4px;';
      el.appendChild(a);
    }
    document.body.prepend(el);
  }

  function extractEmbedUrl(rawValue) {
    if (!rawValue) return '';
    let value = String(rawValue).trim();
    if (!value) return '';

    // Handle encoded iframe/html pasted into input
    try {
      if (/%3C|%3E|%22|%27/i.test(value)) value = decodeURIComponent(value);
    } catch (_) {
      // keep original value when decoding fails
    }

    // If user pasted full iframe HTML, extract src
    const iframeSrc = value.match(/src\s*=\s*["']([^"']+)["']/i);
    if (iframeSrc?.[1]) {
      return iframeSrc[1]
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/gi, '&')
        .trim();
    }

    // If user pasted plain URL, normalize common HTML-escaped chars
    if (/^https?:\/\//i.test(value)) {
      return value
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/gi, '&')
        .replace(/^"(.*)"$/, '$1')
        .trim();
    }

    return '';
  }

  function normalizeEmbedFields(content) {
    const langs = Object.keys(content || {});
    for (const l of langs) {
      if (!content[l]) continue;
      const c = content[l];
      if (c.contact?.map_embed_url) c.contact.map_embed_url = extractEmbedUrl(c.contact.map_embed_url);
      if (c.google_reviews?.embed_url) c.google_reviews.embed_url = extractEmbedUrl(c.google_reviews.embed_url);
    }
  }

  /** Usuwa prosty HTML z tytułów/opisów SEO (żeby nie trafił surowy markup do <title>). */
  function seoPlainText(value) {
    if (value == null || value === '') return '';
    const s = String(value).trim();
    if (!s) return '';
    if (!/[<>]/.test(s)) return s;
    const d = document.createElement('div');
    d.innerHTML = s;
    return (d.textContent || d.innerText || '').trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isPrivacyPolicyPath() {
    try {
      const path = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
      return path === '/polityka-prywatnosci';
    } catch (_) {
      return false;
    }
  }

  function infrastructurePrivacyHtml() {
    return `
      <div class="mt-8 pt-8 border-t border-gray-200">
        <h3 class="text-lg font-bold mb-4">Informacja o przetwarzaniu danych w systemie informatycznym</h3>
        <p class="mb-4">W celu zapewnienia prawidłowego działania strony internetowej, szybkiego ładowania treści oraz obsługi formularzy (kontaktowych, rezerwacyjnych, cenników), Administrator korzysta z usług zewnętrznego dostawcy technologii.</p>
        <p class="mb-4">Strona została uruchomiona i jest utrzymywana przy użyciu platformy DFCMS, dostarczanej przez firmę Dragonfly Operations Sp. z o.o. z siedzibą w Korzeczniku (Podmiot Przetwarzający). W celu zagwarantowania najwyższego poziomu bezpieczeństwa i niezawodności, dane użytkowników są przechowywane w bezpiecznej i zaszyfrowanej architekturze chmurowej u certyfikowanych podwykonawców technologicznych:</p>
        <ul class="list-disc pl-6 mb-4">
          <li class="mb-2"><strong>Supabase</strong> (bezpieczne przechowywanie danych w bazie danych z zachowaniem rygorystycznych polityk dostępu, na serwerach zlokalizowanych na terenie Unii Europejskiej).</li>
          <li class="mb-2"><strong>Cloudflare</strong> (obsługa infrastruktury sieciowej, ochrona przed atakami botów oraz optymalizacja szybkości ładowania strony z poziomu serwerów Edge).</li>
        </ul>
        <p class="mb-4">Wszystkie podmioty zaangażowane w utrzymanie techniczne strony spełniają wymogi RODO, stosują zaawansowane środki ochrony kryptograficznej i przetwarzają dane wyłącznie na zlecenie Administratora w celach technicznych.</p>
        <h3 class="text-lg font-bold mb-4">Statystyki kliknięć elementów kontaktowych (CTA)</h3>
        <p class="mb-4">Aby Administrator mógł ocenić skuteczność strony i lepiej dopasować sposób kontaktu do potrzeb klientów, platforma DFCMS odnotowuje zdarzenia kliknięcia w elementy kontaktowe strony, takie jak: numer telefonu, przycisk rezerwacji, WhatsApp / Messenger, adres e-mail lub mapę dojazdu. Zdarzenia te <strong>nie są powiązane z plikami cookies</strong> ani żadnymi identyfikatorami zapisywanymi w przeglądarce użytkownika.</p>
        <p>Do celów wyłącznie technicznych (ochrona przed nadużyciami i wielokrotnym zliczeniem tego samego zdarzenia) po stronie serwera tworzony jest jednorazowy, nieodwracalny skrót kryptograficzny (hash) na podstawie adresu IP, adresu strony i bieżącej daty — sam adres IP nie jest zapisywany w bazie danych. Zebrane w ten sposób dane mają charakter wyłącznie zbiorczy (liczba kliknięć w danym okresie) i służą do wyświetlenia Administratorowi statystyk w panelu zarządzania stroną oraz — w formie w pełni zanonimizowanej i uśrednionej dla branży — do porównań (benchmarków) między stronami o podobnym profilu działalności. Dane te nie umożliwiają zidentyfikowania konkretnego użytkownika ani odtworzenia jego adresu IP.</p>
      </div>
    `;
  }

  function defaultPrivacyPolicyHtml(block) {
    const businessName = escapeHtml(
      block?.settings?.business_name || block?.hero?.name || block?.nav?.logo || 'Administrator strony',
    );
    const email = escapeHtml(block?.contact?.email || 'adres e-mail podany na stronie');
    const phone = escapeHtml(block?.contact?.phone || '');
    const address = escapeHtml(block?.contact?.address || 'adres podany na stronie');
    const contactLine = phone
      ? `Kontakt z Administratorem jest możliwy pod adresem e-mail ${email} lub telefonicznie: ${phone}.`
      : `Kontakt z Administratorem jest możliwy pod adresem e-mail ${email}.`;

    return `
      <h2 class="text-2xl font-bold mb-4">Polityka Prywatności</h2>
      <p class="mb-4">Niniejsza Polityka Prywatności opisuje zasady przetwarzania danych osobowych użytkowników strony internetowej prowadzonej przez <strong>${businessName}</strong>.</p>
      <h3 class="mt-6 mb-3 text-lg font-bold">1. Administrator danych</h3>
      <p class="mb-4">Administratorem danych osobowych jest <strong>${businessName}</strong>, działający pod adresem: ${address}. ${contactLine}</p>
      <h3 class="mt-6 mb-3 text-lg font-bold">2. Zakres przetwarzanych danych</h3>
      <p class="mb-4">Administrator może przetwarzać dane podane dobrowolnie w formularzach kontaktowych, rezerwacyjnych lub w wiadomościach kierowanych przez stronę, w szczególności imię i nazwisko, adres e-mail, numer telefonu oraz treść zapytania.</p>
      <h3 class="mt-6 mb-3 text-lg font-bold">3. Cele i podstawy przetwarzania</h3>
      <p class="mb-4">Dane są przetwarzane w celu obsługi zapytań, kontaktu z użytkownikiem, realizacji usług, prowadzenia korespondencji oraz zapewnienia bezpieczeństwa i prawidłowego działania strony. Podstawą przetwarzania jest prawnie uzasadniony interes Administratora, wykonanie umowy lub działania przed jej zawarciem, a w określonych przypadkach zgoda użytkownika.</p>
      <h3 class="mt-6 mb-3 text-lg font-bold">4. Okres przechowywania danych</h3>
      <p class="mb-4">Dane są przechowywane przez okres niezbędny do obsługi sprawy, realizacji usług, dochodzenia lub obrony roszczeń oraz spełnienia obowiązków wynikających z przepisów prawa.</p>
      <h3 class="mt-6 mb-3 text-lg font-bold">5. Prawa użytkownika</h3>
      <p class="mb-4">Użytkownik ma prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia danych, wniesienia sprzeciwu oraz złożenia skargi do Prezesa Urzędu Ochrony Danych Osobowych.</p>
      <h3 class="mt-6 mb-3 text-lg font-bold">6. Dobrowolność podania danych</h3>
      <p class="mb-4">Podanie danych jest dobrowolne, ale może być konieczne do udzielenia odpowiedzi, obsługi rezerwacji lub wykonania usługi.</p>
      <h3 class="mt-6 mb-3 text-lg font-bold">7. Pliki cookies i technologie podobne</h3>
      <p class="mb-4">Strona może wykorzystywać pliki cookies niezbędne do prawidłowego działania, bezpieczeństwa i zapamiętania ustawień użytkownika. Opcjonalne narzędzia analityczne lub marketingowe mogą być używane wyłącznie zgodnie z konfiguracją zgód na stronie.</p>
    `;
  }

  function renderPrivacyPolicyPage(content, lang) {
    const block = content?.[lang] || content?.pl || {};
    const privacy = block.privacy || {};
    const mode = privacy.mode === 'custom' ? 'custom' : 'default';
    const rawCustom = String(privacy.customText || '').trim();
    const sanitizer =
      typeof window.DFOPS_pageRepository?.sanitizeHtml === 'function'
        ? window.DFOPS_pageRepository.sanitizeHtml
        : function noSanitizer() { return ''; };
    const mainHtml =
      mode === 'custom' && rawCustom
        ? sanitizer(rawCustom)
        : defaultPrivacyPolicyHtml(block);
    const businessName = escapeHtml(block?.settings?.business_name || block?.hero?.name || block?.nav?.logo || 'strony');
    document.title = `Polityka Prywatności — ${businessName}`;
    document.body.className = 'min-h-screen bg-slate-50 text-slate-800 antialiased';
    document.body.innerHTML = `
      <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <a href="/" class="mb-8 inline-flex text-sm font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-900">← Wróć na stronę</a>
        <article class="rounded-2xl border border-gray-200 bg-white p-6 leading-relaxed shadow-sm sm:p-8">
          <div class="prose prose-slate max-w-none">${mainHtml}${infrastructurePrivacyHtml()}</div>
        </article>
      </main>
    `;
  }

  function ensureMetaByName(name, contentAttr) {
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', contentAttr);
  }

  function ensureMetaByProperty(property, contentAttr) {
    let el = document.querySelector(`meta[property="${property}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', property);
      document.head.appendChild(el);
    }
    el.setAttribute('content', contentAttr);
  }

  /**
   * Aktualizacja SEO / Open Graph po stronie klienta (title, description, obraz udostępnień).
   */
  function parseGtmIdForInject(raw) {
    const s = String(raw || '').trim().toUpperCase();
    if (!/^GTM-[A-Z0-9]{4,}$/.test(s)) return '';
    return s;
  }

  function parseFbPixelIdForInject(raw) {
    const s = String(raw || '').trim().replace(/\s+/g, '');
    if (!/^\d{5,24}$/.test(s)) return '';
    return s;
  }

  /**
   * Śledzenie tylko na prawdziwym widoku publicznym — nie w iframe, nie z podglądu panelu (?dfcms_preview=1).
   */
  function isPublicAnalyticsSurface() {
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined') return false;
      if (window.self !== window.top) return false;
      const p = new URLSearchParams(window.location.search || '');
      if (p.get('dfcms_preview') === '1') return false;
    } catch (_) {
      return false;
    }
    return true;
  }

  /**
   * Wstrzyknięcie GTM / Meta Pixel wyłącznie po ID (walidacja jak w pageRepository przy zapisie).
   * consentOpts: analytics → Google Tag Manager; marketing → Meta Pixel (zgodnie z banerem cookies).
   */
  function injectClientAnalytics(content, lang, consentOpts) {
    if (!isPublicAnalyticsSurface()) return;
    if (!content || typeof content !== 'object') return;
    const allowAnalytics = !!(consentOpts && consentOpts.analytics === true);
    const allowMarketing = !!(consentOpts && consentOpts.marketing === true);
    const L = typeof lang === 'string' && content[lang] ? lang : Object.keys(content)[0] || 'pl';
    const analytics = content[L]?.settings?.analytics;
    if (!analytics || typeof analytics !== 'object') return;

    const gtmId = allowAnalytics ? parseGtmIdForInject(analytics.gtm_id) : '';
    const fbId = allowMarketing ? parseFbPixelIdForInject(analytics.fb_pixel_id) : '';
    if (!gtmId && !fbId) return;
    if (!document.head) return;

    if (gtmId && !document.getElementById('dfcms-gtm')) {
      const scr = document.createElement('script');
      scr.id = 'dfcms-gtm';
      scr.textContent =
        "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" +
        gtmId +
        "');";
      document.head.appendChild(scr);

      if (document.body) {
        const ns = document.createElement('noscript');
        ns.id = 'dfcms-gtm-ns';
        const ifr = document.createElement('iframe');
        ifr.src = 'https://www.googletagmanager.com/ns.html?id=' + encodeURIComponent(gtmId);
        ifr.height = '0';
        ifr.width = '0';
        ifr.style.display = 'none';
        ifr.style.visibility = 'hidden';
        ifr.setAttribute('title', 'Google Tag Manager');
        ns.appendChild(ifr);
        document.body.insertBefore(ns, document.body.firstChild);
      }
    }

    if (fbId && !document.getElementById('dfcms-fbq')) {
      const scr = document.createElement('script');
      scr.id = 'dfcms-fbq';
      scr.textContent =
        "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','" +
        fbId +
        "');fbq('track','PageView');";
      document.head.appendChild(scr);
    }
  }

  function applyDocumentSeo(content, lang) {
    const seoData = content?.[lang]?.seo;
    if (!seoData) return;

    const title = seoPlainText(seoData.title);
    if (title) document.title = title;

    const desc = seoPlainText(seoData.description);
    if (desc) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', desc);
      ensureMetaByProperty('og:description', desc);
      ensureMetaByName('twitter:description', desc);
    }

    if (title) {
      ensureMetaByProperty('og:title', title);
      ensureMetaByName('twitter:title', title);
    }

    const og = typeof seoData.ogImage === 'string' ? seoData.ogImage.trim() : '';
    if (og) {
      ensureMetaByProperty('og:image', og);
      ensureMetaByName('twitter:image', og);
      ensureMetaByName('twitter:card', 'summary_large_image');
    }
  }

  function createPublicContentShell() {
    return {
      pl: {
        nav: { logo: '', cta: '', logoImage: '', menu: {} },
        hero: { name: '', headline: '', description: '', button: '', image: '' },
        manifesto: { label: '', title: '', text: '' },
        services: [],
        proof: { label: '', title: '', text: '', statNumber: '', statLabel: '', statDesc: '' },
        /** Opcjonalny grafik (fitness.html): { day, time, note }[] */
        schedule: [],
        gallery: { title: '', images: [] },
        faq: [],
        contact: {
          email: '',
          phone: '',
          address: '',
          booking_url: '',
          bookingUrl: '',
          booksyUrl: '',
          booksyIframeUrl: '',
          map_embed_url: '',
          map_place_id: '',
          whatsapp: '',
          messenger: '',
        },
        social: { linkedin: '', facebook: '', instagram: '', tiktok: '' },
        google_reviews: { embed_url: '', place_query: '', place_id: '', max_reviews: 6, title: 'Opinie z Google' },
        reviews: [],
        seo: { title: '', description: '', ogImage: '' },
        privacy: { mode: 'default', customText: '' },
        legal: { enabled: false, privacy_policy: '', terms: '' },
        settings: {
          analytics: { gtm_id: '', fb_pixel_id: '' },
          showManifesto: true,
          showServices: true,
          showProof: true,
          showGallery: true,
          showGoogleReviews: true,
          showFaq: true,
          showReviews: true,
          showContact: true,
        },
      },
    };
  }

  /**
   * Slug z ?site= (preview / pages.dev) lub subdomeny platformy; inaczej custom_domain klienta.
   * @returns {{ currentSlug: string, currentCustomDomain: string }}
   */
  function resolveSiteContext() {
    const urlParams = new URLSearchParams(window.location.search);
    const siteParam = urlParams.get('site');
    const hostname = normalizeHostname(window.location.hostname);

    let currentSlug = '';
    let currentCustomDomain = '';

    if (siteParam && String(siteParam).trim()) {
      const raw = String(siteParam).trim().toLowerCase();
      if (!raw.includes('://') && !raw.includes('/') && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) {
        currentSlug = raw;
      }
    }

    if (!currentSlug && typeof window.DFOPS_extractTenantSlugFromHostname === 'function') {
      const fromHost = window.DFOPS_extractTenantSlugFromHostname(hostname, normalizeHostname);
      if (fromHost) currentSlug = fromHost;
    }

    if (
      !currentSlug &&
      typeof window.DFOPS_isHostUnderPlatform === 'function' &&
      !window.DFOPS_isHostUnderPlatform(hostname, normalizeHostname)
    ) {
      currentCustomDomain = hostname;
    }

    return { currentSlug, currentCustomDomain };
  }

  const PLATFORM_APEX_HOSTS = {
    'staging.dfopscms.pages.dev': 1,
    'staging.dfcms.pl': 1,
    'dfcms.pl': 1,
    'dfopscms.pl': 1,
    'dfopscms.pages.dev': 1,
    localhost: 1,
    '127.0.0.1': 1,
  };

  function isTenantPublicHost(hostname) {
    if (typeof window.DFOPS_isTenantPublicHostname === 'function') {
      return window.DFOPS_isTenantPublicHostname(hostname, normalizeHostname);
    }
    const h = normalizeHostname(hostname);
    if (!h || PLATFORM_APEX_HOSTS[h]) return false;
    if (h.endsWith('.dfcms.pl') || h.endsWith('.dfopscms.pl')) return true;
    if (h.includes('pages.dev')) return false;
    if (h === 'localhost' || h === '127.0.0.1') return false;
    return true;
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

  /**
   * Po załadowaniu treści: subdomena / custom domain → czysty `/` w pasku (bez /templates/ ani ?site=).
   */
  function cleanTenantPublicUrl(slug) {
    try {
      const u = new URL(window.location.href);
      const h = normalizeHostname(u.hostname);
      if (!isTenantPublicHost(h)) return;

      let changed = false;
      const siteQs = u.searchParams.get('site');
      if (siteQs && String(siteQs).trim()) {
        const siteNorm = String(siteQs).trim().toLowerCase();
        const slugNorm = slug ? String(slug).trim().toLowerCase() : '';
        if (!slugNorm || siteNorm === slugNorm) {
          u.searchParams.delete('site');
          changed = true;
        }
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

  function createPublicSiteApp(expectedTheme) {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;

    const GASTRO_PALETTES = {
      dark_gold: {
        page: 'bg-zinc-900 text-stone-100',
        loaderBg: 'bg-zinc-950',
        loaderSpin: 'border-amber-500',
        loaderText: 'text-amber-500',
        nav: 'bg-zinc-950/90 border-white/10',
        navLink: 'text-stone-400 hover:text-amber-500',
        logo: 'text-amber-500',
        heroOverlay: 'from-zinc-950 via-zinc-950/80 to-zinc-950/30',
        tagline: 'text-amber-400',
        heading: 'text-stone-50',
        name: 'text-amber-500',
        body: 'text-stone-300',
        hoursCard: 'border-amber-500/30 bg-stone-950/70',
        sectionAlt: 'bg-zinc-900/50 border-white/5',
        section: 'bg-zinc-950 border-white/5',
        accentText: 'text-amber-500',
        accentText2: 'text-amber-400',
        accentBg: 'bg-amber-500',
        accentBgHover: 'hover:bg-amber-400',
        btnOnAccent: 'text-zinc-950',
        borderAccent: 'border-amber-500/30',
        borderMuted: 'border-stone-800/80',
        muted: 'text-stone-400',
        itemHover: 'group-hover:text-amber-500 hover:border-amber-500/20',
        mapBorder: 'border-stone-800',
        mapPlaceholder: 'bg-stone-900 text-stone-500',
        footer: 'bg-zinc-950 border-amber-500/20',
        footerTitle: 'text-stone-200',
        footerMuted: 'text-stone-400',
        cookie: 'bg-zinc-950 border-amber-500/20',
        cookieText: 'text-stone-300',
        cookieBtn: 'bg-amber-500 text-zinc-950',
        trialCard: 'border-amber-500/30 bg-stone-900',
      },
      warm_terracotta: {
        page: 'bg-amber-50 text-stone-800',
        loaderBg: 'bg-amber-50',
        loaderSpin: 'border-orange-700',
        loaderText: 'text-orange-700',
        nav: 'bg-amber-50/95 border-orange-200/60',
        navLink: 'text-stone-600 hover:text-orange-700',
        logo: 'text-orange-700',
        heroOverlay: 'from-amber-50 via-amber-50/85 to-stone-900/40',
        tagline: 'text-orange-600',
        heading: 'text-stone-900',
        name: 'text-orange-700',
        body: 'text-stone-600',
        hoursCard: 'border-orange-300 bg-white/80',
        sectionAlt: 'bg-white/60 border-orange-100',
        section: 'bg-amber-50 border-orange-100',
        accentText: 'text-orange-700',
        accentText2: 'text-orange-600',
        accentBg: 'bg-orange-700',
        accentBgHover: 'hover:bg-orange-800',
        btnOnAccent: 'text-white',
        borderAccent: 'border-orange-300',
        borderMuted: 'border-orange-100',
        muted: 'text-stone-500',
        itemHover: 'group-hover:text-orange-700 hover:border-orange-200',
        mapBorder: 'border-orange-200',
        mapPlaceholder: 'bg-white text-stone-500',
        footer: 'bg-amber-100 border-orange-200',
        footerTitle: 'text-stone-800',
        footerMuted: 'text-stone-600',
        cookie: 'bg-white border-orange-200',
        cookieText: 'text-stone-600',
        cookieBtn: 'bg-orange-700 text-white',
        trialCard: 'border-orange-200 bg-white',
      },
      modern_mint: {
        page: 'bg-slate-50 text-slate-800',
        loaderBg: 'bg-slate-50',
        loaderSpin: 'border-emerald-600',
        loaderText: 'text-emerald-800',
        nav: 'bg-slate-50/95 border-slate-200',
        navLink: 'text-slate-600 hover:text-emerald-800',
        logo: 'text-emerald-800',
        heroOverlay: 'from-slate-50 via-slate-50/85 to-slate-900/35',
        tagline: 'text-emerald-700',
        heading: 'text-slate-900',
        name: 'text-emerald-800',
        body: 'text-slate-600',
        hoursCard: 'border-emerald-200 bg-white/85',
        sectionAlt: 'bg-white border-slate-200',
        section: 'bg-slate-50 border-slate-200',
        accentText: 'text-emerald-800',
        accentText2: 'text-emerald-700',
        accentBg: 'bg-emerald-600',
        accentBgHover: 'hover:bg-emerald-700',
        btnOnAccent: 'text-white',
        borderAccent: 'border-emerald-200',
        borderMuted: 'border-slate-200',
        muted: 'text-slate-500',
        itemHover: 'group-hover:text-emerald-800 hover:border-emerald-200',
        mapBorder: 'border-slate-200',
        mapPlaceholder: 'bg-white text-slate-500',
        footer: 'bg-white border-emerald-200',
        footerTitle: 'text-slate-800',
        footerMuted: 'text-slate-600',
        cookie: 'bg-white border-slate-200',
        cookieText: 'text-slate-600',
        cookieBtn: 'bg-emerald-600 text-white',
        trialCard: 'border-emerald-200 bg-white',
      },
      burgundy_noir: {
        page: 'bg-stone-950 text-stone-100',
        loaderBg: 'bg-stone-950',
        loaderSpin: 'border-rose-700',
        loaderText: 'text-rose-400',
        nav: 'bg-stone-950/92 border-rose-900/40',
        navLink: 'text-stone-400 hover:text-rose-400',
        logo: 'text-rose-300',
        heroOverlay: 'from-stone-950 via-stone-950/85 to-rose-950/35',
        tagline: 'text-rose-400',
        heading: 'text-stone-50',
        name: 'text-rose-300',
        body: 'text-stone-300',
        hoursCard: 'border-rose-800/50 bg-stone-900/75',
        sectionAlt: 'bg-stone-900/60 border-rose-900/30',
        section: 'bg-stone-950 border-rose-900/25',
        accentText: 'text-rose-400',
        accentText2: 'text-rose-300',
        accentBg: 'bg-rose-800',
        accentBgHover: 'hover:bg-rose-700',
        btnOnAccent: 'text-white',
        borderAccent: 'border-rose-700/40',
        borderMuted: 'border-stone-800',
        muted: 'text-stone-400',
        itemHover: 'group-hover:text-rose-400 hover:border-rose-800/40',
        mapBorder: 'border-stone-800',
        mapPlaceholder: 'bg-stone-900 text-stone-500',
        footer: 'bg-stone-950 border-rose-900/35',
        footerTitle: 'text-stone-200',
        footerMuted: 'text-stone-400',
        cookie: 'bg-stone-950 border-rose-900/35',
        cookieText: 'text-stone-300',
        cookieBtn: 'bg-rose-800 text-white',
        trialCard: 'border-rose-900/40 bg-stone-900',
      },
      espresso_cream: {
        page: 'bg-amber-50 text-stone-800',
        loaderBg: 'bg-amber-50',
        loaderSpin: 'border-amber-900',
        loaderText: 'text-amber-900',
        nav: 'bg-amber-50/95 border-amber-200/70',
        navLink: 'text-stone-600 hover:text-amber-900',
        logo: 'text-amber-900',
        heroOverlay: 'from-amber-50 via-amber-50/88 to-stone-900/45',
        tagline: 'text-amber-800',
        heading: 'text-stone-900',
        name: 'text-amber-900',
        body: 'text-stone-600',
        hoursCard: 'border-amber-300/80 bg-white/90',
        sectionAlt: 'bg-white/70 border-amber-100',
        section: 'bg-amber-50 border-amber-100',
        accentText: 'text-amber-900',
        accentText2: 'text-amber-800',
        accentBg: 'bg-amber-900',
        accentBgHover: 'hover:bg-amber-950',
        btnOnAccent: 'text-amber-50',
        borderAccent: 'border-amber-300',
        borderMuted: 'border-amber-100',
        muted: 'text-stone-500',
        itemHover: 'group-hover:text-amber-900 hover:border-amber-200',
        mapBorder: 'border-amber-200',
        mapPlaceholder: 'bg-white text-stone-500',
        footer: 'bg-amber-100/80 border-amber-200',
        footerTitle: 'text-stone-800',
        footerMuted: 'text-stone-600',
        cookie: 'bg-white border-amber-200',
        cookieText: 'text-stone-600',
        cookieBtn: 'bg-amber-900 text-amber-50',
        trialCard: 'border-amber-200 bg-white',
      },
    };

    const CARE_PALETTES = {
      medical_blue: {
        page: 'bg-slate-50 text-slate-800',
        loaderBg: 'bg-slate-50',
        loaderSpin: 'border-blue-600',
        loaderText: 'text-blue-600',
        nav: 'bg-white/95 border-slate-200 shadow-sm',
        navLink: 'text-slate-600 hover:text-blue-600',
        logo: 'text-slate-800',
        hero: 'bg-gradient-to-b from-sky-50 to-white',
        tagline: 'text-blue-600',
        heading: 'text-slate-900',
        name: 'text-slate-600',
        body: 'text-slate-600',
        ring: 'ring-blue-600/20',
        section: 'bg-white border-slate-100',
        sectionAlt: 'bg-slate-50',
        card: 'bg-white border-slate-200/80 hover:border-blue-300',
        cardBadge: 'bg-blue-600/10 text-blue-600',
        accentText: 'text-blue-600',
        accentBg: 'bg-blue-600',
        accentBgHover: 'hover:bg-blue-700',
        btnOnAccent: 'text-white',
        shadowCta: 'shadow-blue-600/25',
        muted: 'text-slate-600',
        contact: 'bg-gradient-to-br from-sky-50 via-white to-slate-50 border-slate-100',
        footer: 'bg-white border-slate-200',
        footerMuted: 'text-slate-500',
        cookie: 'bg-white border-slate-200',
        cookieText: 'text-slate-600',
        cookieBtn: 'bg-blue-600 text-white',
        trialCard: 'border-sky-100 bg-white',
        cert: 'bg-sky-50 border-blue-100 text-blue-900',
        mapBorder: 'border-slate-200',
        mapPlaceholder: 'bg-slate-100 text-slate-500',
        borderMuted: 'border-slate-200',
        borderAccent: 'border-blue-200',
      },
      eco_green: {
        page: 'bg-stone-50 text-stone-800',
        loaderBg: 'bg-stone-50',
        loaderSpin: 'border-teal-600',
        loaderText: 'text-teal-700',
        nav: 'bg-stone-50/95 border-stone-200',
        navLink: 'text-stone-600 hover:text-teal-700',
        logo: 'text-stone-800',
        hero: 'bg-gradient-to-b from-teal-50/80 to-stone-50',
        tagline: 'text-teal-700',
        heading: 'text-stone-900',
        name: 'text-stone-600',
        body: 'text-stone-600',
        ring: 'ring-teal-600/20',
        section: 'bg-white border-stone-100',
        sectionAlt: 'bg-stone-50',
        card: 'bg-white border-stone-200 hover:border-teal-300',
        cardBadge: 'bg-teal-600/10 text-teal-700',
        accentText: 'text-teal-700',
        accentBg: 'bg-teal-600',
        accentBgHover: 'hover:bg-teal-700',
        btnOnAccent: 'text-white',
        shadowCta: 'shadow-teal-600/25',
        muted: 'text-stone-600',
        contact: 'bg-gradient-to-br from-teal-50 via-stone-50 to-white border-stone-100',
        footer: 'bg-white border-stone-200',
        footerMuted: 'text-stone-500',
        cookie: 'bg-white border-stone-200',
        cookieText: 'text-stone-600',
        cookieBtn: 'bg-teal-600 text-white',
        trialCard: 'border-teal-100 bg-white',
        cert: 'bg-teal-50 border-teal-100 text-teal-900',
        mapBorder: 'border-stone-200',
        mapPlaceholder: 'bg-stone-100 text-stone-500',
        borderMuted: 'border-stone-200',
        borderAccent: 'border-teal-200',
      },
      elegant_plum: {
        page: 'bg-zinc-50 text-zinc-800',
        loaderBg: 'bg-zinc-50',
        loaderSpin: 'border-purple-800',
        loaderText: 'text-purple-950',
        nav: 'bg-zinc-50/95 border-zinc-200',
        navLink: 'text-zinc-600 hover:text-purple-950',
        logo: 'text-purple-950',
        hero: 'bg-gradient-to-b from-purple-50/50 to-zinc-50',
        tagline: 'text-purple-800',
        heading: 'text-purple-950',
        name: 'text-zinc-600',
        body: 'text-zinc-600',
        ring: 'ring-purple-800/20',
        section: 'bg-white border-zinc-100',
        sectionAlt: 'bg-zinc-50',
        card: 'bg-white border-zinc-200 hover:border-purple-300',
        cardBadge: 'bg-purple-800/10 text-purple-950',
        accentText: 'text-purple-950',
        accentBg: 'bg-purple-800',
        accentBgHover: 'hover:bg-purple-900',
        btnOnAccent: 'text-white',
        shadowCta: 'shadow-purple-800/25',
        muted: 'text-zinc-600',
        contact: 'bg-gradient-to-br from-purple-50/40 via-zinc-50 to-white border-zinc-100',
        footer: 'bg-white border-zinc-200',
        footerMuted: 'text-zinc-500',
        cookie: 'bg-white border-zinc-200',
        cookieText: 'text-zinc-600',
        cookieBtn: 'bg-purple-800 text-white',
        trialCard: 'border-purple-100 bg-white',
        cert: 'bg-purple-50 border-purple-100 text-purple-950',
        mapBorder: 'border-zinc-200',
        mapPlaceholder: 'bg-zinc-100 text-zinc-500',
        borderMuted: 'border-zinc-200',
        borderAccent: 'border-purple-200',
      },
      warm_trust: {
        page: 'bg-stone-50 text-stone-800',
        loaderBg: 'bg-stone-50',
        loaderSpin: 'border-sky-600',
        loaderText: 'text-sky-700',
        nav: 'bg-white/95 border-stone-200 shadow-sm',
        navLink: 'text-stone-600 hover:text-sky-700',
        logo: 'text-stone-800',
        hero: 'bg-gradient-to-b from-amber-50/60 via-sky-50/40 to-stone-50',
        tagline: 'text-sky-700',
        heading: 'text-stone-900',
        name: 'text-stone-600',
        body: 'text-stone-600',
        ring: 'ring-sky-600/20',
        section: 'bg-white border-stone-100',
        sectionAlt: 'bg-stone-50',
        card: 'bg-white border-stone-200 hover:border-sky-300',
        cardBadge: 'bg-sky-600/10 text-sky-700',
        accentText: 'text-sky-700',
        accentBg: 'bg-sky-600',
        accentBgHover: 'hover:bg-sky-700',
        btnOnAccent: 'text-white',
        shadowCta: 'shadow-sky-600/25',
        muted: 'text-stone-600',
        contact: 'bg-gradient-to-br from-amber-50/50 via-sky-50/30 to-white border-stone-100',
        footer: 'bg-white border-stone-200',
        footerMuted: 'text-stone-500',
        cookie: 'bg-white border-stone-200',
        cookieText: 'text-stone-600',
        cookieBtn: 'bg-sky-600 text-white',
        trialCard: 'border-sky-100 bg-white',
        cert: 'bg-sky-50 border-sky-100 text-sky-900',
        mapBorder: 'border-stone-200',
        mapPlaceholder: 'bg-stone-100 text-stone-500',
        borderMuted: 'border-stone-200',
        borderAccent: 'border-sky-200',
      },
      calm_coral: {
        page: 'bg-rose-50/40 text-slate-800',
        loaderBg: 'bg-rose-50',
        loaderSpin: 'border-rose-400',
        loaderText: 'text-rose-600',
        nav: 'bg-white/95 border-rose-100 shadow-sm',
        navLink: 'text-slate-600 hover:text-rose-600',
        logo: 'text-slate-800',
        hero: 'bg-gradient-to-b from-rose-50/80 to-white',
        tagline: 'text-rose-600',
        heading: 'text-slate-900',
        name: 'text-slate-600',
        body: 'text-slate-600',
        ring: 'ring-rose-400/25',
        section: 'bg-white border-rose-100/80',
        sectionAlt: 'bg-rose-50/30',
        card: 'bg-white border-rose-100 hover:border-rose-300',
        cardBadge: 'bg-rose-400/15 text-rose-700',
        accentText: 'text-rose-600',
        accentBg: 'bg-rose-500',
        accentBgHover: 'hover:bg-rose-600',
        btnOnAccent: 'text-white',
        shadowCta: 'shadow-rose-500/25',
        muted: 'text-slate-600',
        contact: 'bg-gradient-to-br from-rose-50 via-white to-slate-50 border-rose-100',
        footer: 'bg-white border-rose-100',
        footerMuted: 'text-slate-500',
        cookie: 'bg-white border-rose-100',
        cookieText: 'text-slate-600',
        cookieBtn: 'bg-rose-500 text-white',
        trialCard: 'border-rose-100 bg-white',
        cert: 'bg-rose-50 border-rose-100 text-rose-900',
        mapBorder: 'border-rose-100',
        mapPlaceholder: 'bg-rose-50 text-slate-500',
        borderMuted: 'border-rose-100',
        borderAccent: 'border-rose-200',
      },
    };

    return {
      lang: 'pl',
      dataLoaded: false,
      billingPlan: 'trial',
      fabBubbleVisible: false,
      content: createPublicContentShell(),
      bazaBlad: false,
      /** Widok publiczny zablokowany (cron trial_blocked_at lub logika shouldBlockPublicPageView). */
      trialBlocked: false,
      /** Podgląd panelu (`dfcms_preview=1`) właściciela mimo blokady publicznej. */
      privatePreviewOnly: false,
      trialBlockedTitle: 'Ta strona jest chwilowo niedostępna',
      trialBlockedBody:
        'Trwają prace techniczne albo witryna jest w aktualizacji. Spróbuj ponownie później — przepraszamy za utrudnienia.',
      /** Opcjonalny drugi akapit (np. podpowiedź dla właściciela). Publicznie zwykle puste — bez wzmianki o płatnościach. */
      trialBlockedAdminHint: '',
      subscriptionPanelUrl: '',
      landingPricingUrl: '',
      theme: expectedTheme,
      slug: null,
      activeModal: null,
      openModal(type) {
        this.activeModal = type;
      },
      closeModal() {
        this.activeModal = null;
      },
      getContentBlock() {
        return this.content?.[this.lang] || {};
      },
      /** Paleta szablonu gastro/care — `content.pl.settings.color_palette` (domyślna per motyw). */
      colorPalette() {
        const s = this.getContentBlock().settings || {};
        const raw = String(s.color_palette || '').trim();
        if (raw) return raw;
        if (this.theme === 'gastro') return 'dark_gold';
        if (this.theme === 'care') return 'medical_blue';
        return '';
      },
      /** Klasy Tailwind dla slotu palety (gastro / care). */
      paletteClass(slot) {
        const p = this.colorPalette();
        const map =
          this.theme === 'gastro'
            ? GASTRO_PALETTES
            : this.theme === 'care'
              ? CARE_PALETTES
              : null;
        if (!map) return '';
        const palette = map[p] || map[Object.keys(map)[0]];
        return palette?.[slot] || '';
      },
      heroCtaEnabled() {
        return this.getContentBlock().hero?.button_enabled !== false;
      },
      footerCtaEnabled() {
        return this.getContentBlock().contact?.cta?.enabled === true;
      },
      /** Smart Booking Module — kanoniczny URL rezerwacji (Calendly / Booksy / inne). */
      resolveBookingUrl() {
        const c = this.getContentBlock().contact || {};
        return String(c.booking_url || c.bookingUrl || c.booksyUrl || '').trim();
      },
      /** Tryb modułu rezerwacji: 'schedule' | 'embed' | 'button' | 'both'. Stare treści bez trybu → inferencja z URL. */
      bookingMode() {
        const raw = String(this.getContentBlock().settings?.booking_mode || '').trim().toLowerCase();
        if (['schedule', 'embed', 'button', 'both'].includes(raw)) return raw;
        const url = this.resolveBookingUrl().toLowerCase();
        if (!url) return 'schedule';
        return url.includes('calendly') ? 'embed' : 'button';
      },
      /** Czy sekcja rezerwacji (embed lub przycisk) jest aktywna — steruje nav-linkiem i sekcją `#rezerwacja`. */
      bookingModuleActive() {
        return this.bookingMode() !== 'schedule' && !!this.resolveBookingUrl();
      },
      showBookingEmbed() {
        return this.bookingMode() === 'embed' && !!this.resolveBookingUrl();
      },
      showBookingButton() {
        const m = this.bookingMode();
        return (m === 'button' || m === 'both') && !!this.resolveBookingUrl();
      },
      resolveCalendlyEmbedUrl(raw) {
        const u = String(raw || '').trim();
        if (!u || !u.toLowerCase().includes('calendly')) return u;
        if (/[?&]embed_type=/i.test(u)) return u;
        return u + (u.includes('?') ? '&' : '?') + 'embed_type=Inline';
      },
      bookingCtaTitle() {
        const c = this.getContentBlock().contact || {};
        return String(c.cta?.title || '').trim() || 'Umów się online';
      },
      bookingCtaDescription() {
        const c = this.getContentBlock().contact || {};
        const url = this.resolveBookingUrl().toLowerCase();
        if (String(c.cta?.description || '').trim()) return c.cta.description;
        if (url.includes('booksy')) return 'Zarezerwuj wizytę w Booksy — wybierz usługę i dogodny termin.';
        return 'Wybierz dogodny termin w zewnętrznym systemie rezerwacji.';
      },
      bookingCtaButtonText() {
        const c = this.getContentBlock().contact || {};
        if (String(c.cta?.button_text || '').trim()) return c.cta.button_text;
        const url = this.resolveBookingUrl().toLowerCase();
        if (url.includes('booksy')) return 'Przejdź do Booksy';
        if (url.includes('calendly')) return 'Otwórz kalendarz';
        return 'Zarezerwuj termin';
      },
      resolveHeroButtonUrl() {
        const c = this.getContentBlock();
        const u = String(
          c.hero?.button_url || c.contact?.bookingUrl || c.contact?.cta?.button_url || c.contact?.booksyUrl || '',
        ).trim();
        return u || '#kontakt';
      },
      resolveFooterCtaUrl() {
        const c = this.getContentBlock();
        const u = String(
          c.contact?.booking_url || c.contact?.bookingUrl || c.contact?.booksyUrl || c.contact?.cta?.button_url || c.hero?.button_url || '',
        ).trim();
        return u || '#kontakt';
      },
      ctaOpensNewTab(url) {
        const u = String(url || '').trim();
        return u.startsWith('http://') || u.startsWith('https://');
      },
      ctaLinkTarget(url) {
        return this.ctaOpensNewTab(url) ? '_blank' : '_self';
      },
      ctaLinkRel(url) {
        return this.ctaOpensNewTab(url) ? 'noopener noreferrer' : null;
      },
      quickChatPlanAllowed() {
        if (typeof window.DFOPS_planAllowsQuickChat === 'function') {
          return window.DFOPS_planAllowsQuickChat(this.billingPlan);
        }
        return String(this.billingPlan || 'trial').trim() !== 'tier0';
      },
      quickChatWhatsApp() {
        if (!this.quickChatPlanAllowed()) return '';
        return String(this.getContentBlock().contact?.whatsapp || '').trim();
      },
      quickChatMessenger() {
        if (!this.quickChatPlanAllowed()) return '';
        return String(this.getContentBlock().contact?.messenger || '').trim();
      },
      quickChatActive() {
        return !!(this.quickChatWhatsApp() || this.quickChatMessenger());
      },
      quickChatHref() {
        const wa = this.quickChatWhatsApp();
        if (wa) {
          const digits = wa.replace(/\D/g, '');
          return digits ? `https://wa.me/${digits}` : '';
        }
        const raw = this.quickChatMessenger();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        const slug = raw.replace(/^@/, '').replace(/^m\.me\//i, '').replace(/\/$/, '');
        return slug ? `https://m.me/${slug}` : '';
      },
      quickChatIsWhatsApp() {
        return !!this.quickChatWhatsApp();
      },
      quickChatLabel() {
        return this.quickChatIsWhatsApp() ? 'Napisz na WhatsApp' : 'Napisz na Messengerze';
      },
      /**
       * Silnik Wzrostu (G1) — jedyny punkt wejścia trackingu konwersji publicznych
       * (tel/rezerwacja/WhatsApp/Messenger/e-mail/mapa). Delegacja do js/core/siteAnalytics.js;
       * brak skryptu / preview → no-op (patrz DFOPS_recordConversionEvent).
       */
      onConversionClick(eventName, source) {
        if (typeof window.DFOPS_recordConversionEvent === 'function') {
          window.DFOPS_recordConversionEvent(eventName, source);
        }
      },
      quickChatFabOffsetClass() {
        if (
          typeof window.DFOPS_planShowsWatermark === 'function' &&
          window.DFOPS_planShowsWatermark(this.billingPlan)
        ) {
          return 'bottom-16 sm:bottom-20';
        }
        return 'bottom-5 sm:bottom-6';
      },
      initQuickChatFab() {
        this.fabBubbleVisible = false;
        if (!this.quickChatActive()) return;
        setTimeout(() => {
          this.fabBubbleVisible = true;
        }, 1400);
      },
      privacyPolicyUrl() {
        const slug = this.slug || this.getSiteSlug();
        const params = new URLSearchParams(window.location.search || '');
        if (slug && params.get('site')) {
          return `/polityka-prywatnosci?site=${encodeURIComponent(slug)}`;
        }
        return '/polityka-prywatnosci';
      },
      injectAnalyticsTracking() {
        try {
          const self = this;
          window.DFOPS__applyAnalyticsConsentNow = function applyAnalyticsConsent() {
            const stored =
              typeof window.DFOPS_getStoredCookieConsent === 'function'
                ? window.DFOPS_getStoredCookieConsent()
                : null;
            const flags = stored
              ? { analytics: !!stored.analytics, marketing: !!stored.marketing }
              : { analytics: false, marketing: false };
            injectClientAnalytics(self.content, self.lang, flags);
          };
          window.DFOPS__applyAnalyticsConsentNow();
        } catch (e) {
          console.warn('DFOPS analytics:', e);
        }
      },
      getSiteSlug() {
        const { currentSlug, currentCustomDomain } = resolveSiteContext();
        return currentSlug || currentCustomDomain || null;
      },
      /** URL do właściwego pliku szablonu (zachowanie hosta: subdomena / custom / apex z ?site=). */
      buildSubscriptionLinks(pageSlug) {
        const slug = pageSlug || this.slug || '';
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const isLocal = (cfg.localHosts || []).includes(window.location.hostname);
        const panel = slug
          ? `${origin}/admin.html?site=${encodeURIComponent(slug)}`
          : `${origin}/admin.html`;
        const appDomain = (cfg.appDomain || 'dfcms.pl').toLowerCase();
        const landing =
          isLocal || origin.includes('localhost')
            ? `${origin}/index.html`
            : `https://${appDomain}/index.html`;
        return { panel, landingCennik: `${landing}#cennik` };
      },
      buildThemePageUrl(page) {
        const host = normalizeHostname(window.location.hostname);
        const isLocal = (cfg.localHosts || []).includes(window.location.hostname);
        const theme = page.theme;
        const slug = page.slug;
        const themePath =
          typeof window.DFOPS_publicHtmlPathForTheme === 'function'
            ? window.DFOPS_publicHtmlPathForTheme(theme)
            : theme === 'setup'
              ? '/setup.html'
              : `/templates/${theme}.html`;

        if (!theme || theme === 'setup') {
          if (!slug) return `${window.location.origin}${themePath || '/setup.html'}`;
          if (isLocal) {
            return `${window.location.origin}/setup.html?site=${encodeURIComponent(slug)}`;
          }
          if (isTenantPublicHost(host)) {
            return `${window.location.protocol}//${window.location.host}/setup.html`;
          }
          return `${window.location.origin}/setup.html?site=${encodeURIComponent(slug)}`;
        }
        if (!slug) return `${window.location.origin}${themePath}`;

        if (isLocal) {
          return `${window.location.origin}/templates/${theme}.html?site=${encodeURIComponent(slug)}`;
        }

        if (isTenantPublicHost(host)) {
          return `${window.location.protocol}//${window.location.host}${themePath}`;
        }

        return `${window.location.origin}/templates/${theme}.html?site=${encodeURIComponent(slug)}`;
      },
      async init() {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const isPreview = urlParams.get('dfcms_preview') === '1';
          const hostname = normalizeHostname(window.location.hostname);
          const { currentSlug, currentCustomDomain } = resolveSiteContext();

          if (!currentSlug && !currentCustomDomain) {
            throw new Error('Brak identyfikatora strony');
          }

          let page = null;
          let isAuthenticatedPreview = false;
          if (currentSlug) {
            if (isPreview && typeof repo.getPageForAuthenticatedPreview === 'function') {
              const ownerRes = await repo.getPageForAuthenticatedPreview(currentSlug);
              if (ownerRes?.error) throw ownerRes.error;
              if (ownerRes?.data) {
                page = ownerRes.data;
                isAuthenticatedPreview = true;
              }
            }
            if (!page) {
              const { data, error } = await repo.getPageBySlug(currentSlug);
              if (error) throw error;
              page = data;
            }
          } else {
            const { data, error } = await repo.getPageByCustomDomain(currentCustomDomain);
            if (error) throw error;
            page = data;
          }

          if (!page) {
            if (isPreview) {
              window.DFOPS__applyAnalyticsConsentNow = function noopAnalyticsConsent() {};
              this.trialBlocked = true;
              this.trialBlockedTitle = 'Podgląd wymaga logowania w panelu';
              this.trialBlockedBody =
                'Wróć do panelu i kliknij „Podgląd prywatny” (otwiera nową kartę z Twoją sesją). Wklejony link bez panelu nie wystarczy. Goście nadal nie widzą strony.';
              this.dataLoaded = true;
              document.title = 'Podgląd niedostępny';
              cleanTenantPublicUrl(currentSlug || '');
              return;
            }
            throw new Error('Brak strony');
          }

          this.slug = page.slug;
          /** Silnik Wzrostu (siteAnalytics.js) czyta slug stąd — bez duplikowania stanu routingu. */
          window.DFOPS_publicSiteAppInstance = this;
          cleanTenantPublicUrl(page.slug);

          const rawPathname = window.location.pathname;
          const onTenantPublicSurface =
            (!!currentSlug || !!currentCustomDomain) &&
            !urlParams.get('site')?.trim() &&
            isTenantPublicHost(hostname);
          const homePaths = ['/', '/index.html', '/index'];
          const onTenantHome =
            onTenantPublicSurface && homePaths.indexOf(rawPathname) !== -1;

          const wouldBlockPublic = shouldBlockPublicPageView(page);
          if (wouldBlockPublic && !(isPreview && isAuthenticatedPreview)) {
            window.DFOPS__applyAnalyticsConsentNow = function noopAnalyticsConsent() {};
            const links = this.buildSubscriptionLinks(page.slug);
            this.subscriptionPanelUrl = links.panel;
            this.landingPricingUrl = links.landingCennik;
            this.trialBlocked = true;
            this.dataLoaded = true;
            document.title = 'Strona chwilowo niedostępna';
            cleanTenantPublicUrl(page.slug);
            return;
          }

          /**
           * Podgląd roboczy (Live Preview): TYLKO gdy `dfcms_preview=1` i zalogowany właściciel/superadmin.
           * Anonimowy gość nigdy tu nie wchodzi (brak sesji → brak rekordu) — publiczna ścieżka bez zmian.
           */
          let previewDraft = null;
          if (isPreview) {
            // 1) Handoff z panelu przez localStorage — działa w nowej karcie niezależnie od
            //    sesji/„Zapamiętaj mnie” (sessionStorage nie jest dziedziczony przez nową kartę).
            //    Tylko przeglądarka właściciela ma ten wpis → szczelne wobec anona.
            try {
              const raw = window.localStorage.getItem('dfops_preview_draft:' + page.slug);
              if (raw) {
                const parsed = JSON.parse(raw);
                const fresh = parsed && parsed.ts && Date.now() - parsed.ts < 30 * 60 * 1000;
                if (fresh && parsed.slug === page.slug && parsed.content && parsed.content.pl) {
                  previewDraft = parsed.content;
                }
              }
            } catch (_) {
              previewDraft = null;
            }
            // 2) Fallback: draft z bazy dla zalogowanego właściciela (gdy handoff niedostępny).
            if (!previewDraft && typeof repo.getDraftContentForOwner === 'function') {
              try {
                const draftRes = await repo.getDraftContentForOwner(page.slug);
                if (draftRes && draftRes.data && draftRes.data.pl) previewDraft = draftRes.data;
              } catch (_) {
                previewDraft = null;
              }
            }
          }

          // Redirect na właściwy motyw tylko poza tenantowym `/`; edge rewrite serwuje szablon bez zmiany URL.
          if (
            !previewDraft &&
            !onTenantHome &&
            expectedTheme &&
            page.theme &&
            page.theme !== expectedTheme
          ) {
            window.location.replace(this.buildThemePageUrl(page));
            return;
          }

          cleanTenantPublicUrl(page.slug);

          const renderSource = previewDraft || page.content;
          this.theme =
            (previewDraft && previewDraft.pl?.settings?.theme && String(previewDraft.pl.settings.theme).trim()) ||
            page.theme ||
            expectedTheme;
          this.content = window.DFOPS_normalizeContent(renderSource, this.theme);
          normalizeEmbedFields(this.content);
          window.DFOPS_applyThemeStyling(this.content?.pl?.settings, this.theme, 'public');

          const userLang = navigator.language.slice(0, 2);
          this.lang = this.content[userLang] ? userLang : (Object.keys(this.content)[0] || 'pl');

          if (isPrivacyPolicyPath()) {
            renderPrivacyPolicyPage(this.content, this.lang);
            return;
          }

          applyDocumentSeo(this.content, this.lang);
          this.billingPlan = page.billing_plan || 'trial';
          if (isPreview && isAuthenticatedPreview && wouldBlockPublic) {
            this.privatePreviewOnly = true;
            const links = this.buildSubscriptionLinks(page.slug);
            injectPrivatePreviewBanner(links.panel);
          }
          initWatermark(this.billingPlan);
          this.injectAnalyticsTracking();
          this.dataLoaded = true;
          this.initQuickChatFab();
          cleanTenantPublicUrl(page.slug);
        } catch (error) {
          console.error('Błąd krytyczny aplikacji:', error);
          this.bazaBlad = true;
          this.dataLoaded = false;
        }
      },

    };
  }

  window.createPublicSiteApp = createPublicSiteApp;
  window.DFOPS_applyDocumentSeo = applyDocumentSeo;
  window.DFOPS_isPublicAnalyticsSurface = isPublicAnalyticsSurface;
  window.DFOPS_injectClientAnalytics = injectClientAnalytics;

  window.addEventListener(
    'consent-updated',
    () => {
      if (typeof window.DFOPS__applyAnalyticsConsentNow === 'function') {
        window.DFOPS__applyAnalyticsConsentNow();
      }
    },
    false
  );
})();

