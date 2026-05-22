;(function () {
  /**
   * Local vs Production — Supabase API (PostgREST + Auth + Edge z tego samego origin w config).
   * Na localhost: `supabase start` → URL http://127.0.0.1:54321; anon key z `supabase status`.
   */
  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const SUPABASE_URL_PROD = 'https://tawywecinkubmouyprab.supabase.co';
  const SUPABASE_ANON_KEY_PROD = 'sb_publishable_b-y5BLfAZBNnPdjhFx61Tw_NP_FI1Sp';
  const SUPABASE_URL_LOCAL = 'http://127.0.0.1:54321';
  /** Uzupełnij po `supabase status` (anon key lokalnego stacka). */
  const SUPABASE_ANON_KEY_LOCAL = '625729a08b95bf1b7ff351a663f3a23c';

  const SUPABASE_URL = isLocalhost ? SUPABASE_URL_LOCAL : SUPABASE_URL_PROD;
  const SUPABASE_ANON_KEY = isLocalhost ? SUPABASE_ANON_KEY_LOCAL : SUPABASE_ANON_KEY_PROD;

  const APP_CONFIG = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    isLocalhost,
    /** Opcjonalny URL (np. Edge Function) do zapisu zdarzeń DFOPS_trackEvent — może zostać puste. */
    analyticsEndpoint: '',
    /**
     * Tabela w Supabase pod zdarzenia DFOPS_trackEvent (kolumny: user_id, event_name, created_at).
     * Puste = bez zapisu do bazy. Nazwa musi zgadzać się z tabelą w projekcie.
     */
    analyticsTable: 'analytics_events',
    /**
     * Stripe: Price ID (price_…) lub Product ID (prod_…) — w Checkout produkt jest
     * rozwijany do domyślnej ceny po stronie Edge Function.
     * Sekrety STRIPE_PRICE_* w Supabase mają pierwszeństwo; wartość to price_… lub prod_… z Stripe.
     */
    stripePrices: {
      starter: 'prod_UH55Tk8hYyhzcs',
      pro: 'prod_UFPYv9j5jTbNZd',
      premium: 'prod_UFPccgmP3lMp9N',
    },
    appDomain: 'dfcms.pl',
    /**
     * Opcjonalnie nadpisz URL w resetPasswordForEmail (musi być w Supabase → Authentication → Redirect URLs).
     * Puste = automatycznie: na localhost origin/admin.html; na domenie produkcyjnej https://{appDomain}/admin.html.
     */
    passwordResetRedirectUrl: '',
    /** Adres do wiadomości „usuń konto” (mailto) z panelu administracyjnego. */
    supportEmail: 'kontakt@dfops.eu',
    /** Nadawca wiadomości automatycznych (auth Supabase, powiadomienia systemowe) — ustaw w SMTP/Resend zgodnie z wdrożeniem. */
    notificationsEmail: 'notifications@dfops.eu',
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
      /** Consultant — Modern Cloud / DevOps (slate + niebieski) */
      'dfops-tech': '#3b82f6',
      /** Fitness / dark public templates */
      'neon-lime': '#a3e635',
      'neon-cyan': '#22d3ee',
      'neon-orange': '#fb923c',
      /** Usługi lokalne (granat + biel + pomarańcz) */
      'trades-navy': '#f97316',
    },
    /**
     * Paleta publiczna dla motywu `services` (jak consultantPresetPalette).
     */
    servicesPresetPalette: {
      'trades-navy': {
        accent: '#f97316',
        accentContrast: '#ffffff',
        bgA: '#0f172a',
        bgB: '#1e293b',
        bgC: 'rgba(249, 115, 22, 0.12)',
        bgTextureOpacity: 0.04,
        surfaceBg: '#ffffff',
        surfaceAccent: '#f1f5f9',
        surfaceCard: '#ffffff',
        text: '#0f172a',
        textMuted: '#64748b',
      },
    },
    /**
     * Pełna paleta powierzchni/tła dla consultant przy wybranym color_preset (poza samym akcentem).
     * Stosowane w themeStyling.js — nadpisują domyślny gradient darkMode.
     */
    consultantPresetPalette: {
      'dfops-tech': {
        accent: '#3b82f6',
        accentContrast: '#f1f5f9',
        bgA: '#0B132B',
        bgB: '#0f172a',
        bgC: 'rgba(59, 130, 246, 0.14)',
        bgTextureOpacity: 0.05,
        surfaceBg: 'transparent',
        surfaceAccent: 'rgba(30, 41, 59, 0.92)',
        surfaceCard: 'rgba(30, 41, 59, 0.78)',
        text: '#E2E8F0',
        textMuted: '#94a3b8',
      },
    },
    presetsByTheme: {
      setup: [{ id: 'gold', label: 'Gold' }],
      consultant: [
        { id: 'dfops-tech', label: 'DFOPS Tech (ciemny granat)' },
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
      fitness: [
        { id: 'neon-lime', label: 'Neon lime' },
        { id: 'neon-cyan', label: 'Electric blue' },
        { id: 'neon-orange', label: 'Energy orange' },
      ],
      services: [{ id: 'trades-navy', label: 'Granat + pomarańcz (rzemiosło)' }],
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
    timeouts: {
      msPerDay: 86400000,
      apiTimeout: 25000,
      abortTimeout: 12000,
      slugDebounce: 400,
      redirectDelay: 800,
      errorMessage: 5000,
      successMessage: 3000,
      upgradeMessage: 3500,
    },
    bundlesByTheme: {
      setup: [],
      consultant: [
        { id: 'consultant-dfops-tech', label: 'DFOPS Tech (slate)', color_preset: 'dfops-tech', background_style: 'glow', font_preset: 'inter' },
        { id: 'consultant-premium', label: 'Premium Gold', color_preset: 'gold', background_style: 'glow', font_preset: 'inter' },
        { id: 'consultant-navy', label: 'Navy Modern', color_preset: 'navy', background_style: 'clean', font_preset: 'inter' },
        { id: 'consultant-emerald', label: 'Emerald Trust', color_preset: 'emerald', background_style: 'soft', font_preset: 'elegant' },
      ],
      beauty: [
        { id: 'beauty-soft', label: 'Beauty Soft', color_preset: 'beige', background_style: 'soft', font_preset: 'poppins' },
        { id: 'beauty-rosewood', label: 'Rosewood Elegant', color_preset: 'rosewood', background_style: 'clean', font_preset: 'elegant' },
        { id: 'barber-luxe', label: 'Barber Luxe', color_preset: 'black-gold', background_style: 'smoky', font_preset: 'barber' },
      ],
      fitness: [
        { id: 'fit-lime', label: 'Neon Lime Power', color_preset: 'neon-lime', background_style: 'glow', font_preset: 'inter' },
        { id: 'fit-cyan', label: 'Electric Night', color_preset: 'neon-cyan', background_style: 'glow', font_preset: 'inter' },
        { id: 'fit-orange', label: 'Metabolic Fire', color_preset: 'neon-orange', background_style: 'smoky', font_preset: 'inter' },
      ],
      services: [
        {
          id: 'svc-trades',
          label: 'Rzemiosło (navy + pomarańcz)',
          color_preset: 'trades-navy',
          background_style: 'clean',
          font_preset: 'inter',
        },
      ],
    },
  };

  window.DFOPS_CONFIG = APP_CONFIG;
  window.DFOPS_IS_LOCALHOST = isLocalhost;
  window.DFOPS_SUPABASE_URL = SUPABASE_URL;
  window.DFOPS_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
})();

