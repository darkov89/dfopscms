#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const inputFile = path.join(root, 'dataset_crawler-google-places_2026-06-10_05-51-45-009.json');
const outputFile = path.join(root, 'data', 'seeds', 'demo_pages.json');

const ALLOWED_THEMES = new Set(['beauty', 'fitness', 'services', 'consultant']);
const MAX_DEMO_LEADS = 40;
const HERO_PLACEHOLDER = '/img/demo-your-photo.svg';
const GALLERY_PLACEHOLDERS = ['/img/demo-gallery-photo-1.svg', '/img/demo-gallery-photo-2.svg'];

function normalizeText(value) {
  return String(value || '').trim();
}

// Funkcja dopasowująca szablon DFCMS do kategorii z Google Maps.
function mapCategoryToTheme(categories) {
  const cats = Array.isArray(categories) ? categories.map((c) => normalizeText(c).toLowerCase()) : [];
  if (cats.some((c) => c.includes('fryzjer') || c.includes('kosmety') || c.includes('beauty'))) return 'beauty';
  if (cats.some((c) => c.includes('trener') || c.includes('siłow') || c.includes('sport') || c.includes('fizjo'))) return 'fitness';
  if (cats.some((c) => c.includes('złota rączka') || c.includes('hydraulik') || c.includes('budowlan') || c.includes('elektryk'))) return 'services';
  if (cats.some((c) => c.includes('psycholog') || c.includes('coach') || c.includes('terapeuta'))) return 'consultant';
  return 'consultant';
}

function generateSlug(name) {
  return (
    'demo-' +
    normalizeText(name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 40)
      .replace(/-$/, '')
  );
}

function isPortalWebsite(website) {
  const web = normalizeText(website).toLowerCase();
  if (!web) return true;
  return (
    web.includes('facebook.com') ||
    web.includes('instagram.com') ||
    web.includes('booksy.com') ||
    web.includes('znanylekarz.pl') ||
    web.includes('business.site')
  );
}

