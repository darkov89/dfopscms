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
      accepted: false,
      form: { email: '', password: '', slug: '' },

      init() {
        this.supabase = window.DFOPS_getSupabaseClient();
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
        const theme = 'setup';
        const c = window.DFOPS_getTemplate(theme);
        c.pl.settings.template_version = window.DFOPS_LATEST_TEMPLATE_VERSION || c.pl.settings.template_version || 3;
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
          if (!this.accepted) {
            throw new Error('Zaakceptuj Regulamin oraz Politykę Prywatności.');
          }
          const okSlug = await this.checkSlugUnique();
          if (!okSlug) throw new Error('Popraw slug (unikalny, format twoja-nazwa).');

          const { data: authData, error: authError } = await this.supabase.auth.signUp({
            email: this.form.email,
            password: this.form.password,
          });
          if (authError) throw authError;
          if (!authData?.user?.id) throw new Error('Nie udało się utworzyć użytkownika.');

          const content = this.buildInitialContent();
          const colorPreset = content.pl.settings.color_preset;

          const { error: dbError } = await repo.createPage({
            slug: this.form.slug,
            theme: 'setup',
            color_preset: colorPreset,
            content,
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
