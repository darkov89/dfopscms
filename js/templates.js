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
        manifesto: {
          label: "",
          title: "",
          text: ""
        },
        services: [{ title: "Konsultacje 1:1", desc: "Zarządzaj swoimi usługami." }],
        proof: {
          label: "",
          title: "",
          text: "",
          statNumber: "",
          statLabel: "",
          statDesc: ""
        },
        faq: [],
        reviews: [],
        contact: {
          email: "",
          phone: "",
          address: ""
        },
        social: { linkedin: "" },
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
        nav: { logo: "Sattva", cta: "Rezerwuj", logoImage: "" },
        hero: {
          name: "Gabinet",
          headline: "Zadbaj o siebie",
          description: "Krótki opis Twojego miejsca.",
          button: "Umów wizytę",
          image: "",
          qrText: "",
          qrImage: ""
        },
        manifesto: { label: "O nas", title: "Kilka słów", text: "" },
        services: [],
        faq: [],
        contact: { phone: "", email: "", address: "", booksyUrl: "" },
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

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function getTemplate(theme, version = LATEST_TEMPLATE_VERSION) {
    // Currently we ship v3 as the only canonical template.
    if (version !== 3) version = 3;
    const t = templatesV3[theme];
    if (!t) throw new Error("Unknown theme: " + theme);
    return deepClone(t);
  }

  window.DFOPS_LATEST_TEMPLATE_VERSION = LATEST_TEMPLATE_VERSION;
  window.DFOPS_getTemplate = getTemplate;
})();

