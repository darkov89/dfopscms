  /** Pusty szkielet `content` — Alpine nie wywołuje wtedy błędów typu `null.pl` przed `loadData`. */
  function formatResendSignupError(err) {
    if (!err) return 'Nie udało się wysłać maila.';
    if (typeof err !== 'object') return String(err) || 'Nie udało się wysłać maila.';
    const code = err.code || err.name;
    const msg = String(err.message || err.msg || '');
    if (code === 'over_email_send_rate_limit' || msg.includes('over_email_send_rate_limit')) {
      const secMatch = msg.match(/(\d+)\s*seconds?/i);
      const sec = secMatch ? secMatch[1] : 'kilka';
      return `Wysłano już niedawno wiadomość na ten adres. Odczekaj ok. ${sec} s — albo sprawdź skrzynkę (spam).`;
    }
    return msg || 'Nie udało się wysłać maila.';
  }

  /** Czy konto ma ustawione potwierdzenie e-mail (snake_case + camelCase — różne wersje klienta JWT). */
  function userEmailLooksConfirmed(u) {
    if (!u || typeof u !== 'object') return false;
    const ok = (v) => v != null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null';
    return !!(
      ok(u.email_confirmed_at) ||
      ok(u.confirmed_at) ||
      ok(u.emailConfirmedAt) ||
      ok(u.confirmedAt)
    );
  }

  function resendErrorMeansAlreadyConfirmed(err) {
    if (!err || typeof err !== 'object') return false;
    const code = String(err.code || '');
    const msg = String(err.message || '').toLowerCase();
    if (code === 'email_address_already_confirmed') return true;
    return /already confirmed|already verified|already registered|email address is already confirmed/i.test(msg);
  }

  function isNonEmptyContentString(v) {
    return typeof v === 'string' && String(v).trim().length > 0;
  }

  const BOOKING_MODES = new Set(['schedule', 'embed', 'button', 'both']);

  /**
   * Smart Booking: normalizuje `contact.booking_url` (kanoniczne; legacy `bookingUrl`/`booksyUrl`
   * zsynchronizowane) oraz `settings.booking_mode` ('schedule' | 'embed' | 'button' | 'both').
   * Brak trybu (stare treści) → inferencja: Calendly = embed, inny URL = button, pusty = schedule.
   */
  function normalizeBookingSettings(plBlock) {
    if (!plBlock || typeof plBlock !== 'object') return;
    if (!plBlock.contact || typeof plBlock.contact !== 'object') plBlock.contact = {};
    const contact = plBlock.contact;
    const raw = String(contact.booking_url || contact.bookingUrl || contact.booksyUrl || '').trim();
    contact.booking_url = raw;
    contact.bookingUrl = raw;
    contact.booksyUrl = raw;
    contact.booksyIframeUrl = '';
    if (!plBlock.settings || typeof plBlock.settings !== 'object') plBlock.settings = {};
    const mode = String(plBlock.settings.booking_mode || '').trim();
    if (!BOOKING_MODES.has(mode)) {
      plBlock.settings.booking_mode = !raw
        ? 'schedule'
        : (raw.toLowerCase().includes('calendly') ? 'embed' : 'button');
    }
  }

  const WIZARD_STATE_STORAGE_PREFIX = 'dfops_wizard_state_v1:';
  const WIZARD_STATE_VERSION = 2;
  const WIZARD_STEP_COUNT = 6;

  function getThemeSections(theme) {
    if (typeof window.DFOPS_getThemeSections === 'function') {
      return window.DFOPS_getThemeSections(theme);
    }
    return [];
  }

  function themeHasSection(theme, section) {
    if (typeof window.DFOPS_themeHasSection === 'function') {
      return window.DFOPS_themeHasSection(theme, section);
    }
    return false;
  }

  function adminTabVisibleForTheme(theme, tabId) {
    if (typeof window.DFOPS_adminTabVisible === 'function') {
      return window.DFOPS_adminTabVisible(theme, tabId);
    }
    return true;
  }

  function getActiveWizardStepIds(theme) {
    if (typeof window.DFOPS_getActiveWizardStepIds === 'function') {
      return window.DFOPS_getActiveWizardStepIds(theme);
    }
    return ['template', 'brand', 'hero', 'offer', 'about', 'contact'];
  }

  function wizardStepIdAtIndex(theme, index) {
    if (typeof window.DFOPS_wizardStepIdAtIndex === 'function') {
      return window.DFOPS_wizardStepIdAtIndex(theme, index);
    }
    const legacy = ['', 'template', 'brand', 'hero', 'offer', 'about', 'contact'];
    return legacy[index] || 'template';
  }

  function wizardOfferSection(theme) {
    if (typeof window.DFOPS_wizardOfferSection === 'function') {
      return window.DFOPS_wizardOfferSection(theme);
    }
    return themeHasSection(theme, 'services') ? 'services' : null;
  }

  function resolveWizardStepIndex(theme, savedStep) {
    if (typeof window.DFOPS_resolveWizardStepIndex === 'function') {
      return window.DFOPS_resolveWizardStepIndex(theme, savedStep);
    }
    return savedStep;
  }

  /** Zakładki Studia — zgodnie z przyciskami w `admin.html` (hash w URL przy `setTab`). */
  const ADMIN_TAB_IDS = new Set([
    'dashboard',
    'hero',
    'manifesto',
    'services',
    'menu',
    'care_profile',
    'trust',
    'schedule',
    'booking',
    'gallery',
    'contact',
    'faq',
    'google_reviews',
    'reviews',
    'leady',
    'settings',
    'seo',
    'legal',
    'account',
    'subscription',
  ]);

  const THEME_DISPLAY_LABELS = {
    beauty: 'Beauty & Wellness',
    consultant: 'Coaching & Biznes',
    fitness: 'Fitness',
    services: 'Usługi lokalne',
    gastro: 'Gastro',
    care: 'Care',
    setup: 'Konfiguracja',
  };

  /** Stare hashe / aliasy → aktualna zakładka panelu. */
  function normalizeAdminTabId(tab) {
    const id = typeof tab === 'string' ? tab.trim().toLowerCase() : '';
    if (id === 'google_reviews') return 'reviews';
    if (id === 'booking') return 'contact';
    if (id === 'leady') return 'dashboard';
    return id;
  }

  function parseAdminTabFromHash() {
    try {
      const h = window.location.hash;
      if (!h || h === '#') return null;
      let id = h.slice(1).trim();
      if (!id) return null;
      if (id.includes('=')) {
        const p = new URLSearchParams(id);
        const t = (p.get('tab') || '').trim();
        if (t) id = t;
      }
      id = decodeURIComponent(id).trim().toLowerCase();
      if (!id || !/^[a-z][a-z0-9_]*$/.test(id)) return null;
      if (!ADMIN_TAB_IDS.has(id)) return null;
      return normalizeAdminTabId(id);
    } catch {
      return null;
    }
  }

  function replaceAdminUrlHashForTab(tab) {
    try {
      const norm = normalizeAdminTabId(tab);
      if (!norm || !ADMIN_TAB_IDS.has(norm)) return;
      const u = new URL(window.location.href);
      u.hash = norm === 'dashboard' ? '' : `#${encodeURIComponent(norm)}`;
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch {
      /* ignore */
    }
  }

  function normalizePageSlug(raw) {
    const slug = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return '';
    return slug;
  }

  function readWizardStateFromStorage(slug) {
    try {
      if (!slug || typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(WIZARD_STATE_STORAGE_PREFIX + slug);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      let step = Number(data.step);
      const theme = typeof data.theme === 'string' ? data.theme : '';
      if (!Number.isFinite(step) || step < 0 || step > WIZARD_STEP_COUNT) return null;
      if (data.v !== WIZARD_STATE_VERSION && step >= 4) {
        step = WIZARD_STEP_COUNT;
      }
      const normTheme = normalizeWizardTheme(theme);
      if (theme && !getWizardTemplateIds().includes(theme)) return null;
      step = resolveWizardStepIndex(normTheme, step);
      const maxStep = getActiveWizardStepIds(normTheme).length;
      if (step < 0) step = 0;
      if (step > maxStep) step = maxStep;
      return {
        step,
        theme: normTheme,
      };
    } catch {
      return null;
    }
  }

  function writeWizardStateToStorage(slug, step, theme) {
    try {
      if (!slug || typeof localStorage === 'undefined') return;
      localStorage.setItem(
        WIZARD_STATE_STORAGE_PREFIX + slug,
        JSON.stringify({
          v: WIZARD_STATE_VERSION,
          step,
          theme: normalizeWizardTheme(theme),
          ts: Date.now(),
        }),
      );
    } catch {
      /* quota / tryb prywatny */
    }
  }

  function clearWizardStateFromStorage(slug) {
    try {
      if (!slug || typeof localStorage === 'undefined') return;
      localStorage.removeItem(WIZARD_STATE_STORAGE_PREFIX + slug);
    } catch {
      /* ignore */
    }
  }

  /** Przywrócony krok musi być spójny z `pages.theme` (np. nie krok 3–4, gdy szablon w DB wciąż `setup`). */
  function getWizardTemplateIds() {
    if (typeof window.DFOPS_getWizardThemeIds === 'function') {
      return window.DFOPS_getWizardThemeIds();
    }
    return ['beauty', 'consultant', 'fitness', 'services', 'gastro', 'care'];
  }

  function getSwitchableTemplateIds() {
    if (typeof window.DFOPS_getPublishedThemeIds === 'function') {
      return window.DFOPS_getPublishedThemeIds();
    }
    return ['beauty', 'consultant', 'fitness', 'services', 'gastro', 'care'];
  }

  function themeUsesColorPalette(theme) {
    if (typeof window.DFOPS_themeUsesColorPalette === 'function') {
      return window.DFOPS_themeUsesColorPalette(theme);
    }
    const t = String(theme || '').trim().toLowerCase();
    return t === 'gastro' || t === 'care';
  }

  function isPublishedTheme(theme) {
    if (typeof window.DFOPS_isPublishedTheme === 'function') {
      return window.DFOPS_isPublishedTheme(theme);
    }
    return getSwitchableTemplateIds().includes(String(theme || '').trim().toLowerCase());
  }

  /** Ścieżka HTML widoku publicznego — `setup` to root `setup.html`, nie `/templates/`. */
  function publicHtmlPathForTheme(theme) {
    const t = String(theme || '').trim().toLowerCase();
    if (t === 'setup') return '/setup.html';
    if (isPublishedTheme(t)) return `/templates/${t}.html`;
    return '/templates/beauty.html';
  }

  function normalizeWizardTheme(theme) {
    const id = String(theme || '').trim().toLowerCase();
    return getWizardTemplateIds().includes(id) ? id : 'beauty';
  }

  function normalizeWizardRestore(step, wizardTheme, pageTheme) {
    let s = step;
    if (pageTheme === 'setup' && s >= 2) {
      s = 1;
    }
    if (s < 0) s = 0;
    const allowed = new Set(getWizardTemplateIds());
    let wt = 'beauty';
    if (pageTheme && allowed.has(pageTheme)) {
      wt = pageTheme;
    } else if (wizardTheme && allowed.has(wizardTheme)) {
      wt = wizardTheme;
    }
    if (s > 0) {
      s = resolveWizardStepIndex(wt, s);
      const maxStep = getActiveWizardStepIds(wt).length;
      if (s > maxStep) s = maxStep;
    }
    return { step: s, theme: wt };
  }

  const WIZARD_SEO_SUFFIX = {
    beauty: 'salon beauty i zabiegi',
    consultant: 'konsultacje i coaching',
    fitness: 'trening personalny i fitness',
    services: 'usługi lokalne',
    gastro: 'restauracja i menu online',
    care: 'gabinet i opieka zdrowotna',
  };

  function getWizardTemplatePl(theme) {
    const getT = window.DFOPS_getTemplate;
    if (typeof getT !== 'function') return null;
    const resolve =
      typeof window.DFOPS_resolveTemplateKeyForMerge === 'function'
        ? window.DFOPS_resolveTemplateKeyForMerge
        : function (t) {
            return t;
          };
    const base = getT(resolve(theme));
    return base?.pl || null;
  }

  function normWizardText(v) {
    return String(v || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isWizardPlaceholder(current, templateVal) {
    const c = normWizardText(current);
    if (!c) return true;
    const t = normWizardText(templateVal);
    if (t && c === t) return true;
    return false;
  }

  function servicesMatchTemplate(services, tmplServices) {
    if (!Array.isArray(tmplServices) || tmplServices.length === 0) {
      return !Array.isArray(services) || services.length === 0;
    }
    if (!Array.isArray(services) || services.length !== tmplServices.length) return false;
    return services.every((s, i) => {
      const t = tmplServices[i] || {};
      return (
        normWizardText(s?.title) === normWizardText(t.title) &&
        normWizardText(s?.desc) === normWizardText(t.desc) &&
        normWizardText(s?.price) === normWizardText(t.price)
      );
    });
  }

  function schedulesMatchTemplate(schedule, tmplSchedule) {
    if (!Array.isArray(tmplSchedule) || tmplSchedule.length === 0) {
      return !Array.isArray(schedule) || schedule.length === 0;
    }
    if (!Array.isArray(schedule) || schedule.length !== tmplSchedule.length) return false;
    return schedule.every((row, i) => {
      const t = tmplSchedule[i] || {};
      return (
        normWizardText(row?.day) === normWizardText(t.day) &&
        normWizardText(row?.time) === normWizardText(t.time) &&
        normWizardText(row?.note) === normWizardText(t.note)
      );
    });
  }

  function emptyWizardService(theme) {
    return {
      title: '',
      desc: '',
      price: '',
      duration: '',
      details: '',
      icon: theme === 'services' ? 'wrench' : '',
    };
  }

  function emptyWizardMenuItem() {
    return { category: '', name: '', ingredients: '', price: '' };
  }

  function menuItemsMatchTemplate(items, tmplItems) {
    if (!Array.isArray(tmplItems) || tmplItems.length === 0) {
      return !Array.isArray(items) || items.length === 0;
    }
    if (!Array.isArray(items) || items.length !== tmplItems.length) return false;
    return items.every((row, i) => {
      const t = tmplItems[i] || {};
      return (
        normWizardText(row?.name) === normWizardText(t.name) &&
        normWizardText(row?.price) === normWizardText(t.price)
      );
    });
  }

  function prepareWizardMenuStep(pl, theme) {
    const tmpl = getWizardTemplatePl(theme);
    const tmplItems = tmpl?.menu_items;
    if (menuItemsMatchTemplate(pl.menu_items, tmplItems)) {
      pl.menu_items = [emptyWizardMenuItem(), emptyWizardMenuItem()];
    } else if (!Array.isArray(pl.menu_items) || pl.menu_items.length === 0) {
      pl.menu_items = [emptyWizardMenuItem()];
    }
  }

  function syncWizardDerivedFields(pl, theme) {
    if (!pl) return;
    const tmpl = getWizardTemplatePl(theme);
    const name = String(pl.nav?.logo || '').trim();
    if (!pl.settings) pl.settings = {};
    if (!pl.hero) pl.hero = {};
    if (!pl.seo) pl.seo = { title: '', description: '', ogImage: '' };

    if (name) {
      if (isWizardPlaceholder(pl.settings.business_name, tmpl?.settings?.business_name)) {
        pl.settings.business_name = name;
      }
      if (isWizardPlaceholder(pl.hero.name, tmpl?.hero?.name)) {
        pl.hero.name = name;
      }
    }

    const heroDesc = String(pl.hero?.description || '').trim();
    if (heroDesc && isWizardPlaceholder(pl.seo.description, tmpl?.seo?.description)) {
      pl.seo.description = heroDesc;
    }

    const suffix = WIZARD_SEO_SUFFIX[theme] || 'strona firmowa';
    if (name && isWizardPlaceholder(pl.seo.title, tmpl?.seo?.title)) {
      pl.seo.title = `${name} — ${suffix}`;
    }
  }

  function prepareWizardServicesStep(pl, theme) {
    const tmpl = getWizardTemplatePl(theme);
    const tmplServices = tmpl?.services;
    if (servicesMatchTemplate(pl.services, tmplServices)) {
      pl.services = [emptyWizardService(theme), emptyWizardService(theme)];
    } else if (!Array.isArray(pl.services) || pl.services.length === 0) {
      pl.services = [emptyWizardService(theme)];
    }
  }

  function prepareWizardManifestoStep(pl, theme) {
    const tmpl = getWizardTemplatePl(theme);
    if (!pl.manifesto) pl.manifesto = { label: '', title: '', text: '' };
    if (isWizardPlaceholder(pl.manifesto.text, tmpl?.manifesto?.text)) {
      pl.manifesto.text = '';
    }
    if (isWizardPlaceholder(pl.manifesto.title, tmpl?.manifesto?.title)) {
      pl.manifesto.title = '';
    }
  }

  function finalizeWizardContent(pl, theme) {
    if (!pl?.settings) return;
    const tmpl = getWizardTemplatePl(theme);
    syncWizardDerivedFields(pl, theme);

    if (Array.isArray(pl.services)) {
      pl.services = pl.services.filter((s) => normWizardText(s?.title));
    }

    if (themeHasSection(theme, 'menu') && Array.isArray(pl.menu_items)) {
      pl.menu_items = pl.menu_items.filter((row) => normWizardText(row?.name));
    }

    const hasServices =
      Array.isArray(pl.services) && pl.services.some((s) => normWizardText(s?.title));
    if (themeHasSection(theme, 'services')) {
      pl.settings.showServices = hasServices;
    }

    const hasManifesto = !!normWizardText(pl.manifesto?.text);
    pl.settings.showManifesto = hasManifesto;

    const galleryImages = pl.gallery?.images;
    pl.settings.showGallery = Array.isArray(galleryImages) && galleryImages.length > 0;

    const gr = pl.google_reviews || {};
    const hasGoogleReviews =
      String(gr.place_query || gr.embed_url || '').trim().length > 0 ||
      String(pl.contact?.map_place_id || '').trim().length > 0;
    pl.settings.showGoogleReviews = hasGoogleReviews;

    pl.settings.showFaq =
      Array.isArray(pl.faq) && pl.faq.some((f) => normWizardText(f?.q || f?.question));

    if (theme === 'services') {
      const trustQuote = normWizardText(pl.trust?.quote);
      const tmplQuote = normWizardText(tmpl?.trust?.quote);
      if (!trustQuote || trustQuote === tmplQuote) {
        pl.settings.showTrust = false;
      }
    }

    if (theme === 'fitness' && schedulesMatchTemplate(pl.schedule, tmpl?.schedule)) {
      pl.schedule = [];
    }

    const cta = pl.contact?.cta;
    if (cta && typeof cta === 'object') {
      const url = String(cta.button_url || '').trim().toLowerCase();
      if (
        !url ||
        url === 'https://calendly.com/' ||
        url === 'https://calendly.com' ||
        isWizardPlaceholder(cta.button_url, tmpl?.contact?.cta?.button_url)
      ) {
        cta.enabled = false;
        if (!String(pl.contact?.booking_url || '').trim()) {
          cta.button_url = '';
        }
      }
    }

    if (pl.contact) {
      const booking = String(pl.contact.booking_url || pl.contact.bookingUrl || '').trim();
      if (booking) {
        pl.contact.booking_url = booking;
        pl.contact.bookingUrl = booking;
        pl.contact.booksyUrl = booking;
      }
    }

    pl.settings.showReviews = Array.isArray(pl.reviews) && pl.reviews.length > 0;
  }

  function createAdminContentShell() {
    return {
      pl: {
        nav: { logo: '', cta: '', logoImage: '', menu: {} },
        hero: { name: '', headline: '', subheadline: '', description: '', button: '', image: '', qrText: '', qrImage: '' },
        manifesto: { label: '', title: '', text: '' },
        services: [],
        proof: { label: '', title: '', text: '', statNumber: '', statLabel: '', statDesc: '' },
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
          cta: {
            enabled: false,
            title: '',
            description: '',
            button_text: '',
            button_url: '',
          },
        },
        social: { linkedin: '', facebook: '', instagram: '', tiktok: '' },
        google_reviews: {
          embed_url: '',
          place_query: '',
          place_id: '',
          max_reviews: 6,
          title: 'Opinie z Google',
          cached_place_id: '',
          cached_place_rating: null,
          cached_user_rating_count: null,
          google_synced_at: '',
          google_sync_query: '',
        },
        reviews: [],
        schedule: [],
        hours: { title: 'Godziny otwarcia', lines: [] },
        menu_items: [],
        menu_mode: 'manual',
        menu_link: '',
        menu_image: '',
        orders: { label: '', title: '', description: '', call_button: '' },
        help_areas: [],
        certificates: [],
        trust: { title: '', quote: '', author: '', subtitle: '', stars: 5 },
        seo: { title: '', description: '', ogImage: '' },
        privacy: { mode: 'default', customText: '' },
        legal: { enabled: false, privacy_policy: '', terms: '' },
        cookies: { text: '', accept: '' },
        footer: { quote: '', copyright: '', privacy: '' },
        settings: {
          template_version: 1,
          color_preset: 'beige',
          booking_mode: 'schedule',
          analytics: { gtm_id: '', fb_pixel_id: '' },
          subscription: { plan: 'trial', trial_started_at: new Date().toISOString(), selected_plan: null },
          background_style: 'soft',
          font_preset: 'inter',
          darkMode: false,
          showManifesto: true,
          showServices: true,
          showProof: true,
          showGallery: true,
          showGoogleReviews: true,
          showFaq: true,
          showReviews: true,
          showContact: true,
          onboarding_completed: false,
          /** Pusta po pierwszym logowaniu — włącza powitalny modal (Treść → pierwsze pola). */
          business_name: '',
          /** Zapis w Supabase po powicie / zakończeniu touru (Driver.js) — nie pokazuj modala ponownie. */
          welcome_onboarding_completed: false,
          /** Lustrzane odbicie aktywnego motywu strony (`pages.theme`); ustawiane w normalizeContent / saveData. */
          theme: '',
        },
      },
    };
  }

  /** Ciepły komunikat podczas dodawania zdjęć — zależnie od miejsca w panelu. */
  function uploadingMessageFor(section, field) {
    if (section === 'nav' && field === 'logoImage') return 'Chwileczkę, dodaję logo Twojej marki…';
    if (section === 'hero' && field === 'image') return 'Chwileczkę, dodaję Twoje zdjęcie…';
    if (section === 'hero' && field === 'qrImage') return 'Zapisuję ten detal — kod QR…';
    if (section === 'gallery' && field === 'images') return 'Chwileczkę, dodaję zdjęcie do galerii…';
    if (section === 'menu' && field === 'menu_image') return 'Zapisuję zdjęcie Twojego menu…';
    if (section === 'reviews' && field === 'logoImage') return 'Przetwarzam ikonkę przy tej opinii…';
    if (section === 'seo' && field === 'ogImage') return 'Zapisuję obrazek do podglądu w mediach…';
    return 'Chwileczkę, dodaję Twoje zdjęcie…';
  }

  /**
   * URL powrotu z maila resetującego — musi być na liście Redirect URLs w Supabase (dokładnie lub wildcard).
   * Produkcja: kanonicznie https://{appDomain}/admin.html, żeby www / bez www nie psuły walidacji.
   */
  function resolvePasswordResetRedirectUrl() {
    const cfg = window.DFOPS_CONFIG || {};
    const explicit = typeof cfg.passwordResetRedirectUrl === 'string' ? cfg.passwordResetRedirectUrl.trim() : '';
    if (explicit) return explicit;
    if (typeof window === 'undefined' || !window.location) return undefined;
    const origin = window.location.origin;
    const host = (window.location.hostname || '').toLowerCase();
    const isLocal =
      host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || host.endsWith('.localhost');
    const ad = typeof cfg.appDomain === 'string' ? cfg.appDomain.trim().toLowerCase() : '';
    const matchesProd =
      ad && (host === ad || host === `www.${ad}`);
    if (!isLocal && matchesProd && ad) {
      return `https://${ad}/admin.html`;
    }
    return origin ? `${origin.replace(/\/$/, '')}/admin.html` : undefined;
  }

  /** Polityka hasła wyłącznie przy wymuszonym resecie (izolatka). */
  function passwordPolicyErrorForRecovery(pw) {
    const s = String(pw || '').trim();
    if (s.length < 8) return 'Hasło musi mieć co najmniej 8 znaków.';
    if (!/[\p{L}]/u.test(s)) return 'Hasło musi zawierać co najmniej jedną literę.';
    if (!/\d/u.test(s)) return 'Hasło musi zawierać co najmniej jedną cyfrę.';
    return null;
  }
