;(function () {
  const MS_PER_DAY = 86400000;
  /** Zgodnie z public.expire_trial_pages() — blok po 14 dniach od trial_started_at bez płatności. */
  const TRIAL_PUBLIC_BLOCK_AFTER_DAYS = 14;
  /** Zgodnie z billing_targets w expire_trial_pages — 14 dni po billing_failed_at. */
  const BILLING_FAILED_BLOCK_AFTER_DAYS = 14;

  function paymentCompletedTrue(sub) {
    if (!sub || typeof sub !== 'object') return false;
    const v = sub.payment_completed;
    if (v === true || v === 1 || v === '1' || v === 'true') return true;
    return false;
  }

  /**
   * Czy ukryć treść strony publicznej (bez czekania na cron ustawiający trial_blocked_at).
   * Logika zsynchronizowana z SQL: expire_trial_pages (trial + billing_failed).
   * Uwaga: rezygnacja na koniec okresu w Stripe (`cancel_at_period_end` w JSON) sama w sobie
   * NIE blokuje publikacji — do tego służą trial, billing_failed i trial_blocked_at.
   */
  function shouldBlockPublicPageView(page) {
    if (!page || typeof page !== 'object') return true;
    if (page.trial_blocked_at) return true;
    const bf = page.billing_failed_at;
    if (bf) {
      const bt = new Date(bf).getTime();
      if (Number.isFinite(bt) && Date.now() - bt >= BILLING_FAILED_BLOCK_AFTER_DAYS * MS_PER_DAY) {
        return true;
      }
    }
    const billingPlan = String(page.billing_plan || '').trim() || 'trial';
    if (billingPlan === 'tier0' || billingPlan === 'tier1' || billingPlan === 'tier2') {
      return false;
    }
    const sub = page.content?.pl?.settings?.subscription;
    if (!sub || typeof sub !== 'object') return true;
    const ts = sub.trial_started_at;
    if (ts == null || String(ts).trim() === '') return true;
    const start = new Date(ts).getTime();
    if (!Number.isFinite(start)) return true;
    if (Date.now() - start < TRIAL_PUBLIC_BLOCK_AFTER_DAYS * MS_PER_DAY) return false;
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
        contact: { email: '', phone: '', address: '', booksyUrl: '', map_embed_url: '', map_place_id: '' },
        social: { linkedin: '', facebook: '', instagram: '', tiktok: '' },
        google_reviews: { embed_url: '', place_query: '', max_reviews: 6, title: 'Opinie z Google' },
        reviews: [],
        seo: { title: '', description: '', ogImage: '' },
        legal: { enabled: false, privacy_policy: '', terms: '' },
        settings: {
          analytics: { gtm_id: '', fb_pixel_id: '' },
          showManifesto: true,
          showServices: true,
          showProof: true,
          showFaq: true,
          showReviews: true,
          showContact: true,
        },
      },
    };
  }

  function createPublicSiteApp(expectedTheme) {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    return {
      lang: 'pl',
      dataLoaded: false,
      content: createPublicContentShell(),
      bazaBlad: false,
      /** Widok publiczny zablokowany (cron trial_blocked_at lub logika shouldBlockPublicPageView). */
      trialBlocked: false,
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
        const baseDomain = (cfg.appDomain || 'dfcms.pl').toLowerCase();

        const urlParams = new URLSearchParams(window.location.search);
        const siteParam = urlParams.get('site');
        if (siteParam && String(siteParam).trim()) return String(siteParam).trim();

        const hostname = window.location.hostname.replace(/^www\./, '').toLowerCase();

        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === baseDomain) {
          return null;
        }

        if (hostname.endsWith(`.${baseDomain}`)) {
          const slug = hostname.replace(`.${baseDomain}`, '');
          return slug || null;
        }

        return hostname;
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
        const baseDomain = (cfg.appDomain || 'dfcms.pl').toLowerCase();
        const host = window.location.hostname.replace(/^www\./, '').toLowerCase();
        const isLocal = (cfg.localHosts || []).includes(window.location.hostname);
        const theme = page.theme;
        const slug = page.slug;
        if (!theme || !slug) return `${window.location.origin}/${theme || 'setup'}.html`;

        if (isLocal) {
          return `${window.location.origin}/${theme}.html?site=${encodeURIComponent(slug)}`;
        }

        if (host.endsWith(`.${baseDomain}`) && host !== baseDomain) {
          return `${window.location.protocol}//${window.location.host}/${theme}.html`;
        }

        if (host !== baseDomain && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith(`.${baseDomain}`)) {
          return `${window.location.protocol}//${window.location.host}/${theme}.html`;
        }

        return `${window.location.origin}/${theme}.html?site=${encodeURIComponent(slug)}`;
      },
      async init() {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const hostname = window.location.hostname.replace(/^www\./, '').toLowerCase();
          const baseDomain = (cfg.appDomain || 'dfcms.pl').toLowerCase();
          const hasSiteParam = urlParams.has('site') && urlParams.get('site')?.trim();
          const onTenantSubdomain = hostname.endsWith(`.${baseDomain}`) && hostname !== baseDomain;

          this.slug = this.getSiteSlug();
          if (!this.slug) throw new Error('Brak identyfikatora strony');

          let page = null;
          if (hasSiteParam || onTenantSubdomain) {
            const { data, error } = await repo.getPageBySlug(this.slug);
            if (error) throw error;
            page = data;
          } else {
            const { data, error } = await repo.getPageByCustomDomain(hostname);
            if (error) throw error;
            page = data;
          }

          if (!page) throw new Error('Brak strony');

          this.slug = page.slug;
          if (page.trial_blocked_at || shouldBlockPublicPageView(page)) {
            window.DFOPS__applyAnalyticsConsentNow = function noopAnalyticsConsent() {};
            const links = this.buildSubscriptionLinks(page.slug);
            this.subscriptionPanelUrl = links.panel;
            this.landingPricingUrl = links.landingCennik;
            this.trialBlocked = true;
            this.dataLoaded = true;
            document.title = 'Strona chwilowo niedostępna';
            return;
          }

          if (expectedTheme && page.theme && page.theme !== expectedTheme) {
            window.location.replace(this.buildThemePageUrl(page));
            return;
          }

          this.theme = page.theme || expectedTheme;
          this.content = window.DFOPS_normalizeContent(page.content, this.theme);
          normalizeEmbedFields(this.content);
          window.DFOPS_applyThemeStyling(this.content?.pl?.settings, this.theme, 'public');

          const userLang = navigator.language.slice(0, 2);
          this.lang = this.content[userLang] ? userLang : (Object.keys(this.content)[0] || 'pl');

          applyDocumentSeo(this.content, this.lang);
          initWatermark(page.billing_plan || 'trial');
          this.injectAnalyticsTracking();
          this.dataLoaded = true;
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

