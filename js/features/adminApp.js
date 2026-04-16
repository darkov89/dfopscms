;(function () {
  /** Pusty szkielet `content` — Alpine nie wywołuje wtedy błędów typu `null.pl` przed `loadData`. */
  function formatResendSignupError(err) {
    if (!err) return 'Nie udało się wysłać maila.';
    if (typeof err !== 'object') return String(err) || 'Nie udało się wysłać maila.';
    const code = err.code || err.name;
    const msg = String(err.message || err.msg || '');
    if (code === 'over_email_send_rate_limit' || msg.includes('over_email_send_rate_limit')) {
      const secMatch = msg.match(/(\d+)\s*seconds?/i);
      const sec = secMatch ? secMatch[1] : 'kilka';
      return `Wysłano już niedawno wiadomość na ten adres. Odczekaj ok. ${sec} s — albo sprawdź skrzynkę (spam).`;
    }
    return msg || 'Nie udało się wysłać maila.';
  }

  /** Czy konto ma ustawione potwierdzenie e-mail (snake_case + camelCase — różne wersje klienta JWT). */
  function userEmailLooksConfirmed(u) {
    if (!u || typeof u !== 'object') return false;
    const ok = (v) => v != null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null';
    return !!(
      ok(u.email_confirmed_at) ||
      ok(u.confirmed_at) ||
      ok(u.emailConfirmedAt) ||
      ok(u.confirmedAt)
    );
  }

  function resendErrorMeansAlreadyConfirmed(err) {
    if (!err || typeof err !== 'object') return false;
    const code = String(err.code || '');
    const msg = String(err.message || '').toLowerCase();
    if (code === 'email_address_already_confirmed') return true;
    return /already confirmed|already verified|already registered|email address is already confirmed/i.test(msg);
  }

  function createAdminContentShell() {
    return {
      pl: {
        nav: { logo: '', cta: '', logoImage: '', menu: {} },
        hero: { name: '', headline: '', subheadline: '', description: '', button: '', image: '', qrText: '', qrImage: '' },
        manifesto: { label: '', title: '', text: '' },
        services: [],
        proof: { label: '', title: '', text: '', statNumber: '', statLabel: '', statDesc: '' },
        gallery: { title: '', images: [] },
        faq: [],
        contact: {
          email: '',
          phone: '',
          address: '',
          booksyUrl: '',
          map_embed_url: '',
          map_place_id: '',
          cta: {
            enabled: false,
            title: '',
            description: '',
            button_text: '',
            button_url: '',
          },
        },
        social: { linkedin: '', facebook: '', instagram: '', tiktok: '' },
        google_reviews: { embed_url: '', place_query: '', max_reviews: 6, title: 'Opinie z Google' },
        reviews: [],
        seo: { title: '', description: '', ogImage: '' },
        legal: { enabled: false, privacy_policy: '', terms: '' },
        cookies: { text: '', accept: '' },
        footer: { quote: '', copyright: '', privacy: '' },
        settings: {
          template_version: 1,
          color_preset: 'beige',
          subscription: { plan: 'trial', trial_started_at: new Date().toISOString(), selected_plan: null },
          background_style: 'soft',
          font_preset: 'inter',
          darkMode: false,
          showManifesto: true,
          showServices: true,
          showProof: true,
          showFaq: true,
          showReviews: true,
          showContact: true,
          onboarding_completed: false,
          /** Pusta po pierwszym logowaniu — włącza powitalny modal (Treść → pierwsze pola). */
          business_name: '',
          /** Zapis w Supabase po powicie / zakończeniu touru (Driver.js) — nie pokazuj modala ponownie. */
          welcome_onboarding_completed: false,
        },
      },
    };
  }

  /** Ciepły komunikat podczas dodawania zdjęć — zależnie od miejsca w panelu. */
  function uploadingMessageFor(section, field) {
    if (section === 'nav' && field === 'logoImage') return 'Chwileczkę, dodaję logo Twojej marki…';
    if (section === 'hero' && field === 'image') return 'Chwileczkę, dodaję Twoje zdjęcie…';
    if (section === 'hero' && field === 'qrImage') return 'Zapisuję ten detal — kod QR…';
    if (section === 'gallery' && field === 'images') return 'Chwileczkę, dodaję zdjęcie do galerii…';
    if (section === 'reviews' && field === 'logoImage') return 'Przetwarzam ikonkę przy tej opinii…';
    if (section === 'seo' && field === 'ogImage') return 'Zapisuję obrazek do podglądu w mediach…';
    return 'Chwileczkę, dodaję Twoje zdjęcie…';
  }

  /**
   * URL powrotu z maila resetującego — musi być na liście Redirect URLs w Supabase (dokładnie lub wildcard).
   * Produkcja: kanonicznie https://{appDomain}/admin.html, żeby www / bez www nie psuły walidacji.
   */
  function resolvePasswordResetRedirectUrl() {
    const cfg = window.DFOPS_CONFIG || {};
    const explicit = typeof cfg.passwordResetRedirectUrl === 'string' ? cfg.passwordResetRedirectUrl.trim() : '';
    if (explicit) return explicit;
    if (typeof window === 'undefined' || !window.location) return undefined;
    const origin = window.location.origin;
    const host = (window.location.hostname || '').toLowerCase();
    const isLocal =
      host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || host.endsWith('.localhost');
    const ad = typeof cfg.appDomain === 'string' ? cfg.appDomain.trim().toLowerCase() : '';
    const matchesProd =
      ad && (host === ad || host === `www.${ad}`);
    if (!isLocal && matchesProd && ad) {
      return `https://${ad}/admin.html`;
    }
    return origin ? `${origin.replace(/\/$/, '')}/admin.html` : undefined;
  }

  /** Polityka hasła wyłącznie przy wymuszonym resecie (izolatka). */
  function passwordPolicyErrorForRecovery(pw) {
    const s = String(pw || '').trim();
    if (s.length < 8) return 'Hasło musi mieć co najmniej 8 znaków.';
    if (!/[\p{L}]/u.test(s)) return 'Hasło musi zawierać co najmniej jedną literę.';
    if (!/\d/u.test(s)) return 'Hasło musi zawierać co najmniej jedną cyfrę.';
    return null;
  }

  function createAdminApp() {
    const t = window.DFOPS_CONFIG?.timeouts || {};
    const MS_PER_DAY = t.msPerDay ?? 86400000;
    const ERROR_MESSAGE_TIMEOUT = t.errorMessage ?? 5000;
    const SUCCESS_MESSAGE_TIMEOUT = t.successMessage ?? 3000;
    const UPGRADE_MESSAGE_TIMEOUT = t.upgradeMessage ?? 3500;
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    return {
      supabase: null,
      user: null,
      loadingAuth: true,
      email: '',
      password: '',
      rememberMe: false,
      authError: '',
      /** Logowanie: widok „Nie pamiętam hasła” (ten sam admin.html). */
      showLoginForgotPassword: false,
      forgotPasswordEmail: '',
      forgotPasswordSending: false,
      forgotPasswordInfo: '',
      /** Link resetujący hasło (Supabase) — po loadData: izolatka wymuszonego resetu. */
      _passwordRecoveryPendingUi: false,
      _passwordRecoveryUiHandled: false,
      /** Sesja z linku recovery — pełny panel ukryty do ustawienia nowego hasła. */
      isForcedPasswordReset: false,
      slug: new URLSearchParams(window.location.search).get('site') || '',
      lang: 'pl',
      theme: '',
      isLoading: false,
      /** Pakiet do feature gating (kolory). Test lokalny: ustaw 'pro' | 'premium'; po loadData nadpisuje się z subskrypcji. */
      userPlan: 'starter',
      content: createAdminContentShell(),
      showWizard: false,
      wizardStep: 0,
      wizardTheme: '',
      wizardFieldWarning: '',
      /** Jednorazowy komunikat po „Pomiń kreator” — bez listy „ninja” u góry. */
      showWizardDismissModal: false,
      /** Pierwsza konfiguracja: treść bez `business_name` (po normalize — zob. loadData). */
      showWelcomeModal: false,
      showStudioWelcomeModal: false,
      customDomain: '',
      customDomainStatus: '',
      pageId: null,
      verifyingDomain: false,
      domainMessage: '',
      domainError: '',
      showDnsInstructions: false,
      showTemplateSwitcher: false,
      activeTab: 'hero',
      saving: false,
      uploadingImage: false,
      uploadingMessage: '',
      message: '',
      errorMessage: '',
      toast: { show: false, message: '', type: 'success' },
      _toastTimer: null,
      hasUnsavedChanges: false,
      _stopContentWatch: null,
      upgrading: false,
      checkoutLoading: false,
      stripeSyncLoading: false,
      newPassword: '',
      newPasswordConfirm: '',
      /** Podgląd znaków przy zmianie hasła (Konto). */
      showAccountPassword: false,
      isPasswordUpdating: false,
      isPortalLoading: false,
      latestTemplateVersion: window.DFOPS_LATEST_TEMPLATE_VERSION || 3,
      currentTemplateVersion: 1,
      updateAvailable: false,
      selectedStyleBundle: '',
      /** Ustawiane z pages.trial_blocked_at — po trialu bez płatności strona publiczna jest zablokowana. */
      trialBlockedAt: null,
      showTrialSuspendedModal: true,
      /** Opcjonalny modal po płatności — główny flow opiera się na toastach + opóźnionym loadData. */
      showSuccessModal: false,
      _postPaymentRefreshTimer: null,
      resendConfirmLoading: false,
      /**
       * Z serwera Auth (getUser), nie ze „stale” session.user w JWT.
       * true = pokaż baner + blokuj kreator do czasu potwierdzenia maila.
       */
      needsEmailConfirmation: false,
      get availablePresets() {
        const currentTheme = this.showWizard
          ? (this.wizardTheme || this.theme || 'beauty')
          : (this.theme || 'beauty');
        return cfg.presetsByTheme[currentTheme] || [];
      },
      get accentColor() { return cfg.accentByPreset[this.content?.pl?.settings?.color_preset] || '#D4AF37'; },
      get styleBundles() { return cfg.bundlesByTheme[this.theme] || []; },
      get subscriptionPlan() { return this.content?.pl?.settings?.subscription?.plan || 'trial'; },
      /** Tier zapisany w CMS albo wybrany przed pełnym merge z webhookiem. */
      get activePaidTierForUi() {
        const p = this.subscriptionPlan;
        if (p === 'tier0' || p === 'tier1' || p === 'tier2') return p;
        const sel = this.content?.pl?.settings?.subscription?.selected_plan;
        if (sel === 'tier0' || sel === 'tier1' || sel === 'tier2') return sel;
        return null;
      },
      /** Kreator tylko po potwierdzeniu e-maila — zgodny z needsEmailConfirmation ustawianym po getUser(). */
      get isEmailVerified() {
        return !!this.user && !this.needsEmailConfirmation;
      },
      /**
       * Checklista „co jeszcze dołożyć” dopóki `onboarding_completed` jest false — bez pełnoekranowego kreatora.
       * Kolejność zgodna z walidacją kreatora (szablon → marka → nagłówek → kontakt).
       */
      get incompleteOnboardingChecks() {
        if (!this.content?.pl?.settings || this.content.pl.settings.onboarding_completed === true) return [];
        const pl = this.content.pl;
        if (!pl) return [];
        const items = [];
        if (this.theme === 'setup') {
          items.push({ id: 'setup', label: 'Wybierz szablon Salon lub Konsultant', tab: null, openWizard: true });
        }
        if (!String(pl.nav?.logo || '').trim()) {
          items.push({ id: 'navlogo', label: 'Podaj nazwę marki w menu strony', tab: 'settings', openWizard: false });
        }
        if (!String(pl.hero?.headline || '').trim()) {
          items.push({ id: 'hero', label: 'Uzupełnij główny nagłówek w sekcji powitalnej', tab: 'hero', openWizard: false });
        }
        const phone = String(pl.contact?.phone || '').trim();
        const email = String(pl.contact?.email || '').trim();
        if (!phone && !email) {
          items.push({ id: 'contact', label: 'Dodaj telefon lub e-mail do kontaktu', tab: 'contact', openWizard: false });
        }
        return items;
      },
      /**
       * Aktywny plan płatny w CMS lub subskrypcja Stripe ze statusem active/trialing
       * (np. gdy webhook nie nadpisał jeszcze pola `plan`).
       */
      get hasActivePaidSubscription() {
        const p = this.subscriptionPlan;
        if (p === 'tier0' || p === 'tier1' || p === 'tier2') return true;
        const sub = this.content?.pl?.settings?.subscription;
        const st = typeof sub?.status === 'string' ? sub.status : '';
        const sid = typeof sub?.stripe_subscription_id === 'string' ? sub.stripe_subscription_id.trim() : '';
        if (sid && (st === 'active' || st === 'trialing')) return true;
        return false;
      },
      /**
       * True gdy w Stripe wisi jeszcze subskrypcja — wtedy nie udostępniamy prośby o usunięcie konta
       * (najpierw anulowanie w portalu Stripe).
       */
      get subscriptionBlocksAccountDeletion() {
        const sub = this.content?.pl?.settings?.subscription;
        const sid = typeof sub?.stripe_subscription_id === 'string' ? sub.stripe_subscription_id.trim() : '';
        if (!sid) return false;
        const stRaw = typeof sub?.status === 'string' ? sub.status.trim().toLowerCase() : '';
        if (stRaw === 'canceled' || stRaw === 'cancelled' || stRaw === 'incomplete_expired') return false;
        if (!stRaw) return true;
        return ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(stRaw);
      },
      get activeSubscriptionBrandLabel() {
        const t = this.activePaidTierForUi;
        if (t === 'tier2') return 'PREMIUM';
        if (t === 'tier1') return 'PRO';
        if (t === 'tier0') return 'STARTER';
        if (this.hasActivePaidSubscription) return 'SUBSKRYPCJA STRIPE';
        return '';
      },
      get activeSubscriptionPriceLine() {
        const t = this.activePaidTierForUi;
        if (t === 'tier2') return '99 PLN netto / msc';
        if (t === 'tier1') return '49 PLN netto / msc';
        if (t === 'tier0') return '19 PLN netto / msc';
        if (this.hasActivePaidSubscription) return 'Kwota zgodnie z aktywnym pakietem w Stripe';
        return '';
      },
      get trialDaysLeft() {
        const sub = this.content?.pl?.settings?.subscription;
        if (!sub || sub.plan !== 'trial' || !sub.trial_started_at) return 14;
        const start = new Date(sub.trial_started_at).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - start) / MS_PER_DAY);
        return Math.max(0, 14 - elapsed);
      },
      get isCustomDomainLocked() {
        if (typeof window.DFOPS_planAllowsCustomDomain === 'function') {
          return !window.DFOPS_planAllowsCustomDomain(this.subscriptionPlan);
        }
        const p = this.subscriptionPlan;
        return p === 'trial' || p === 'tier0';
      },
      getPublicSiteUrl() {
        const hostCustom = typeof this.customDomain === 'string' ? this.customDomain.trim() : '';
        if (hostCustom && this.customDomainStatus === 'active') {
          const h = hostCustom.replace(/^https?:\/\//i, '').split('/')[0];
          return `https://${h}`;
        }
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocalhost) {
          if (!this.slug || !this.theme) return '#';
          return `/${this.theme}.html?site=${encodeURIComponent(this.slug)}`;
        }
        if (!this.slug) return '#';
        const base = (cfg.appDomain || 'dfcms.pl').toLowerCase();
        return `https://${this.slug}.${base}`;
      },
      get planDisplayLabel() {
        const sub = this.content?.pl?.settings?.subscription;
        if (typeof window.DFOPS_subscriptionDisplayName === 'function') {
          return window.DFOPS_subscriptionDisplayName(sub);
        }
        if (typeof window.DFOPS_planDisplayName === 'function') {
          return window.DFOPS_planDisplayName(this.subscriptionPlan);
        }
        return this.subscriptionPlan;
      },
      get selectedPlanHumanLabel() {
        const s = this.content?.pl?.settings?.subscription?.selected_plan;
        if (s === 'tier0') return 'Starter';
        if (s === 'tier1') return 'Pro';
        if (s === 'tier2') return 'Premium';
        return '';
      },

      subscriptionPaymentActive() {
        const sub = this.content?.pl?.settings?.subscription;
        if (!sub || sub.payment_completed !== true) return false;
        const p = sub.plan;
        return p === 'tier0' || p === 'tier1' || p === 'tier2';
      },
      get planSummaryLine() {
        if (typeof window.DFOPS_planCapabilitiesSummary === 'function') {
          return window.DFOPS_planCapabilitiesSummary(this.subscriptionPlan);
        }
        return '';
      },

      showError(msg) {
        this.errorMessage = msg;
        setTimeout(() => { this.errorMessage = ''; }, ERROR_MESSAGE_TIMEOUT);
      },

      showToast(message, type = 'success') {
        if (!this.toast) this.toast = { show: false, message: '', type: 'success' };
        this.toast.message = String(message || '');
        const t = type === 'error' ? 'error' : type === 'info' ? 'info' : 'success';
        this.toast.type = t;
        this.toast.show = true;
        if (this._toastTimer) clearTimeout(this._toastTimer);
        const ms = t === 'info' ? 5000 : 4000;
        this._toastTimer = setTimeout(() => { this.toast.show = false; }, ms);
      },

      setTab(tab) {
        this.activeTab = tab;
        this.sidebarOpen = false;
      },

      maybeShowPaymentReturnToast() {
        /** Parametr `payment` jest czyszczony w init() — tu tylko zapas na starsze sesje. */
        try {
          const url = new URL(window.location.href);
          const p = url.searchParams.get('payment');
          if (!p) return;
          url.searchParams.delete('payment');
          const qs = url.searchParams.toString();
          window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash);
          if (p === 'cancelled') {
            this.showToast('Płatność nie została dokończona — możesz spróbować ponownie w sekcji Subskrypcja.', 'error');
          }
        } catch (e) {
          /* ignore */
        }
      },

      /** Polska data z ISO w subscription.current_period_end (webhook Stripe). */
      /** Zmiana hasła: dopiero po 6+ znakach i zgodności obu pól (po trim). */
      get accountPasswordFieldsTrimmed() {
        return {
          a: String(this.newPassword ?? '').trim(),
          b: String(this.newPasswordConfirm ?? '').trim(),
        };
      },
      get canUpdatePassword() {
        if (this.isPasswordUpdating) return false;
        const { a, b } = this.accountPasswordFieldsTrimmed;
        return a.length >= 6 && a === b;
      },
      get accountPasswordHint() {
        const { a, b } = this.accountPasswordFieldsTrimmed;
        if (!a && !b) return '';
        if (a.length < 6) return `Za krótkie — minimum 6 znaków (${a.length}/6).`;
        if (!b) return 'Wpisz to samo hasło w polu „Potwierdź”.';
        if (a !== b) return 'Hasła się różnią.';
        return 'Hasła są zgodne — możesz zapisać.';
      },
      get accountPasswordHintClass() {
        return this.canUpdatePassword ? 'text-emerald-700' : 'text-amber-800';
      },

      supportEmailDisplay() {
        return (cfg && typeof cfg.supportEmail === 'string' && cfg.supportEmail.includes('@')
          ? cfg.supportEmail.trim()
          : 'kontakt@dfops.eu');
      },
      supportMailtoHref() {
        return `mailto:${encodeURIComponent(this.supportEmailDisplay())}`;
      },

      get canSubmitForcedPasswordReset() {
        if (this.isPasswordUpdating) return false;
        const a = String(this.newPassword ?? '').trim();
        const b = String(this.newPasswordConfirm ?? '').trim();
        if (a !== b || !a) return false;
        return passwordPolicyErrorForRecovery(a) === null;
      },
      get forcedResetPasswordHint() {
        const a = String(this.newPassword ?? '').trim();
        const b = String(this.newPasswordConfirm ?? '').trim();
        if (!a && !b) return '';
        const pol = passwordPolicyErrorForRecovery(a);
        if (pol) return pol;
        if (!b) return 'Potwierdź hasło w drugim polu.';
        if (a !== b) return 'Hasła muszą być identyczne.';
        return 'Hasło spełnia wymagania.';
      },
      get forcedResetPasswordHintClass() {
        return this.canSubmitForcedPasswordReset ? 'text-emerald-700' : 'text-amber-800';
      },
      get subscriptionRenewalDateFormatted() {
        const raw = this.content?.pl?.settings?.subscription?.current_period_end;
        if (raw == null || raw === '') return '—';
        try {
          const d = new Date(typeof raw === 'number' ? raw * 1000 : String(raw));
          if (Number.isNaN(d.getTime())) return '—';
          return d.toLocaleDateString('pl-PL', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
        } catch {
          return '—';
        }
      },

      closeSuccessModal() {
        this.showSuccessModal = false;
      },

      /** Stripe Customer Portal (anulacja / metoda płatności) — Edge Function `create-portal-session`. */
      openStripeCustomerPortal() {
        return this.openCustomerPortal();
      },

      async updatePassword() {
        if (!this.supabase) {
          this.showToast('Brak połączenia z serwisem. Odśwież stronę.', 'error');
          return;
        }
        const pw = String(this.newPassword ?? '').trim();
        const pw2 = String(this.newPasswordConfirm ?? '').trim();

        if (this.isForcedPasswordReset) {
          const polErr = passwordPolicyErrorForRecovery(pw);
          if (polErr) {
            this.showToast(polErr, 'error');
            return;
          }
          if (!pw2) {
            this.showToast('Wpisz ponownie hasło w polu „Potwierdź”.', 'error');
            return;
          }
          if (pw !== pw2) {
            this.showToast('Hasła nie są takie same.', 'error');
            return;
          }
        } else {
          if (pw.length < 6) {
            this.showToast('Hasło musi mieć co najmniej 6 znaków.', 'error');
            return;
          }
          if (pw !== pw2) {
            this.showToast('Hasła nie są takie same — wpisz to samo hasło w obu polach.', 'error');
            return;
          }
        }

        this.isPasswordUpdating = true;
        try {
          const { error } = await this.supabase.auth.updateUser({
            password: pw,
          });
          if (error) throw error;
          const exitForced = this.isForcedPasswordReset;
          this.newPassword = '';
          this.newPasswordConfirm = '';
          if (exitForced) {
            this.isForcedPasswordReset = false;
            try {
              window.history.replaceState({}, document.title, window.location.pathname);
            } catch {
              /* ignore */
            }
            this.showToast('Hasło zostało ustawione. Zaloguj się ponownie.', 'success');
            await this.logout();
          } else {
            this.showToast('Hasło zostało pomyślnie zmienione!', 'success');
          }
        } catch (err) {
          const msg = err && typeof err === 'object' && 'message' in err ? String((err).message) : String(err);
          this.showToast(msg || 'Nie udało się zmienić hasła.', 'error');
        } finally {
          this.isPasswordUpdating = false;
        }
      },

      async openCustomerPortal() {
        if (!this.supabase) {
          this.showToast('Brak połączenia z serwisem. Odśwież stronę.', 'error');
          return;
        }
        this.isPortalLoading = true;
        try {
          const { data: sessionData } = await this.supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          if (!token) throw new Error('Brak autoryzacji');
          const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
          const { data, error } = await this.supabase.functions.invoke('create-portal-session', {
            body: { returnUrl },
            headers: { Authorization: `Bearer ${token}` },
          });
          if (error) throw error;
          const url = data && typeof data.url === 'string' ? data.url : '';
          if (url) {
            window.location.href = url;
            return;
          }
          const errMsg =
            data && typeof data.error === 'string' ? data.error : 'Brak adresu portalu płatności.';
          throw new Error(errMsg);
        } catch (err) {
          console.error(err);
          this.showToast('Nie udało się otworzyć portalu płatności. Skontaktuj się z pomocą.', 'error');
        } finally {
          this.isPortalLoading = false;
        }
      },

      deleteAccount() {
        if (this.subscriptionBlocksAccountDeletion) {
          this.showToast(
            'Najpierw anuluj subskrypcję w Stripe: zakładka Subskrypcja → „Zarządzaj subskrypcją i fakturami”. Gdy subskrypcja w Stripe będzie anulowana, wróć tu i wyślij prośbę o usunięcie konta.',
            'error',
          );
          return;
        }
        const confirmed = confirm(
          'Czy na pewno chcesz bezpowrotnie usunąć swoje konto i stronę? Tej operacji nie można cofnąć.',
        );
        if (!confirmed) return;
        const support =
          (cfg && typeof cfg.supportEmail === 'string' && cfg.supportEmail.includes('@')
            ? cfg.supportEmail.trim()
            : 'pomoc@dfcms.pl');
        const subj = this.user?.email
          ? `Usunięcie konta: ${this.user.email}`
          : 'Usunięcie konta';
        window.location.href = `mailto:${support}?subject=${encodeURIComponent(subj)}`;
        this.showToast('Otwarto okno wiadomości. Wyślij prośbę o usunięcie konta.', 'info');
      },

      /**
       * Po ?payment=success czekamy na webhook Stripe, potem ponownie loadData (świeży content + trial_blocked_at).
       * Zwraca true, jeśli zaplanowano opóźnione odświeżenie (pierwsze loadData nie wołamy od razu).
       */
      schedulePostPaymentDataRefresh() {
        try {
          const u = new URL(window.location.href);
          if (u.searchParams.get('payment') !== 'success' || !this.user) return false;
          if (this._postPaymentRefreshTimer != null) {
            clearTimeout(this._postPaymentRefreshTimer);
            this._postPaymentRefreshTimer = null;
          }
          this.showToast('Przetwarzanie płatności... Odświeżam Twoje konto! ✨', 'success');
          this.isLoading = true;
          this._postPaymentRefreshTimer = setTimeout(async () => {
            this._postPaymentRefreshTimer = null;
            try {
              await this.loadData();
              if (!this.subscriptionPaymentActive()) {
                await this.syncStripeSubscription({ silent: true });
                await this.loadData();
              }
              if (!this.subscriptionPaymentActive()) {
                this.showToast(
                  'Nie widzimy jeszcze potwierdzenia w bazie. Otwórz Subskrypcja → „Synchronizuj ze Stripe” lub poczekaj minutę (webhook Stripe).',
                  'error',
                );
              } else {
                this.showToast('Gotowe! Twój plan jest aktywny.', 'success');
              }
            } catch (e) {
              console.error(e);
            } finally {
              this.showTrialSuspendedModal = false;
              const clean = new URL(window.location.href);
              clean.searchParams.delete('payment');
              const qs = clean.searchParams.toString();
              window.history.replaceState(
                {},
                document.title,
                clean.pathname + (qs ? `?${qs}` : '') + clean.hash,
              );
              this.showSuccessModal = false;
            }
          }, 4000);
          return true;
        } catch {
          return false;
        }
      },

      /**
       * Edge Function sync-stripe-subscription — naprawia opóźniony webhook.
       * @param {{ silent?: boolean }} opts — `silent: true` bez toastów (retry po checkout).
       */
      async syncStripeSubscription(opts) {
        const options = opts && typeof opts === 'object' ? opts : {};
        const silent = options.silent === true;
        if (!this.user?.id || !this.supabase) {
          if (!silent) this.showToast('Zaloguj się, aby zsynchronizować płatności.', 'error');
          return false;
        }
        const { data: sessionData } = await this.supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) {
          if (!silent) this.showToast('Błąd sesji. Wyloguj się i zaloguj ponownie.', 'error');
          return false;
        }
        this.stripeSyncLoading = true;
        try {
          const { data, error } = await this.supabase.functions.invoke('sync-stripe-subscription', {
            body: {},
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (error) throw error;
          if (data && data.ok === false && typeof data.error === 'string') {
            if (!silent) this.showToast(data.error, 'error');
            return false;
          }
          await this.loadData();
          if (!silent) this.showToast('Zsynchronizowano status subskrypcji ze Stripe.', 'success');
          return true;
        } catch (e) {
          console.error(e);
          const msg = e instanceof Error ? e.message : String(e);
          if (!silent) {
            this.showToast(msg || 'Nie udało się zsynchronizować. Sprawdź połączenie i czy funkcja jest wdrożona.', 'error');
          }
          return false;
        } finally {
          this.stripeSyncLoading = false;
        }
      },

      syncUserPlanFromBilling() {
        const p = this.subscriptionPlan;
        if (p === 'tier2') this.userPlan = 'premium';
        else if (p === 'tier1') this.userPlan = 'pro';
        else this.userPlan = 'starter';
      },

      isLocked(index) {
        return this.userPlan === 'starter' && index > 0;
      },

      presetSwatchColor(presetId) {
        return (cfg.accentByPreset && cfg.accentByPreset[presetId]) || '#a1a1aa';
      },

      selectColorPreset(preset, index) {
        if (!preset?.id || !this.content?.pl?.settings) return;
        if (this.isLocked(index)) {
          this.showToast('Ten kolor wymaga pakietu PRO!', 'error');
          return;
        }
        this.content.pl.settings.color_preset = preset.id;
        this.applyThemeStylingFromContent();
      },

      enforceColorPresetForStarter() {
        const presets = this.availablePresets;
        if (!presets?.length || !this.content?.pl?.settings) return;
        if (this.userPlan !== 'starter') return;
        const idx = presets.findIndex((p) => p.id === this.content.pl.settings.color_preset);
        if (idx > 0) {
          this.content.pl.settings.color_preset = presets[0].id;
          this.applyThemeStylingFromContent();
        }
      },

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
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.get('payment') === 'cancelled') {
            url.searchParams.delete('payment');
            const qs = url.searchParams.toString();
            window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash);
            this.showToast(
              'Płatność nie została dokończona — możesz spróbować ponownie w sekcji Subskrypcja.',
              'error',
            );
          }
        } catch {
          /* ignore */
        }
        this.supabase = window.DFOPS_getSupabaseClient();
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
        const paymentRefreshScheduled = !!this.user && this.schedulePostPaymentDataRefresh();
        if (this.user && !paymentRefreshScheduled) {
          this.isLoading = true;
        }
        this.loadingAuth = false;
        if (this.user && !paymentRefreshScheduled && !this.isForcedPasswordReset) {
          await this.loadData();
        } else if (this.user && this.isForcedPasswordReset) {
          this.isLoading = false;
        }
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
        this.content = createAdminContentShell();
        this.pageId = null;
        this.isLoading = false;
        this.customDomainStatus = '';
        this.showDnsInstructions = false;
        this.showWizard = false;
        this.wizardStep = 0;
        this.wizardTheme = '';
        this.wizardFieldWarning = '';
        this.showWizardDismissModal = false;
        this.showWelcomeModal = false;
        this.hasUnsavedChanges = false;
        this.showSuccessModal = false;
        if (this._postPaymentRefreshTimer != null) {
          clearTimeout(this._postPaymentRefreshTimer);
          this._postPaymentRefreshTimer = null;
        }
      },
      async ensurePageFromRegistrationMetadata() {
        const { data: first } = await repo.getCurrentUserPage(this.user.id);
        if (first) return true;

        const { data: udata, error: uerr } = await this.supabase.auth.getUser();
        if (uerr || !udata?.user) {
          this.showError('Nie znaleziono Twojej strony.');
          return false;
        }
        const user = udata.user;
        let slug = user.user_metadata && user.user_metadata.slug;
        if (typeof slug !== 'string' || !String(slug).trim()) {
          this.showError(
            'Nie znaleziono Twojej strony (brak slug w koncie). Jeśli rejestrowałeś się przed aktualizacją aplikacji, skontaktuj się z pomocą.'
          );
          return false;
        }
        slug = String(slug)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
          this.showError('Nieprawidłowy zapis adresu strony w koncie. Skontaktuj się z pomocą.');
          return false;
        }

        if (typeof window.DFOPS_buildNewSiteContent !== 'function') {
          this.showError('Brak konfiguracji szablonów (registry).');
          return false;
        }
        const content = window.DFOPS_buildNewSiteContent();
        const { error: insErr } = await repo.createPage({
          slug,
          theme: 'setup',
          color_preset: content.pl.settings.color_preset,
          content,
          user_id: user.id,
        });
        if (insErr) {
          const code = insErr.code || insErr?.code;
          if (code === '23505') {
            this.showError('Ten adres strony jest już zajęty. Skontaktuj się z pomocą.');
          } else {
            this.showError(insErr.message || 'Nie udało się utworzyć strony przy pierwszym logowaniu.');
          }
          return false;
        }
        return true;
      },

      async loadData() {
        this.isLoading = true;
        this.showWizardDismissModal = false;
        try {
          if (this.user) {
            await this.syncAuthUserFromServer();
          }
          let { data, error } = await repo.getCurrentUserPage(this.user.id);
          if (error) {
            this.showError('Nie udało się wczytać strony.');
            return;
          }
          if (!data) {
            const created = await this.ensurePageFromRegistrationMetadata();
            if (!created) {
              return;
            }
            const retry = await repo.getCurrentUserPage(this.user.id);
            if (retry.error || !retry.data) {
              this.showError('Nie znaleziono Twojej strony.');
              return;
            }
            data = retry.data;
          }
          this.pageId = data.id;
          this.slug = data.slug;
          this.theme = data.theme;
          this.trialBlockedAt = data.trial_blocked_at ?? null;
          this.showTrialSuspendedModal = !!this.trialBlockedAt;
          this.customDomain = data.custom_domain || '';
          this.customDomainStatus = data.custom_domain_status || '';
          const subSig = (s) => {
            if (!s || typeof s !== 'object') return '';
            const p = s.plan || 'trial';
            const sel = s.selected_plan == null ? '' : String(s.selected_plan);
            const paid = s.payment_completed === true ? '1' : '0';
            return `${p}|${sel}|${paid}`;
          };
          const prevSubSig = subSig(data.content?.pl?.settings?.subscription);
          this.content = window.DFOPS_normalizeContent(data.content, this.theme);
          const nextSubSig = subSig(this.content.pl.settings.subscription);
          if (prevSubSig !== nextSubSig) {
            await this.saveData({ silentSuccess: true });
          }
          this.currentTemplateVersion = Number(this.content.pl.settings.template_version || 1);
          this.updateAvailable = this.currentTemplateVersion < this.latestTemplateVersion;
          this.syncUserPlanFromBilling();
          this.applyThemeStylingFromContent();
          this.enforceColorPresetForStarter();

          if (!this.isEmailVerified) {
            this.showWizard = false;
          } else if (
            this.content?.pl?.settings?.onboarding_completed === false &&
            this.incompleteOnboardingChecks.length === 0
          ) {
            this.content.pl.settings.onboarding_completed = true;
            await this.saveData({ silentSuccess: true });
          }

          this.showWelcomeModal =
            !!this.user &&
            this.isEmailVerified &&
            !this.isForcedPasswordReset &&
            !this.content?.pl?.settings?.welcome_onboarding_completed;

          this.$nextTick(() => {
            setTimeout(() => {
              if (typeof this._stopContentWatch === 'function') {
                this._stopContentWatch();
                this._stopContentWatch = null;
              }
              this.hasUnsavedChanges = false;
              this._stopContentWatch = this.$watch('content', () => { this.hasUnsavedChanges = true; }, { deep: true });
            }, 0);
          });
        } finally {
          this.isLoading = false;
          if (this.user) this.maybeShowPaymentReturnToast();
        }
      },
      applyThemeStylingFromContent() {
        if (!this.content?.pl?.settings) return;
        window.DFOPS_applyThemeStyling(this.content.pl.settings, this.theme, 'admin');
      },

      async switchTemplate(newTemplateId) {
        if (newTemplateId !== 'beauty' && newTemplateId !== 'consultant') return;
        if (this.theme === newTemplateId) return;
        if (
          !confirm(
            'Uwaga: zmiana szablonu nadpisze aktualne teksty i układ sekcji (hero, usługi, FAQ itd.). Zachowamy dane kontaktowe, logo tekstowe i logo graficzne oraz ustawienia subskrypcji. Kontynuować?'
          )
        ) {
          return;
        }
        if (typeof window.DFOPS_mergeContentWithTemplate !== 'function' || typeof window.DFOPS_getTemplate !== 'function') {
          this.showError('Brak konfiguracji szablonów (registry).');
          return;
        }
        try {
          const savedContact = JSON.parse(JSON.stringify(this.content?.pl?.contact || {}));
          const savedLogo = this.content?.pl?.nav?.logo ?? '';
          const savedLogoImage = this.content?.pl?.nav?.logoImage ?? '';
          const savedSubscription = JSON.parse(JSON.stringify(this.content?.pl?.settings?.subscription || {}));

          const merged = window.DFOPS_mergeContentWithTemplate(newTemplateId, {});
          merged.pl.contact = savedContact;
          if (!merged.pl.nav) merged.pl.nav = {};
          merged.pl.nav.logo = savedLogo;
          merged.pl.nav.logoImage = savedLogoImage;
          if (merged.pl.settings) {
            merged.pl.settings.subscription = {
              ...(merged.pl.settings.subscription || {}),
              ...savedSubscription,
            };
          }

          this.theme = newTemplateId;
          this.content = window.DFOPS_normalizeContent(merged, newTemplateId);

          const presets = cfg.presetsByTheme[newTemplateId] || [];
          const cp = this.content.pl.settings.color_preset;
          if (presets.length && !presets.some((p) => p.id === cp)) {
            this.content.pl.settings.color_preset = presets[0].id;
          }

          this.selectedStyleBundle = '';
          this.syncUserPlanFromBilling();
          this.enforceColorPresetForStarter();
          this.applyThemeStylingFromContent();

          const ok = await this.saveData({ silentSuccess: true });
          if (!ok) return;

          this.showTemplateSwitcher = false;
          this.message = 'Szablon zmieniony. Odświeżam panel…';
          setTimeout(() => {
            window.location.reload();
          }, 900);
        } catch (e) {
          console.error(e);
          this.showError('Nie udało się zmienić szablonu.');
        }
      },
      applyStyleBundle() {
        const bundle = this.styleBundles.find((b) => b.id === this.selectedStyleBundle);
        if (!bundle || !this.content?.pl?.settings) return;
        const presets = this.availablePresets;
        const cIdx = presets.findIndex((p) => p.id === bundle.color_preset);
        if (this.userPlan === 'starter' && cIdx > 0) {
          this.showToast('Ten zestaw wymaga pakietu PRO (pełna paleta kolorów).', 'error');
          return;
        }
        this.content.pl.settings.color_preset = bundle.color_preset;
        this.content.pl.settings.background_style = bundle.background_style;
        this.content.pl.settings.font_preset = bundle.font_preset;
        this.applyThemeStylingFromContent();
        this.enforceColorPresetForStarter();
      },
      validateWizardStep(step) {
        const pl = this.content?.pl;
        if (!pl) return '';
        if (step === 1) {
          if (this.wizardTheme !== 'beauty' && this.wizardTheme !== 'consultant') {
            return 'Wybierz szablon (Salon lub Konsultant).';
          }
        }
        if (step === 2) {
          if (!String(pl.nav?.logo || '').trim()) {
            return 'Podaj nazwę firmy — wyświetli się w menu i buduje rozpoznawalność marki.';
          }
        }
        if (step === 4) {
          const phone = String(pl.contact?.phone || '').trim();
          const email = String(pl.contact?.email || '').trim();
          if (!phone && !email) {
            return 'Podaj numer telefonu lub e-mail — klienci muszą mieć sposób kontaktu.';
          }
        }
        return '';
      },
      startWizard() {
        this.wizardStep = 1;
        this.wizardTheme = this.theme === 'setup' ? 'beauty' : (this.theme || 'beauty');
        this.wizardFieldWarning = '';
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_started', { slug: this.slug });
        }
      },
      async skipWizard() {
        if (!this.content?.[this.lang]?.settings) return;
        this.content[this.lang].settings.onboarding_completed = true;
        const ok = await this.saveData({ silentSuccess: true });
        if (!ok) return;
        this.showWizard = false;
        this.wizardStep = 0;
        this.wizardFieldWarning = '';
        this.showWizardDismissModal = true;
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_skipped', { slug: this.slug });
        }
      },
      nextWizardStep() {
        const err = this.validateWizardStep(this.wizardStep);
        if (err) {
          this.wizardFieldWarning = err;
          return;
        }
        this.wizardFieldWarning = '';

        if (this.wizardStep === 1 && this.wizardTheme !== this.theme) {
          if (typeof window.DFOPS_mergeContentWithTemplate !== 'function') {
            this.showError('Brak konfiguracji szablonów (registry).');
            return;
          }
          const savedContact = JSON.parse(JSON.stringify(this.content?.pl?.contact || {}));
          const savedLogo = this.content?.pl?.nav?.logo ?? '';
          const savedLogoImage = this.content?.pl?.nav?.logoImage ?? '';
          const savedSubscription = JSON.parse(JSON.stringify(this.content?.pl?.settings?.subscription || {}));

          const merged = window.DFOPS_mergeContentWithTemplate(this.wizardTheme, {});
          merged.pl.contact = savedContact;
          if (!merged.pl.nav) merged.pl.nav = {};
          merged.pl.nav.logo = savedLogo;
          merged.pl.nav.logoImage = savedLogoImage;
          if (merged.pl.settings) {
            merged.pl.settings.subscription = {
              ...(merged.pl.settings.subscription || {}),
              ...savedSubscription,
            };
          }

          this.theme = this.wizardTheme;
          this.content = window.DFOPS_normalizeContent(merged, this.wizardTheme);

          const presets = cfg.presetsByTheme[this.wizardTheme] || [];
          const cp = this.content.pl.settings.color_preset;
          if (presets.length && !presets.some((p) => p.id === cp)) {
            this.content.pl.settings.color_preset = presets[0].id;
          }
          this.selectedStyleBundle = '';
          this.syncUserPlanFromBilling();
          this.enforceColorPresetForStarter();
          this.applyThemeStylingFromContent();
        }

        if (this.wizardStep < 4) {
          if (typeof window.DFOPS_trackEvent === 'function') {
            window.DFOPS_trackEvent('onboarding_step_completed', { step: this.wizardStep });
          }
          this.wizardStep++;
        }
      },
      prevWizardStep() {
        this.wizardFieldWarning = '';
        if (this.wizardStep > 1) this.wizardStep--;
      },
      async finishWizard() {
        if (!this.content?.[this.lang]?.settings) return;
        const err = this.validateWizardStep(4);
        if (err) {
          this.wizardFieldWarning = err;
          return;
        }
        this.wizardFieldWarning = '';
        this.content[this.lang].settings.onboarding_completed = true;
        const ok = await this.saveData({ silentSuccess: true });
        if (!ok) return;
        this.showWizard = false;
        this.wizardStep = 0;
        this.wizardFieldWarning = '';
        this.showStudioWelcomeModal = true;
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_finished', { slug: this.slug });
        }
      },
      closeStudioWelcomeModal() {
        this.showStudioWelcomeModal = false;
        this.activeTab = 'hero';
      },

      resolveDriverFactory() {
        const pkg = typeof window !== 'undefined' && window.driver && window.driver.js;
        if (pkg && typeof pkg.driver === 'function') return pkg.driver;
        return null;
      },

      /** Zapis w `content` (Supabase): ukończono powitanie / tour — modal nie wraca przy kolejnych logowaniach. */
      async markWelcomeOnboardingSeen() {
        if (!this.content?.pl?.settings) return;
        if (this.content.pl.settings.welcome_onboarding_completed === true) return;
        this.content.pl.settings.welcome_onboarding_completed = true;
        await this.saveData({ silentSuccess: true });
      },

      /**
       * Oprowadzenie po panelu (driver.js): marka → logo → podgląd strony.
       * Wywoływane po zamknięciu modala powitalnego (gdy nie ma pełnoekranowego kreatora).
       */
      async startOnboardingTour() {
        const driverFactory = this.resolveDriverFactory();
        if (!driverFactory) {
          await this.markWelcomeOnboardingSeen();
          return;
        }

        const self = this;
        const d = driverFactory({
          showProgress: true,
          progressText: 'Krok {{current}} z {{total}}',
          nextBtnText: 'Dalej',
          prevBtnText: 'Wstecz',
          doneBtnText: 'Zakończ',
          smoothScroll: true,
          allowClose: true,
          overlayOpacity: 0.55,
          overlayColor: '#0f172a',
          onDestroyed: () => {
            void self.markWelcomeOnboardingSeen();
          },
          steps: [
            {
              element: '#dfcms-first-content-input',
              popover: {
                title: 'Twoja marka',
                description: 'Zacznij od wpisania nazwy swojej firmy lub salonu.',
                side: 'bottom',
                align: 'start',
              },
            },
            {
              element: '#dfcms-onboarding-logo',
              popover: {
                title: 'Wyróżnij się',
                description: 'Dodaj swoje logo, aby strona wyglądała profesjonalnie.',
                side: 'bottom',
                align: 'start',
              },
              onHighlightStarted: (element, step, { driver }) => {
                self.setTab('settings');
                self.$nextTick(() => {
                  requestAnimationFrame(() => {
                    if (driver && typeof driver.refresh === 'function') driver.refresh();
                  });
                });
              },
            },
            {
              element: '#dfcms-onboarding-site-preview',
              popover: {
                title: 'Magia na żywo',
                description:
                  'W każdym momencie możesz kliknąć tutaj, aby zobaczyć, jak Twoja strona będzie wyglądać w internecie.',
                side: 'bottom',
                align: 'center',
              },
              onHighlightStarted: () => {
                self.setTab('hero');
              },
            },
          ],
        });

        this.setTab('hero');
        this.sidebarOpen = false;
        await new Promise((resolve) => this.$nextTick(resolve));
        requestAnimationFrame(() => {
          d.drive();
        });
      },

      /** Zamknięcie modala powitalnego; przy otwartym kreatorze tylko zapis „widziane”, bez touru pod spodem. */
      async dismissWelcomeModalAndStartOnboarding() {
        this.showWelcomeModal = false;
        if (this.showWizard) {
          await this.markWelcomeOnboardingSeen();
          return;
        }
        this.sidebarOpen = false;
        this.setTab('hero');
        await new Promise((resolve) => this.$nextTick(resolve));
        await this.startOnboardingTour();
      },
      /** Pełny ekran startowy kreatora (wybór ścieżki). */
      openWizardFromStudio() {
        if (!this.isEmailVerified) {
          this.showToast('Potwierdź najpierw adres e-mail — link masz w wiadomości od DFCMS.', 'error');
          return;
        }
        this.wizardStep = 0;
        this.wizardTheme = this.theme === 'setup' ? 'beauty' : (this.theme || 'beauty');
        this.wizardFieldWarning = '';
        this.showWizard = true;
        this.sidebarOpen = false;
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_reopened', { slug: this.slug });
        }
      },
      reopenWizard() {
        if (!this.isEmailVerified) {
          this.showToast('Potwierdź najpierw adres e-mail — link masz w wiadomości od DFCMS.', 'error');
          return;
        }
        this.wizardStep = 1;
        this.wizardTheme = this.theme === 'setup' ? 'beauty' : (this.theme || 'beauty');
        this.showWizard = true;
        this.wizardFieldWarning = '';
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_reopened', { slug: this.slug });
        }
      },
      sidebarTabNeedsAttention(tab) {
        if (!this.content?.pl?.settings || this.content.pl.settings.onboarding_completed === true) return false;
        const pl = this.content.pl;
        if (!pl) return false;
        if (tab === 'settings') {
          return this.theme === 'setup' || !String(pl.nav?.logo || '').trim();
        }
        if (tab === 'hero') return !String(pl.hero?.headline || '').trim();
        if (tab === 'contact') {
          const phone = String(pl.contact?.phone || '').trim();
          const email = String(pl.contact?.email || '').trim();
          return !phone && !email;
        }
        return false;
      },
      goToOnboardingItem(item) {
        if (!item) return;
        if (item.openWizard) this.openWizardFromStudio();
        else if (item.tab) this.setTab(item.tab);
        this.sidebarOpen = false;
      },
      closeWizardDismissModal() {
        this.showWizardDismissModal = false;
      },
      async subscribe(planType) {
        const prices = cfg.stripePrices || {};
        const priceId = prices[planType];
        if (!priceId || String(priceId).includes('TUTAJ')) {
          this.showError('Skonfiguruj ID cen Stripe w js/core/config.js (stripePrices) i Secrets w Supabase.');
          return;
        }
        if (!this.user?.id) {
          this.showError('Zaloguj się, aby wykupić subskrypcję.');
          return;
        }
        if (!this.content?.pl?.settings) return;
        const tier =
          planType === 'premium' ? 'tier2' : planType === 'starter' ? 'tier0' : 'tier1';
        const sub = this.content.pl.settings.subscription || {};
        const existingStripeSubId =
          typeof sub.stripe_subscription_id === 'string' ? sub.stripe_subscription_id.trim() : '';
        const changePlanInStripe =
          !!existingStripeSubId &&
          (planType === 'pro' || planType === 'premium' || planType === 'test_daily');

        if (!changePlanInStripe) {
          if (!this.content.pl.settings.subscription) {
            this.content.pl.settings.subscription = { plan: 'trial', trial_started_at: new Date().toISOString() };
          }
          this.content.pl.settings.subscription.selected_plan = tier;
          const saved = await this.saveData({ silentSuccess: true });
          if (!saved) return;
        }

        const { data: sessionData } = await this.supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) {
          this.showToast('Błąd sesji. Wyloguj się i zaloguj ponownie.', 'error');
          return;
        }
        this.checkoutLoading = true;
        try {
          const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
          if (changePlanInStripe) {
            const { data, error } = await this.supabase.functions.invoke('change-subscription-plan', {
              body: { plan: planType, priceId, returnUrl },
              headers: { Authorization: `Bearer ${token}` },
            });
            if (error) throw error;
            if (data && data.action === 'use_portal') {
              this.showToast(
                typeof data.message === 'string'
                  ? data.message
                  : 'Zmianę na niższy pakiet wykonasz w portalu Stripe (od następnego okresu).',
                'info',
              );
              await this.openCustomerPortal();
              return;
            }
            if (data && data.unchanged === true) {
              this.showToast('Masz już wybrany ten plan rozliczeniowy.', 'success');
              return;
            }
            if (data && typeof data.error === 'string') {
              throw new Error(data.error);
            }
            await this.syncStripeSubscription({ silent: true });
            this.showToast(
              'Plan został zaktualizowany. Stripe może wystawić dopłatę proratą — sprawdź e-mail lub portal płatności.',
              'success',
            );
            return;
          }

          const { data, error } = await this.supabase.functions.invoke(
            'create-checkout',
            {
              body: {
                plan: planType,
                priceId,
                returnUrl,
                userEmail: this.user?.email || '',
              },
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );
          if (error) throw error;
          const url = data && typeof data.url === 'string' ? data.url : '';
          if (url) {
            window.location.href = url;
          } else {
            const errMsg =
              data && typeof data.error === 'string'
                ? data.error
                : 'Brak adresu płatności.';
            throw new Error(errMsg);
          }
        } catch (e) {
          console.error(e);
          const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : '';
          if (msg.includes('HAS_STRIPE_SUBSCRIPTION') || /subskrypcję Stripe/i.test(msg)) {
            this.showToast(
              'Masz już subskrypcję — użyj zmiany planu w panelu albo portalu płatności.',
              'error',
            );
          } else {
            this.showToast(msg || 'Błąd podczas łączenia z systemem płatności.', 'error');
          }
        } finally {
          this.checkoutLoading = false;
        }
      },

      async selectStarterPlan() {
        if (this.subscriptionPlan !== 'trial') {
          this.showError('Zmiana pakietu przy aktywnej subskrypcji wymaga kontaktu z obsługą (Concierge).');
          return;
        }
        if (
          !confirm(
            'Wybierasz pakiet Starter (19 zł netto / msc + VAT). Do pierwszej opłaty korzystasz z 14-dniowego okresu próbnego na warunkach regulaminu. Kontynuować?'
          )
        ) {
          return;
        }
        if (!this.content?.pl?.settings) return;
        if (!this.content.pl.settings.subscription) {
          this.content.pl.settings.subscription = { plan: 'trial', trial_started_at: new Date().toISOString() };
        }
        this.content.pl.settings.subscription.selected_plan = 'tier0';
        this.content.pl.settings.subscription.plan = 'trial';
        const ok = await this.saveData({
          successMessage:
            'Zapisano wybór Startera. Dopóki nie zaksięgujemy płatności, pozostajesz w okresie próbnym — dokończ opłatę przed jego końcem.',
        });
        if (ok) {
          this.syncUserPlanFromBilling();
          this.enforceColorPresetForStarter();
          this.applyThemeStylingFromContent();
          if (typeof window.DFOPS_trackEvent === 'function') {
            window.DFOPS_trackEvent('starter_plan_selected', { slug: this.slug });
          }
        }
      },
      async upgradeTemplate() {
        if (!this.content || !this.theme) return;
        this.upgrading = true;
        try {
          const upgraded = window.DFOPS_upgradeContent(this.theme, this.content, this.latestTemplateVersion);
          this.content = upgraded;
          this.syncUserPlanFromBilling();
          this.enforceColorPresetForStarter();
          this.applyThemeStylingFromContent();
          const { error } = await repo.saveCurrentUserPage(this.user.id, { content: this.content });
          if (error) throw error;
          this.currentTemplateVersion = this.latestTemplateVersion;
          this.updateAvailable = false;
          this.hasUnsavedChanges = false;
          this.message = `Szablon zaktualizowany do v${this.latestTemplateVersion}.`;
          setTimeout(() => { this.message = ''; }, UPGRADE_MESSAGE_TIMEOUT);
        } catch (e) {
          console.error(e);
          this.showError('Upgrade nie powiódł się.');
        } finally {
          this.upgrading = false;
        }
      },
      async verifyCustomDomain() {
        if (this.isCustomDomainLocked) return;
        if (window.location.protocol === 'file:') {
          this.domainError = 'Otwórz panel przez adres http:// (np. Live Server na localhost), nie z dysku (file://) — inaczej przeglądarka blokuje połączenie z Supabase.';
          this.domainMessage = '';
          return;
        }
        const domain = typeof this.customDomain === 'string' ? this.customDomain.trim() : '';
        if (!this.pageId || !domain) {
          this.domainError = 'Podaj domenę (hostname, np. twojadomena.pl).';
          this.domainMessage = '';
          return;
        }

        if (!confirm('Podpięcie domeny spowoduje również zapisanie i opublikowanie wszystkich wprowadzonych przez Ciebie zmian na stronie. Czy chcesz kontynuować?')) {
          return;
        }

        const saved = await this.saveData();
        if (!saved) {
          this.domainError = 'Nie udało się zapisać zmian — domena nie została zgłoszona do Cloudflare. Popraw błędy i spróbuj ponownie.';
          this.domainMessage = '';
          return;
        }

        this.verifyingDomain = true;
        this.domainMessage = '';
        this.domainError = '';
        this.showDnsInstructions = false;

        try {
          const { data: { session } } = await this.supabase.auth.getSession();

          if (!session) {
            throw new Error('Brak aktywnej sesji. Zaloguj się ponownie.');
          }

          const cfg = window.DFOPS_CONFIG || {};
          const response = await fetch(`${cfg.supabaseUrl}/functions/v1/add-custom-domain`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
              apikey: cfg.supabaseAnonKey || '',
            },
            body: JSON.stringify({
              domain,
              pageId: this.pageId,
            }),
          });

          const result = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(result.error || result.message || `HTTP ${response.status}`);
          }
          if (result.success === false) {
            throw new Error(result.error || 'Odmowa dostępu z serwera Cloudflare.');
          }

          this.domainMessage = 'Domena zgłoszona! Cloudflare weryfikuje rekordy DNS (może to potrwać do kilkunastu minut).';
          this.showDnsInstructions = true;
          await this.loadData();
        } catch (e) {
          console.error('Błąd weryfikacji domeny:', e);
          const raw = e instanceof Error ? e.message : String(e);
          this.domainError = raw === 'Failed to fetch'
            ? 'Brak połączenia z serwerem (CORS, sieć lub otwórz stronę przez http/https, nie file://).'
            : (raw || 'Wystąpił błąd podczas komunikacji z serwerem.');
        } finally {
          this.verifyingDomain = false;
        }
      },
      async saveData(opts) {
        const options = opts && typeof opts === 'object' ? opts : {};
        const silentSuccess = options.silentSuccess === true;
        const successMessage = typeof options.successMessage === 'string' ? options.successMessage : '';
        if (!this.content?.pl || this.isLoading || !this.pageId) return false;
        this.saving = true;
        try {
          if (Array.isArray(this.content.pl.services)) {
            this.content.pl.services = this.content.pl.services.filter((s) => s.title && String(s.title).trim() !== '');
          }
          this.content.pl.settings.template_version = this.latestTemplateVersion;
          const payload = {
            content: this.content,
            color_preset: this.content.pl.settings.color_preset,
            theme: this.theme,
          };
          if (!this.isCustomDomainLocked) {
            payload.custom_domain = this.customDomain;
          } else {
            payload.custom_domain = null;
            payload.custom_domain_status = 'none';
          }
          if (this.subscriptionPaymentActive()) {
            payload.trial_blocked_at = null;
            payload.billing_failed_at = null;
          }
          const { error } = await repo.saveCurrentUserPage(this.user.id, payload);
          if (error) throw error;
          if (this.isCustomDomainLocked) this.customDomain = '';
          if (this.subscriptionPaymentActive()) {
            this.trialBlockedAt = null;
          }
          this.hasUnsavedChanges = false;
          if (!silentSuccess) {
            this.message = successMessage || 'Zmiany zostały opublikowane!';
            setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
          }
          return true;
        } catch (e) {
          console.error(e);
          this.showError('Nie udało się zapisać zmian. Sprawdź połączenie i spróbuj ponownie. Jeśli błąd się powtarza, napisz do nas.');
          this.showToast('Nie udało się zapisać zmian. Sprawdź połączenie i spróbuj ponownie.', 'error');
          return false;
        } finally {
          this.saving = false;
        }
      },
      async uploadImage(event, section, field, index = null) {
        const file = event.target.files?.[0];
        if (!file || !this.slug) return;
        const pl = this.content?.pl;
        if (!pl) return;
        this.uploadingMessage = uploadingMessageFor(section, field);
        this.uploadingImage = true;
        try {
          const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
          const mime = String(file.type || '').toLowerCase();
          if (!allowedTypes.has(mime)) {
            throw new Error('Nieprawidłowy typ pliku. Dozwolone: JPG, PNG, WEBP.');
          }

          // Dodatkowy bezpiecznik: blokuj svg/html nawet przy błędnym MIME od systemu.
          const nameLower = String(file.name || '').toLowerCase();
          if (/\.(svg|html?|xml)$/i.test(nameLower) || mime === 'image/svg+xml') {
            throw new Error('Ten typ pliku jest zablokowany ze względów bezpieczeństwa.');
          }

          const fileExt = file.name.split('.').pop() || 'png';
          const fileName = `${this.slug}-${section}-${field}-${Date.now()}.${fileExt}`;
          const { error } = await this.supabase.storage.from('images').upload(fileName, file);
          if (error) throw error;
          const { data: publicUrlData } = this.supabase.storage.from('images').getPublicUrl(fileName);
          if (section === 'gallery' && field === 'images') {
            if (!pl.gallery) pl.gallery = { title: 'Nasze realizacje', images: [] };
            if (!Array.isArray(pl.gallery.images)) pl.gallery.images = [];
            pl.gallery.images.push(publicUrlData.publicUrl);
          } else if (index !== null) {
            const sec = pl[section];
            const el = Array.isArray(sec) ? sec[index] : sec?.[index];
            if (el == null) return;
            el[field] = publicUrlData.publicUrl;
          } else {
            if (!pl[section]) pl[section] = {};
            pl[section][field] = publicUrlData.publicUrl;
          }
          this.message = this.showWizard
            ? 'Zdjęcie jest już w Twojej stronie. Na końcu kreatora kliknij „Opublikuj moją stronę” — albo dopracujesz to później w panelu.'
            : 'Gotowe! Kliknij „Publikuj zmiany”, żeby pokazać je na stronie.';
          setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
        } catch (e) {
          console.error(e);
          this.showError('Nie udało się dodać zdjęcia. Spróbuj jeszcze raz.');
        } finally {
          this.uploadingImage = false;
          this.uploadingMessage = '';
          event.target.value = '';
        }
      },
      removeGalleryImage(index) {
        if (!this.content?.pl?.gallery?.images || !Array.isArray(this.content.pl.gallery.images)) return;
        this.content.pl.gallery.images.splice(index, 1);
      },

      mapPlaceQuery: '',
      mapPlaceResults: [],
      mapPlaceLoading: false,
      mapPlaceError: '',
      mapPlaceSelectedId: null,

      async searchPlacesForMap() {
        const q = (this.mapPlaceQuery || '').trim();
        if (!q || q.length < 2) {
          this.mapPlaceError = 'Wpisz co najmniej 2 znaki (nazwa firmy lub adres).';
          return;
        }
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
          this.mapPlaceError = 'Brak konfiguracji Supabase.';
          return;
        }
        this.mapPlaceLoading = true;
        this.mapPlaceError = '';
        this.mapPlaceResults = [];
        this.mapPlaceSelectedId = null;
        try {
          const { data, error } = await this.supabase.functions.invoke('get-google-reviews', {
            body: { query: q, maxResults: 8, listPlaces: true },
          });
          if (error) {
            throw new Error(error.message || String(error));
          }
          if (!data?.ok) {
            throw new Error(typeof data?.error === 'string' ? data.error : 'Błąd wyszukiwania.');
          }
          this.mapPlaceResults = Array.isArray(data.places) ? data.places : [];
          if (!this.mapPlaceResults.length) {
            this.mapPlaceError = 'Brak wyników — spróbuj innej frazy (np. miasto + nazwa).';
          }
        } catch (e) {
          console.error(e);
          const msg = e instanceof Error ? e.message : String(e);
          this.mapPlaceError =
            /401|JWT|Unauthorized/i.test(msg)
              ? 'Brak uprawnień (401). Wdróż get-google-reviews z supabase/config.toml (verify_jwt) lub zaloguj się ponownie.'
              : 'Nie udało się wyszukać. Sprawdź połączenie i czy funkcja get-google-reviews jest wdrożona.';
        } finally {
          this.mapPlaceLoading = false;
        }
      },

      confirmMapPlaceSelection() {
        if (!this.mapPlaceSelectedId || !this.content?.pl) return;
        const hit = this.mapPlaceResults.find((p) => p.id === this.mapPlaceSelectedId);
        if (!hit) return;
        if (!this.content.pl.contact) this.content.pl.contact = {};
        this.content.pl.contact.map_place_id = hit.id;
        this.content.pl.contact.map_embed_url = '';
        if (hit.address && !String(this.content.pl.contact.address || '').trim()) {
          this.content.pl.contact.address = hit.address;
        }
        this.message = 'Wybrano lokalizację mapy. Opublikuj zmiany, żeby była widoczna na stronie.';
        setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
      },

      clearMapPlaceSelection() {
        if (this.content?.pl?.contact) {
          this.content.pl.contact.map_place_id = '';
        }
        this.mapPlaceSelectedId = null;
      },
    };
  }

  /**
   * Pełny stan pod `x-data` panelu: zawsze ma `isLoading` i `content.pl` (bez wyścigu z Kreatorem).
   * Wywoływane w admin.html zamiast `{ ...createAdminApp() }`, żeby cache starego JS nie zostawiał `content: null`.
   */
  function buildAdminAlpineState() {
    const fromApp = createAdminApp();

    // Mutujemy oryginalny obiekt, aby zachować gettery (spread niszczyłby je przy inicjalizacji).
    fromApp.sidebarOpen = false;
    fromApp.content =
      fromApp.content && typeof fromApp.content === 'object' && fromApp.content.pl
        ? fromApp.content
        : createAdminContentShell();
    fromApp.isLoading = fromApp.isLoading === true || fromApp.isLoading === false ? fromApp.isLoading : false;

    return fromApp;
  }

  window.createAdminApp = createAdminApp;
  window.DFOPS_adminAlpineState = buildAdminAlpineState;
  window.DFOPS_createAdminContentShell = createAdminContentShell;
})();
