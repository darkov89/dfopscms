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

function buildSeed(lead) {
  const title = normalizeText(lead.title || lead.name);
  const city = normalizeText(lead.city) || 'Wrocław';
  const theme = mapCategoryToTheme(lead.categories || []);
  const placeQuery = `${title}, ${city}`;
  const phone = normalizeText(lead.phone);
  const address = normalizeText(lead.address || lead.street || city);

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
          cta: 'Kontakt',
          logoImage: '',
          menu: {},
        },
        hero: {
          name: title,
          headline: `${title}<br /><i>w nowej odsłonie online.</i>`,
          subheadline: '',
          description: 'Nowoczesna, szybka strona wizytówkowa z opiniami Google, mapą dojazdu i prostym kontaktem.',
          button: 'Skontaktuj się',
          image: '',
          qrText: '',
          qrImage: '',
        },
        services: [],
        reviews: [],
        faq: [],
        contact: {
          email: '',
          phone,
          address,
          booking_url: '',
          bookingUrl: '',
          booksyUrl: '',
          booksyIframeUrl: '',
          map_embed_url: '',
          map_place_id: '',
        },
        social: {
          facebook: '',
          instagram: '',
          tiktok: '',
        },
        google_reviews: {
          embed_url: '',
          place_query: placeQuery,
          max_reviews: 5,
          title: 'Opinie klientów',
        },
        gallery: {
          title: 'Galeria',
          images: [],
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
          color_preset: 'gold',
          subscription: {
            plan: 'tier1',
            payment_completed: true,
            trial_started_at: new Date().toISOString(),
          },
          is_demo_catalog: true,
          showServices: true,
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
