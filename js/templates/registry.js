// Single source of truth for templates + versions
(function () {
  const LATEST_TEMPLATE_VERSION = 3;

  const TEMPLATE_LABELS = {
    setup: { name: 'Konfiguracja', desc: 'Widok startowy do czasu ukończenia kreatora' },
    beauty: { name: 'Beauty & Wellness', desc: 'Idealny dla salonów, spa, fizjoterapii i branży usługowej' },
    consultant: { name: 'Coaching & Biznes', desc: 'Stworzony dla trenerów, konsultantów, agencji i freelancerów' },
    fitness: { name: 'Fitness', desc: 'Studio, trening personalny, grafik zajęć' },
    services: { name: 'Usługi profesjonalne', desc: 'B2B, usługi lokalne (w przygotowaniu)' },
    gastro: { name: 'Gastro', desc: 'Restauracja, kawiarnia (w przygotowaniu)' },
  };

  /**
   * Merge treści z szablonem w DFOPS_mergeContentWithTemplate: dopóki nie ma pełnego JSON szablonu,
   * spadamy na `beauty`, żeby nie rzucać „Unknown theme” przy odczycie z bazy (Epik 3).
   */
  function resolveTemplateKeyForMerge(theme) {
    const id = typeof theme === 'string' ? theme.trim() : '';
    if (id && templatesV3[id]) return id;
    return 'beauty';
  }

  /** Kafelki w panelu: Wygląd → motyw branżowy (available = możliwa zmiana już teraz). */
  function getTemplateCatalog() {
    return [
      { id: 'beauty', name: 'Beauty', desc: 'Salon, spa, usługi lokalne', available: true },
      { id: 'consultant', name: 'Konsultant', desc: 'Ekspert, freelancer, B2B', available: true },
      { id: 'fitness', name: 'Fitness', desc: 'Studio, trening, sport', available: true },
      { id: 'services', name: 'Usługi', desc: 'Profesjonalne usługi, B2B', available: false },
      { id: 'gastro', name: 'Gastro', desc: 'Restauracja, kawiarnia', available: false },
    ];
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
        contact: { email: '', phone: '', address: '', booksyUrl: '', map_embed_url: '', map_place_id: '' },
        social: { facebook: '', instagram: '', tiktok: '' },
        google_reviews: { embed_url: '', place_query: '', max_reviews: 6, title: 'Opinie z Google' },
        gallery: { title: 'Nasze realizacje', images: [] },
        seo: {
          title: 'Strona w budowie — DFCMS',
          description: 'Trwa konfiguracja serwisu. Właściciel może zalogować się do panelu i dokończyć stronę w Kreatorze.',
          ogImage: '',
        },
        legal: { enabled: false, privacy_policy: '', terms: '' },
        settings: {
          template_version: 3,
          color_preset: 'gold',
          subscription: { plan: 'trial', trial_started_at: new Date().toISOString() },
          background_style: 'glow',
          font_preset: 'inter',
          showManifesto: false,
          showServices: false,
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
          menu: { about: "O nas", pricing: "Usługi", faq: "Pytania i odpowiedzi (Q&A)", reviews: "Opinie", contact: "Kontakt" },
        },
        hero: {
          name: "Witaj na pokładzie",
          headline: "Twoja przestrzeń <span class='text-brand-gold italic'>Ekspercka</span>.",
          subheadline: "",
          description: "Panel dla konsultantów i specjalistów. Gotowy na opinie i akordeony.",
          button: "Zaczynamy",
          image: ""
        },
        manifesto: { label: "", title: "", text: "" },
        services: [{ title: "Konsultacje 1:1", desc: "Krótki opis usługi — widoczny na stronie." }],
        proof: { label: "", title: "", text: "", statNumber: "", statLabel: "", statDesc: "" },
        faq: [],
        reviews: [],
        contact: {
          email: "",
          phone: "",
          address: "",
          map_embed_url: "",
          map_place_id: "",
          cta: {
            enabled: true,
            title: "Szybki kalendarz",
            description:
              "Wybierz dogodny termin i umów się na darmową, 15-minutową konsultację wstępną.",
            button_text: "Wybierz termin na Calendly",
            button_url: "https://calendly.com/",
          },
        },
        social: { linkedin: "", facebook: "", instagram: "", tiktok: "" },
        google_reviews: { embed_url: "", place_query: "", max_reviews: 6, title: "Opinie z Google" },
        gallery: { title: "Nasze realizacje", images: [] },
        seo: {
          title: "Konsultacje i coaching — profesjonalna strona eksperta",
          description:
            "Strona dla konsultantów, coachów i specjalistów. Umów rozmowę, poznaj ofertę i buduj zaufanie dzięki przejrzystemu, nowoczesnemu układowi.",
          ogImage: ""
        },
        footer: { quote: "", copyright: "", privacy: "" },
        legal: { enabled: true, privacy_policy: "", terms: "" },
        cookies: { text: "Ta strona używa plików cookies w celach funkcjonalnych.", accept: "Akceptuję" },
        settings: {
          darkMode: true,
          template_version: 3,
          color_preset: "dfops-tech",
          subscription: { plan: "trial", trial_started_at: new Date().toISOString() },
          background_style: "glow",
          font_preset: "inter",
          showManifesto: true,
          showServices: true,
          showProof: true,
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
        hero: { name: "Twoje miejsce", headline: "Odkryj <i>siebie</i> na nowo", description: "Krótki opis Twojej oferty i atmosfery.", button: "Umów wizytę", image: "", qrText: "", qrImage: "" },
        manifesto: { label: "O nas", title: "Kilka słów", text: "" },
        services: [],
        faq: [],
        contact: { phone: "", email: "", address: "", booksyUrl: "", map_embed_url: "", map_place_id: "" },
        social: { facebook: "", instagram: "", tiktok: "" },
        google_reviews: { embed_url: "", place_query: "", max_reviews: 6, title: "Opinie z Google" },
        gallery: { title: "Nasze realizacje", images: [] },
        seo: {
          title: "Salon beauty i zabiegi — rezerwacja online",
          description:
            "Profesjonalne zabiegi kosmetyczne, barber i relaks w jednym miejscu. Sprawdź cennik, przeczytaj opinie i umów wizytę w kilka kliknięć.",
          ogImage: ""
        },
        legal: { enabled: true, privacy_policy: "", terms: "" },
        settings: {
          subscription: { plan: "trial", trial_started_at: new Date().toISOString() },
          showManifesto: true,
          showServices: true,
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
          headline: "SILNIEJ. SZYBCIEJ.<br />BEZ WYMÓWEK.",
          subheadline: "",
          description: "Treningi personalne i małe grupy. Cel: Twoja forma — mierzalnie, bezpiecznie, bez chaosu.",
          button: "Umów trening",
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
          booksyUrl: "",
          map_embed_url: "",
          map_place_id: "",
        },
        social: { facebook: "", instagram: "", tiktok: "" },
        google_reviews: { embed_url: "", place_query: "", max_reviews: 6, title: "Opinie klientów" },
        gallery: { title: "Z studia", images: [] },
        seo: {
          title: "Trening personalny i studio fitness",
          description: "Treningi personalne, grafik zajęć i zapisy online. Sprawdź ofertę i zacznij dziś.",
          ogImage: "",
        },
        legal: { enabled: true, privacy_policy: "", terms: "" },
        settings: {
          subscription: { plan: "trial", trial_started_at: new Date().toISOString() },
          template_version: 3,
          color_preset: "neon-lime",
          background_style: "glow",
          font_preset: "inter",
          showManifesto: true,
          showServices: true,
          showFaq: true,
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

  window.DFOPS_LATEST_TEMPLATE_VERSION = LATEST_TEMPLATE_VERSION;
  window.DFOPS_getTemplate = getTemplate;
  window.DFOPS_getTemplateLabel = getTemplateLabel;
  window.DFOPS_buildNewSiteContent = buildNewSiteContent;
  window.DFOPS_resolveTemplateKeyForMerge = resolveTemplateKeyForMerge;
  window.DFOPS_getTemplateCatalog = getTemplateCatalog;
})();

