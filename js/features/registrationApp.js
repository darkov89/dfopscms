;(function () {
  function createRegistrationApp() {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    return {
      supabase: null,
      loading: false,
      success: false,
      errorMessage: '',
      slugStatus: 'idle',
      slugCheckTimer: null,
      form: { theme: 'consultant', color_preset: 'gold', email: '', password: '', slug: '', acceptRegulamin: false, acceptFaktury: false },
      get availablePresets() { return cfg.presetsByTheme[this.form.theme] || []; },
      get accentColor() { return cfg.accentByPreset[this.form.color_preset] || '#D4AF37'; },

      init() {
        this.supabase = window.DFOPS_getSupabaseClient();
        this.$watch('form.theme', (t) => {
          const first = (cfg.presetsByTheme[t] || [])[0]?.id;
          if (first && !this.availablePresets.some((p) => p.id === this.form.color_preset)) this.form.color_preset = first;
        });
      },

      formatSlug() {
        this.form.slug = (this.form.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      },
      scheduleSlugCheck() {
        if (this.slugCheckTimer) window.clearTimeout(this.slugCheckTimer);
        const debounce = (cfg.timeouts?.slugDebounce ?? 400);
        this.slugCheckTimer = window.setTimeout(() => this.checkSlugUnique(), debounce);
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
        c.pl.settings.subscription = {
          plan: 'trial',
          trial_started_at: new Date().toISOString(),
        };
        return c;
      },
      async createPage() {
        this.loading = true;
        this.errorMessage = '';
        try {
          if (!this.form.acceptRegulamin || !this.form.acceptFaktury) {
            throw new Error('Zaakceptuj Regulamin, Politykę Prywatności oraz zgodę na faktury elektroniczne.');
          }
          const okSlug = await this.checkSlugUnique();
          if (!okSlug) throw new Error('Popraw slug (unikalny, format twoja-nazwa).');

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
          const delay = (cfg.timeouts?.redirectDelay ?? 800);
          setTimeout(() => {
            window.location.href = 'admin.html?site=' + encodeURIComponent(this.form.slug);
          }, delay);
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
