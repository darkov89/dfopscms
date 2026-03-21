;(function () {
  const APP_CONFIG = {
    supabaseUrl: 'https://tawywecinkubmouyprab.supabase.co',
    supabaseAnonKey: 'sb_publishable_b-y5BLfAZBNnPdjhFx61Tw_NP_FI1Sp',
    appDomain: 'dfcms.pl',
    systemDomains: ['dfcms.pl', 'localhost', '127.0.0.1'],
    localHosts: ['localhost', '127.0.0.1'],
    accentByPreset: {
      gold: '#D4AF37',
      navy: '#2B3A67',
      emerald: '#0F766E',
      charcoal: '#A3A3A3',
      beige: '#D6C2A5',
      rosewood: '#7A2E2E',
      'black-gold': '#D4AF37',
      'forest-mint': '#4FBDAA',
    },
    presetsByTheme: {
      consultant: [
        { id: 'gold', label: 'Gold (premium)' },
        { id: 'navy', label: 'Navy (biznes)' },
        { id: 'emerald', label: 'Emerald (zaufanie)' },
        { id: 'charcoal', label: 'Charcoal (minimal)' },
      ],
      beauty: [
        { id: 'beige', label: 'Beige (ciepły)' },
        { id: 'rosewood', label: 'Rosewood (elegancja)' },
        { id: 'black-gold', label: 'Black & Gold (barber/luxe)' },
        { id: 'forest-mint', label: 'Forest Mint (świeżość)' },
      ],
    },
    backgroundByStyle: {
      clean: { a: '#ffffff', b: '#ffffff', c: 'rgba(0,0,0,0)', texture: 0 },
      glow: { a: '#0b0b0f', b: '#121212', c: 'rgba(212,175,55,0.12)', texture: 0.06 },
      soft: { a: '#Fdfbf7', b: '#F7F1EA', c: 'rgba(163,135,113,0.18)', texture: 0.04 },
      smoky: { a: '#050507', b: '#0f0f12', c: 'rgba(212,175,55,0.10)', texture: 0.10 },
    },
    surfaceByStyle: {
      clean: { bg: 'transparent', accent: 'transparent', card: 'rgba(255,255,255,0.92)' },
      soft: { bg: 'rgba(255,255,255,0.10)', accent: 'rgba(255,255,255,0.16)', card: 'rgba(255,255,255,0.85)' },
      glow: { bg: 'rgba(255,255,255,0.02)', accent: 'rgba(255,255,255,0.04)', card: 'rgba(18,18,18,0.55)' },
      smoky: { bg: 'rgba(0,0,0,0.25)', accent: 'rgba(0,0,0,0.35)', card: 'rgba(18,18,18,0.60)' },
    },
    fontByPreset: {
      inter: { sans: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif', serif: 'Playfair Display, ui-serif, Georgia, serif' },
      poppins: { sans: 'Poppins, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif', serif: 'Playfair Display, ui-serif, Georgia, serif' },
      barber: { sans: 'Oswald, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif', serif: 'Playfair Display, ui-serif, Georgia, serif' },
      elegant: { sans: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif', serif: 'Cormorant Garamond, ui-serif, Georgia, serif' },
    },
    bundlesByTheme: {
      consultant: [
        { id: 'consultant-premium', label: 'Premium Gold', color_preset: 'gold', background_style: 'glow', font_preset: 'inter' },
        { id: 'consultant-navy', label: 'Navy Modern', color_preset: 'navy', background_style: 'clean', font_preset: 'inter' },
        { id: 'consultant-emerald', label: 'Emerald Trust', color_preset: 'emerald', background_style: 'soft', font_preset: 'elegant' },
      ],
      beauty: [
        { id: 'beauty-soft', label: 'Beauty Soft', color_preset: 'beige', background_style: 'soft', font_preset: 'poppins' },
        { id: 'beauty-rosewood', label: 'Rosewood Elegant', color_preset: 'rosewood', background_style: 'clean', font_preset: 'elegant' },
        { id: 'barber-luxe', label: 'Barber Luxe', color_preset: 'black-gold', background_style: 'smoky', font_preset: 'barber' },
      ],
    },
  };

  window.DFOPS_CONFIG = APP_CONFIG;
})();

