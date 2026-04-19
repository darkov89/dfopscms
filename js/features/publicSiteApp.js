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
    const sub = page.content?.pl?.settings?.subscription;
    if (!sub || typeof sub !== 'object') return false;
    const ts = sub.trial_started_at;
    if (ts == null || String(ts).trim() === '') return false;
    const start = new Date(ts).getTime();
    if (!Number.isFinite(start)) return false;
    if (Date.now() - start < TRIAL_PUBLIC_BLOCK_AFTER_DAYS * MS_PER_DAY) return false;
    if (paymentCompletedTrue(sub)) return false;
    const plan = String(sub.plan || 'trial');
    if (plan === 'trial') return true;
    if (plan === 'tier0' && !paymentCompletedTrue(sub)) return true;
    return false;
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
      /** Widok publiczny zablokowany (pages.trial_blocked_at) — wygasły trial / brak płatności po karencji. */
      trialBlocked: false,
      trialBlockedTitle: 'Strona chwilowo niedostępna',
      trialBlockedBody:
        'Nie możemy wyświetlić treści tej witryny. Zwykle oznacza to zakończony okres próbny bez opłaty albo nieuregulowaną subskrypcję po upływie terminu na zapłatę.',
      trialBlockedAdminHint:
        'Jeśli jesteś administratorem tej strony — zaloguj się do panelu DFCMS. Tam możesz opłacić subskrypcję lub uregulować należność i przywrócić publikację.',
      subscriptionPanelUrl: '',
      landingPricingUrl: '',
      theme: expectedTheme,
      slug: null,
      /** URL iframe z get-google-reviews (embed_for_place_id), gdy brak map_embed_url. */
      mapIframeSrc: '',
      activeModal: null,
      openModal(type) {
        this.activeModal = type;
      },
      closeModal() {
        this.activeModal = null;
      },
      async resolveMapIframeFromPlace() {
        this.mapIframeSrc = '';
        const c = this.content?.[this.lang]?.contact;
        if (!c) return;
        if (String(c.map_embed_url || '').trim()) return;
        const pid = String(c.map_place_id || '').trim();
        if (!pid) return;
        if (!cfg.supabaseAnonKey) return;
        try {
          const sb = window.DFOPS_getSupabaseClient();
          const { data, error } = await sb.functions.invoke('get-google-reviews', {
            body: { embed_for_place_id: pid },
          });
          if (error) {
            console.warn('DFOPS map embed:', error.message || error);
            return;
          }
          if (data?.ok && typeof data.embedUrl === 'string' && data.embedUrl.startsWith('https://')) {
            this.mapIframeSrc = data.embedUrl;
          }
        } catch (e) {
          console.warn('DFOPS resolveMapIframeFromPlace:', e);
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
            const links = this.buildSubscriptionLinks(page.slug);
            this.subscriptionPanelUrl = links.panel;
            this.landingPricingUrl = links.landingCennik;
            this.trialBlocked = true;
            this.dataLoaded = true;
            document.title = 'Chwilowo niedostępna — DFCMS';
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
          initWatermark(this.content?.pl?.settings?.subscription?.plan);
          await this.resolveMapIframeFromPlace();
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
})();

