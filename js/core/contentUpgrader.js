;(function () {
  /**
   * Pełna normalizacja contentu pod dany motyw: merge z szablonem + domyślne pola
   * (settings, contact, social, google_reviews, menu beauty itd.).
   * Sygnatura: (content, theme) — spójna z panelem admina.
   */
  function normalizeContent(content, theme) {
    const merged = window.DFOPS_mergeContentWithTemplate(theme, content);
    const pl = merged.pl;
    if (!pl) merged.pl = {};
    if (!pl.settings) pl.settings = {};

    /** Spójne z kolumną `pages.theme` i panelem — zapis w Supabase w `saveData`. */
    pl.settings.theme = typeof theme === 'string' ? theme : '';

    /**
     * Nazwa marki w panelu (onboarding). Puste = pierwsza konfiguracja (powitalny modal).
     * Treści zapisane przed tym polem: jeśli kreator już był ukończony, wstawiamy z logo nawigacji.
     */
    if (pl.settings.business_name === undefined || pl.settings.business_name === null) {
      if (pl.settings.onboarding_completed === true) {
        pl.settings.business_name = String(pl.nav?.logo || '').trim();
      } else {
        pl.settings.business_name = '';
      }
    }

    if (
      pl.settings.welcome_onboarding_completed === undefined ||
      pl.settings.welcome_onboarding_completed === null
    ) {
      const bnM = String(pl.settings.business_name || '').trim();
      pl.settings.welcome_onboarding_completed =
        pl.settings.onboarding_completed === true || bnM.length > 0;
    }

    if (!pl.settings.color_preset) {
      pl.settings.color_preset =
        theme === 'beauty'
          ? 'beige'
          : theme === 'consultant'
            ? 'dfops-tech'
            : theme === 'fitness'
              ? 'neon-lime'
              : theme === 'services'
                ? 'trades-navy'
                : 'gold';
    }
    if (!pl.settings.background_style) {
      pl.settings.background_style = theme === 'beauty' ? 'soft' : theme === 'services' ? 'clean' : 'glow';
    }
    if (!pl.settings.font_preset) {
      pl.settings.font_preset = theme === 'beauty' ? 'poppins' : 'inter';
    }
    if (!pl.settings.subscription) {
      pl.settings.subscription = { plan: 'trial', trial_started_at: new Date().toISOString() };
    } else {
      if (!pl.settings.subscription.plan) pl.settings.subscription.plan = 'trial';
      if (!pl.settings.subscription.trial_started_at) pl.settings.subscription.trial_started_at = new Date().toISOString();
    }
    if (!pl.settings.analytics || typeof pl.settings.analytics !== 'object') {
      pl.settings.analytics = { gtm_id: '', fb_pixel_id: '' };
    } else {
      if (pl.settings.analytics.gtm_id === undefined || pl.settings.analytics.gtm_id === null) {
        pl.settings.analytics.gtm_id = '';
      }
      if (pl.settings.analytics.fb_pixel_id === undefined || pl.settings.analytics.fb_pixel_id === null) {
        pl.settings.analytics.fb_pixel_id = '';
      }
    }

    const sub = pl.settings.subscription;
    if (sub.payment_completed === 'true' || sub.payment_completed === 1 || sub.payment_completed === '1') {
      sub.payment_completed = true;
    } else if (
      sub.payment_completed === 'false' ||
      sub.payment_completed === 0 ||
      sub.payment_completed === '0'
    ) {
      sub.payment_completed = false;
    }
    if (
      (sub.plan === 'tier1' || sub.plan === 'tier2') && /* tier2: legacy → Standard */
      (sub.payment_completed === undefined || sub.payment_completed === null)
    ) {
      sub.payment_completed = true;
    }
    if (sub.plan === 'tier0' && sub.payment_completed !== true) {
      sub.selected_plan = sub.selected_plan || 'tier0';
      sub.plan = 'trial';
    }

    if (!pl.nav) pl.nav = {};
    /*
     * Motyw `setup`: panel ma pola menu pod x-show dla beauty/consultant, ale Alpine i tak
     * inicjalizuje x-model — bez pełnego obiektu menu leci TypeError (reading 'about').
     */
    if (!pl.nav.menu || typeof pl.nav.menu !== 'object' || Array.isArray(pl.nav.menu)) {
      pl.nav.menu = {};
    }
    const pricingDefault = theme === 'consultant' ? 'Usługi' : theme === 'services' ? 'Zakres usług' : 'Cennik';
    const menuDefaults = {
      about: 'O nas',
      pricing: pricingDefault,
      gallery: 'Galeria',
      faq: 'Pytania i odpowiedzi (Q&A)',
      contact: 'Kontakt',
      reviews: 'Opinie',
    };
    for (const k of Object.keys(menuDefaults)) {
      if (pl.nav.menu[k] === undefined || pl.nav.menu[k] === null) {
        pl.nav.menu[k] = menuDefaults[k];
      }
    }
    if (theme === 'beauty') {
      if (!pl.nav.menu) {
        pl.nav.menu = { about: 'O nas', pricing: 'Cennik', gallery: 'Galeria', faq: 'Pytania i odpowiedzi (Q&A)', contact: 'Kontakt', reviews: 'Opinie' };
      }
      if (pl.nav.menu.about === undefined) pl.nav.menu.about = 'O nas';
      if (pl.nav.menu.pricing === undefined) pl.nav.menu.pricing = 'Cennik';
      if (pl.nav.menu.gallery === undefined) pl.nav.menu.gallery = 'Galeria';
      if (pl.nav.menu.faq === undefined) pl.nav.menu.faq = 'Pytania i odpowiedzi (Q&A)';
      if (pl.nav.menu.contact === undefined) pl.nav.menu.contact = 'Kontakt';
      if (pl.nav.menu.reviews === undefined) pl.nav.menu.reviews = 'Opinie';
    }
    if (theme === 'consultant') {
      if (!pl.nav.menu) {
        pl.nav.menu = { about: 'O nas', pricing: 'Usługi', faq: 'Pytania i odpowiedzi (Q&A)', reviews: 'Opinie', contact: 'Kontakt' };
      }
      if (pl.nav.menu.about === undefined) pl.nav.menu.about = 'O nas';
      if (pl.nav.menu.pricing === undefined) pl.nav.menu.pricing = 'Usługi';
      if (pl.nav.menu.faq === undefined) pl.nav.menu.faq = 'Pytania i odpowiedzi (Q&A)';
      if (pl.nav.menu.reviews === undefined) pl.nav.menu.reviews = 'Opinie';
      if (pl.nav.menu.contact === undefined) pl.nav.menu.contact = 'Kontakt';
    }
    if (theme === 'fitness') {
      if (!pl.nav.menu) {
        pl.nav.menu = {
          about: 'O mnie',
          pricing: 'Treningi',
          schedule: 'Grafik',
          gallery: 'Galeria',
          faq: 'FAQ',
          contact: 'Kontakt',
          reviews: 'Opinie',
        };
      }
      if (pl.nav.menu.about === undefined) pl.nav.menu.about = 'O mnie';
      if (pl.nav.menu.pricing === undefined) pl.nav.menu.pricing = 'Treningi';
      if (pl.nav.menu.schedule === undefined) pl.nav.menu.schedule = 'Grafik';
      if (pl.nav.menu.gallery === undefined) pl.nav.menu.gallery = 'Galeria';
      if (pl.nav.menu.faq === undefined) pl.nav.menu.faq = 'FAQ';
      if (pl.nav.menu.contact === undefined) pl.nav.menu.contact = 'Kontakt';
      if (pl.nav.menu.reviews === undefined) pl.nav.menu.reviews = 'Opinie';
    }
    if (theme === 'services') {
      if (!pl.nav.menu) {
        pl.nav.menu = {
          about: 'O nas',
          pricing: 'Zakres usług',
          gallery: 'Realizacje',
          trust: 'Zaufanie',
          faq: 'FAQ',
          contact: 'Kontakt',
          reviews: 'Opinie',
        };
      }
      if (pl.nav.menu.about === undefined) pl.nav.menu.about = 'O nas';
      if (pl.nav.menu.pricing === undefined) pl.nav.menu.pricing = 'Zakres usług';
      if (pl.nav.menu.gallery === undefined) pl.nav.menu.gallery = 'Realizacje';
      if (pl.nav.menu.trust === undefined) pl.nav.menu.trust = 'Zaufanie';
      if (pl.nav.menu.faq === undefined) pl.nav.menu.faq = 'FAQ';
      if (pl.nav.menu.contact === undefined) pl.nav.menu.contact = 'Kontakt';
      if (pl.nav.menu.reviews === undefined) pl.nav.menu.reviews = 'Opinie';
    }
    if (theme === 'services' && (pl.nav.cta === undefined || pl.nav.cta === null)) {
      pl.nav.cta = 'Zadzwoń';
    }

    if (!pl.trust || typeof pl.trust !== 'object' || Array.isArray(pl.trust)) {
      pl.trust = { title: '', quote: '', author: '', subtitle: '', stars: 5 };
    } else {
      if (pl.trust.title === undefined) pl.trust.title = '';
      if (pl.trust.quote === undefined) pl.trust.quote = '';
      if (pl.trust.author === undefined) pl.trust.author = '';
      if (pl.trust.subtitle === undefined) pl.trust.subtitle = '';
      if (pl.trust.stars === undefined || pl.trust.stars === null) pl.trust.stars = 5;
    }
    if (theme === 'services' && (pl.settings.showTrust === undefined || pl.settings.showTrust === null)) {
      pl.settings.showTrust = true;
    }

    if (!Array.isArray(pl.schedule)) pl.schedule = [];

    if (!pl.contact) pl.contact = {};
    if (!pl.contact.map_embed_url) pl.contact.map_embed_url = '';
    if (pl.contact.map_place_id === undefined || pl.contact.map_place_id === null) pl.contact.map_place_id = '';

    if (!pl.google_reviews) pl.google_reviews = { embed_url: '', place_query: '', max_reviews: 6, title: 'Opinie z Google' };
    if (pl.google_reviews.embed_url === undefined) pl.google_reviews.embed_url = '';
    if (pl.google_reviews.place_query === undefined) pl.google_reviews.place_query = '';
    if (pl.google_reviews.place_id === undefined || pl.google_reviews.place_id === null) {
      pl.google_reviews.place_id = '';
    }
    if (pl.google_reviews.max_reviews === undefined) pl.google_reviews.max_reviews = 6;
    if (pl.google_reviews.title === undefined) pl.google_reviews.title = 'Opinie z Google';
    if (pl.google_reviews.cached_place_id === undefined) pl.google_reviews.cached_place_id = '';
    if (pl.google_reviews.cached_place_rating === undefined) pl.google_reviews.cached_place_rating = null;
    if (pl.google_reviews.cached_user_rating_count === undefined) pl.google_reviews.cached_user_rating_count = null;
    if (pl.google_reviews.google_synced_at === undefined) pl.google_reviews.google_synced_at = '';
    if (pl.google_reviews.google_sync_query === undefined) pl.google_reviews.google_sync_query = '';

    if (!pl.gallery) pl.gallery = { title: 'Nasze realizacje', images: [] };
    if (!Array.isArray(pl.gallery.images)) pl.gallery.images = [];
    if (pl.gallery.title === undefined || pl.gallery.title === null) pl.gallery.title = 'Nasze realizacje';

    if (!pl.social) pl.social = {};
    if (pl.social.facebook === undefined) pl.social.facebook = '';
    if (pl.social.instagram === undefined) pl.social.instagram = '';
    if (pl.social.tiktok === undefined) pl.social.tiktok = '';

    function ensureSeo(block) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return;
      if (!block.seo) {
        block.seo = { title: '', description: '', ogImage: '' };
      } else {
        if (block.seo.title === undefined || block.seo.title === null) block.seo.title = '';
        if (block.seo.description === undefined || block.seo.description === null) block.seo.description = '';
        if (block.seo.ogImage === undefined || block.seo.ogImage === null) block.seo.ogImage = '';
      }
    }

    function ensureLegal(block) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return;
      if (!block.legal) block.legal = { enabled: true, privacy_policy: '', terms: '' };
      if (block.legal.enabled === undefined) block.legal.enabled = true;
      if (block.legal.privacy_policy === undefined) block.legal.privacy_policy = '';
      if (block.legal.terms === undefined) block.legal.terms = '';
    }

    const contactCtaDefaultsByTheme = {
      consultant: {
        enabled: true,
        title: 'Szybki kalendarz',
        description:
          'Wybierz dogodny termin i umów się na darmową, 15-minutową konsultację wstępną.',
        button_text: 'Wybierz termin na Calendly',
        button_url: 'https://calendly.com/',
      },
      beauty: {
        enabled: false,
        title: 'Umów się wygodnie',
        description: '',
        button_text: 'Przejdź do Booksy',
        button_url: '',
      },
      fitness: {
        enabled: false,
        title: 'Umów się wygodnie',
        description: '',
        button_text: 'Przejdź do Booksy',
        button_url: '',
      },
      services: {
        enabled: false,
        title: 'Szybki kontakt',
        description: '',
        button_text: 'Rezerwacja online',
        button_url: '',
      },
    };

    function ensureContactCta(block, contentTheme) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return;
      if (!block.contact) block.contact = {};
      const defaults =
        contactCtaDefaultsByTheme[contentTheme] || contactCtaDefaultsByTheme.consultant;
      if (!block.contact.cta) {
        block.contact.cta = { ...defaults };
      }
      const c = block.contact.cta;
      if (c.enabled === undefined) c.enabled = defaults.enabled;
      if (c.title === undefined || c.title === null) c.title = defaults.title;
      if (c.description === undefined || c.description === null) c.description = defaults.description;
      if (c.button_text === undefined || c.button_text === null) c.button_text = defaults.button_text;
      if (c.button_url === undefined || c.button_url === null) c.button_url = defaults.button_url;

      const booksy = String(block.contact.booksyUrl || '').trim();
      if (booksy) {
        if (!String(c.button_url || '').trim()) c.button_url = booksy;
        if (!block.hero) block.hero = {};
        if (!String(block.hero.button_url || '').trim()) block.hero.button_url = booksy;
      }
    }

    function ensureHeroButton(block) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return;
      if (!block.hero) block.hero = {};
      if (block.hero.button_enabled === undefined) block.hero.button_enabled = true;
      if (block.hero.button_url === undefined || block.hero.button_url === null) {
        block.hero.button_url = '';
      }
    }

    for (const _lang of Object.keys(merged)) {
      ensureSeo(merged[_lang]);
      ensureLegal(merged[_lang]);
      ensureContactCta(merged[_lang], theme);
      ensureHeroButton(merged[_lang]);
    }

    return merged;
  }

  function upgradeContent(theme, content, targetVersion) {
    const normalized = normalizeContent(content, theme);
    if (!normalized.pl) normalized.pl = {};
    if (!normalized.pl.settings) normalized.pl.settings = {};
    normalized.pl.settings.template_version = targetVersion || window.DFOPS_LATEST_TEMPLATE_VERSION || 1;
    return normalized;
  }

  window.DFOPS_normalizeContent = normalizeContent;
  window.DFOPS_upgradeContent = upgradeContent;
})();
