/**
 * Landing — cennik + UI i18n (PL/EN).
 * Alpine: `x-data="landingPricing()"` na `<body>` w `index.html`.
 */
(function () {
  const PLAN_BASE = [
    {
      id: 'starter',
      name: 'Starter',
      monthly: 29,
      yearlyTotal: 278.4,
      yearlyStrike: 348,
      yearlyPerMonth: 23.2,
      highlighted: false,
      href: 'rejestracja.html',
      variant: 'outline',
    },
    {
      id: 'standard',
      name: 'Standard',
      monthly: 49,
      yearlyTotal: 470.4,
      yearlyStrike: 588,
      yearlyPerMonth: 39.2,
      highlighted: true,
      href: 'rejestracja.html',
      variant: 'gold',
    },
    {
      id: 'premium',
      name: 'Premium',
      monthly: null,
      highlighted: false,
      variant: 'custom',
    },
  ];

  function formatPln(amount) {
    if (amount == null || Number.isNaN(amount)) return '';
    return amount.toLocaleString('pl-PL', {
      minimumFractionDigits: amount % 1 ? 2 : 0,
      maximumFractionDigits: 2,
    });
  }

  function buildPlans(locale) {
    const t = function (path) {
      return typeof window.DFOPS_uiT === 'function' ? window.DFOPS_uiT(path, null, locale) : path;
    };
    const pack =
      (window.DFOPS_UI_COPY && window.DFOPS_UI_COPY[locale] && window.DFOPS_UI_COPY[locale].pricing &&
        window.DFOPS_UI_COPY[locale].pricing.plans) ||
      (window.DFOPS_UI_COPY && window.DFOPS_UI_COPY.pl && window.DFOPS_UI_COPY.pl.pricing.plans) ||
      {};

    return PLAN_BASE.map(function (base) {
      const loc = pack[base.id] || {};
      if (base.id === 'premium') {
        return Object.assign({}, base, {
          tagline: loc.tagline || '',
          customTitle: loc.customTitle || '',
          customSub: loc.customSub || '',
          cta: null,
          trialNote: null,
          badge: null,
          features: Array.isArray(loc.features) ? loc.features : [],
          links: Array.isArray(loc.links) ? loc.links : [],
        });
      }
      return Object.assign({}, base, {
        tagline: loc.tagline || '',
        trialNote: loc.trialNote || null,
        badge: loc.badge || null,
        cta: loc.cta || t('pricing.plans.' + base.id + '.cta'),
        features: Array.isArray(loc.features) ? loc.features : [],
        links: null,
        customTitle: null,
        customSub: null,
      });
    });
  }

  function applyLandingMeta(locale) {
    const title =
      typeof window.DFOPS_uiT === 'function' ? window.DFOPS_uiT('meta.landingTitle', null, locale) : '';
    const desc =
      typeof window.DFOPS_uiT === 'function'
        ? window.DFOPS_uiT('meta.landingDescription', null, locale)
        : '';
    if (title) document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && desc) metaDesc.setAttribute('content', desc);
    const ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.setAttribute('content', locale === 'en' ? 'en_US' : 'pl_PL');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && title) ogTitle.setAttribute('content', title);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc && desc) ogDesc.setAttribute('content', desc);
  }

  function landingPricing() {
    const i18n =
      typeof window.DFOPS_uiI18nState === 'function'
        ? window.DFOPS_uiI18nState()
        : { uiLocale: 'pl', t: function (k) { return k; }, setUiLocale: function () {}, copy: {} };

    const state = Object.assign({}, i18n, {
      billingInterval: 'monthly',
      mobileOpen: false,
      plans: buildPlans(i18n.uiLocale),
      formatPln: formatPln,
      onUiLocaleChange: function (loc) {
        this.plans = buildPlans(loc);
        applyLandingMeta(loc);
      },
      yearlyPerMonthLabel: function (plan) {
        return this.t('pricing.yearlyPerMonth', { amount: formatPln(plan.yearlyPerMonth) });
      },
      init: function () {
        applyLandingMeta(this.uiLocale);
      },
    });

    return state;
  }

  document.addEventListener('alpine:init', function () {
    if (typeof Alpine !== 'undefined' && Alpine.data) {
      Alpine.data('landingPricing', landingPricing);
    }
  });

  window.DFOPS_landingPricing = landingPricing;
  window.DFOPS_landingPlans = PLAN_BASE;
  window.DFOPS_buildLandingPlans = buildPlans;
})();
