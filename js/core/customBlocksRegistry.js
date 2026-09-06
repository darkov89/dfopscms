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

  const BLOCK_DEFINITIONS = {
    // === BLOKI FILMOWE / CINEMATIC ===
    cinematic_hero: {
      type: 'cinematic_hero',
      label: 'Główny ekran filmowy (Hero Video)',
      category: 'cinematic',
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
      defaults: {
        heading: 'Wybrane Realizacje',
        subheading: 'Reklama · Teledyski · Formy Fabularne',
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
      defaults: {
        heading: 'Często zadawane pytania',
        items: [
          { question: 'Jak szybko możecie przyjechać?', answer: 'W przypadku awarii zazwyczaj dojeżdżamy w ciągu 45-60 minut.' },
          { question: 'Czy wycena jest płatna?', answer: 'Wstępna wycena telefoniczna jest całkowicie bezpłatna.' },
        ],
      },
    },
  };

  /**
   * Tworzy stan początkowy dla motywu filmowego.
   */
  function createInitialCinematicState(answers) {
    const a = answers || {};
    const name = (a.name || 'Jan Kowalski').trim();
    const role = (a.role || 'Director & Cinematographer').trim();
    const videoUrl = (a.video_url || 'https://vimeo.com/76979871').trim();
    const videoMeta = extractVideoMeta(videoUrl);
    const phone = (a.phone || '+48 600 700 800').trim();
    const email = (a.email || 'kontakt@tworca.pl').trim();
    const city = (a.city || 'Warszawa · Dostępny na całym świecie').trim();

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
    const businessName = (a.business_name || a.name || 'Usługi Specjalistyczne').trim();
    const city = (a.city || 'Warszawa i okolice').trim();
    const specialty = (a.specialty || 'Szybkie i profesjonalne usługi').trim();
    const phone = (a.phone || '+48 600 700 800').trim();
    const email = (a.email || 'kontakt@wizytowka.pl').trim();
    const whatsapp = (a.whatsapp || phone.replace(/\s+/g, '')).trim();

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
    const ok = setDeepValue(block.data, path, value);
    if (!ok) return { success: false, blocks: list, error: `Nieprawidłowa lub niedozwolona ścieżka '${path}'.` };

    // Jeśli zmieniono video_url, zaktualizuj też video_provider i video_id
    if (path === 'video_url' || path === 'showreel_url') {
      const meta = extractVideoMeta(value);
      block.data.video_provider = meta.provider;
      block.data.video_id = meta.id;
    }

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

  return {
    BLOCK_DEFINITIONS,
    extractVideoMeta,
    createInitialCinematicState,
    createInitialQuickCardState,
    applyBlockUpdate,
    insertBlock,
    removeBlock,
    reorderBlocks,
  };
});
