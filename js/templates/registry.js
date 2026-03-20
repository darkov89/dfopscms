// Single source of truth for templates + versions
(function () {
  const LATEST_TEMPLATE_VERSION = 3;

  const templatesV3 = {
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
        contact: { email: "", phone: "", address: "", map_embed_url: "" },
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
        cookies: { text: "Ta strona używa plików cookies w celach funkcjonalnych.", accept: "Akceptuję" },
        settings: {
          darkMode: false,
          template_version: 3,
          color_preset: "gold",
          background_style: "glow",
          font_preset: "inter",
          showManifesto: true,
          showServices: true,
          showProof: true,
          showFaq: true,
          showReviews: true,
          showContact: true
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
        contact: { phone: "", email: "", address: "", booksyUrl: "", map_embed_url: "" },
        social: { facebook: "", instagram: "", tiktok: "" },
        google_reviews: { embed_url: "", place_query: "", max_reviews: 6, title: "Opinie z Google" },
        gallery: { title: "Nasze realizacje", images: [] },
        seo: {
          title: "Salon beauty i zabiegi — rezerwacja online",
          description:
            "Profesjonalne zabiegi kosmetyczne, barber i relaks w jednym miejscu. Sprawdź cennik, przeczytaj opinie i umów wizytę w kilka kliknięć.",
          ogImage: ""
        },
        settings: {
          showManifesto: true,
          showServices: true,
          showFaq: true,
          showContact: true,
          template_version: 3,
          color_preset: "beige",
          background_style: "soft",
          font_preset: "poppins"
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

  window.DFOPS_LATEST_TEMPLATE_VERSION = LATEST_TEMPLATE_VERSION;
  window.DFOPS_getTemplate = getTemplate;
})();

