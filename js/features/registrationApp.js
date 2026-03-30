;(function () {
  function createRegistrationApp() {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    return {
      supabase: null,
      loading: false,
      success: false,
      /** true gdy włączone potwierdzanie e-maila — brak sesji, strona powstaje w DB (trigger) lub przy pierwszym logowaniu do panelu */
      pendingEmailConfirmation: false,
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

      /**
       * Rejestracja: tylko signUp + slug w user_metadata.
       * Przy potwierdzaniu e-maila nie ma JWT — insert z przeglądarki nie przejdzie RLS.
       * Strona: trigger w bazie (migracja) albo pierwsze wejście do panelu (adminApp.ensurePageFromRegistrationMetadata).
       */
      async createPage() {
        this.loading = true;
        this.errorMessage = '';
        try {
          if (!this.accepted) {
            throw new Error('Zaakceptuj Regulamin oraz Politykę Prywatności.');
          }
          const okSlug = await this.checkSlugUnique();
          if (!okSlug) throw new Error('Popraw slug (unikalny, format twoja-nazwa).');

          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const { data: authData, error: authError } = await this.supabase.auth.signUp({
            email: this.form.email,
            password: this.form.password,
            options: {
              data: { slug: this.form.slug.trim() },
              emailRedirectTo: origin ? `${origin}/admin.html` : undefined,
            },
          });
          if (authError) throw authError;
          if (!authData?.user?.id) throw new Error('Nie udało się utworzyć użytkownika.');

          this.pendingEmailConfirmation = !authData.session;
          this.success = true;

          if (authData.session) {
            const delay = (cfg.timeouts?.redirectDelay ?? 800);
            setTimeout(() => {
              window.location.href = 'admin.html?site=' + encodeURIComponent(this.form.slug);
            }, delay);
          }
        } catch (e) {
          this.errorMessage = e?.message || 'Błąd tworzenia konta.';
        } finally {
          this.loading = false;
        }
      },
    };
  }
  window.createRegistrationApp = createRegistrationApp;
})();
