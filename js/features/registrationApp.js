;(function () {
  var EMAIL_TAKEN_MSG =
    'Ten adres e-mail jest już zajęty. Zaloguj się w panelu albo skorzystaj z opcji „Nie pamiętam hasła”.';

  /** Wspólna polityka haseł dla rejestracji (spójna z wymuszonym resetem w panelu). */
  function passwordPolicyError(pw) {
    const s = String(pw || '');
    if (s.length < 8) return 'Hasło musi mieć co najmniej 8 znaków.';
    if (!/[\p{L}]/u.test(s)) return 'Hasło musi zawierać co najmniej jedną literę.';
    if (!/\d/u.test(s)) return 'Hasło musi zawierać co najmniej jedną cyfrę.';
    return null;
  }

  function formatRegistrationAuthError(err) {
    if (!err) return 'Błąd tworzenia konta.';
    const code = err.code || err.name;
    const msg = String(err.message || '');
    if (code === 'over_email_send_rate_limit' || msg.includes('over_email_send_rate_limit')) {
      const secMatch = msg.match(/(\d+)\s*seconds?/i);
      const sec = secMatch ? secMatch[1] : 'kilka';
      return `Wysłano już niedawno wiadomość na ten adres. Ze względów bezpieczeństwa odczekaj ok. ${sec} s i spróbuj ponownie — albo sprawdź skrzynkę, czy wcześniejszy mail z linkiem już doszedł.`;
    }
    if (
      code === 'user_already_registered' ||
      /already registered|already been registered|email address is already/i.test(msg)
    ) {
      return 'Ten adres e-mail jest już zarejestrowany. Sprawdź skrzynkę (link potwierdzający) lub zaloguj się w panelu.';
    }
    return msg || 'Błąd tworzenia konta.';
  }

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
      rememberMe: false,
      form: { email: '', password: '', passwordConfirm: '', slug: '' },
      turnstileSiteKey: cfg.turnstileSiteKey || '0x4AAAAAADmt_cmVRzWtvglX',

      init() {
        this.supabase = window.DFOPS_getSupabaseClient();
      },

      /** Live checklist polityki hasła (do podświetlania wymagań pod polem). */
      get passwordChecks() {
        const s = String(this.form.password || '');
        return {
          length: s.length >= 8,
          letter: /[\p{L}]/u.test(s),
          digit: /\d/u.test(s),
        };
      },
      get passwordConfirmMismatch() {
        return (
          !!this.form.passwordConfirm &&
          this.form.password !== this.form.passwordConfirm
        );
      },

      getTurnstileToken() {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input && typeof input.value === 'string' ? input.value.trim() : '';
      },

      resetTurnstile() {
        if (window.turnstile && typeof window.turnstile.reset === 'function') {
          window.turnstile.reset();
        }
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
       * Kolejność w bazie: 1) auth.signUp → wiersz auth.users, 2) trigger DB → pages (slug).
       * Zajęty e-mail rozpoznajemy po anti-enumeration Supabase (user z pustą tablicą
       * identities i bez sesji) — wtedy pokazujemy błąd „adres zajęty”, a nie „sprawdź skrzynkę”.
       */
      async createPage() {
        this.loading = true;
        this.errorMessage = '';
        const slugTrimmed = (this.form.slug || '').trim();
        try {
          if (!this.accepted) {
            throw new Error('Zaakceptuj Regulamin oraz Politykę Prywatności.');
          }
          const policyError = passwordPolicyError(this.form.password);
          if (policyError) throw new Error(policyError);
          if (this.form.password !== this.form.passwordConfirm) {
            throw new Error('Hasła nie są identyczne — wpisz to samo hasło w obu polach.');
          }
          const okSlug = await this.checkSlugUnique();
          if (!okSlug) throw new Error('Popraw slug (unikalny, format twoja-nazwa).');
          const turnstileToken = this.getTurnstileToken();
          if (!turnstileToken) {
            throw new Error('Potwierdź, że nie jesteś botem.');
          }

          localStorage.setItem('dfops_remember', String(!!this.rememberMe));
          if (typeof window.DFOPS_resetSupabaseClient === 'function') {
            window.DFOPS_resetSupabaseClient();
          }
          this.supabase = window.DFOPS_getSupabaseClient();

          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const { data: authData, error: authError } = await this.supabase.auth.signUp({
            email: this.form.email.trim(),
            password: this.form.password,
            options: {
              data: { slug: slugTrimmed },
              emailRedirectTo: origin ? `${origin}/admin.html` : undefined,
              captchaToken: turnstileToken,
            },
          });
          if (authError) throw authError;

          const user = authData?.user;
          const userId = user?.id;
          const hasSession = !!authData?.session;

          // Anti-enumeration Supabase: dla już istniejącego adresu przy włączonym
          // potwierdzaniu e-maila zwracany jest "user" z pustą tablicą identities
          // i bez sesji. To jedyny sygnał, że e-mail jest zajęty — nie udawaj sukcesu.
          const identities = Array.isArray(user?.identities) ? user.identities : null;
          if (userId && !hasSession && identities && identities.length === 0) {
            throw new Error(EMAIL_TAKEN_MSG);
          }

          if (userId) {
            this.pendingEmailConfirmation = !hasSession;
            this.success = true;
            if (hasSession) {
              localStorage.setItem('dfops_login_time', String(Date.now()));
            }
            return;
          }

          // Brak user w odpowiedzi — najpewniej ponowna rejestracja na ten sam e-mail.
          // Nie udajemy sukcesu ("sprawdź skrzynkę") — informujemy, że adres jest zajęty.
          throw new Error(EMAIL_TAKEN_MSG);
        } catch (e) {
          this.errorMessage = formatRegistrationAuthError(e);
          this.resetTurnstile();
        } finally {
          this.loading = false;
        }
      },
    };
  }
  window.createRegistrationApp = createRegistrationApp;
})();
