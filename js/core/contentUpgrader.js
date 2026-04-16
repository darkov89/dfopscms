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

    if (!pl.settings.color_preset) {
      pl.settings.color_preset = theme === 'beauty' ? 'beige' : theme === 'consultant' ? 'dfops-tech' : 'gold';
    }
    if (!pl.settings.background_style) pl.settings.background_style = theme === 'beauty' ? 'soft' : 'glow';
    if (!pl.settings.font_preset) pl.settings.font_preset = theme === 'beauty' ? 'poppins' : 'inter';
    if (!pl.settings.subscription) {
      pl.settings.subscription = { plan: 'trial', trial_started_at: new Date().toISOString() };
    } else {
      if (!pl.settings.subscription.plan) pl.settings.subscription.plan = 'trial';
      if (!pl.settings.subscription.trial_started_at) pl.settings.subscription.trial_started_at = new Date().toISOString();
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
      (sub.plan === 'tier1' || sub.plan === 'tier2') &&
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
    const pricingDefault = theme === 'consultant' ? 'Usługi' : 'Cennik';
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

    if (!pl.contact) pl.contact = {};
    if (!pl.contact.map_embed_url) pl.contact.map_embed_url = '';
    if (pl.contact.map_place_id === undefined || pl.contact.map_place_id === null) pl.contact.map_place_id = '';

    if (!pl.google_reviews) pl.google_reviews = { embed_url: '', place_query: '', max_reviews: 6, title: 'Opinie z Google' };
    if (pl.google_reviews.embed_url === undefined) pl.google_reviews.embed_url = '';
    if (pl.google_reviews.place_query === undefined) pl.google_reviews.place_query = '';
    if (pl.google_reviews.max_reviews === undefined) pl.google_reviews.max_reviews = 6;
    if (pl.google_reviews.title === undefined) pl.google_reviews.title = 'Opinie z Google';

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

    const defaultContactCta = {
      enabled: true,
      title: 'Szybki kalendarz',
      description:
        'Wybierz dogodny termin i umów się na darmową, 15-minutową konsultację wstępną.',
      button_text: 'Wybierz termin na Calendly',
      button_url: 'https://calendly.com/',
    };

    function ensureContactCta(block) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return;
      if (!block.contact) block.contact = {};
      if (!block.contact.cta) {
        block.contact.cta = { ...defaultContactCta };
        return;
      }
      const c = block.contact.cta;
      if (c.enabled === undefined) c.enabled = defaultContactCta.enabled;
      if (c.title === undefined || c.title === null) c.title = defaultContactCta.title;
      if (c.description === undefined || c.description === null) c.description = defaultContactCta.description;
      if (c.button_text === undefined || c.button_text === null) c.button_text = defaultContactCta.button_text;
      if (c.button_url === undefined || c.button_url === null) c.button_url = defaultContactCta.button_url;
    }

    for (const _lang of Object.keys(merged)) {
      ensureSeo(merged[_lang]);
      ensureLegal(merged[_lang]);
      ensureContactCta(merged[_lang]);
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
