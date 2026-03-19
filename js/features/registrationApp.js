;(function () {
  function createRegistrationApp() {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    return {
      supabase: null,
      stripe: null,
      loading: false,
      success: false,
      errorMessage: '',
      slugStatus: 'idle',
      slugCheckTimer: null,
      bypassUnlocked: false,
      adminBypass: false,
      form: { theme: 'consultant', color_preset: 'gold', email: '', password: '', slug: '' },
      get availablePresets() { return cfg.presetsByTheme[this.form.theme] || []; },
      get accentColor() { return cfg.accentByPreset[this.form.color_preset] || '#D4AF37'; },

      init() {
        this.supabase = window.DFOPS_getSupabaseClient();
        const STRIPE_PUBLISHABLE_KEY = 'pk_test_REPLACE_ME';
        this.stripe = window.Stripe ? window.Stripe(STRIPE_PUBLISHABLE_KEY) : null;
        const url = new URL(window.location.href);
        this.bypassUnlocked = url.searchParams.get('bypass') === cfg.bypassSecret;
        this.$watch('form.theme', (t) => {
          const first = (cfg.presetsByTheme[t] || [])[0]?.id;
          if (first && !this.availablePresets.some((p) => p.id === this.form.color_preset)) this.form.color_preset = first;
        });
        if (url.searchParams.get('paid') === '1') this.createPageAfterPayment();
      },

      formatSlug() {
        this.form.slug = (this.form.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      },
      scheduleSlugCheck() {
        if (this.slugCheckTimer) window.clearTimeout(this.slugCheckTimer);
        this.slugCheckTimer = window.setTimeout(() => this.checkSlugUnique(), 400);
      },
      async checkSlugUnique() {
        const s = (this.form.slug || '').trim();
        if (!s) { this.slugStatus = 'idle'; return false; }
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) { this.slugStatus = 'invalid'; return false; }
        this.slugStatus = 'checking';
        const { available, error } = await repo.isSlugAvailable(s);
        if (error) { this.slugStatus = 'error'; return false; }
        this.slugStatus = available ? 'available' : 'taken';
        return available;
      },
      buildInitialContent() {
        const c = window.DFOPS_getTemplate(this.form.theme);
        c.pl.settings.color_preset = this.form.color_preset;
        c.pl.settings.template_version = window.DFOPS_LATEST_TEMPLATE_VERSION || c.pl.settings.template_version || 1;
        return c;
      },
      async startStripeCheckout() {
        const res = await fetch('/create-checkout-session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            priceId: 'price_REPLACE_ME',
            slug: this.form.slug,
            theme: this.form.theme,
            color_preset: this.form.color_preset,
            email: this.form.email,
          }),
        });
        if (!res.ok) throw new Error('Nie udało się rozpocząć płatności.');
        const json = await res.json();
        if (!this.stripe) throw new Error('Stripe nie został zainicjalizowany.');
        const { error } = await this.stripe.redirectToCheckout({ sessionId: json.id });
        if (error) throw new Error(error.message || 'Błąd Stripe.');
      },
      async createPageAfterPayment() {
        this.errorMessage = 'Ta wersja wymaga backendowej weryfikacji płatności przed utworzeniem konta.';
      },
      async createPage() {
        this.loading = true;
        this.errorMessage = '';
        try {
          const okSlug = await this.checkSlugUnique();
          if (!okSlug) throw new Error('Popraw slug (unikalny, format twoja-nazwa).');
          if (!this.adminBypass) {
            await this.startStripeCheckout();
            return;
          }
          const { data: authData, error: authError } = await this.supabase.auth.signUp({
            email: this.form.email,
            password: this.form.password,
          });
          if (authError) throw authError;
          if (!authData?.user?.id) throw new Error('Nie udało się utworzyć użytkownika.');

          const { error: dbError } = await repo.createPage({
            slug: this.form.slug,
            theme: this.form.theme,
            color_preset: this.form.color_preset,
            content: this.buildInitialContent(),
            user_id: authData.user.id,
          });
          if (dbError) throw dbError;
          this.success = true;
        } catch (e) {
          this.errorMessage = e?.message || 'Błąd tworzenia strony.';
        } finally {
          this.loading = false;
        }
      },
    };
  }
  window.createRegistrationApp = createRegistrationApp;
})();

