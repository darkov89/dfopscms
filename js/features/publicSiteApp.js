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
    const billingPlan = String(page.billing_plan || '').trim() || 'trial';
    if (billingPlan === 'tier0' || billingPlan === 'tier1' || billingPlan === 'tier2') {
      return false;
    }
    if (page.trial_blocked_at) return true;
    const bf = page.billing_failed_at;
    if (bf) {
      const bt = new Date(bf).getTime();
      if (Number.isFinite(bt) && Date.now() - bt >= BILLING_FAILED_BLOCK_AFTER_DAYS * MS_PER_DAY) {
        return true;
      }
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
        },
        social: { linkedin: '', facebook: '', instagram: '', tiktok: '' },
        google_reviews: { embed_url: '', place_query: '', place_id: '', max_reviews: 6, title: 'Opinie z Google' },
        reviews: [],
        seo: { title: '', description: '', ogImage: '' },
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
    const hostname = window.location.hostname.replace(/^www\./i, '').toLowerCase();

    let currentSlug = '';
    let currentCustomDomain = '';

    if (siteParam && String(siteParam).trim()) {
      currentSlug = String(siteParam).trim().toLowerCase();
    } else if (
      hostname.includes('dfcms.pl') ||
      hostname.includes('dfopscms.pl') ||
      hostname.includes('localhost') ||
      hostname === '127.0.0.1'
    ) {
      const bareRoots = {
        'dfcms.pl': 1,
        'dfopscms.pl': 1,
        'dfopscms.pages.dev': 1,
        'staging.dfcms.pl': 1,
        localhost: 1,
        '127.0.0.1': 1,
      };
      if (!bareRoots[hostname]) {
        const parts = hostname.split('.');
        if (parts.length > 2 || (hostname.includes('localhost') && parts.length > 1 && parts[0] !== 'localhost')) {
          currentSlug = parts[0].toLowerCase();
        }
      }
    } else if (!hostname.includes('pages.dev')) {
      currentCustomDomain = hostname;
    }

    return { currentSlug, currentCustomDomain };
  }

  /** Po załadowaniu treści usuń ?site= z URL na subdomenie tenantowej (czysty adres w pasku). */
  function cleanTenantPublicUrl(slug) {
    try {
      const u = new URL(window.location.href);
      const siteQs = u.searchParams.get('site');
      if (!siteQs || !String(siteQs).trim()) return;
      const h = u.hostname.replace(/^www\./i, '').toLowerCase();
      const bareRoots = {
        'dfcms.pl': 1,
        'dfopscms.pl': 1,
        'dfopscms.pages.dev': 1,
        'staging.dfcms.pl': 1,
        localhost: 1,
        '127.0.0.1': 1,
      };
      if (bareRoots[h]) return;
      if (!h.endsWith('.dfcms.pl') && !h.endsWith('.dfopscms.pl')) return;
      if (String(siteQs).trim().toLowerCase() !== String(slug || '').trim().toLowerCase()) return;
      u.searchParams.delete('site');
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
      },
    };

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
          return `${window.location.protocol}//${window.location.host}/`;
        }

        if (host !== baseDomain && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith(`.${baseDomain}`)) {
          return `${window.location.protocol}//${window.location.host}/${theme}.html`;
        }

        return `${window.location.origin}/${theme}.html?site=${encodeURIComponent(slug)}`;
      },
      async init() {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const hostname = window.location.hostname.replace(/^www\./i, '').toLowerCase();
          const { currentSlug, currentCustomDomain } = resolveSiteContext();

          if (!currentSlug && !currentCustomDomain) {
            throw new Error('Brak identyfikatora strony');
          }

          let page = null;
          if (currentSlug) {
            const { data, error } = await repo.getPageBySlug(currentSlug);
            if (error) throw error;
            page = data;
          } else {
            const { data, error } = await repo.getPageByCustomDomain(currentCustomDomain);
            if (error) throw error;
            page = data;
          }

          if (!page) throw new Error('Brak strony');

          this.slug = page.slug;
          const onTenantSubdomain =
            !!currentSlug &&
            !currentCustomDomain &&
            !urlParams.get('site')?.trim() &&
            (hostname.includes('dfcms.pl') || hostname.includes('dfopscms.pl')) &&
            hostname !== 'dfcms.pl' &&
            hostname !== 'dfopscms.pl';
          if (shouldBlockPublicPageView(page)) {
            window.DFOPS__applyAnalyticsConsentNow = function noopAnalyticsConsent() {};
            const links = this.buildSubscriptionLinks(page.slug);
            this.subscriptionPanelUrl = links.panel;
            this.landingPricingUrl = links.landingCennik;
            this.trialBlocked = true;
            this.dataLoaded = true;
            document.title = 'Strona chwilowo niedostępna';
            return;
          }

          /**
           * Podgląd roboczy (Live Preview): TYLKO gdy `dfcms_preview=1` i zalogowany właściciel.
           * Anonimowy gość nigdy tu nie wchodzi (brak sesji → brak draftu) — publiczna ścieżka bez zmian.
           */
          const isPreview = urlParams.get('dfcms_preview') === '1';
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

          // Redirect na właściwy plik motywu tylko dla wersji opublikowanej; w podglądzie draftu
          // panel sam wybiera plik wg motywu roboczego (unikamy gubienia parametru dfcms_preview).
          const onTenantHome =
            onTenantSubdomain &&
            (window.location.pathname === '/' ||
              window.location.pathname === '/index.html' ||
              window.location.pathname === '/index');
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

          applyDocumentSeo(this.content, this.lang);
          initWatermark(page.billing_plan || 'trial');
          this.injectAnalyticsTracking();
          this.dataLoaded = true;
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

