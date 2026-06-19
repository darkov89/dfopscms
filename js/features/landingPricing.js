/**
 * Landing — cennik, porównanie, nisze i moduły „Silnik Biznesu”.
 * Alpine: `x-data="landingPricing()"` na `<body>` w `index.html`.
 */
(function () {
  const PLANS = [
    {
      id: 'starter',
      name: 'Starter',
      tagline: 'Start bez ryzyka',
      monthly: 29,
      yearlyTotal: 278.4,
      yearlyStrike: 348,
      yearlyPerMonth: 23.2,
      trialNote: '14 dni trialu przy rejestracji — bez karty',
      highlighted: false,
      cta: 'Wybierz Starter',
      href: 'rejestracja.html',
      variant: 'outline',
      features: [
        { strong: 'Adres strony', text: ' na subdomenie .dfcms.pl — online w minutę' },
        { strong: 'Szablon branżowy', text: ' dopasowany do niszy, bez układania klocków' },
        { strong: 'Silnik operacyjny', text: ' — opinie Google, rezerwacje, mapa w standardzie' },
        { strong: 'Panel CMS', text: ', hosting i certyfikat SSL w cenie' },
      ],
    },
    {
      id: 'standard',
      name: 'Standard',
      tagline: 'Marka na własnej domenie',
      monthly: 49,
      yearlyTotal: 470.4,
      yearlyStrike: 588,
      yearlyPerMonth: 39.2,
      trialNote: null,
      badge: 'Polecane',
      highlighted: true,
      cta: 'Wybierz Standard',
      href: 'rejestracja.html',
      variant: 'gold',
      features: [
        { strong: 'Własna domena', text: ' .pl / .com — podpinamy za Ciebie' },
        { strong: 'Pełna paleta', text: ' kolorów i motywów branżowych' },
        { strong: 'Bez logo DFCMS', text: ' na stronie publicznej' },
        { strong: 'Concierge', text: ' — asystent wdrożeniowy od 100 zł/h netto' },
      ],
    },
    {
      id: 'premium',
      name: 'Premium',
      tagline: 'Na zamówienie',
      monthly: null,
      customTitle: 'Wycena indywidualna',
      customSub: 'Integracje, procesy i wsparcie dopasowane do firmy',
      highlighted: false,
      cta: null,
      variant: 'custom',
      features: [
        { text: 'Indywidualne wdrożenie i integracje systemowe' },
        { text: 'Rozszerzenia pod Twój model pracy' },
        { text: 'Bez samoobsługowej subskrypcji — kontakt z zespołem' },
      ],
      links: [
        { label: 'Formularz zapytania', href: 'zapytanie-custom.html', variant: 'outline' },
        { label: 'Napisz do nas', href: 'mailto:kontakt@dfops.eu?subject=DFCMS%20%E2%80%94%20pakiet%20Premium', variant: 'dark' },
      ],
    },
  ];

  const COMPARISON_ROWS = [
    {
      label: 'Czas do uruchomienia',
      legacy: 'Kilka–kilkadziesiąt godzin',
      dfcms: '3 minuty',
      dfcmsWin: true,
    },
    {
      label: 'Szablon',
      legacy: 'Uniwersalny, trzeba składać',
      dfcms: 'Dedykowany pod Twoją branżę',
      dfcmsWin: true,
    },
    {
      label: 'Koszty po roku',
      legacy: 'Promocja → duża podwyżka',
      dfcms: 'Przejrzysta, stała cena',
      dfcmsWin: true,
    },
    {
      label: 'Obsługa',
      legacy: 'Sam wszystko robisz',
      dfcms: 'Concierge — my się tym zajmujemy',
      dfcmsWin: true,
    },
    {
      label: 'Rezerwacje i opinie',
      legacy: 'Dodatkowe wtyczki',
      dfcms: 'Wbudowane',
      dfcmsWin: true,
    },
  ];

  const ENGINE_MODULES = [
    {
      id: 'reviews',
      title: 'Opinie, które zarabiają',
      desc: 'Automatyczna synchronizacja opinii z Google Maps oraz miejsce na rekomendacje własne — social proof bez ręcznego kopiowania.',
      icon: 'star',
    },
    {
      id: 'booking',
      title: 'Rezerwacje pod kontrolą',
      desc: 'Booksy, Calendly, ZnanyLekarz — osadzasz widget lub przycisk rezerwacji. Grafik i formularze bez przełączania między narzędziami.',
      icon: 'calendar',
    },
    {
      id: 'inbox',
      title: 'Wiadomości w jednym miejscu',
      desc: 'Zapytania z formularza kontaktowego trafiają do panelu DFCMS — jedna skrzynka zamiast gubienia leadów w rozproszonej poczcie.',
      icon: 'inbox',
    },
    {
      id: 'maps',
      title: 'Lokalizacja, która prowadzi klienta',
      desc: 'Mapa Google i dane kontaktowe zsynchronizowane ze stroną — gość od razu wie, gdzie Cię znaleźć i jak zadzwonić.',
      icon: 'map',
    },
    {
      id: 'publish',
      title: 'Publikacja bez technikaliów',
      desc: 'Draft i publikacja jednym kliknięciem. Hosting w UE, SSL i kopie zapasowe — Ty edytujesz treść, my utrzymujemy infrastrukturę.',
      icon: 'shield',
    },
    {
      id: 'seo',
      title: 'Widoczność w Google',
      desc: 'Meta tytuł, opis i struktura pod lokalne wyszukiwanie — bez wtyczek SEO i bez studia informatyki.',
      icon: 'search',
    },
  ];

  const NICHES = [
    {
      id: 'gastro',
      name: 'Gastro',
      desc: 'Restauracja, kawiarnia, bar — menu, godziny i zamówienia.',
      demoHref: '?site=demo-gastro',
      demoLabel: 'Zobacz demo na żywo',
      external: true,
      gradient: 'from-stone-900 via-amber-950/80 to-zinc-900',
      accent: 'text-amber-400/70',
    },
    {
      id: 'care',
      name: 'Care',
      desc: 'Gabinet medyczny, psychologia, fizjoterapia — zaufanie i cennik.',
      demoHref: '?site=demo-care',
      demoLabel: 'Zobacz demo na żywo',
      external: true,
      gradient: 'from-sky-50 via-white to-slate-100',
      accent: 'text-sky-600/50',
      light: true,
    },
    {
      id: 'fitness',
      name: 'Fitness',
      desc: 'Trener, studio — grafik, oferta i mocny wizualny punch.',
      demoHref: '?site=demo-fitness',
      demoLabel: 'Zobacz demo na żywo',
      external: true,
      gradient: 'from-zinc-900 via-emerald-950/90 to-lime-950/80',
      accent: 'text-lime-300/65',
    },
    {
      id: 'beauty',
      name: 'Beauty',
      desc: 'Salon, SPA, barber — cennik, galeria i rezerwacja wizyty.',
      demoHref: '?site=demo-beauty',
      demoLabel: 'Zobacz demo na żywo',
      external: true,
      gradient: 'from-rose-100 via-fuchsia-50 to-amber-50/80',
      accent: 'text-rose-950/35',
      light: true,
    },
    {
      id: 'services',
      name: 'Złota Rączka',
      desc: 'Hydraulik, elektryk, usługi lokalne — realizacje i kontakt.',
      demoHref: '?site=demo-services',
      demoLabel: 'Zobacz demo na żywo',
      external: true,
      gradient: 'from-slate-900 via-slate-800 to-amber-950/50',
      accent: 'text-amber-200/55',
    },
    {
      id: 'consultant',
      name: 'Konsultant',
      desc: 'Doradztwo, B2B, ekspert — case studies i profesjonalny wizerunek.',
      demoHref: '?site=demo-consultant',
      demoLabel: 'Zobacz demo na żywo',
      external: true,
      gradient: 'from-slate-950 via-blue-950/90 to-slate-900',
      accent: 'text-blue-400/55',
    },
  ];

  function formatPln(amount) {
    if (amount == null || Number.isNaN(amount)) return '';
    return amount.toLocaleString('pl-PL', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  function moduleIcon(name) {
    const stroke = 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"';
    const icons = {
      star: `<svg class="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path ${stroke} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg>`,
      calendar: `<svg class="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path ${stroke} d="M6.75 3v2.25M17.25 3v2.25M3 9.75h18M4.5 6.75h15a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-15a1.5 1.5 0 01-1.5-1.5v-12a1.5 1.5 0 011.5-1.5z"/></svg>`,
      inbox: `<svg class="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path ${stroke} d="M21.75 9v9a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 18V9M21.75 9l-9.75 6-9.75-6M21.75 9l-9.75-6-9.75 6"/></svg>`,
      map: `<svg class="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path ${stroke} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path ${stroke} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>`,
      shield: `<svg class="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path ${stroke} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>`,
      search: `<svg class="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path ${stroke} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>`,
    };
    return icons[name] || icons.star;
  }

  function landingPricing() {
    return {
      billingInterval: 'monthly',
      plans: PLANS,
      comparisonRows: COMPARISON_ROWS,
      engineModules: ENGINE_MODULES,
      niches: NICHES,
      formatPln,
      moduleIcon,
      isYearly() {
        return this.billingInterval === 'yearly';
      },
    };
  }

  document.addEventListener('alpine:init', function () {
    if (typeof Alpine !== 'undefined' && Alpine.data) {
      Alpine.data('landingPricing', landingPricing);
    }
  });

  window.DFOPS_landingPricing = landingPricing;
  window.DFOPS_landingPlans = PLANS;
})();
