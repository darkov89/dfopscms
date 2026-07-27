;(function () {
  function tr(path, vars, locale) {
    if (typeof window.DFOPS_uiT === 'function') return window.DFOPS_uiT(path, vars, locale);
    return path;
  }

  /** Wspólna polityka haseł dla rejestracji (spójna z wymuszonym resetem w panelu). */
  function passwordPolicyError(pw, locale) {
    const s = String(pw || '');
    if (s.length < 8) return tr('register.errPwLen', null, locale);
    if (!/[\p{L}]/u.test(s)) return tr('register.errPwLetter', null, locale);
    if (!/\d/u.test(s)) return tr('register.errPwDigit', null, locale);
    return null;
  }

  function formatRegistrationAuthError(err, locale) {
    if (!err) return tr('register.errCreate', null, locale);
    const code = err.code || err.name;
    const msg = String(err.message || '');
    if (code === 'over_email_send_rate_limit' || msg.includes('over_email_send_rate_limit')) {
      const secMatch = msg.match(/(\d+)\s*seconds?/i);
      const sec = secMatch ? secMatch[1] : tr('register.errRateLimitSecFallback', null, locale);
      return tr('register.errRateLimit', { sec: sec }, locale);
    }
    if (
      code === 'user_already_registered' ||
      /already registered|already been registered|email address is already/i.test(msg)
    ) {
      return tr('register.errAlreadyRegistered', null, locale);
    }
    return msg || tr('register.errCreate', null, locale);
  }

  function applyRegisterMeta(locale) {
    const title = tr('meta.registerTitle', null, locale);
    if (title) document.title = title;
  }

  function createRegistrationApp() {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    const i18n =
      typeof window.DFOPS_uiI18nState === 'function'
        ? window.DFOPS_uiI18nState()
        : {
            uiLocale: 'pl',
            t: function (k) {
              return k;
            },
            setUiLocale: function () {},
          };

    return Object.assign({}, i18n, {
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
        applyRegisterMeta(this.uiLocale);
      },

      onUiLocaleChange(loc) {
        applyRegisterMeta(loc);
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
        // Autofill czasem wypełnia DOM bez x-model — zsynchronizuj przed walidacją.
        const pwEl = document.getElementById('reg-password');
        const pw2El = document.getElementById('reg-password-confirm');
        if (pwEl && typeof pwEl.value === 'string') this.form.password = pwEl.value;
        if (pw2El && typeof pw2El.value === 'string') this.form.passwordConfirm = pw2El.value;
        const slugTrimmed = (this.form.slug || '').trim();
        const loc = this.uiLocale;
        try {
          if (!this.accepted) {
            throw new Error(tr('register.errAccept', null, loc));
          }
          const policyError = passwordPolicyError(this.form.password, loc);
          if (policyError) throw new Error(policyError);
          if (this.form.password !== this.form.passwordConfirm) {
            throw new Error(tr('register.errPwMatch', null, loc));
          }
          const okSlug = await this.checkSlugUnique();
          if (!okSlug) throw new Error(tr('register.errSlug', null, loc));
          const turnstileToken = this.getTurnstileToken();
          if (!turnstileToken) {
            throw new Error(tr('register.errCaptcha', null, loc));
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
            throw new Error(tr('register.errEmailTaken', null, loc));
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
          throw new Error(tr('register.errEmailTaken', null, loc));
        } catch (e) {
          this.errorMessage = formatRegistrationAuthError(e, loc);
          this.resetTurnstile();
        } finally {
          this.loading = false;
        }
      },
    });
  }
  window.createRegistrationApp = createRegistrationApp;
})();
