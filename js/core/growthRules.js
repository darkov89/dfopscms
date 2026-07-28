// Silnik Wzrostu (G0) — reguły branżowe + kontekst ewaluacji. Warstwa domenowa: PURE
// functions, bez Alpine, bez Supabase (patrz docs/specs/growth.md §6, §14.2).
// Wzorzec: js/core/themeConfig.js (IIFE, window.DFOPS_*).
;(function () {
  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function nonEmpty(v) {
    return str(v).length > 0;
  }

  function themeHasSectionSafe(theme, section) {
    return typeof window.DFOPS_themeHasSection === 'function'
      ? window.DFOPS_themeHasSection(theme, section)
      : false;
  }

  /** Spójne z publicSiteApp.bookingModuleActive(): tryb ≠ 'schedule' i jest URL. */
  function resolveBookingActive(pl) {
    const contact = (pl && pl.contact) || {};
    const mode = str(pl && pl.settings && pl.settings.booking_mode) || 'schedule';
    const url = str(contact.booking_url || contact.bookingUrl || contact.booksyUrl);
    return mode !== 'schedule' && !!url;
  }

  function resolveHasOffer(theme, pl) {
    if (themeHasSectionSafe(theme, 'menu')) {
      return Array.isArray(pl && pl.menu_items) && pl.menu_items.some((row) => row && nonEmpty(row.name));
    }
    return Array.isArray(pl && pl.services) && pl.services.some((s) => s && nonEmpty(s.title));
  }

  function benchmarkValue(ctx, key) {
    if (!key) return null;
    const v = ctx.benchmarks ? ctx.benchmarks[key] : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function benchmarkSentence(ctx, key, suffix) {
    const v = benchmarkValue(ctx, key);
    return v === null ? '' : ` Branżowo ${v}% stron ${suffix || 'ma to uzupełnione'}.`;
  }

  /**
   * Kontekst ewaluacji reguł (kontrakt logiczny — patrz §6.1 spec).
   * `weekStats` niesie dodatkowo `page_age_days` (liczone przez growthRepository.js z `pages.created_at`)
   * i `draft_stale_days` (zwracane wprost przez RPC `get_page_growth_stats`, licząc od `pages.draft_updated_at` —
   * patrz trigger `pages_set_draft_updated_at()` w migracji 20260705010000_growth_draft_staleness.sql).
   */
  function buildGrowthContext(theme, pl, benchmarks, weekStats) {
    const p = pl && typeof pl === 'object' ? pl : {};
    const contact = p.contact || {};
    const hero = p.hero || {};
    const plan = str(p.settings && p.settings.subscription && p.settings.subscription.plan) || 'trial';
    const quickChatPlanAllowed =
      typeof window.DFOPS_planAllowsQuickChat === 'function'
        ? window.DFOPS_planAllowsQuickChat(plan)
        : true;

    return {
      theme: str(theme),
      slug: str(p.slug || (p.settings && p.settings.slug)),
      pl: p,
      themeHasSection: (section) => themeHasSectionSafe(theme, section),
      benchmarks: benchmarks && typeof benchmarks === 'object' ? benchmarks : {},
      weekStats: weekStats && typeof weekStats === 'object' ? weekStats : {},
      plan,
      quickChatPlanAllowed,
      hasPhone: nonEmpty(contact.phone),
      hasEmail: nonEmpty(contact.email),
      hasOffer: resolveHasOffer(theme, p),
      hasHeroImage: nonEmpty(hero.image) || nonEmpty(p.nav && p.nav.logoImage),
      hasHeadline: nonEmpty(hero.headline),
      bookingActive: resolveBookingActive(p),
      hasGoogleReviews: nonEmpty(p.google_reviews && p.google_reviews.place_id),
      hasWhatsapp: nonEmpty(contact.whatsapp) || nonEmpty(contact.messenger),
    };
  }

  /**
   * Reguły v0 (§6.3) — kolejność w tablicy nieistotna, wybiera `pickGrowthRecommendation`
   * (najwyższy `priority` spełniający `when`, poza `dismissedIds`).
   */
  const RULES = [
    {
      id: 'contact_phone_missing',
      priority: 100,
      themes: null,
      requiresSection: null,
      when: (ctx) => !ctx.hasPhone && !ctx.hasEmail,
      title: 'Dodaj numer telefonu',
      message: (ctx) => `Bez telefonu ani e-maila klienci nie mogą się z Tobą skontaktować.${benchmarkSentence(ctx, 'pct_has_phone', 'ma podany telefon')}`,
      benchmarkKey: 'pct_has_phone',
      action: { tab: 'contact' },
      patch: null,
    },
    {
      id: 'offer_empty',
      priority: 95,
      themes: null,
      requiresSection: null,
      when: (ctx) => (ctx.themeHasSection('services') || ctx.themeHasSection('menu')) && !ctx.hasOffer,
      title: (ctx) => (ctx.themeHasSection('menu') ? 'Uzupełnij kartę dań' : 'Dodaj pierwszą usługę'),
      message: (ctx) =>
        `Pusta oferta zniechęca gości — dodaj choć jedną pozycję z nazwą i ceną.${benchmarkSentence(ctx, 'pct_has_offer', 'ma uzupełnioną ofertę')}`,
      benchmarkKey: 'pct_has_offer',
      action: (ctx) => ({ tab: ctx.themeHasSection('menu') ? 'menu' : 'services' }),
      patch: null,
    },
    {
      id: 'hero_image_missing',
      priority: 70,
      themes: null,
      requiresSection: null,
      when: (ctx) => !ctx.hasHeroImage,
      title: 'Wgraj zdjęcie banera',
      message: (ctx) => `Strona bez zdjęcia wygląda niedokończona.${benchmarkSentence(ctx, 'pct_has_hero_image', 'ma zdjęcie banera')}`,
      benchmarkKey: 'pct_has_hero_image',
      action: { tab: 'hero' },
      patch: null,
    },
    {
      id: 'headline_missing',
      priority: 65,
      themes: null,
      requiresSection: null,
      when: (ctx) => !ctx.hasHeadline,
      title: 'Uzupełnij nagłówek banera',
      message: () => 'Pierwsze zdanie na stronie decyduje, czy gość zostanie — dodaj krótki, konkretny nagłówek.',
      benchmarkKey: null,
      action: { tab: 'hero' },
      patch: null,
    },
    {
      id: 'booking_not_configured',
      priority: 85,
      themes: null,
      requiresSection: 'booking',
      when: (ctx) => !ctx.bookingActive,
      title: 'Skonfiguruj rezerwację online',
      message: (ctx) => `Rezerwacja bez linku lub trybu nie działa dla gości.${benchmarkSentence(ctx, 'pct_has_booking_url', 'ma aktywną rezerwację online')}`,
      benchmarkKey: 'pct_has_booking_url',
      action: { tab: 'contact' },
      patch: null,
    },
    {
      id: 'google_reviews_missing',
      priority: 60,
      themes: null,
      requiresSection: 'google_reviews',
      when: (ctx) => !ctx.hasGoogleReviews,
      title: 'Podepnij opinie Google',
      message: (ctx) => `Opinie budują zaufanie szybciej niż opis oferty.${benchmarkSentence(ctx, 'pct_has_google_reviews', 'ma podpięte opinie Google')}`,
      benchmarkKey: 'pct_has_google_reviews',
      action: { tab: 'reviews' },
      patch: null,
    },
    {
      id: 'faq_empty',
      priority: 40,
      themes: null,
      requiresSection: 'faq',
      when: (ctx) => !(Array.isArray(ctx.pl.faq) && ctx.pl.faq.length > 0),
      title: 'Dodaj pytania i odpowiedzi',
      message: () => 'Sekcja FAQ jest widoczna na stronie, ale pusta — dodaj 2–3 najczęstsze pytania klientów.',
      benchmarkKey: null,
      action: { tab: 'faq' },
      patch: null,
    },
    {
      id: 'gallery_empty',
      priority: 35,
      themes: null,
      requiresSection: 'gallery',
      when: (ctx) => !(Array.isArray(ctx.pl.gallery && ctx.pl.gallery.images) && ctx.pl.gallery.images.length > 0),
      title: 'Dodaj zdjęcia do galerii',
      message: () => 'Galeria jest widoczna na stronie, ale pusta — dodaj kilka zdjęć realizacji.',
      benchmarkKey: null,
      action: { tab: 'gallery' },
      patch: null,
    },
    {
      id: 'gastro_hours_missing',
      priority: 55,
      themes: ['gastro'],
      requiresSection: 'opening_hours',
      when: (ctx) => !(Array.isArray(ctx.pl.hours && ctx.pl.hours.lines) && ctx.pl.hours.lines.length > 0),
      title: 'Uzupełnij godziny otwarcia',
      message: () => 'Bez godzin otwarcia klienci nie wiedzą, kiedy mogą przyjść lub zadzwonić.',
      benchmarkKey: null,
      action: { tab: 'contact' },
      patch: null,
    },
    {
      id: 'whatsapp_available',
      priority: 30,
      themes: null,
      requiresSection: null,
      when: (ctx) => ctx.quickChatPlanAllowed && !ctx.hasWhatsapp,
      title: 'Włącz szybki kontakt WhatsApp',
      message: () => 'Twój plan pozwala na pływający przycisk WhatsApp/Messenger — klienci piszą częściej niż dzwonią.',
      benchmarkKey: null,
      action: { tab: 'contact' },
      patch: null,
    },
    {
      id: 'low_phone_clicks',
      priority: 50,
      themes: null,
      requiresSection: null,
      when: (ctx) =>
        ctx.hasPhone &&
        Number(ctx.weekStats.page_age_days || 0) > 14 &&
        Number(ctx.weekStats.phone_click || 0) === 0,
      title: 'Zero kliknięć w numer telefonu',
      message: () => 'Telefon jest widoczny, ale nikt go nie kliknął od dawna — sprawdź, czy jest wyeksponowany w banerze.',
      benchmarkKey: 'median_weekly_phone_clicks',
      action: { tab: 'hero' },
      patch: null,
    },
    {
      id: 'publish_reminder',
      priority: 20,
      themes: null,
      requiresSection: null,
      when: (ctx) => Number(ctx.weekStats.draft_stale_days || 0) > 7,
      title: 'Masz niepublikowane zmiany',
      message: () => 'Zmiany w edycji czekają na publikację od ponad tygodnia — kliknij „Opublikuj zmiany”.',
      benchmarkKey: null,
      action: { tab: 'dashboard' },
      patch: null,
    },
  ];

  function resolveField(value, ctx) {
    return typeof value === 'function' ? value(ctx) : value;
  }

  function ruleApplies(rule, ctx) {
    if (Array.isArray(rule.themes) && rule.themes.length && !rule.themes.includes(ctx.theme)) return false;
    if (rule.requiresSection && !ctx.themeHasSection(rule.requiresSection)) return false;
    try {
      return !!rule.when(ctx);
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) console.debug('[DFOPS growthRules]', rule.id, e);
      return false;
    }
  }

  function buildRecommendation(rule, ctx) {
    return {
      id: rule.id,
      title: resolveField(rule.title, ctx),
      message: resolveField(rule.message, ctx),
      benchmarkKey: rule.benchmarkKey || null,
      benchmarkValue: benchmarkValue(ctx, rule.benchmarkKey),
      action: resolveField(rule.action, ctx) || { tab: 'dashboard' },
      priority: rule.priority,
    };
  }

  /** Jedna reguła o najwyższym `priority`, spełniająca `when`, poza `dismissedIds`. */
  function pickGrowthRecommendation(ctx, dismissedIds) {
    if (!ctx) return null;
    const dismissed = Array.isArray(dismissedIds) ? dismissedIds : [];
    const candidates = RULES.filter((r) => !dismissed.includes(r.id) && ruleApplies(r, ctx));
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return buildRecommendation(candidates[0], ctx);
  }

  /** Re-ewaluacja jednej, konkretnej reguły (np. do rotacji tygodniowej w growthPanel.js — §7). */
  function evaluateGrowthRule(ruleId, ctx) {
    if (!ctx) return null;
    const rule = RULES.find((r) => r.id === ruleId);
    if (!rule || !ruleApplies(rule, ctx)) return null;
    return buildRecommendation(rule, ctx);
  }

  window.DFOPS_GROWTH_RULES = RULES;
  window.DFOPS_buildGrowthContext = buildGrowthContext;
  window.DFOPS_pickGrowthRecommendation = pickGrowthRecommendation;
  window.DFOPS_evaluateGrowthRule = evaluateGrowthRule;
})();