function includesAny(value, needles) {
  const text = normalizeText(value).toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

function isBarberLead(lead) {
  const haystack = [
    lead.title,
    lead.categoryName,
    ...(Array.isArray(lead.categories) ? lead.categories : []),
  ].join(' ');
  return includesAny(haystack, ['barber', 'barbershop', 'barber-shop', 'broda', 'męsk']);
}

function buildMapEmbedUrl(placeQuery) {
  return `https://www.google.com/maps?q=${encodeURIComponent(placeQuery)}&output=embed`;
}

function resolveBookingMode(website) {
  const web = normalizeText(website).toLowerCase();
  if (!web) return 'schedule';
  return 'button';
}

function resolveBookingUrl(website) {
  const web = normalizeText(website);
  if (!web) return '';
  return web;
}

function resolveSocialLinks(website) {
  const web = normalizeText(website);
  const lower = web.toLowerCase();
  return {
    facebook: lower.includes('facebook.com') ? web : '',
    instagram: lower.includes('instagram.com') ? web : '',
    tiktok: lower.includes('tiktok.com') ? web : '',
  };
}

function uniqueBySlug(seeds) {
  const seen = new Map();
  for (const seed of seeds) {
    const base = seed.slug;
    let slug = base;
    let i = 2;
    while (seen.has(slug)) {
      slug = `${base.substring(0, 37)}-${i}`;
      i += 1;
    }
    seen.set(slug, { ...seed, slug });
  }
  return Array.from(seen.values());
}

function leadQualitySort(a, b) {
  const scoreDiff = Number(b.totalScore || 0) - Number(a.totalScore || 0);
  if (scoreDiff !== 0) return scoreDiff;
  const reviewsDiff = Number(b.reviewsCount || 0) - Number(a.reviewsCount || 0);
  if (reviewsDiff !== 0) return reviewsDiff;
  return normalizeText(a.title || a.name).localeCompare(normalizeText(b.title || b.name), 'pl');
}

function styleSettingsForLead(lead, theme) {
  if (theme === 'beauty' && isBarberLead(lead)) {
    return {
      color_preset: 'black-gold',
      background_style: 'smoky',
      font_preset: 'barber',
    };
  }
  if (theme === 'beauty') {
    return {
      color_preset: 'rosewood',
      background_style: 'clean',
      font_preset: 'elegant',
    };
  }
  if (theme === 'fitness') {
    return {
      color_preset: 'neon-lime',
      background_style: 'glow',
      font_preset: 'inter',
    };
  }
  if (theme === 'services') {
    return {
      color_preset: 'trades-navy',
      background_style: 'clean',
      font_preset: 'inter',
    };
  }
  return {
    color_preset: 'dfops-tech',
    background_style: 'glow',
    font_preset: 'inter',
  };
}

function servicesForTheme(theme, barber) {
  if (theme === 'beauty' && barber) {
    return [
      { title: 'Strzyżenie męskie', desc: 'Precyzyjne cięcie dopasowane do stylu klienta.', details: 'Placeholder oferty demo — właściciel może podmienić opis w panelu.', duration: '45 min', price: 'od 90 zł' },
      { title: 'Broda i kontur', desc: 'Modelowanie brody, kontur i wykończenie.', details: 'Sekcja korzysta z modułu usług i cen w adminie.', duration: '30 min', price: 'od 60 zł' },
    ];
  }
  if (theme === 'beauty') {
    return [
      { title: 'Usługa premium', desc: 'Najczęściej wybierana usługa w salonie.', details: 'Placeholder oferty demo — do edycji w panelu.', duration: '60 min', price: 'od 120 zł' },
      { title: 'Konsultacja i dobór zabiegu', desc: 'Krótka rozmowa i rekomendacja kolejnych kroków.', details: 'Sekcja pokazuje moduł usług oraz cennika.', duration: '30 min', price: 'od 80 zł' },
    ];
  }
  if (theme === 'fitness') {
    return [
      { title: 'Trening personalny', desc: 'Indywidualna praca nad celem i techniką.', details: 'Demo modułu usług dla trenerów i studiów fitness.', duration: '60 min', price: 'od 150 zł' },
      { title: 'Plan startowy', desc: 'Pierwsza konsultacja, analiza celu i plan działania.', details: 'Do edycji z poziomu admina.', duration: '45 min', price: 'od 120 zł' },
    ];
  }
  if (theme === 'services') {
    return [
      { title: 'Szybka wycena', desc: 'Kontakt, opis problemu i orientacyjny koszt.', details: 'Moduł usług pokazuje zakres pracy oraz sposób kontaktu.', duration: '15 min', price: 'bezpłatnie' },
      { title: 'Realizacja usługi', desc: 'Termin, dojazd i wykonanie zlecenia.', details: 'Treści można dopasować w panelu DFCMS.', duration: 'wg zakresu', price: 'do ustalenia' },
    ];
  }
  return [
    { title: 'Konsultacja wstępna', desc: 'Rozmowa o potrzebach i możliwych rozwiązaniach.', details: 'Placeholder oferty demo.', duration: '30 min', price: 'od 150 zł' },
  ];
}

function faqForTheme(theme) {
  if (theme === 'services') {
    return [
      { question: 'Czy można szybko zadzwonić?', answer: 'Tak — numer telefonu jest widoczny w sekcji kontaktu i w przyciskach CTA.' },
      { question: 'Czy dojazd jest widoczny na mapie?', answer: 'Tak, demo ma wpiętą mapę Google wygenerowaną z adresu i nazwy firmy.' },
    ];
  }
  return [
    { question: 'Czy mogę podmienić zdjęcia?', answer: 'Tak, placeholdery „Twoje zdjęcie” można zastąpić własnymi fotografiami w panelu.' },
    { question: 'Czy opinie Google są automatyczne?', answer: 'Tak, strona używa Google Place Query i pobiera opinie przez istniejący moduł DFCMS.' },
  ];
}

function fallbackReviewsForLead(lead, theme) {
  const score = Number(lead.totalScore || 5);
  const stars = score >= 4.5 ? 5 : Math.max(4, Math.round(score));
  if (theme === 'services') {
    return [
      { author: 'Klient Google', content: 'Szybki kontakt, konkretna informacja i jasne warunki współpracy. To dokładnie te elementy, które warto pokazać na stronie.', logoImage: '', stars },
      { author: 'Lokalny klient', content: 'Dobra opinia z Google od razu buduje zaufanie. Właściciel może później podmienić te przykłady na realne recenzje.', logoImage: '', stars: 5 },
    ];
  }
  if (theme === 'fitness') {
    return [
      { author: 'Klient Google', content: 'Profesjonalne podejście, świetny kontakt i dużo dobrej energii. Takie opinie pomagają szybciej podjąć decyzję o pierwszej wizycie.', logoImage: '', stars },
      { author: 'Nowy klient', content: 'Sekcja opinii pokazuje społeczny dowód słuszności już w pierwszym widoku demo.', logoImage: '', stars: 5 },
    ];
  }
  if (theme === 'beauty') {
    return [
      { author: 'Klient Google', content: 'Świetny klimat miejsca, sprawny kontakt i efekt, który warto pokazać nowym klientom.', logoImage: '', stars },
      { author: 'Stały klient', content: 'Opinie z Google pomagają zbudować zaufanie jeszcze zanim klient zadzwoni albo umówi termin.', logoImage: '', stars: 5 },
    ];
  }
  return [
    { author: 'Klient Google', content: 'Profesjonalne podejście i łatwy kontakt. Taka sekcja pomaga pokazać wiarygodność specjalisty.', logoImage: '', stars },
    { author: 'Osoba polecająca', content: 'Czytelna strona z opiniami, mapą i szybkim formularzem skraca drogę do kontaktu.', logoImage: '', stars: 5 },
  ];
}

function buildSeed(lead) {
  const title = normalizeText(lead.title || lead.name);
  const city = normalizeText(lead.city) || 'Wrocław';
  const theme = mapCategoryToTheme(lead.categories || []);
  const placeQuery = `${title}, ${city}`;
  const phone = normalizeText(lead.phone);
  const address = normalizeText(lead.address || lead.street || city);
  const barber = isBarberLead(lead);
  const styleSettings = styleSettingsForLead(lead, theme);
  const bookingUrl = resolveBookingUrl(lead.website);
  const social = resolveSocialLinks(lead.website);

  if (!ALLOWED_THEMES.has(theme)) {
    throw new Error(`Nieobsługiwany motyw dla ${title}: ${theme}`);
  }

  return {
    slug: generateSlug(title),
    theme,
    content: {
      pl: {
        nav: {
          logo: title,
          cta: bookingUrl ? 'Umów termin' : 'Kontakt',
          logoImage: '',
          menu: {
            about: 'O nas',
            pricing: theme === 'services' ? 'Zakres usług' : 'Oferta',
            gallery: 'Galeria',
            reviews: 'Opinie',
            faq: 'FAQ',
            contact: 'Kontakt',
          },
        },
        hero: {
          name: title,
          headline: `${title}<br /><i>w nowej odsłonie online.</i>`,
          subheadline: '',
          description: 'Nowoczesna, szybka strona wizytówkowa z opiniami Google, mapą dojazdu i prostym kontaktem.',
          button: bookingUrl ? 'Umów termin' : 'Skontaktuj się',
          button_url: bookingUrl || '#kontakt',
          image: HERO_PLACEHOLDER,
          qrText: '',
          qrImage: '',
        },
        manifesto: {
          label: barber ? 'Barber demo' : 'Demo DFCMS',
          title: barber ? 'Mocny styl, szybki kontakt i opinie Google' : 'Gotowa wizytówka do personalizacji',
          text: 'To demo pokazuje układ, który właściciel może uzupełnić własnymi zdjęciami, ofertą i treścią w panelu administracyjnym.',
        },
        services: servicesForTheme(theme, barber),
        reviews: fallbackReviewsForLead(lead, theme),
        faq: faqForTheme(theme),
        contact: {
          email: '',
          phone,
          address,
          booking_url: bookingUrl,
          bookingUrl: bookingUrl,
          booksyUrl: bookingUrl && bookingUrl.toLowerCase().includes('booksy') ? bookingUrl : '',
          booksyIframeUrl: '',
          map_embed_url: buildMapEmbedUrl(placeQuery),
          map_place_id: '',
          cta: {
            enabled: true,
            title: bookingUrl ? 'Umów wizytę online' : 'Skontaktuj się bezpośrednio',
            description: bookingUrl
              ? 'Przycisk prowadzi do zewnętrznego systemu rezerwacji lub profilu firmy.'
              : 'Zadzwoń lub sprawdź trasę dojazdu na mapie Google.',
            button_text: bookingUrl ? 'Otwórz rezerwację' : 'Zadzwoń',
            button_url: bookingUrl || '#kontakt',
          },
        },
        social,
        google_reviews: {
          embed_url: '',
          place_query: placeQuery,
          max_reviews: 5,
          title: 'Opinie klientów',
          cached_place_rating: Number.isFinite(Number(lead.totalScore)) ? Number(lead.totalScore) : null,
          cached_user_rating_count: Number.isFinite(Number(lead.reviewsCount)) ? Number(lead.reviewsCount) : null,
        },
        gallery: {
          title: barber ? 'Fotele, detale i klimat miejsca' : 'Twoje zdjęcia i realizacje',
          images: GALLERY_PLACEHOLDERS,
        },
        seo: {
          title: `${title} — ${city}`,
          description: `Strona demo DFCMS dla ${title}. Opinie Google, mapa dojazdu i szybki kontakt w jednym miejscu.`,
          ogImage: '',
        },
        privacy: {
          mode: 'default',
          customText: '',
        },
        legal: {
          enabled: true,
          privacy_policy: '',
          terms: '',
        },
        settings: {
          ...styleSettings,
          booking_mode: resolveBookingMode(lead.website),
          subscription: {
            plan: 'tier1',
            payment_completed: true,
            trial_started_at: new Date().toISOString(),
          },
          is_demo_catalog: true,
          theme,
          business_name: title,
          template_version: 3,
          darkMode: theme === 'fitness' || (theme === 'beauty' && barber),
          showManifesto: true,
          showServices: true,
          showProof: true,
          showGallery: true,
          showGoogleReviews: true,
          showFaq: true,
          showReviews: true,
          showContact: true,
        },
      },
    },
  };
}

function processLeads() {
  if (!fs.existsSync(inputFile)) {
    console.error(`Brak pliku wejściowego: ${path.relative(root, inputFile)}`);
    console.error('Dodaj eksport z Apify do root repo i uruchom skrypt ponownie.');
    process.exit(1);
  }

  console.log('Czytam surowe dane z Apify...');
  const rawData = fs.readFileSync(inputFile, 'utf-8');
  const leads = JSON.parse(rawData);

  if (!Array.isArray(leads)) {
    console.error('Plik wejściowy musi zawierać tablicę leadów.');
    process.exit(1);
  }

  const qualifiedLeads = leads.filter((lead) => {
    if (!lead || typeof lead !== 'object') return false;
    if (!lead.totalScore || lead.totalScore < 4.2) return false;
    if (!lead.reviewsCount || lead.reviewsCount < 20) return false;
    if (!normalizeText(lead.title || lead.name)) return false;
    return isPortalWebsite(lead.website);
  });

  const selectedLeads = qualifiedLeads.sort(leadQualitySort).slice(0, MAX_DEMO_LEADS);

  console.log(
    `Zakwalifikowano ${qualifiedLeads.length} leadów. Wybrano top ${selectedLeads.length}. Generowanie struktury dla DFCMS...`,
  );

  const seeds = uniqueBySlug(selectedLeads.map(buildSeed));
  const outputObj = {
    meta: {
      purpose: 'Demo pages wygenerowane z leadów Google Places / Apify.',
      source: path.basename(inputFile),
      generated_at: new Date().toISOString(),
      count: seeds.length,
    },
    seeds,
  };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(outputObj, null, 2) + '\n');
  console.log(`Zapisano plik seedów: ${path.relative(root, outputFile)}`);
}

processLeads();
