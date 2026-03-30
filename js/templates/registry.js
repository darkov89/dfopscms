// Single source of truth for templates + versions
(function () {
  const LATEST_TEMPLATE_VERSION = 3;

  const TEMPLATE_LABELS = {
    setup: { name: 'Konfiguracja', desc: 'Widok startowy do czasu ukończenia kreatora' },
    beauty: { name: 'Beauty & Wellness', desc: 'Idealny dla salonów, spa, fizjoterapii i branży usługowej' },
    consultant: { name: 'Coaching & Biznes', desc: 'Stworzony dla trenerów, konsultantów, agencji i freelancerów' }
  };

  const templatesV3 = {
    setup: {
      pl: {
        nav: { logo: 'DFCMS', cta: '', logoImage: '' },
        hero: {
          name: '',
          headline: 'Twoja strona jest już prawie gotowa!',
          subheadline: '',
          description:
            'Właśnie trwają prace nad konfiguracją Twojego serwisu. Jeśli jesteś właścicielem, zaloguj się do panelu admina, aby uruchomić Kreator Magii.',
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
        nav: { logo: "Ekspert", cta: "", logoImage: "" },
        hero: {
          name: "Witaj na pokładzie",
          headline: "Twoja przestrzeń <span class='text-brand-gold italic'>Ekspercka</span>.",
          subheadline: "",
          description: "Panel dla konsultantów i specjalistów. Gotowy na opinie i akordeony.",
          button: "Zaczynamy",
          image: ""
        },
        manifesto: { label: "", title: "", text: "" },
        services: [{ title: "Konsultacje 1:1", desc: "Zarządzaj swoimi usługami." }],
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
          menu: { about: "O nas", pricing: "Cennik", gallery: "Galeria", faq: "Q&A", contact: "Kontakt" }
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
    }
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
    };
    return c;
  }

  window.DFOPS_LATEST_TEMPLATE_VERSION = LATEST_TEMPLATE_VERSION;
  window.DFOPS_getTemplate = getTemplate;
  window.DFOPS_getTemplateLabel = getTemplateLabel;
  window.DFOPS_buildNewSiteContent = buildNewSiteContent;
})();

