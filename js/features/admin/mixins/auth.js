function adminMixinAuth(ctx) {
  const {
    cfg,
    repo,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
  } = ctx;
  return {
      init() {
        if (typeof window.DFOPS_applyThemeStyling === 'function') {
          window.DFOPS_applyThemeStyling(null, '', 'admin');
        }
        window.addEventListener('beforeunload', (e) => {
          if (this.hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = 'Masz niezapisane zmiany!';
          }
        });
        this.supabase = window.DFOPS_getSupabaseClient();
        window.addEventListener('hashchange', () => {
          if (this.loadingAuth || this.panelBootLoading || !this.content?.pl || this.showWizard) return;
          const t = parseAdminTabFromHash();
          if (t) {
            this.activeTab = t;
            this.ensureActiveTabForTheme();
            return;
          }
          if (window.location.hash === '' || window.location.hash === '#') {
            this.activeTab = 'dashboard';
          }
        });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || this.loadingAuth) return;
          if (this.user && this.needsEmailConfirmation) {
            void this.syncAuthUserFromServer();
          }
        });
        this.supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY') {
            this._passwordRecoveryPendingUi = true;
          }
          if (session?.user) this.assignAuthUser(session.user);
          else this.assignAuthUser(null);
          if (!this.loadingAuth && (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'SIGNED_IN')) {
            void this.syncAuthUserFromServer();
          }
          if (event === 'PASSWORD_RECOVERY' && !this.loadingAuth && this.user) {
            this.isForcedPasswordReset = true;
            this.applyPasswordRecoveryUi();
          }
          if (this.loadingAuth) return;
          if (!this.isEmailVerified) {
            this.showWizard = false;
            return;
          }
        });
        void this.bootstrapAdminSession();
      },

      /**
       * Ustawia this.user i needsEmailConfirmation z jednego miejsca (sesja klienta lub odpowiedź getUser).
       */
      assignAuthUser(user) {
        if (!user) {
          this.user = null;
          this.needsEmailConfirmation = false;
          this.isForcedPasswordReset = false;
          return;
        }
        this.user = { ...user };
        this.needsEmailConfirmation = !userEmailLooksConfirmed(user);
      },

      /** PKCE: link z maila zawiera ?code= — bez wymiany sesja pozostaje „sprzed” potwierdzenia. `type=recovery` = reset hasła. */
      async consumeEmailConfirmParamsFromUrl() {
        if (!this.supabase) return;
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (!code) return;
        let flowType = (url.searchParams.get('type') || '').toLowerCase();
        if (!flowType && url.hash && url.hash.length > 1) {
          try {
            const hp = new URLSearchParams(url.hash.replace(/^#/, ''));
            flowType = (hp.get('type') || '').toLowerCase();
          } catch {
            /* ignore */
          }
        }
        const { error } = await this.supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        if (flowType === 'recovery') {
          this._passwordRecoveryPendingUi = true;
          this.isForcedPasswordReset = true;
        }
        ['code', 'code_challenge', 'code_challenge_method', 'type'].forEach((k) => url.searchParams.delete(k));
        const qs = url.searchParams.toString();
        window.history.replaceState({}, document.title, url.pathname + (qs ? `?${qs}` : '') + url.hash);
      },

      /** Po wejściu z linku resetu: izolatka UI — brak dostępu do panelu do ustawienia hasła. */
      applyPasswordRecoveryUi() {
        if (this._passwordRecoveryUiHandled || !this.user) return;
        this._passwordRecoveryUiHandled = true;
        this._passwordRecoveryPendingUi = false;
        this.showWizard = false;
        this.isForcedPasswordReset = true;
      },

      async requestPasswordReset(evt) {
        if (evt && typeof evt.preventDefault === 'function') {
          evt.preventDefault();
          evt.stopPropagation();
        }
        this.authError = '';
        this.forgotPasswordInfo = '';
        const em = String(this.forgotPasswordEmail || '').trim();
        if (!em) {
          this.authError = 'Podaj adres e-mail.';
          return;
        }
        if (!this.supabase) {
          this.supabase = window.DFOPS_getSupabaseClient();
        }
        this.forgotPasswordSending = true;
        try {
          const redirectTo = resolvePasswordResetRedirectUrl();
          if (!redirectTo) {
            this.authError = 'Nie można ustalić adresu powrotu (redirect). Odśwież stronę i spróbuj ponownie.';
            return;
          }
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[DFCMS] resetPasswordForEmail redirectTo', redirectTo);
          }
          const { error } = await this.supabase.auth.resetPasswordForEmail(em, {
            redirectTo,
          });
          if (error) throw error;
          this.forgotPasswordInfo =
            'Na podany adres — jeśli jest zarejestrowany w DFCMS — wysłaliśmy wiadomość z linkiem. Sprawdź skrzynkę i spam. Gdy nic nie dojdzie w kilka minut: upewnij się, że to ten sam e-mail co przy rejestracji, albo skontaktuj się z pomocą.';
          this.showToast(
            'Jeśli konto istnieje, mail z linkiem został wysłany — sprawdź skrzynkę i folder spam.',
            'success',
          );
        } catch (err) {
          const raw =
            err && typeof err === 'object'
              ? String(err.message || err.msg || err.error_description || err)
              : String(err);
          if (typeof console !== 'undefined' && console.error) {
            console.error('[DFCMS] resetPasswordForEmail', err);
          }
          const lower = raw.toLowerCase();
          if (lower.includes('redirect') && (lower.includes('url') || lower.includes('invalid'))) {
            this.authError =
              'Serwer odrzucił adres powrotu. W Supabase: Authentication → URL Configuration → Redirect URLs — dodaj dokładnie ten adres (lub wildcard): ' +
              String(resolvePasswordResetRedirectUrl() || '…/admin.html');
          } else {
            this.authError = raw || 'Nie udało się wysłać wiadomości.';
          }
        } finally {
          this.forgotPasswordSending = false;
        }
      },

      /**
       * Zawsze preferuj getUser() (dane z serwera), nie tylko session.user z pamięci lokalnej / JWT.
       */
      async syncAuthUserFromServer() {
        if (!this.supabase) return;
        try {
          const { data: sessWrap } = await this.supabase.auth.getSession();
          if (sessWrap?.session?.user && !userEmailLooksConfirmed(sessWrap.session.user)) {
            await this.supabase.auth.refreshSession();
          }
          let { data: userData, error: userError } = await this.supabase.auth.getUser();
          if ((userError || !userData?.user) && sessWrap?.session) {
            await this.supabase.auth.refreshSession();
            ({ data: userData, error: userError } = await this.supabase.auth.getUser());
          }
          if (!userError && userData?.user) {
            this.assignAuthUser(userData.user);
          }
        } catch {
          /* ignore */
        }
      },

      async refreshSuperadminStatus() {
        if (!this.user?.id || !repo || typeof repo.isCurrentUserSuperadmin !== 'function') {
          this.isSuperadmin = false;
          this.isSuperAdmin = false;
          return false;
        }
        try {
          const access = await repo.isCurrentUserSuperadmin(this.user.id);
          const allowed = !!(!access.error && access.allowed);
          this.isSuperadmin = allowed;
          this.isSuperAdmin = allowed;
          return allowed;
        } catch {
          this.isSuperadmin = false;
          this.isSuperAdmin = false;
          return false;
        }
      },

      async bootstrapAdminSession() {
        try {
          await this.consumeEmailConfirmParamsFromUrl();
        } catch (e) {
          const raw = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
          this.showToast(
            /expired|invalid|already been used|flow state/i.test(raw)
              ? 'Ten link wygasł lub został już użyty. Zaloguj się hasłem albo kliknij „Wyślij link ponownie”.'
              : raw || 'Nie udało się dokończyć logowania z linku z maila.',
            'error',
          );
        }
        const { data: { session } } = await this.supabase.auth.getSession();
        this.assignAuthUser(session?.user || null);
        await this.syncAuthUserFromServer();
        if (this.user) await this.refreshSuperadminStatus();
        const paymentRefreshScheduled = !!this.user && this.schedulePostPaymentDataRefresh();
        const portalRefreshScheduled =
          !!this.user && !paymentRefreshScheduled && this.schedulePostPortalBillingRefresh();
        if (this.user && !paymentRefreshScheduled && !portalRefreshScheduled) {
          this.isLoading = true;
        }
        if (
          this.user &&
          !paymentRefreshScheduled &&
          !portalRefreshScheduled &&
          !this.isForcedPasswordReset
        ) {
          await this.loadData();
        } else if (this.user && this.isForcedPasswordReset) {
          this.isLoading = false;
        }
        /** Dopiero po pierwszym loadData nie pokazujemy „pustego” panelu (mniej migania przy pierwszym logowaniu). */
        this.loadingAuth = false;
        if (this._passwordRecoveryPendingUi && this.user) {
          this.applyPasswordRecoveryUi();
        }
      },

      async resendSignupConfirmation() {
        const email = this.user?.email;
        if (!email) {
          this.showToast('Brak adresu e-mail w sesji.', 'error');
          return;
        }
        if (!this.supabase) {
          this.supabase = window.DFOPS_getSupabaseClient();
        }
        this.resendConfirmLoading = true;
        try {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const { error } = await this.supabase.auth.resend({
            type: 'signup',
            email,
            options: {
              emailRedirectTo: origin ? `${origin}/admin.html` : undefined,
            },
          });
          if (error) {
            if (resendErrorMeansAlreadyConfirmed(error)) {
              await this.syncAuthUserFromServer();
              this.showToast(
                'Ten adres jest już potwierdzony — zaktualizowaliśmy sesję z serwera. Możesz uruchomić kreator.',
                'success',
              );
              this.isLoading = true;
              await this.loadData();
              return;
            }
            throw error;
          }
          this.showToast('E-mail z linkiem został wysłany ponownie — sprawdź skrzynkę (także spam).', 'success');
        } catch (err) {
          this.showToast(formatResendSignupError(err), 'error');
        } finally {
          this.resendConfirmLoading = false;
        }
      },
      async login(evt) {
        if (evt && typeof evt.preventDefault === 'function') {
          evt.preventDefault();
          evt.stopPropagation();
        }
        this.authError = '';
        localStorage.setItem('dfops_remember', String(!!this.rememberMe));
        if (typeof window.DFOPS_resetSupabaseClient === 'function') {
          window.DFOPS_resetSupabaseClient();
        }
        this.supabase = window.DFOPS_getSupabaseClient();
        const { data, error } = await this.supabase.auth.signInWithPassword({
          email: this.email,
          password: this.password,
        });
        if (error) this.authError = 'Błędny e-mail lub hasło.';
        else {
          localStorage.setItem('dfops_login_time', String(Date.now()));
          this.isLoading = true;
          this.assignAuthUser(data.user);
          await this.syncAuthUserFromServer();
          await this.refreshSuperadminStatus();
          if (!this.schedulePostPaymentDataRefresh()) {
            await this.loadData();
          }
        }
      },
      async logout() {
        if (typeof this._stopContentWatch === 'function') {
          this._stopContentWatch();
          this._stopContentWatch = null;
        }
        await this.supabase.auth.signOut();
        try {
          localStorage.removeItem('dfops_login_time');
        } catch (e) { /* ignore */ }
        this.showLoginForgotPassword = false;
        this.forgotPasswordEmail = '';
        this.forgotPasswordInfo = '';
        this._passwordRecoveryPendingUi = false;
        this._passwordRecoveryUiHandled = false;
        this.isForcedPasswordReset = false;
        this.assignAuthUser(null);
        this.isSuperadmin = false;
        this.isSuperAdmin = false;
        this.isImpersonating = false;
        this.impersonatedPageOwnerId = null;
        this.content = createAdminContentShell();
        this.pageId = null;
        this.isLoading = false;
        this.customDomainStatus = '';
        this.domainInput = '';
        this.showDnsInstructions = false;
        this.showWizard = false;
        this.wizardStep = 0;
        this.wizardTheme = '';
        this.wizardFieldWarning = '';
        this.showWizardDismissModal = false;
        this.showWelcomeModal = false;
        this.hasUnsavedChanges = false;
        this.showSuccessModal = false;
        this.billingProfile = null;
        this.pageBillingPlan = 'trial';
        this.billingSubscriptionView = emptyBillingSubscriptionView();
        this.subscriptionPlan = 'trial';
        this.hasActivePaidSubscription = false;
        this.subscriptionRenewalDateFormatted = '—';
        this.subscriptionRenewalDateBadgeShort = '—';
        this.activePaidTierForUi = null;
        this.isSubscriptionCanceledButValid = false;
        this.showStripeBillingPortal = false;
        this.activeSubscriptionBrandLabel = '';
        this.activeSubscriptionPriceLine = '';
        this.billingProfileReady = false;
        this._billingStatusToastShown = false;
        this._initialPanelLoadDone = false;
        this._subscriptionTabStripeSynced = false;
        if (this._postPaymentRefreshTimer != null) {
          clearTimeout(this._postPaymentRefreshTimer);
          this._postPaymentRefreshTimer = null;
        }
      },
  };
}
