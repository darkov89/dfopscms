/**
 * DFCMS Custom AI Sites — Rejestr bloków i silnik mutacji atomowych.
 * Używany zarówno w przeglądarce (studio.html / custom.html) jak i w Edge Function (chat-site-agent) oraz testach Node.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DFOPS_customBlocksRegistry = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function toCleanString(v, fallback = '') {
    if (v == null) return fallback;
    if (typeof v === 'string') {
      const s = v.trim();
      return s === '[object Object]' ? fallback : s;
    }
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      if (typeof v.text === 'string') return toCleanString(v.text, fallback);
      if (typeof v.title === 'string') return toCleanString(v.title, fallback);
      if (typeof v.name === 'string') return toCleanString(v.name, fallback);
      if (typeof v.value === 'string') return toCleanString(v.value, fallback);
      if (typeof v.desc === 'string') return toCleanString(v.desc, fallback);
      if (typeof v.content === 'string') return toCleanString(v.content, fallback);
      return fallback;
    }
    const s = String(v).trim();
    return s === '[object Object]' ? fallback : s;
  }

  function extractVideoMeta(url) {
    if (!url || typeof url !== 'string') return { provider: 'unknown', id: '', embedUrl: '' };
    const cleanUrl = url.trim();

    // Vimeo
    const vimeoMatch = cleanUrl.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
    if (vimeoMatch) {
      return {
        provider: 'vimeo',
        id: vimeoMatch[1],
        embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1&dnt=1&title=0&byline=0&portrait=0`,
        loopUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?background=1&autoplay=1&loop=1&byline=0&title=0&muted=1&dnt=1`,
      };
    }

    // YouTube
    const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      return {
        provider: 'youtube',
        id: ytMatch[1],
        embedUrl: `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=1&rel=0`,
        loopUrl: `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=1&mute=1&loop=1&playlist=${ytMatch[1]}&controls=0&showinfo=0`,
      };
    }

    // Cloudflare Stream
    const cfStreamMatch = cleanUrl.match(/(?:videodelivery\.net\/|cloudflarestream\.com\/|iframe\.videodelivery\.net\/)([a-zA-Z0-9_-]{32})/);
    if (cfStreamMatch) {
      return {
        provider: 'cloudflare_stream',
        id: cfStreamMatch[1],
        embedUrl: `https://iframe.videodelivery.net/${cfStreamMatch[1]}`,
        loopUrl: `https://iframe.videodelivery.net/${cfStreamMatch[1]}?autoplay=true&loop=true&muted=true&controls=false`,
      };
    }

    // MP4 / Direct link
    if (/\.(mp4|webm|mov)(\?.*)?$/i.test(cleanUrl)) {
      return {
        provider: 'direct',
        id: cleanUrl,
        embedUrl: cleanUrl,
        loopUrl: cleanUrl,
      };
    }

    return { provider: 'custom', id: cleanUrl, embedUrl: cleanUrl, loopUrl: cleanUrl };
  }

  const CATALOG_GROUPS = [
    { id: 'all', label: 'Wszystkie' },
    { id: 'offer', label: 'Oferta i cennik' },
    { id: 'trust', label: 'Opinie i zaufanie' },
    { id: 'contact', label: 'Kontakt' },
    { id: 'info', label: 'Informacje i FAQ' },
    { id: 'hero', label: 'Ekrany główne' },
  ];

  const BLOCK_DEFINITIONS = {
    // === BLOKI FILMOWE / CINEMATIC ===
    cinematic_hero: {
      type: 'cinematic_hero',
      label: 'Główny ekran filmowy (Hero Video)',
      category: 'cinematic',
      catalog_group: 'hero',
      icon: '🎬',
      summary: 'Ekran powitalny z wideo w tle lub odtwarzaczem showreela',
      allow_multiple: false,
      required_fields: [
        { key: 'video_url', label: 'Link do wideo', ask: 'Podaj link do filmu (Vimeo lub YouTube), który ma pojawić się na głównym ekranie.' },
      ],
      defaults: {
        title: 'Twórca Filmowy',
        subtitle: 'Director & Cinematographer',
        tagline: 'Historie opowiadane światłem i ruchem.',
        video_url: 'https://vimeo.com/76979871',
        video_provider: 'vimeo',
        video_id: '76979871',
        showreel_url: 'https://vimeo.com/76979871',
        cta_text: 'Odtwórz Showreel',
        cta_secondary_text: 'Zobacz Projekty',
        cta_secondary_target: '#projekty',
      },
    },
    projects_grid: {
      type: 'projects_grid',
      label: 'Siatka projektów wideo',
      category: 'cinematic',
      catalog_group: 'offer',
      icon: '🎞️',
      summary: 'Siatka wybranych realizacji wideo i portfolio',
      allow_multiple: true,
      required_fields: [
        { key: 'heading', label: 'Tytuł sekcji', ask: 'Dodałem siatkę realizacji wideo. Jakie projekty chcesz tutaj zaprezentować?' },
      ],
      defaults: {
        heading: 'Wybrane Realizacje',
        subheading: 'Reklama · Teledyski · Formy Fabularne',
        feed_source: { type: 'manual', handle: '', folder_id: '' },
        items: [
          {
            id: 'p1',
            title: 'Spot Komercyjny — Nowa Fala',
            category: 'Commercial',
            role: 'Reżyseria / Zdjęcia',
            video_url: 'https://vimeo.com/76979871',
            thumbnail: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=800&q=80',
          },
          {
            id: 'p2',
            title: 'Teledysk — Nocny Kurs',
            category: 'Music Video',
            role: 'Director of Photography',
            video_url: 'https://vimeo.com/76979871',
            thumbnail: 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&w=800&q=80',
          },
        ],
      },
    },
    awards_strip: {
      type: 'awards_strip',
      label: 'Pasek nagród i festiwali',
      category: 'cinematic',
      catalog_group: 'trust',
      icon: '🏆',
      summary: 'Pasek nagród, festiwali i wyróżnień branżowych',
      allow_multiple: false,
      required_fields: [
        { key: 'items', label: 'Wyróżnienia', ask: 'Wstawiłem pasek nagród. Jakie wyróżnienia lub certyfikaty chcesz w nim umieścić?' },
      ],
      defaults: {
        heading: 'Wyróżnienia & Festiwale',
        items: [
          { name: 'Camerimage 2025', desc: 'Oficjalna selekcja' },
          { name: 'Fryderyk 2024', desc: 'Nominacja — Teledysk Roku' },
          { name: 'Grand Video Awards', desc: 'Nagroda Główna w kategorii Branded Content' },
        ],
      },
    },
    director_statement: {
      type: 'director_statement',
      label: 'O mnie / Statement artystyczny',
      category: 'cinematic',
      catalog_group: 'info',
      icon: '✍️',
      summary: 'Osobisty manifest artystyczny, misja i bio',
      allow_multiple: false,
      required_fields: [
        { key: 'quote', label: 'Cytat / Myśl przewodnia', ask: 'Wstawiłem sekcję o Twojej wizji. Jaki cytat lub motto najlepiej oddaje Twoje podejście?' },
      ],
      defaults: {
        heading: 'Podejście i Wizja',
        quote: 'Kino to dla mnie przede wszystkim rytm, kontrast i autentyczność.',
        text: 'Od ponad 8 lat realizuję projekty wideo dla czołowych marek i artystów w Polsce i za granicą. Łączę rzemiosło operatorskie z narracją fabularną.',
        signature: 'Jan Kowalski',
      },
    },
    minimal_contact: {
      type: 'minimal_contact',
      label: 'Kontakt minimalistyczny',
      category: 'cinematic',
      catalog_group: 'contact',
      icon: '✉️',
      summary: 'Minimalistyczny blok kontaktu: telefon, email, social media',
      allow_multiple: false,
      required_fields: [
        { key: 'phone', label: 'Telefon', ask: 'Podaj numer telefonu, a od razu uzupełnię go w nowej sekcji kontaktowej.' },
      ],
      defaults: {
        heading: 'Porozmawiajmy o projekcie',
        subheading: 'Dostępność: realizacje komercyjne, teledyski, etiudy i filmy dokumentalne.',
        phone: '+48 600 700 800',
        email: 'kontakt@tworcafilmowy.pl',
        instagram: 'https://instagram.com/',
        vimeo: 'https://vimeo.com/',
        location: 'Warszawa · Dostępny na całym świecie',
      },
    },

    // === BLOKI SZYBKIEJ WIZYTÓWKI / QUICK CARD ===
    quick_hero: {
      type: 'quick_hero',
      label: 'Szybki nagłówek z bezpośrednim kontaktem',
      category: 'quick_card',
      catalog_group: 'hero',
      icon: '⚡',
      summary: 'Nagłówek usługowy z bezpośrednim CTA telefonicznym i WhatsApp',
      allow_multiple: false,
      required_fields: [
        { key: 'phone', label: 'Telefon kontaktowy', ask: 'Jaki numer telefonu ma być głównym numerem do szybkiego kontaktu?' },
      ],
      defaults: {
        badge: 'Dostępny od zaraz',
        title: 'Usługi Elektryczne — Szybko i Solidnie',
        subtitle: 'Kompleksowe instalacje, pomiary i usuwanie awarii.',
        city: 'Poznań i okolice',
        phone: '+48 600 700 800',
        whatsapp: '+48600700800',
        cta_primary_text: 'Zadzwoń teraz',
        cta_secondary_text: 'Napisz na WhatsApp',
      },
    },
    key_features: {
      type: 'key_features',
      label: '3 kluczowe atuty / usługi',
      category: 'quick_card',
      catalog_group: 'offer',
      icon: '✨',
      summary: '3 kluczowe atuty i przewagi Twojej oferty',
      allow_multiple: true,
      required_fields: [
        { key: 'items', label: 'Atuty', ask: 'Dodałem 3 kluczowe atuty. Jakie główne przewagi Twojej firmy chcesz tu wyeksponować?' },
      ],
      defaults: {
        heading: 'Dlaczego warto?',
        items: [
          {
            title: 'Ekspresowy dojazd',
            desc: 'W nagłych awariach jesteśmy na miejscu w 60 minut.',
            icon: 'bolt',
          },
          {
            title: 'Uprawnienia SEP',
            desc: 'Pełne uprawnienia dozoru i eksploatacji, protokoły do ubezpieczenia.',
            icon: 'check',
          },
          {
            title: 'Gwarancja i faktura',
            desc: 'Darmowa wycena przed rozpoczęciem prac, faktury VAT 23%.',
            icon: 'shield',
          },
        ],
      },
    },
    quick_contact_card: {
      type: 'quick_contact_card',
      label: 'Karta adresowa i kontaktowa',
      category: 'quick_card',
      catalog_group: 'contact',
      icon: '📞',
      summary: 'Karta adresowa z godzinami otwarcia i bezpośrednim kontaktem',
      allow_multiple: false,
      required_fields: [
        { key: 'phone', label: 'Telefon', ask: 'Podaj numer telefonu oraz godziny otwarcia, a natychmiast je uzupełnię.' },
      ],
      defaults: {
        heading: 'Skontaktuj się bezpośrednio',
        company_name: 'Usługi Elektryczne Jan Kowalski',
        address: 'ul. Przykładowa 12/4',
        city: '60-100 Poznań',
        phone: '+48 600 700 800',
        email: 'biuro@elektryk-poznan.pl',
        hours: 'Poniedziałek – Sobota: 7:00 – 21:00\nPogotowie awaryjne: 24/7',
        booking_url: '',
      },
    },
    faq_simple: {
      type: 'faq_simple',
      label: 'Częste pytania (FAQ)',
      category: 'quick_card',
      catalog_group: 'info',
      icon: '💬',
      summary: 'Prosta lista najczęściej zadawanych pytań z odpowiedziami',
      allow_multiple: true,
      required_fields: [
        { key: 'heading', label: 'Pytania i odpowiedzi', ask: 'Wstawiłem sekcję FAQ. Jakie pytania najczęściej słyszysz od swoich klientów?' },
      ],
      defaults: {
        heading: 'Często zadawane pytania',
        items: [
          { question: 'Jak szybko możecie przyjechać?', answer: 'W przypadku awarii zazwyczaj dojeżdżamy w ciągu 45-60 minut.' },
          { question: 'Czy wycena jest płatna?', answer: 'Wstępna wycena telefoniczna jest całkowicie bezpłatna.' },
        ],
      },
    },

    // === BLOKI UNIWERSALNE ===
    testimonials_grid: {
      type: 'testimonials_grid',
      label: 'Opinie klientów (siatka)',
      category: 'universal',
      catalog_group: 'trust',
      icon: '⭐',
      summary: 'Kafelki z opiniami klientów i oceną gwiazdkową',
      allow_multiple: true,
      required_fields: [
        { key: 'items', label: 'Opinie', ask: 'Dodałem sekcję z opiniami. Czy chcesz podmienić te przykłady na realne cytaty Twoich klientów?' },
      ],
      defaults: {
        heading: 'Co mówią nasi klienci',
        items: [
          { name: 'Anna K.', text: 'Profesjonalna obsługa i szybki termin. Zdecydowanie polecam!', rating: 5 },
          { name: 'Marek W.', text: 'Solidna robota, wysoka jakość i przejrzyste zasady współpracy.', rating: 5 },
          { name: 'Katarzyna M.', text: 'Bardzo dobry kontakt i terminowa realizacja projektu.', rating: 5 },
        ],
      },
    },
    faq_accordion: {
      type: 'faq_accordion',
      label: 'FAQ z akordeonem (rozwijane pytania)',
      category: 'universal',
      catalog_group: 'info',
      icon: '❓',
      summary: 'Rozwijany akordeon pytań i odpowiedzi (oszczędność miejsca)',
      allow_multiple: true,
      required_fields: [
        { key: 'items', label: 'Pytania', ask: 'Dodałem rozwijane FAQ. O co najczęściej pytają Cię klienci przed zakupem lub współpracą?' },
      ],
      defaults: {
        heading: 'Najczęściej zadawane pytania',
        items: [
          { question: 'Jak wygląda proces współpracy?', answer: 'Na początku ustalamy zakres prac i termin, a następnie przedstawiamy bezpłatną wycenę.' },
          { question: 'Jaki jest standardowy czas realizacji?', answer: 'Standardowy termin wynosi od 3 do 7 dni roboczych, w zależności od skali projektu.' },
          { question: 'Czy wystawiacie fakturę VAT?', answer: 'Tak, do każdego zlecenia wystawiamy pełną fakturę VAT 23%.' },
        ],
      },
    },
    pricing_tiers: {
      type: 'pricing_tiers',
      label: 'Cennik i pakiety usług',
      category: 'universal',
      catalog_group: 'offer',
      icon: '💰',
      summary: 'Cennik pakietowy z listą korzyści i przyciskami wyboru',
      allow_multiple: false,
      required_fields: [
        { key: 'items', label: 'Ceny i pakiety', ask: 'Dodałem cennik z 3 pakietami. Czy chcesz, abym dostosował ceny lub nazwy pakietów?' },
      ],
      defaults: {
        heading: 'Przejrzysty cennik',
        subheading: 'Wybierz pakiet dopasowany do Twoich potrzeb. Bez ukrytych opłat.',
        items: [
          {
            name: 'Pakiet Podstawowy',
            price: '199 zł',
            period: '',
            features: ['Wstępna konsultacja', 'Szybka wycena w 24h', 'Gwarancja jakości'],
            highlighted: false,
            cta_text: 'Wybierz pakiet',
          },
          {
            name: 'Pakiet Profesjonalny',
            price: '499 zł',
            period: '',
            features: ['Wszystko z Podstawowego', 'Priorytetowy termin', 'Protokół i raport', 'Gwarancja 24 miesiące'],
            highlighted: true,
            cta_text: 'Najpopularniejszy',
          },
          {
            name: 'Pakiet Indywidualny',
            price: 'Wycena',
            period: 'indywidualna',
            features: ['Kompleksowa obsługa', 'Dedykowany opiekun', 'Wsparcie posprzedażowe', 'Elastyczne warunki'],
            highlighted: false,
            cta_text: 'Skontaktuj się',
          },
        ],
      },
    },
    trust_stats: {
      type: 'trust_stats',
      label: 'Liczby i zaufanie (Statystyki)',
      category: 'universal',
      catalog_group: 'trust',
      icon: '📈',
      summary: 'Kafelki z kluczowymi liczbami, sukcesami i wskaźnikami zaufania',
      allow_multiple: false,
      required_fields: [
        { key: 'items', label: 'Wskaźniki', ask: 'Jakie kluczowe liczby chcesz wyróżnić (np. lata na rynku, zrealizowane projekty, zadowoleni klienci)?' },
      ],
      defaults: {
        heading: 'Liczby, które mówią same za siebie',
        subheading: 'Konkretne rezultaty i wieloletnie doświadczenie',
        items: [
          { value: '10+', label: 'Lat doświadczenia', desc: 'Na rynku usług' },
          { value: '500+', label: 'Zrealizowanych zleceń', desc: 'Dla klientów indywidualnych i firm' },
          { value: '100%', label: 'Zadowolonych klientów', desc: 'Gwarancja jakości i terminowości' },
          { value: '24h', label: 'Czas reakcji', desc: 'Szybki kontakt i wycena' },
        ],
      },
    },
    services_list: {
      type: 'services_list',
      label: 'Lista usług i cennik',
      category: 'universal',
      catalog_group: 'offer',
      icon: '🏷️',
      summary: 'Przejrzysta lista pozycji z cenami, czasem trwania i opisem',
      allow_multiple: true,
      required_fields: [
        { key: 'items', label: 'Lista usług', ask: 'Jakie usługi i w jakich cenach świadczysz? Wymień je, a od razu wpiszę je na listę.' },
      ],
      defaults: {
        heading: 'Nasze Usługi',
        subheading: 'Wybierz usługę dopasowaną do Twoich potrzeb',
        items: [
          { title: 'Usługa Podstawowa', desc: 'Szybka realizacja i standardowy zakres prac', price: 'od 150 zł', duration: '60 min' },
          { title: 'Usługa Kompleksowa', desc: 'Pełne wykonanie, materiały i gwarancja', price: 'od 350 zł', duration: '120 min' },
          { title: 'Konsultacja i Diagnoza', desc: 'Dojazd, sprawdzenie i kosztorys na miejscu', price: 'Bezpłatnie', duration: '30 min' },
        ],
      },
    },
    booking_cta: {
      type: 'booking_cta',
      label: 'Szybka rezerwacja terminu',
      category: 'universal',
      catalog_group: 'contact',
      icon: '📅',
      summary: 'Dedykowana sekcja z wezwaniem do rezerwacji terminu online lub telefonu',
      allow_multiple: false,
      required_fields: [
        { key: 'booking_url', label: 'Link do rezerwacji lub telefon', ask: 'Podaj link do systemu rezerwacji (np. Booksy, Calendly) lub numer telefonu do umawiania wizyt.' },
      ],
      defaults: {
        badge: 'Dostępne terminy w tym tygodniu',
        heading: 'Zarezerwuj dogodny termin już teraz',
        subheading: 'Umów wizytę w kilka sekund bez czekania na telefon.',
        button_text: 'Zarezerwuj wizytę',
        booking_url: '#kontakt',
        phone: '+48 600 700 800',
        note: 'Bezpłatne odwołanie do 24h przed wizytą',
      },
    },
    location_map: {
      type: 'location_map',
      label: 'Lokalizacja i mapa Google',
      category: 'universal',
      catalog_group: 'contact',
      icon: '📍',
      summary: 'Adres stacjonarny, godziny otwarcia i interaktywna mapa',
      allow_multiple: false,
      required_fields: [
        { key: 'address', label: 'Adres', ask: 'Podaj dokładny adres swojej firmy, abyśmy mogli wycentrować mapę Google.' },
      ],
      defaults: {
        heading: 'Nasza Lokalizacja',
        subheading: 'Odwiedź nas stacjonarnie lub sprawdź dojazd',
        address: 'ul. Przykładowa 12, 60-100 Poznań',
        city: 'Poznań',
        phone: '+48 600 700 800',
        hours: 'Poniedziałek – Piątek: 8:00 – 18:00\nSobota: 9:00 – 14:00',
        map_embed_url: '',
      },
    },
    gallery_grid: {
      type: 'gallery_grid',
      label: 'Galeria zdjęć i realizacji',
      category: 'universal',
      catalog_group: 'info',
      icon: '🖼️',
      summary: 'Estetyczna siatka fotografii z podpisami i kategoriami',
      allow_multiple: true,
      required_fields: [
        { key: 'heading', label: 'Tytuł galerii', ask: 'Dodałem galerię zdjęć. Możesz wgrać własne zdjęcia przyciskiem 📷 w czacie!' },
      ],
      defaults: {
        heading: 'Galeria Realizacji',
        subheading: 'Zobacz efekty naszej pracy na fotografiach',
        feed_source: { type: 'manual', handle: '', folder_id: '' },
        items: [
          { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=80', title: 'Precyzja i jakość', category: 'Montaż' },
          { url: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80', title: 'Nowoczesne rozwiązania', category: 'Projekt' },
          { url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80', title: 'Dbałość o detale', category: 'Realizacja' },
          { url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80', title: 'Komfortowa przestrzeń', category: 'Wnętrza' },
        ],
      },
    },
    google_reviews: {
      type: 'google_reviews',
      label: 'Opinie z Google (Google Places)',
      category: 'universal',
      catalog_group: 'trust',
      icon: '⭐',
      summary: 'Wizytówka Google, gwiazdki i opinie pobierane z Google Maps',
      allow_multiple: false,
      required_fields: [
        { key: 'place_query', label: 'Nazwa w Google', ask: 'Podaj dokładną nazwę swojej firmy w Google Maps (oraz miasto), aby pobrać opinie z wizytówki.' },
      ],
      defaults: {
        heading: 'Opinie z Profilu Google',
        place_name: '',
        place_id: '',
        place_query: '',
        rating: null,
        reviews_count: 0,
        user_ratings_total: 0,
        write_review_url: '',
        items: [],
      },
    },
  };

  /**
   * Tworzy stan początkowy dla motywu filmowego.
   */
  function createInitialCinematicState(answers) {
    const a = answers || {};
    const name = toCleanString(a.name, 'Jan Kowalski');
    const role = toCleanString(a.role, 'Director & Cinematographer');
    const videoUrl = toCleanString(a.video_url, 'https://vimeo.com/76979871');
    const videoMeta = extractVideoMeta(videoUrl);
    const phone = toCleanString(a.phone, '+48 600 700 800');
    const email = toCleanString(a.email, 'kontakt@tworca.pl');
    const city = toCleanString(a.city, 'Warszawa · Dostępny na całym świecie');

    return {
      theme_type: 'cinematic',
      design: {
        palette: 'dark_gold',
        accent_color: '#D4AF37',
        bg_color: '#0d0d0d',
        font_theme: 'cinematic_sans',
      },
      meta: {
        title: `${name} — ${role}`,
        description: `Oficjalne portfolio: ${name} (${role}). Wybrane realizacje komercyjne, teledyski i showreel.`,
      },
      blocks: [
        {
          id: 'hero_cinematic',
          type: 'cinematic_hero',
          data: {
            title: name,
            subtitle: role,
            tagline: a.tagline || 'Kino tworzone pasją, światłem i ruchem.',
            video_url: videoUrl,
            video_provider: videoMeta.provider,
            video_id: videoMeta.id,
            showreel_url: videoUrl,
            cta_text: 'Odtwórz Showreel',
            cta_secondary_text: 'Zobacz Realizacje',
            cta_secondary_target: '#projekty',
          },
        },
        {
          id: 'projects_grid',
          type: 'projects_grid',
          data: {
            heading: 'Wybrane Projekty',
            subheading: 'Reklamy · Muzyka · Formy Krótkometrażowe',
            items: [
              {
                id: 'p1',
                title: 'Spot Wizerunkowy — Pęd ku przyszłości',
                category: 'Commercial',
                role: role,
                video_url: videoUrl,
                thumbnail: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=800&q=80',
              },
              {
                id: 'p2',
                title: 'Krótki metraż — Ostatni Kadr',
                category: 'Narrative',
                role: 'Director of Photography',
                video_url: videoUrl,
                thumbnail: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=800&q=80',
              },
            ],
          },
        },
        {
          id: 'awards_strip',
          type: 'awards_strip',
          data: {
            heading: 'Nagrody & Festiwale',
            items: [
              { name: 'Camerimage Festival', desc: 'Official Selection' },
              { name: 'Festiwal Polskich Filmów', desc: 'Wyróżnienie za zdjęcia' },
            ],
          },
        },
        {
          id: 'director_statement',
          type: 'director_statement',
          data: {
            heading: 'O Mnie',
            quote: 'Każdy kadr powinien wnosić emocję, a nie być jedynie ładnym obrazem.',
            text: 'Pracuję na planach filmowych i reklamowych od ponad dekady. Dbam o każdy detal światła, kompozycji i atmosfery.',
            signature: name,
          },
        },
        {
          id: 'minimal_contact',
          type: 'minimal_contact',
          data: {
            heading: 'Współpraca',
            subheading: 'Masz pomysł na projekt, teledysk lub kampanię? Napisz lub zadzwoń.',
            phone: phone,
            email: email,
            instagram: a.instagram || 'https://instagram.com/',
            vimeo: videoUrl,
            location: city,
          },
        },
      ],
      pl: {
        settings: {
          subscription: {
            plan: 'trial',
            trial_started_at: a.trial_started_at || new Date().toISOString(),
          },
          privacy: {
            mode: 'default',
          },
        },
      },
    };
  }

  /**
   * Tworzy stan początkowy dla szybkiej wizytówki.
   */
  function createInitialQuickCardState(answers) {
    const a = answers || {};
    const businessName = toCleanString(a.business_name || a.name, 'Usługi Specjalistyczne');
    const city = toCleanString(a.city, 'Warszawa i okolice');
    const specialty = toCleanString(a.specialty || a.role, 'Szybkie i profesjonalne usługi');
    const phone = toCleanString(a.phone, '+48 600 700 800');
    const email = toCleanString(a.email, 'kontakt@wizytowka.pl');
    const rawWhatsapp = toCleanString(a.whatsapp, phone);
    const whatsapp = rawWhatsapp.replace(/\s+/g, '');

    return {
      theme_type: 'quick_card',
      design: {
        palette: 'clean_light',
        accent_color: '#D4AF37',
        bg_color: '#ffffff',
        font_theme: 'modern_sans',
      },
      meta: {
        title: `${businessName} — ${city}`,
        description: `${businessName} — ${specialty}. Szybki kontakt: ${phone}.`,
      },
      blocks: [
        {
          id: 'quick_hero',
          type: 'quick_hero',
          data: {
            badge: 'Otwarte dzisiaj · Szybki dojazd',
            title: businessName,
            subtitle: specialty,
            city: city,
            phone: phone,
            whatsapp: whatsapp,
            cta_primary_text: 'Zadzwoń teraz',
            cta_secondary_text: 'Napisz na WhatsApp',
          },
        },
        {
          id: 'key_features',
          type: 'key_features',
          data: {
            heading: 'Dlaczego my?',
            items: [
              { title: 'Szybki czas reakcji', desc: 'Odbieramy telefony na bieżąco i ustalamy dogodny termin.', icon: 'clock' },
              { title: 'Wieloletnie doświadczenie', desc: 'Rzetelne podejście, profesjonalny sprzęt i gwarancja jakości.', icon: 'star' },
              { title: 'Jasna wycena', desc: 'Zero ukrytych kosztów — cenę znasz przed rozpoczęciem prac.', icon: 'check' },
            ],
          },
        },
        {
          id: 'quick_contact_card',
          type: 'quick_contact_card',
          data: {
            heading: 'Dane kontaktowe',
            company_name: businessName,
            address: a.address || 'Obszar całego miasta i okolic',
            city: city,
            phone: phone,
            email: email,
            hours: 'Poniedziałek – Piątek: 8:00 – 18:00\nSobota: 9:00 – 14:00',
            booking_url: a.booking_url || '',
          },
        },
        {
          id: 'faq_simple',
          type: 'faq_simple',
          data: {
            heading: 'Pytania i odpowiedzi',
            items: [
              { question: 'Jak mogę się umówić?', answer: `Najszybciej pod numerem ${phone} lub wiadomością na WhatsApp.` },
              { question: 'Jaki jest obszar działania?', answer: `Działamy na terenie: ${city}.` },
            ],
          },
        },
      ],
      pl: {
        settings: {
          subscription: {
            plan: 'trial',
            trial_started_at: a.trial_started_at || new Date().toISOString(),
          },
          privacy: {
            mode: 'default',
          },
        },
      },
    };
  }

  // === MUTACJE ATOMOWE (STOSOWANE PRZEZ AGENTA I PODGLĄD) ===

  function setDeepValue(obj, path, value) {
    if (!obj || typeof obj !== 'object') return false;
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (p === '__proto__' || p === 'constructor' || p === 'prototype') return false;
      if (!(p in cur) || cur[p] == null || typeof cur[p] !== 'object') {
        cur[p] = {};
      }
      cur = cur[p];
    }
    const last = parts[parts.length - 1];
    if (last === '__proto__' || last === 'constructor' || last === 'prototype') return false;
    cur[last] = value;
    return true;
  }

  function applyBlockUpdate(blocks, blockId, path, value) {
    const list = Array.isArray(blocks) ? deepClone(blocks) : [];
    const block = list.find((b) => b.id === blockId);
    if (!block) return { success: false, blocks: list, error: `Blok o ID '${blockId}' nie istnieje.` };

    if (!block.data) block.data = {};

    // P4.3: Walidacja typów pól tablicowych (zapobiega crashom w x-for) i oczyszczanie stringów
    let resolvedValue = value;
    const def = BLOCK_DEFINITIONS[block.type];
    if (def && def.defaults && Object.prototype.hasOwnProperty.call(def.defaults, path)) {
      const defaultVal = def.defaults[path];
      if (Array.isArray(defaultVal)) {
        if (!Array.isArray(resolvedValue)) {
          if (typeof resolvedValue === 'string') {
            try {
              const parsed = JSON.parse(resolvedValue);
              if (Array.isArray(parsed)) {
                resolvedValue = parsed;
              } else {
                return { success: false, blocks: list, error: `Pole '${path}' w bloku '${block.type}' wymaga tablicy (Array).` };
              }
            } catch {
              return { success: false, blocks: list, error: `Pole '${path}' w bloku '${block.type}' wymaga tablicy (Array).` };
            }
          } else {
            return { success: false, blocks: list, error: `Pole '${path}' w bloku '${block.type}' wymaga tablicy (Array).` };
          }
        }
      } else if (typeof defaultVal === 'string') {
        resolvedValue = toCleanString(resolvedValue, defaultVal);
      }
    } else {
      // Dla ścieżek zagnieżdżonych lub spoza defaults: jeśli wartość to obiekt z tekstem lub string zawierający [object Object]
      if (typeof resolvedValue === 'object' && resolvedValue !== null && !Array.isArray(resolvedValue)) {
        if (typeof resolvedValue.text === 'string' || typeof resolvedValue.title === 'string' || typeof resolvedValue.name === 'string' || typeof resolvedValue.value === 'string' || typeof resolvedValue.desc === 'string') {
          resolvedValue = toCleanString(resolvedValue, '');
        }
      } else if (typeof resolvedValue === 'string') {
        resolvedValue = toCleanString(resolvedValue, '');
      }
    }

    const ok = setDeepValue(block.data, path, resolvedValue);
    if (!ok) return { success: false, blocks: list, error: `Nieprawidłowa lub niedozwolona ścieżka '${path}'.` };

    // Jeśli zmieniono video_url, zaktualizuj też video_provider i video_id
    if (path === 'video_url' || path === 'showreel_url') {
      const meta = extractVideoMeta(resolvedValue);
      block.data.video_provider = meta.provider;
      block.data.video_id = meta.id;
    }

    return { success: true, blocks: list, updatedBlock: block };
  }

  function replaceBlockItems(blocks, blockId, items) {
    const list = Array.isArray(blocks) ? deepClone(blocks) : [];
    const block = list.find((b) => b.id === blockId);
    if (!block) return { success: false, blocks: list, error: `Blok o ID '${blockId}' nie istnieje.` };

    let resolvedItems = items;
    if (typeof items === 'string') {
      try {
        const parsed = JSON.parse(items);
        if (Array.isArray(parsed)) resolvedItems = parsed;
      } catch (_) {}
    }

    if (!Array.isArray(resolvedItems)) {
      return { success: false, blocks: list, error: 'items musi być tablicą (Array)' };
    }

    const sanitizedItems = resolvedItems.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return {};
      const clean = {};
      Object.keys(item).forEach((k) => {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
        const v = item[k];
        if (k === 'features' && Array.isArray(v)) {
          clean[k] = v.map((f) => toCleanString(f, '')).filter((f) => f.length > 0);
        } else if (typeof v === 'string') {
          clean[k] = toCleanString(v, '');
        } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          // Rozpakuj { text: '...', title: '...' } zamiast wstawiać obiekt
          clean[k] = toCleanString(v, '');
        } else {
          clean[k] = v;
        }
      });
      return clean;
    });

    if (!block.data) block.data = {};
    block.data.items = deepClone(sanitizedItems);
    return { success: true, blocks: list, updatedBlock: block };
  }

  function insertBlock(blocks, afterBlockId, blockType, initialData) {
    const list = Array.isArray(blocks) ? deepClone(blocks) : [];
    const def = BLOCK_DEFINITIONS[blockType];
    if (!def) return { success: false, blocks: list, error: `Nieznany typ bloku '${blockType}'.` };

    const newBlock = {
      id: `${blockType}_${Date.now().toString(36)}`,
      type: blockType,
      data: Object.assign({}, def.defaults, initialData || {}),
    };

    if (!afterBlockId) {
      list.push(newBlock);
      return { success: true, blocks: list, insertedBlock: newBlock };
    }

    const idx = list.findIndex((b) => b.id === afterBlockId);
    if (idx === -1) {
      list.push(newBlock);
    } else {
      list.splice(idx + 1, 0, newBlock);
    }
    return { success: true, blocks: list, insertedBlock: newBlock };
  }

  function removeBlock(blocks, blockId) {
    const list = Array.isArray(blocks) ? deepClone(blocks) : [];
    const filtered = list.filter((b) => b.id !== blockId);
    if (filtered.length === list.length) {
      return { success: false, blocks: list, error: `Blok '${blockId}' nie został znaleziony.` };
    }
    return { success: true, blocks: filtered };
  }

  function reorderBlocks(blocks, orderedIds) {
    const list = Array.isArray(blocks) ? deepClone(blocks) : [];
    if (!Array.isArray(orderedIds)) return { success: false, blocks: list, error: 'orderedIds musi być tablicą' };

    const map = new Map(list.map((b) => [b.id, b]));
    const reordered = [];
    for (const id of orderedIds) {
      if (map.has(id)) {
        reordered.push(map.get(id));
        map.delete(id);
      }
    }
    // Pozostałe bloki dopisz na koniec
    for (const remaining of map.values()) {
      reordered.push(remaining);
    }
    return { success: true, blocks: reordered };
  }

  function updateDesign(state, designUpdates) {
    if (!state || typeof state !== 'object') return { success: false, state, error: 'Nieprawidłowy stan strony' };
    const next = deepClone(state);
    if (!next.design) next.design = {};
    const allowed = ['palette', 'font_theme', 'accent_color', 'bg_color'];
    for (const key of Object.keys(designUpdates || {})) {
      if (allowed.includes(key) && typeof designUpdates[key] === 'string') {
        next.design[key] = designUpdates[key].trim();
      }
    }
    return { success: true, state: next, updatedDesign: next.design };
  }

  function isGoogleMapsEmbedHttpsUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = url.trim();
    if (!clean.startsWith('https://')) return false;
    try {
      const u = new URL(clean);
      const host = u.hostname.toLowerCase();
      if (host !== 'www.google.com' && host !== 'google.com' && host !== 'maps.google.com') return false;
      const path = u.pathname || '';
      if (path.includes('/maps/embed')) return true;
      const mapsPath = path === '/maps' || path.startsWith('/maps/');
      return mapsPath && u.searchParams.get('output') === 'embed';
    } catch {
      return false;
    }
  }

  function getSafeMapEmbedUrl(data) {
    if (!data || typeof data !== 'object') return '';
    const parts = [data.address, data.city]
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim());
    const q = parts.join(', ');
    if (q) {
      return 'https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&t=&z=15&ie=UTF8&iwloc=&output=embed';
    }
    if (isGoogleMapsEmbedHttpsUrl(data.map_embed_url)) {
      return String(data.map_embed_url).trim();
    }
    return '';
  }

  function getCatalogGroups() {
    return deepClone(CATALOG_GROUPS);
  }

  function getCatalogBlocks(currentBlocks) {
    const list = Array.isArray(currentBlocks) ? currentBlocks : [];
    const countMap = {};
    for (const b of list) {
      if (b && b.type) {
        countMap[b.type] = (countMap[b.type] || 0) + 1;
      }
    }

    return Object.values(BLOCK_DEFINITIONS).map((def) => {
      const count = countMap[def.type] || 0;
      return {
        type: def.type,
        label: def.label,
        category: def.category,
        catalog_group: def.catalog_group || 'info',
        icon: def.icon || '🧩',
        summary: def.summary || '',
        allow_multiple: def.allow_multiple !== false,
        required_fields: Array.isArray(def.required_fields) ? deepClone(def.required_fields) : [],
        isOnPage: count > 0,
        countOnPage: count,
      };
    });
  }

  return {
    toCleanString,
    BLOCK_DEFINITIONS,
    CATALOG_GROUPS,
    getCatalogGroups,
    getCatalogBlocks,
    isGoogleMapsEmbedHttpsUrl,
    getSafeMapEmbedUrl,
    extractVideoMeta,
    createInitialCinematicState,
    createInitialQuickCardState,
    applyBlockUpdate,
    replaceBlockItems,
    insertBlock,
    removeBlock,
    reorderBlocks,
    updateDesign,
  };
});
