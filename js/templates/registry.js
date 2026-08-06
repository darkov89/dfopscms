// Single source of truth for templates + versions
(function () {
  const LATEST_TEMPLATE_VERSION = 3;

  const TEMPLATE_LABELS = {
    setup: { name: 'Konfiguracja', desc: 'Widok startowy do czasu ukończenia kreatora' },
    beauty: { name: 'Beauty & Wellness', desc: 'Idealny dla salonów, spa, fizjoterapii i branży usługowej' },
    consultant: { name: 'Coaching & Biznes', desc: 'Stworzony dla trenerów, konsultantów, agencji i freelancerów' },
    fitness: { name: 'Fitness', desc: 'Studio, trening personalny, grafik zajęć' },
    services: { name: 'Usługi lokalne', desc: 'Złota rączka, hydraulika, mechanika, elektryka' },
    gastro: { name: 'Gastro', desc: 'Restauracja, kawiarnia, bar' },
    care: { name: 'Care', desc: 'Gabinet medyczny, psychologia, fizjoterapia' },
  };

  /** Kafelki kreatora (krok 1) — wizualne akcenty; nowy motyw dostaje domyślny styl. */
  const WIZARD_TILE_UI = {
    beauty: { badge: 'BEAUTY', tileBg: 'bg-pink-50', tileBadge: 'text-pink-300' },
    consultant: { badge: 'BIZNES', tileBg: 'bg-blue-50', tileBadge: 'text-blue-300' },
    fitness: { badge: 'FIT', tileBg: 'bg-zinc-900', tileBadge: 'text-lime-400' },
    services: { badge: 'USŁUGI', tileBg: 'bg-slate-900', tileBadge: 'text-amber-400' },
    gastro: { badge: 'GASTR', tileBg: 'bg-amber-950', tileBadge: 'text-amber-300' },
    care: { badge: 'CARE', tileBg: 'bg-sky-50', tileBadge: 'text-sky-500' },
  };

  const DEFAULT_WIZARD_TILE_UI = {
    badge: '',
    tileBg: 'bg-slate-100',
    tileBadge: 'text-slate-400',
  };

  /**
   * Opublikowane motywy = klucze w templatesV3 poza `setup`.
   * Edge: `js/core/publishedThemes.js` (Workers-safe) — przy nowym szablonie dodaj id w obu miejscach.
   */
  function getPublishedThemeIds() {
    return Object.keys(templatesV3).filter((id) => id !== 'setup');
  }

  function isPublishedTheme(theme) {
    const id = typeof theme === 'string' ? theme.trim().toLowerCase() : '';
    return id && id !== 'setup' && Object.prototype.hasOwnProperty.call(templatesV3, id);
  }

  /** Wszystkie opublikowane motywy są dostępne w kreatorze onboardingu. */
  function getWizardThemeIds() {
    return getPublishedThemeIds();
  }

  /** gastro / care używają `color_palette` zamiast samego `color_preset`. */
  function themeUsesColorPalette(theme) {
    const id = typeof theme === 'string' ? theme.trim().toLowerCase() : '';
    const settings = templatesV3[id]?.pl?.settings;
    return !!(settings && settings.color_palette);
  }

  /**
   * Merge treści z szablonem w DFOPS_mergeContentWithTemplate: dopóki nie ma pełnego JSON szablonu,
   * spadamy na `beauty`, żeby nie rzucać „Unknown theme” przy odczycie z bazy (Epik 3).
   */
  function resolveTemplateKeyForMerge(theme) {
    const id = typeof theme === 'string' ? theme.trim() : '';
    if (id && templatesV3[id]) return id;
    return 'beauty';
  }

  /** Kafelki w panelu: Wygląd → motyw branżowy (available = opublikowany w registry). */
  function getTemplateCatalog() {
    return getPublishedThemeIds().map((id) => {
      const label = TEMPLATE_LABELS[id] || { name: id, desc: '' };
      return {
        id,
        name: label.name,
        desc: label.desc,
        available: true,
      };
    });
  }

  /** Krok 1 kreatora — lista motywów z etykietami i stylami kafelków. */
  function getWizardTemplateCatalog() {
    return getWizardThemeIds().map((id) => {
      const label = TEMPLATE_LABELS[id] || { name: id, desc: '' };
      const ui = WIZARD_TILE_UI[id] || {
        ...DEFAULT_WIZARD_TILE_UI,
        badge: String(id).slice(0, 6).toUpperCase(),
      };
      return {
        id,
        name: label.name,
        desc: label.desc,
        badge: ui.badge,
        tileBg: ui.tileBg,
        tileBadge: ui.tileBadge,
      };
    });
  }

  const templatesV3 = {
    setup: {
      pl: {
        nav: {
          logo: 'DFCMS',
          cta: '',
          logoImage: '',
          menu: {
            about: 'O nas',
            pricing: 'Cennik',
            gallery: 'Galeria',
            faq: 'Pytania i odpowiedzi (Q&A)',
            contact: 'Kontakt',
            reviews: 'Opinie',
          },
        },
        hero: {
          name: '',
          headline: 'Twoja strona jest już prawie gotowa!',
          subheadline: '',
          description:
            'Właśnie trwają prace nad konfiguracją Twojego serwisu. Jeśli jesteś właścicielem, zaloguj się do panelu — tam czeka na Ciebie prosty kreator krok po kroku.',
          button: '',
          image: '',
          qrText: '',
          qrImage: '',
        },
        manifesto: { label: '', title: '', text: '' },
        services: [],
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
        },
        social: { facebook: '', instagram: '', tiktok: '' },
        google_reviews: { embed_url: '', place_query: '', max_reviews: 6, title: 'Opinie z Google' },
        gallery: { title: 'Nasze realizacje', images: [] },
        seo: {
          title: 'Strona w budowie — DFCMS',
          description: 'Trwa konfiguracja serwisu. Właściciel może zalogować się do panelu i dokończyć stronę w Kreatorze.',
          ogImage: '',
        },
        privacy: { mode: 'default', customText: '' },
        legal: { enabled: false, privacy_policy: '', terms: '' },
        settings: {
          template_version: 3,
          color_preset: 'gold',
          booking_mode: 'schedule',
          subscription: { plan: 'trial', trial_started_at: new Date().toISOString() },
          background_style: 'glow',
          font_preset: 'inter',
          analytics: { gtm_id: '', fb_pixel_id: '' },
          growth: { dismissed_rule_ids: [], last_shown_rule_id: '', last_shown_at: '', onboarding_growth_seen: false },
          showManifesto: false,
          showServices: false,
          showGallery: true,
          showGoogleReviews: true,
          showFaq: false,
          showContact: false,
          onboarding_completed: false,
        },
      },
    },
    consultant: {
      pl: {
        nav: {
          logo: "Ekspert",
          cta: "",
          logoImage: "",
          menu: { about: "O nas", pricing: "Usługi", faq: "Pytania i odpowiedzi (Q&A)", reviews: "Opinie", booking: "Rezerwacja", contact: "Kontakt" },
        },
        hero: {
          name: "Witaj na pokładzie",
          headline: "Twoja przestrzeń ekspercka",
          subheadline: "",
          description: "Panel dla konsultantów i specjalistów. Gotowy na opinie i akordeony.",
          button: "Zaczynamy",
          button_enabled: true,
          button_url: "",
          image: ""
        },
        manifesto: { label: "", title: "", text: "" },
        services: [{ title: "Konsultacje 1:1", desc: "Krótki opis usługi — widoczny na stronie." }],
        proof: { label: "", title: "", text: "", statNumber: "", statLabel: "", statDesc: "" },
        faq: [],
        faq_heading: { label: 'Częste pytania', title: '' },
        reviews: [],
        reviews_heading: { label: 'Głos klientów', title: 'Opinie i współpraca' },
        contact: {
          title: 'Kontakt',
          email: "",
          phone: "",
          address: "",
          booking_url: "",
          bookingUrl: "",
          booksyUrl: "",
          booksyIframeUrl: "",
          map_embed_url: "",
          map_place_id: "",
          whatsapp: "",
          messenger: "",
          cta: {
            enabled: true,
            section_label: 'Rezerwacja',
            title: "Szybki kalendarz",
            description:
              "Wybierz dogodny termin i umów się na darmową, 15-minutową konsultację wstępną.",
            button_text: "Wybierz termin na Calendly",
            button_url: "https://calendly.com/",
          },
        },
        social: { linkedin: "", facebook: "", instagram: "", tiktok: "", twitter: "", youtube: "" },
        google_reviews: { label: 'Zaufanie', embed_url: "", place_query: "", max_reviews: 6, title: "Opinie z Google" },
        gallery: { title: "Nasze realizacje", images: [] },
        seo: {
          title: "Konsultacje i coaching — profesjonalna strona eksperta",
          description:
            "Strona dla konsultantów, coachów i specjalistów. Umów rozmowę, poznaj ofertę i buduj zaufanie dzięki przejrzystemu, nowoczesnemu układowi.",
          ogImage: ""
        },
        footer: {
          quote: 'Innowacja to nie dodatek – to fundament skutecznego biznesu.',
          copyright: '',
          privacy: '',
        },
        privacy: { mode: "default", customText: "" },
        legal: { enabled: true, privacy_policy: "", terms: "" },
        cookies: { text: "Ta strona używa plików cookies w celach funkcjonalnych.", accept: "Akceptuję" },
        settings: {
          darkMode: true,
          template_version: 3,
          color_preset: "dfops-tech",
          booking_mode: "schedule",
          subscription: { plan: "trial", trial_started_at: new Date().toISOString() },
          background_style: "glow",
          font_preset: "inter",
          analytics: { gtm_id: "", fb_pixel_id: "" },
          growth: { dismissed_rule_ids: [], last_shown_rule_id: "", last_shown_at: "", onboarding_growth_seen: false },
          showManifesto: true,
          showServices: true,
          showProof: true,
          showGoogleReviews: true,
          showFaq: true,
          showReviews: true,
          showContact: true,
          onboarding_completed: false
        }
      }
    },
    beauty: {
      pl: {
        nav: {
          logo: "Twoja Marka",
          cta: "Rezerwuj",
          logoImage: "",
          menu: { about: "O nas", pricing: "Cennik", gallery: "Galeria", faq: "Pytania i odpowiedzi (Q&A)", contact: "Kontakt", reviews: "Opinie" }
        },
        hero: {
          name: "Twoje miejsce",
          headline: "Odkryj siebie na nowo",
          description: "Krótki opis Twojej oferty i atmosfery.",
          button: "Umów wizytę",
          button_enabled: true,
          button_url: "",
          image: "",
          qrText: "",
          qrImage: "",
        },
        manifesto: { label: "O nas", title: "Kilka słów", text: "" },
        services: [],
        faq: [],
        contact: {
          phone: "",
          email: "",
          address: "",
          booking_url: "",
          bookingUrl: "",
          booksyUrl: "",
          booksyIframeUrl: "",
          map_embed_url: "",
          map_place_id: "",
          whatsapp: "",
          messenger: "",
          cta: {
            enabled: false,
            title: "Umów się wygodnie",
            description: "",
            button_text: "Przejdź do Booksy",
            button_url: "",
          },
        },
        social: { facebook: "", instagram: "", tiktok: "" },
        google_reviews: { embed_url: "", place_query: "", max_reviews: 6, title: "Opinie z Google" },
        gallery: { title: "Nasze realizacje", images: [] },
        seo: {
          title: "Salon beauty i zabiegi — rezerwacja online",
          description:
            "Profesjonalne zabiegi kosmetyczne, barber i relaks w jednym miejscu. Sprawdź cennik, przeczytaj opinie i umów wizytę w kilka kliknięć.",
          ogImage: ""
        },
        privacy: { mode: "default", customText: "" },
        legal: { enabled: true, privacy_policy: "", terms: "" },
        settings: {
          subscription: { plan: "trial", trial_started_at: new Date().toISOString() },
          booking_mode: "schedule",
          analytics: { gtm_id: "", fb_pixel_id: "" },
          growth: { dismissed_rule_ids: [], last_shown_rule_id: "", last_shown_at: "", onboarding_growth_seen: false },
          showManifesto: true,
          showServices: true,
          showGallery: true,
          showGoogleReviews: true,
          showFaq: true,
          showContact: true,
          template_version: 3,
          color_preset: "beige",
          background_style: "soft",
          font_preset: "poppins",
          onboarding_completed: false
        }
      }
    },
    fitness: {
      pl: {
        nav: {
          logo: "TWOJE STUDIO",
          cta: "Zapisz się",
          logoImage: "",
          menu: {
            about: "O mnie",
            pricing: "Treningi",
            schedule: "Grafik",
            gallery: "Galeria",
            faq: "FAQ",
            contact: "Kontakt",
            reviews: "Opinie",
          },
        },
        hero: {
          name: "Trener personalny",
          headline: "Silniej. Szybciej. Bez wymówek.",
          subheadline: "",
          description: "Treningi personalne i małe grupy. Cel: Twoja forma — mierzalnie, bezpiecznie, bez chaosu.",
          button: "Umów trening",
          button_enabled: true,
          button_url: "",
          image: "",
          qrText: "",
          qrImage: "",
        },
        manifesto: {
          label: "Podejście",
          title: "Technika + progres",
          text: "Nie zgadujemy — trenujemy plan. Powtórzenia, objętość i regeneracja pod Twoje cele.",
        },
        services: [
          {
            title: "Trening personalny 1:1",
            desc: "Indywidualny plan i stała kontrola techniki.",
            details: "45–60 min · dopasowanie do poziomu",
            duration: "60 min",
            price: "od 120 zł",
          },
          {
            title: "Small group HIIT",
            desc: "Mała grupa, duża dynamika.",
            details: "Max 6 osób · muzyka i motywacja",
            duration: "45 min",
            price: "40 zł",
          },
        ],
        schedule: [
          { day: "Poniedziałek — Piątek", time: "6:00 — 22:00", note: "Studio i treningi personalne" },
          { day: "Sobota", time: "8:00 — 14:00", note: "Grupy otwarte · zapisy" },
          { day: "Niedziela", time: "—", note: "Regeneracja / zamknięte — ustal indywidualnie" },
        ],
        faq: [],
        contact: {
          email: "",
          phone: "",
          address: "",
          booking_url: "",
          bookingUrl: "",
          booksyUrl: "",
          booksyIframeUrl: "",
          map_embed_url: "",
          map_place_id: "",
          whatsapp: "",
          messenger: "",
          cta: {
            enabled: false,
            title: "Umów się wygodnie",
            description: "",
            button_text: "Przejdź do Booksy",
            button_url: "",
          },
        },
        social: { facebook: "", instagram: "", tiktok: "" },
        google_reviews: { embed_url: "", place_query: "", max_reviews: 6, title: "Opinie klientów" },
        gallery: { title: "Z studia", images: [] },
        seo: {
          title: "Trening personalny i studio fitness",
          description: "Treningi personalne, grafik zajęć i zapisy online. Sprawdź ofertę i zacznij dziś.",
          ogImage: "",
        },
        privacy: { mode: "default", customText: "" },
        legal: { enabled: true, privacy_policy: "", terms: "" },
        settings: {
          subscription: { plan: "trial", trial_started_at: new Date().toISOString() },
          template_version: 3,
          color_preset: "neon-lime",
          booking_mode: "schedule",
          background_style: "glow",
          font_preset: "inter",
          analytics: { gtm_id: "", fb_pixel_id: "" },
          growth: { dismissed_rule_ids: [], last_shown_rule_id: "", last_shown_at: "", onboarding_growth_seen: false },
          showManifesto: true,
          showServices: true,
          showGallery: true,
          showGoogleReviews: true,
          showFaq: true,
          showContact: true,
          onboarding_completed: false,
        },
      },
    },
    services: {
      pl: {
        nav: {
          logo: "TWOJA FIRMA",
          cta: "Zadzwoń",
          logoImage: "",
          menu: {
            about: "O nas",
            pricing: "Zakres usług",
            gallery: "Realizacje",
            trust: "Zaufanie",
            faq: "FAQ",
            contact: "Kontakt",
            reviews: "Opinie",
          },
        },
        hero: {
          name: "Usługi remontowo-budowlane",
          headline: "Szybko i solidnie",
          subheadline: "",
          description:
            "Dojazd na terenie miasta i okolic. Wycena po oględzinach — bez ukrytych kosztów.",
          button: "Zadzwoń teraz",
          button_enabled: true,
          button_url: "",
          image: "",
          qrText: "",
          qrImage: "",
        },
        manifesto: {
          label: "Dlaczego my",
          title: "Rzetelnie, na czas, z gwarancją",
          text: "Łączymy doświadczenie z uczciwym podejściem. Dbamy o porządek na budowie i jasny kontakt na każdym etapie.",
        },
        services: [
          {
            title: "Hydraulika i instalacje",
            desc: "Przecieki, montaż baterii, udrażnianie, przeglądy.",
            details: "Części premium lub zgodnie z ustaleniami.",
            duration: "do 24h",
            price: "od 150 zł",
            icon: "droplet",
          },
          {
            title: "Elektryka",
            desc: "Gniazda, oświetlenie, rozdzielnice, pomiary.",
            details: "Zgodnie z normami i protokołami.",
            duration: "wizyta",
            price: "wycena",
            icon: "bolt",
          },
          {
            title: "Mechanika / naprawy",
            desc: "Diagnostyka, drobne naprawy, konsultacje.",
            details: "Stacjonarnie lub z dojazdem.",
            duration: "wg ustaleń",
            price: "wycena",
            icon: "cog",
          },
          {
            title: "Złota rączka",
            desc: "Montaż mebli, drobne prace wykończeniowe.",
            details: "Lista prac ustalana telefonicznie.",
            duration: "1–3h",
            price: "od 80 zł",
            icon: "wrench",
          },
        ],
        trust: {
          title: "Polecają nas klienci",
          quote:
            "„Pan przyjechał tego samego dnia, wytłumaczył co się dzieje i naprawił bez kombinowania. Szacunek za uczciwość.”",
          author: "Marek K.",
          subtitle: "Usługa hydrauliczna · 2025",
          stars: 5,
        },
        faq: [],
        contact: {
          email: "",
          phone: "",
          address: "",
          booking_url: "",
          bookingUrl: "",
          booksyUrl: "",
          booksyIframeUrl: "",
          map_embed_url: "",
          map_place_id: "",
          whatsapp: "",
          messenger: "",
          cta: {
            enabled: false,
            title: "Szybki kontakt",
            description: "",
            button_text: "Rezerwacja online",
            button_url: "",
          },
        },
        social: { facebook: "", instagram: "", tiktok: "" },
        google_reviews: { embed_url: "", place_query: "", max_reviews: 6, title: "Opinie z Google" },
        gallery: { title: "Realizacje", images: [] },
        seo: {
          title: "Usługi hydrauliczne, elektryczne i naprawy — lokalnie",
          description:
            "Szybki kontakt, uczciwa wycena, dojazd. Hydraulik, elektryk, mechanik i drobne naprawy w Twojej okolicy.",
          ogImage: "",
        },
        privacy: { mode: "default", customText: "" },
        legal: { enabled: true, privacy_policy: "", terms: "" },
        settings: {
          subscription: { plan: "trial", trial_started_at: new Date().toISOString() },
          template_version: 3,
          color_preset: "trades-navy",
          booking_mode: "schedule",
          background_style: "clean",
          font_preset: "inter",
          analytics: { gtm_id: "", fb_pixel_id: "" },
          growth: { dismissed_rule_ids: [], last_shown_rule_id: "", last_shown_at: "", onboarding_growth_seen: false },
          showManifesto: true,
          showServices: true,
          showTrust: true,
          showGallery: true,
          showGoogleReviews: true,
          showFaq: true,
          showContact: true,
          onboarding_completed: false,
        },
      },
    },
    gastro: {
      pl: {
        nav: {
          logo: 'RESTAURACJA',
          cta: 'Rezerwuj',
          logoImage: '',
          menu: { menu: 'Menu', orders: 'Zamówienia', location: 'Lokalizacja', contact: 'Kontakt' },
        },
        hero: {
          name: 'Nazwa lokalu',
          headline: 'Smak, który zostaje w pamięci',
          subheadline: 'Kuchnia autorska · sezonowe menu',
          description: 'Sezonowe składniki, domowe receptury i ciepła atmosfera — zapraszamy na lunch, kolację i weekendowy brunch.',
          button: 'Zarezerwuj stolik',
          button_enabled: true,
          button_url: '',
          image: '',
        },
        manifesto: { label: 'Gastronomia', title: '', text: '' },
        hours: {
          title: 'Godziny otwarcia',
          lines: ['Wt–Nd: 12:00 — 22:00', 'Pn: zamknięte', 'Niedziela brunch: 10:00 — 15:00'],
        },
        menu_mode: 'manual',
        menu_link: '',
        menu_image: '',
        orders: {
          label: 'Zamówienia i rezerwacje',
          title: 'Zadzwoń — przygotujemy na wynos',
          description:
            'Najszybciej obsłużymy zamówienie telefonicznie. Możesz też skorzystać z rezerwacji online, jeśli masz ustawiony przycisk w panelu.',
          call_button: 'Zadzwoń',
        },
        sections: {
          menu_label: 'Karta dań',
          location_label: 'Dojazd',
          contact_title: 'Kontakt i adres',
        },
        hero_actions: {
          menu_button: 'Zobacz Menu',
          call_button: 'Zadzwoń i zamów',
        },
        menu_items: [
          { category: 'Przystawki', name: 'Bruschetta pomidorowa', ingredients: 'pomidory, bazylia, oliwa extra virgin, czosnek', price: '24 zł' },
          { category: 'Przystawki', name: 'Carpaccio wołowe', ingredients: 'rukola, parmezan, kapary, oliwa truflowa', price: '38 zł' },
          { category: 'Dania główne', name: 'Tagliatelle z borowikami', ingredients: 'makaron świeży, borowiki, śmietana, tymianek', price: '46 zł' },
          { category: 'Dania główne', name: 'Stek z polędwicy', ingredients: '200 g, masło ziołowe, frytki, sałatka', price: '72 zł' },
          { category: 'Desery', name: 'Tiramisu', ingredients: 'mascarpone, espresso, kakao', price: '22 zł' },
        ],
        services: [],
        faq: [],
        contact: {
          email: '',
          phone: '',
          address: '',
          booking_url: '',
          bookingUrl: '',
          map_embed_url: '',
          map_place_id: '',
          whatsapp: '',
          messenger: '',
        },
        social: { facebook: '', instagram: '', tiktok: '' },
        seo: {
          title: 'Restauracja — menu i rezerwacje online',
          description: 'Sprawdź kartę dań, godziny otwarcia i zarezerwuj stolik. Sezonowe menu i lokalne składniki.',
          ogImage: '',
        },
        privacy: { mode: 'default', customText: '' },
        legal: { enabled: true, privacy_policy: '', terms: '' },
        settings: {
          subscription: { plan: 'trial', trial_started_at: new Date().toISOString() },
          template_version: 3,
          color_preset: 'wine',
          color_palette: 'dark_gold',
          booking_mode: 'button',
          background_style: 'smoky',
          font_preset: 'elegant',
          analytics: { gtm_id: '', fb_pixel_id: '' },
          growth: { dismissed_rule_ids: [], last_shown_rule_id: '', last_shown_at: '', onboarding_growth_seen: false },
          showManifesto: false,
          showServices: false,
          showContact: true,
          onboarding_completed: false,
        },
      },
    },
    care: {
      pl: {
        nav: {
          logo: 'Gabinet',
          cta: 'Umów wizytę',
          logoImage: '',
          menu: { about: 'O mnie', help: 'Obszary pomocy', pricing: 'Cennik', contact: 'Kontakt' },
        },
        hero: {
          name: 'mgr Anna Kowalska',
          headline: 'Fizjoterapeutka · specjalistka rehabilitacji',
          subheadline: '',
          description: 'Indywidualne podejście, oparte na dowodach metody i spokojna przestrzeń do powrotu do zdrowia.',
          button: 'Umów wizytę',
          button_enabled: true,
          button_url: '',
          image: '',
        },
        manifesto: {
          label: 'Gabinet',
          title: 'O mnie',
          text: 'Pracuję z pacjentami po urazach, z bólem przewlekłym i zaburzeniami postawy. Łączę manualną terapię z ćwiczeniami do domu — tak, żeby efekty były trwałe.',
        },
        help_areas: [
          { title: 'Ból kręgosłupa', desc: 'Diagnoza funkcjonalna, terapia manualna i plan ćwiczeń.' },
          { title: 'Rehabilitacja po urazie', desc: 'Powrót do sportu i codziennej aktywności pod okiem specjalisty.' },
          { title: 'Profilaktyka', desc: 'Ergonomia pracy, korekta wzorca ruchu, edukacja pacjenta.' },
        ],
        certificates: [
          { title: 'Dyplom fizjoterapii', issuer: 'AWF Warszawa · 2016' },
          { title: 'Terapia manualna — poziom zaawansowany', issuer: 'Osteo Academy · 2021' },
        ],
        services: [
          { title: 'Konsultacja wstępna', desc: 'Wywiad, badanie, plan terapii', duration: '60 min', price: '180 zł' },
          { title: 'Wizyta kontrolna', desc: 'Kontynuacja terapii i korekta ćwiczeń', duration: '45 min', price: '140 zł' },
          { title: 'Pakiet 5 wizyt', desc: 'Program rehabilitacyjny z rabatem', duration: '5 × 45 min', price: '620 zł' },
        ],
        faq: [],
        contact: {
          email: '',
          phone: '',
          address: '',
          booking_url: '',
          bookingUrl: '',
          map_embed_url: '',
          map_place_id: '',
          whatsapp: '',
          messenger: '',
        },
        social: { facebook: '', instagram: '', linkedin: '' },
        seo: {
          title: 'Gabinet fizjoterapii — umów wizytę online',
          description: 'Profesjonalna opieka, przejrzysty cennik i łatwy kontakt. Zaufaj specjaliście w Twojej okolicy.',
          ogImage: '',
        },
        privacy: { mode: 'default', customText: '' },
        legal: { enabled: true, privacy_policy: '', terms: '' },
        settings: {
          subscription: { plan: 'trial', trial_started_at: new Date().toISOString() },
          template_version: 3,
          color_preset: 'ocean',
          color_palette: 'medical_blue',
          booking_mode: 'button',
          background_style: 'clean',
          font_preset: 'inter',
          analytics: { gtm_id: '', fb_pixel_id: '' },
          growth: { dismissed_rule_ids: [], last_shown_rule_id: '', last_shown_at: '', onboarding_growth_seen: false },
          showManifesto: true,
          showServices: true,
          showContact: true,
          onboarding_completed: false,
        },
      },
    },
  };

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function getTemplate(theme, version = LATEST_TEMPLATE_VERSION) {
    if (version !== 3) version = 3;
    const t = templatesV3[theme];
    if (!t) throw new Error("Unknown theme: " + theme);
    return deepClone(t);
  }

  function getTemplateLabel(theme) {
    return TEMPLATE_LABELS[theme] || { name: theme, desc: '' };
  }

  /** Domyślna treść nowej strony (szablon setup + trial). Używane przy rejestracji z triggera DB i przy pierwszym logowaniu (fallback). */
  function buildNewSiteContent() {
    const c = getTemplate('setup');
    c.pl.settings.template_version = LATEST_TEMPLATE_VERSION || c.pl.settings.template_version || 3;
    c.pl.settings.subscription = {
      plan: 'trial',
      trial_started_at: new Date().toISOString(),
      selected_plan: null,
    };
    return c;
  }

  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  g.DFOPS_LATEST_TEMPLATE_VERSION = LATEST_TEMPLATE_VERSION;
  g.DFOPS_getTemplate = getTemplate;
  g.DFOPS_getTemplateLabel = getTemplateLabel;
  g.DFOPS_buildNewSiteContent = buildNewSiteContent;
  g.DFOPS_resolveTemplateKeyForMerge = resolveTemplateKeyForMerge;
  g.DFOPS_getTemplateCatalog = getTemplateCatalog;
  g.DFOPS_getPublishedThemeIds = getPublishedThemeIds;
  g.DFOPS_getWizardThemeIds = getWizardThemeIds;
  g.DFOPS_getWizardTemplateCatalog = getWizardTemplateCatalog;
  g.DFOPS_isPublishedTheme = isPublishedTheme;
  g.DFOPS_themeUsesColorPalette = themeUsesColorPalette;
})();

