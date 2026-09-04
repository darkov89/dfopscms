// Reguły kreatora (onboarding) — pure functions, bez Alpine / Supabase UI.
// Wzorzec: js/core/themeConfig.js (IIFE, window.DFOPS_*). SoT: docs/specs/admin-split.md §4.
;(function () {
  const WIZARD_STATE_STORAGE_PREFIX = 'dfops_wizard_state_v1:';
  const WIZARD_STATE_VERSION = 2;
  const WIZARD_STEP_COUNT = 6;

  const WIZARD_TEMPLATE_FALLBACK = ['beauty', 'consultant', 'fitness', 'services', 'gastro', 'care'];

  const WIZARD_SEO_SUFFIX = {
    beauty: 'salon beauty i zabiegi',
    consultant: 'konsultacje i coaching',
    fitness: 'trening personalny i fitness',
    services: 'usługi lokalne',
    gastro: 'restauracja i menu online',
    care: 'gabinet i opieka zdrowotna',
  };

  function themeHasSection(theme, section) {
    if (typeof window.DFOPS_themeHasSection === 'function') {
      return window.DFOPS_themeHasSection(theme, section);
    }
    return false;
  }

  function getActiveWizardStepIds(theme) {
    if (typeof window.DFOPS_getActiveWizardStepIds === 'function') {
      return window.DFOPS_getActiveWizardStepIds(theme);
    }
    return ['template', 'brand', 'hero', 'offer', 'about', 'contact'];
  }

  function resolveWizardStepIndex(theme, savedStep) {
    if (typeof window.DFOPS_resolveWizardStepIndex === 'function') {
      return window.DFOPS_resolveWizardStepIndex(theme, savedStep);
    }
    return savedStep;
  }

  function wizardOfferSection(theme) {
    if (typeof window.DFOPS_wizardOfferSection === 'function') {
      return window.DFOPS_wizardOfferSection(theme);
    }
    return themeHasSection(theme, 'services') ? 'services' : null;
  }

  function getWizardTemplateIds() {
    if (typeof window.DFOPS_getWizardThemeIds === 'function') {
      return window.DFOPS_getWizardThemeIds();
    }
    return WIZARD_TEMPLATE_FALLBACK.slice();
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

  function resolveWizardStorage(storage) {
    if (storage && typeof storage.getItem === 'function') return storage;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_) {
      /* tryb prywatny */
    }
    return null;
  }

  function readWizardStateFromStorage(slug, storage) {
    try {
      const store = resolveWizardStorage(storage);
      if (!slug || !store) return null;
      const raw = store.getItem(WIZARD_STATE_STORAGE_PREFIX + slug);
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

  function writeWizardStateToStorage(slug, step, theme, storage) {
    try {
      const store = resolveWizardStorage(storage);
      if (!slug || !store) return;
      store.setItem(
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

  function clearWizardStateFromStorage(slug, storage) {
    try {
      const store = resolveWizardStorage(storage);
      if (!slug || !store) return;
      store.removeItem(WIZARD_STATE_STORAGE_PREFIX + slug);
    } catch {
      /* ignore */
    }
  }

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
    if (isWizardPlaceholder(pl.manifesto.label, tmpl?.manifesto?.label)) {
      pl.manifesto.label = '';
    }
  }

  function prepareWizardHeroStep(pl, theme) {
    const tmpl = getWizardTemplatePl(theme);
    if (!pl.hero) pl.hero = {};
    if (isWizardPlaceholder(pl.hero.headline, tmpl?.hero?.headline)) {
      pl.hero.headline = '';
    } else if (pl.hero.headline) {
      pl.hero.headline = String(pl.hero.headline).replace(/<[^>]*>/g, '').trim();
    }
    if (isWizardPlaceholder(pl.hero.description, tmpl?.hero?.description)) {
      pl.hero.description = '';
    }
  }

  function wizardStepSkippable(stepId) {
    return stepId === 'offer' || stepId === 'about';
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

  /**
   * Walidacja kroku kreatora. Zwraca komunikat błędu albo null (OK).
   * @param {object|null} pl
   * @param {string} theme
   * @param {string} stepId
   * @returns {string|null}
   */
  function validateWizardStep(pl, theme, stepId) {
    if (!pl) return null;
    if (stepId === 'template') {
      if (!getWizardTemplateIds().includes(theme)) {
        return 'Wybierz szablon branżowy.';
      }
    }
    if (stepId === 'brand') {
      if (!String(pl.nav?.logo || '').trim()) {
        return 'Podaj nazwę firmy — wyświetli się w menu i buduje rozpoznawalność marki.';
      }
    }
    if (stepId === 'hero') {
      const tmpl = getWizardTemplatePl(theme);
      if (isWizardPlaceholder(pl.hero?.headline, tmpl?.hero?.headline)) {
        return 'Podaj główne hasło na stronie — zastąp przykładowy tekst z szablonu.';
      }
      if (isWizardPlaceholder(pl.hero?.description, tmpl?.hero?.description)) {
        return 'Napisz krótki opis pod nagłówkiem — goście muszą wiedzieć, czym się zajmujesz.';
      }
    }
    if (stepId === 'offer') {
      const offerKind = wizardOfferSection(theme);
      if (offerKind === 'menu') {
        const hasMenu =
          Array.isArray(pl.menu_items) && pl.menu_items.some((row) => normWizardText(row?.name));
        if (!hasMenu) {
          return 'Dodaj co najmniej jedno danie z nazwą — goście muszą wiedzieć, co serwujesz.';
        }
      } else {
        const hasService =
          Array.isArray(pl.services) && pl.services.some((s) => normWizardText(s?.title));
        if (!hasService) {
          return 'Dodaj co najmniej jedną usługę z nazwą — klienci muszą wiedzieć, co oferujesz.';
        }
      }
    }
    if (stepId === 'about') {
      if (!normWizardText(pl.manifesto?.text)) {
        return 'Napisz kilka zdań o sobie lub swojej firmie — sekcja „O nas” nie może zostać pusta.';
      }
    }
    if (stepId === 'contact') {
      const phone = String(pl.contact?.phone || '').trim();
      const email = String(pl.contact?.email || '').trim();
      if (!phone && !email) {
        return 'Podaj numer telefonu lub e-mail — klienci muszą mieć sposób kontaktu.';
      }
    }
    return null;
  }

  window.DFOPS_WIZARD_STATE_STORAGE_PREFIX = WIZARD_STATE_STORAGE_PREFIX;
  window.DFOPS_WIZARD_STATE_VERSION = WIZARD_STATE_VERSION;
  window.DFOPS_WIZARD_STEP_COUNT = WIZARD_STEP_COUNT;
  window.DFOPS_getWizardTemplateIds = getWizardTemplateIds;
  window.DFOPS_normalizeWizardTheme = normalizeWizardTheme;
  window.DFOPS_normalizeWizardRestore = normalizeWizardRestore;
  window.DFOPS_readWizardStateFromStorage = readWizardStateFromStorage;
  window.DFOPS_writeWizardStateToStorage = writeWizardStateToStorage;
  window.DFOPS_clearWizardStateFromStorage = clearWizardStateFromStorage;
  window.DFOPS_getWizardTemplatePl = getWizardTemplatePl;
  window.DFOPS_normWizardText = normWizardText;
  window.DFOPS_isWizardPlaceholder = isWizardPlaceholder;
  window.DFOPS_servicesMatchTemplate = servicesMatchTemplate;
  window.DFOPS_schedulesMatchTemplate = schedulesMatchTemplate;
  window.DFOPS_menuItemsMatchTemplate = menuItemsMatchTemplate;
  window.DFOPS_emptyWizardService = emptyWizardService;
  window.DFOPS_emptyWizardMenuItem = emptyWizardMenuItem;
  window.DFOPS_prepareWizardMenuStep = prepareWizardMenuStep;
  window.DFOPS_prepareWizardServicesStep = prepareWizardServicesStep;
  window.DFOPS_prepareWizardManifestoStep = prepareWizardManifestoStep;
  window.DFOPS_prepareWizardHeroStep = prepareWizardHeroStep;
  window.DFOPS_syncWizardDerivedFields = syncWizardDerivedFields;
  window.DFOPS_wizardStepSkippable = wizardStepSkippable;
  window.DFOPS_finalizeWizardContent = finalizeWizardContent;
  window.DFOPS_validateWizardStep = validateWizardStep;
})();
