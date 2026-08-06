// Kontekstowy panel admina i kreator — sekcje per motyw (`pages.theme`).
(function () {
  /**
   * Sekcje dostępne w danym szablonie. Panel i kreator pokazują pola tylko gdy sekcja jest na liście.
   * Identyfikatory wewnętrzne — etykiety dla użytkownika są w osobnych mapach poniżej.
   */
  const THEME_SECTIONS = {
    beauty: [
      'services',
      'manifesto',
      'gallery',
      'faq',
      'google_reviews',
      'booking',
      'contact',
      'qr_code',
      'nav_labels',
    ],
    consultant: [
      'services',
      'proof',
      'faq',
      'reviews',
      'google_reviews',
      'booking',
      'contact',
      'nav_labels',
      'footer_quote',
    ],
    fitness: [
      'services',
      'manifesto',
      'schedule',
      'gallery',
      'faq',
      'google_reviews',
      'booking',
      'contact',
      'nav_labels',
    ],
    services: [
      'services',
      'manifesto',
      'trust',
      'gallery',
      'faq',
      'google_reviews',
      'booking',
      'contact',
      'nav_labels',
    ],
    gastro: ['menu', 'opening_hours', 'orders', 'location', 'contact', 'booking', 'nav_labels'],
    care: [
      'services',
      'manifesto',
      'help_areas',
      'certificates',
      'contact',
      'booking',
      'nav_labels',
    ],
  };

  /** Zakładki panelu — widoczne gdy motyw ma wskazaną sekcję (lub always). */
  const ADMIN_TAB_SECTIONS = {
    hero: { always: true },
    services: { section: 'services' },
    menu: { section: 'menu' },
    trust: { section: 'trust' },
    schedule: { section: 'schedule' },
    booking: { section: 'booking' },
    gallery: { section: 'gallery' },
    contact: { always: true },
    faq: { section: 'faq' },
    google_reviews: { section: 'google_reviews' },
    reviews: { section: 'reviews' },
    care_profile: { anySection: ['help_areas', 'certificates'] },
  };

  /** Pola etykiet w górnym menu strony — per motyw. */
  const NAV_MENU_FIELDS = {
    beauty: [
      { key: 'about', label: 'O nas' },
      { key: 'pricing', label: 'Cennik' },
      { key: 'gallery', label: 'Galeria' },
      { key: 'reviews', label: 'Opinie' },
      { key: 'faq', label: 'Pytania i odpowiedzi' },
      { key: 'contact', label: 'Kontakt' },
    ],
    consultant: [
      { key: 'about', label: 'O nas' },
      { key: 'pricing', label: 'Usługi' },
      { key: 'faq', label: 'Pytania i odpowiedzi' },
      { key: 'reviews', label: 'Opinie' },
      { key: 'contact', label: 'Kontakt' },
    ],
    fitness: [
      { key: 'about', label: 'O mnie' },
      { key: 'pricing', label: 'Treningi' },
      { key: 'schedule', label: 'Grafik' },
      { key: 'gallery', label: 'Galeria' },
      { key: 'reviews', label: 'Opinie' },
      { key: 'faq', label: 'Pytania i odpowiedzi' },
      { key: 'contact', label: 'Kontakt' },
    ],
    services: [
      { key: 'about', label: 'O nas' },
      { key: 'pricing', label: 'Zakres usług' },
      { key: 'gallery', label: 'Realizacje' },
      { key: 'trust', label: 'Zaufanie' },
      { key: 'reviews', label: 'Opinie' },
      { key: 'faq', label: 'Pytania i odpowiedzi' },
      { key: 'contact', label: 'Kontakt' },
    ],
    gastro: [
      { key: 'menu', label: 'Karta dań' },
      { key: 'orders', label: 'Zamówienia' },
      { key: 'location', label: 'Lokalizacja' },
      { key: 'contact', label: 'Kontakt' },
    ],
    care: [
      { key: 'about', label: 'O mnie' },
      { key: 'help', label: 'Obszary pomocy' },
      { key: 'pricing', label: 'Cennik' },
      { key: 'contact', label: 'Kontakt' },
    ],
  };

  const WIZARD_STEP_DEFS = [
    { id: 'template' },
    { id: 'brand' },
    { id: 'hero' },
    { id: 'offer', offerSections: ['services', 'menu'] },
    { id: 'about', section: 'manifesto' },
    { id: 'contact' },
  ];

  const WIZARD_OFFER_COPY = {
    services: {
      title: 'Twoja oferta',
      lead: 'Dodaj usługi, które chcesz pokazać na stronie — minimum jedną pozycję z nazwą.',
      itemLabel: 'Usługa',
      addRow: '+ Dodaj kolejną usługę',
    },
    menu: {
      title: 'Karta dań',
      lead: 'Wpisz dania ręcznie albo uzupełnisz kartę później w panelu — minimum jedna pozycja z nazwą.',
      itemLabel: 'Danie',
      addRow: '+ Dodaj kolejne danie',
    },
  };

  const DEFAULT_SECTIONS = THEME_SECTIONS.beauty;

  function normalizeThemeId(theme) {
    return typeof theme === 'string' ? theme.trim().toLowerCase() : '';
  }

  function getThemeSections(theme) {
    const id = normalizeThemeId(theme);
    return THEME_SECTIONS[id] || DEFAULT_SECTIONS;
  }

  function themeHasSection(theme, section) {
    if (!section) return false;
    return getThemeSections(theme).includes(section);
  }

  function adminTabVisible(theme, tabId) {
    const def = ADMIN_TAB_SECTIONS[tabId];
    if (!def) return true;
    if (def.always) return true;
    if (def.section) return themeHasSection(theme, def.section);
    if (Array.isArray(def.anySection)) {
      return def.anySection.some((s) => themeHasSection(theme, s));
    }
    return false;
  }

  function getNavMenuFields(theme) {
    const id = normalizeThemeId(theme);
    return NAV_MENU_FIELDS[id] || [];
  }

  function getActiveWizardStepIds(theme) {
    const sections = getThemeSections(theme);
    return WIZARD_STEP_DEFS.filter((def) => {
      if (def.id === 'offer') {
        return (def.offerSections || []).some((s) => sections.includes(s));
      }
      if (def.section) return sections.includes(def.section);
      return true;
    }).map((d) => d.id);
  }

  function wizardOfferSection(theme) {
    const sections = getThemeSections(theme);
    if (sections.includes('menu')) return 'menu';
    if (sections.includes('services')) return 'services';
    return null;
  }

  function wizardStepIdAtIndex(theme, index) {
    const steps = getActiveWizardStepIds(theme);
    const i = Number(index);
    if (!Number.isFinite(i) || i < 1 || i > steps.length) return null;
    return steps[i - 1];
  }

  function wizardIndexForStepId(theme, stepId) {
    const steps = getActiveWizardStepIds(theme);
    const idx = steps.indexOf(stepId);
    return idx >= 0 ? idx + 1 : 1;
  }

  /** Migracja zapisanego kroku (stary układ 1–6) na indeks w aktywnych krokach motywu. */
  function resolveWizardStepIndex(theme, savedStep) {
    const legacyIds = ['', 'template', 'brand', 'hero', 'offer', 'about', 'contact'];
    let legacyId = legacyIds[savedStep] || 'template';
    const active = getActiveWizardStepIds(theme);
    if (active.includes(legacyId)) {
      return active.indexOf(legacyId) + 1;
    }
    const legacyOrder = ['template', 'brand', 'hero', 'offer', 'about', 'contact'];
    const legacyPos = legacyOrder.indexOf(legacyId);
    for (let p = legacyPos; p < legacyOrder.length; p++) {
      const candidate = legacyOrder[p];
      if (active.includes(candidate)) return active.indexOf(candidate) + 1;
    }
    return 1;
  }

  function getWizardOfferCopy(theme) {
    const kind = wizardOfferSection(theme);
    return WIZARD_OFFER_COPY[kind] || WIZARD_OFFER_COPY.services;
  }

  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  g.DFOPS_THEME_SECTIONS = THEME_SECTIONS;
  g.DFOPS_getThemeSections = getThemeSections;
  g.DFOPS_themeHasSection = themeHasSection;
  g.DFOPS_adminTabVisible = adminTabVisible;
  g.DFOPS_getNavMenuFields = getNavMenuFields;
  g.DFOPS_getActiveWizardStepIds = getActiveWizardStepIds;
  g.DFOPS_wizardOfferSection = wizardOfferSection;
  g.DFOPS_wizardStepIdAtIndex = wizardStepIdAtIndex;
  g.DFOPS_wizardIndexForStepId = wizardIndexForStepId;
  g.DFOPS_resolveWizardStepIndex = resolveWizardStepIndex;
  g.DFOPS_getWizardOfferCopy = getWizardOfferCopy;
})();
