// DFCMS Custom AI Sites — Shared Block Defaults
// Source of truth for block schemas across Edge Functions (chat-site-agent, god-provision-site)

// deno-lint-ignore no-explicit-any
export const BLOCK_DEFAULTS: Record<string, Record<string, any>> = {
  cinematic_hero: {
    title: "Twórca Filmowy",
    subtitle: "Director & Cinematographer",
    tagline: "Historie opowiadane światłem i ruchem.",
    video_url: "https://vimeo.com/76979871",
    video_provider: "vimeo",
    video_id: "76979871",
    showreel_url: "https://vimeo.com/76979871",
    cta_text: "Odtwórz Showreel",
    cta_secondary_text: "Zobacz Projekty",
    cta_secondary_target: "#projekty",
  },
  projects_grid: {
    heading: "Wybrane Realizacje",
    subheading: "Reklama · Teledyski · Formy Fabularne",
    items: [
      {
        id: "p1",
        title: "Spot Komercyjny — Nowa Fala",
        category: "Commercial",
        role: "Reżyseria / Zdjęcia",
        video_url: "https://vimeo.com/76979871",
        thumbnail: "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=800&q=80",
      },
      {
        id: "p2",
        title: "Teledysk — Nocny Kurs",
        category: "Music Video",
        role: "Director of Photography",
        video_url: "https://vimeo.com/76979871",
        thumbnail: "https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&w=800&q=80",
      },
    ],
  },
  awards_strip: {
    heading: "Wyróżnienia & Festiwale",
    items: [
      { name: "Camerimage 2025", desc: "Oficjalna selekcja" },
      { name: "Fryderyk 2024", desc: "Nominacja — Teledysk Roku" },
      { name: "Grand Video Awards", desc: "Nagroda Główna w kategorii Branded Content" },
    ],
  },
  director_statement: {
    heading: "Podejście i Wizja",
    quote: "Kino to dla mnie przede wszystkim rytm, kontrast i autentyczność.",
    text: "Od ponad 8 lat realizuję projekty wideo dla czołowych marek i artystów w Polsce i za granicą. Łączę rzemiosło operatorskie z narracją fabularną.",
    signature: "Jan Kowalski",
  },
  minimal_contact: {
    heading: "Porozmawiajmy o projekcie",
    subheading: "Dostępność: realizacje komercyjne, teledyski, etiudy i filmy dokumentalne.",
    phone: "+48 600 700 800",
    email: "kontakt@tworcafilmowy.pl",
    instagram: "https://instagram.com/",
    vimeo: "https://vimeo.com/",
    location: "Warszawa · Dostępny na całym świecie",
  },
  quick_hero: {
    badge: "Dostępny od zaraz",
    title: "Usługi Elektryczne — Szybko i Solidnie",
    subtitle: "Kompleksowe instalacje, pomiary i usuwanie awarii.",
    city: "Poznań i okolice",
    phone: "+48 600 700 800",
    whatsapp: "+48600700800",
    cta_primary_text: "Zadzwoń teraz",
    cta_secondary_text: "Napisz na WhatsApp",
  },
  key_features: {
    heading: "Dlaczego warto?",
    items: [
      {
        title: "Ekspresowy dojazd",
        desc: "W nagłych awariach jesteśmy na miejscu w 60 minut.",
        icon: "bolt",
      },
      {
        title: "Uprawnienia SEP",
        desc: "Pełne uprawnienia dozoru i eksploatacji, protokoły do ubezpieczenia.",
        icon: "check",
      },
      {
        title: "Gwarancja i faktura",
        desc: "Darmowa wycena przed rozpoczęciem prac, faktury VAT 23%.",
        icon: "shield",
      },
    ],
  },
  quick_contact_card: {
    heading: "Skontaktuj się bezpośrednio",
    company_name: "Elektro-Fach Poznań",
    address: "ul. Dąbrowskiego 45",
    city: "60-842 Poznań",
    phone: "+48 600 700 800",
    email: "kontakt@elektrofach.pl",
    hours: "Poniedziałek – Sobota: 7:00 – 21:00\nPogotowie awaryjne: 24/7",
    booking_url: "",
  },
  faq_simple: {
    heading: "Często zadawane pytania",
    items: [
      { question: "Jak szybko możecie przyjechać?", answer: "W przypadku awarii zazwyczaj dojeżdżamy w ciągu 45-60 minut." },
      { question: "Czy wycena jest płatna?", answer: "Wstępna wycena telefoniczna jest całkowicie bezpłatna." },
    ],
  },
};
