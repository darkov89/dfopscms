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

  function isNonEmptyContentString(v) {
    return typeof v === 'string' && String(v).trim().length > 0;
  }

  const WIZARD_STATE_STORAGE_PREFIX = 'dfops_wizard_state_v1:';

  /** Zakładki Studia — zgodnie z przyciskami w `admin.html` (hash w URL przy `setTab`). */
  const ADMIN_TAB_IDS = new Set([
    'hero',
    'services',
    'trust',
    'schedule',
    'gallery',
    'contact',
    'faq',
    'google_reviews',
    'reviews',
    'leady',
    'settings',
    'seo',
    'legal',
    'account',
    'subscription',
  ]);

  function parseAdminTabFromHash() {
    try {
      const h = window.location.hash;
      if (!h || h === '#') return null;
      let id = h.slice(1).trim();
      if (!id) return null;
      if (id.includes('=')) {
        const p = new URLSearchParams(id);
        const t = (p.get('tab') || '').trim();
        if (t) id = t;
      }
      id = decodeURIComponent(id).trim().toLowerCase();
      if (!id || !/^[a-z][a-z0-9_]*$/.test(id)) return null;
      return ADMIN_TAB_IDS.has(id) ? id : null;
    } catch {
      return null;
    }
  }

  function replaceAdminUrlHashForTab(tab) {
    try {
      if (!tab || typeof tab !== 'string' || !ADMIN_TAB_IDS.has(tab)) return;
      const u = new URL(window.location.href);
      u.hash = tab === 'hero' ? '' : `#${encodeURIComponent(tab)}`;
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch {
      /* ignore */
    }
  }

  function readWizardStateFromStorage(slug) {
    try {
      if (!slug || typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(WIZARD_STATE_STORAGE_PREFIX + slug);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      const step = Number(data.step);
      const theme = typeof data.theme === 'string' ? data.theme : '';
      if (!Number.isFinite(step) || step < 0 || step > 4) return null;
      if (theme && theme !== 'beauty' && theme !== 'consultant' && theme !== 'fitness' && theme !== 'services') return null;
      return {
        step,
        theme:
          theme === 'consultant'
            ? 'consultant'
            : theme === 'fitness'
              ? 'fitness'
              : theme === 'services'
                ? 'services'
                : 'beauty',
      };
    } catch {
      return null;
    }
  }

  function writeWizardStateToStorage(slug, step, theme) {
    try {
      if (!slug || typeof localStorage === 'undefined') return;
      localStorage.setItem(
        WIZARD_STATE_STORAGE_PREFIX + slug,
        JSON.stringify({
          step,
          theme:
            theme === 'consultant'
              ? 'consultant'
              : theme === 'fitness'
                ? 'fitness'
                : theme === 'services'
                  ? 'services'
                  : 'beauty',
          ts: Date.now(),
        }),
      );
    } catch {
      /* quota / tryb prywatny */
    }
  }

  function clearWizardStateFromStorage(slug) {
    try {
      if (!slug || typeof localStorage === 'undefined') return;
      localStorage.removeItem(WIZARD_STATE_STORAGE_PREFIX + slug);
    } catch {
      /* ignore */
    }
  }

  /** Przywrócony krok musi być spójny z `pages.theme` (np. nie krok 3–4, gdy szablon w DB wciąż `setup`). */
  const WIZARD_TEMPLATE_IDS = ['beauty', 'consultant', 'fitness', 'services'];

  function normalizeWizardRestore(step, wizardTheme, pageTheme) {
    let s = step;
    if (pageTheme === 'setup' && s >= 2) {
      s = 1;
    }
    if (s < 0) s = 0;
    if (s > 4) s = 4;
    const allowed = new Set(WIZARD_TEMPLATE_IDS);
    let wt = 'beauty';
    if (pageTheme && allowed.has(pageTheme)) {
      wt = pageTheme;
    } else if (wizardTheme && allowed.has(wizardTheme)) {
      wt = wizardTheme;
    }
    return { step: s, theme: wt };
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
        google_reviews: {
          embed_url: '',
          place_query: '',
          place_id: '',
          max_reviews: 6,
          title: 'Opinie z Google',
          cached_place_id: '',
          cached_place_rating: null,
          cached_user_rating_count: null,
          google_synced_at: '',
          google_sync_query: '',
        },
        reviews: [],
        schedule: [],
        trust: { title: '', quote: '', author: '', subtitle: '', stars: 5 },
        seo: { title: '', description: '', ogImage: '' },
        legal: { enabled: false, privacy_policy: '', terms: '' },
        cookies: { text: '', accept: '' },
        footer: { quote: '', copyright: '', privacy: '' },
        settings: {
          template_version: 1,
          color_preset: 'beige',
          analytics: { gtm_id: '', fb_pixel_id: '' },
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
          /** Lustrzane odbicie aktywnego motywu strony (`pages.theme`); ustawiane w normalizeContent / saveData. */
          theme: '',
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
      /** Pakiet do feature gating (kolory): starter | standard. Po loadData nadpisuje się z subskrypcji. */
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
      /** Globalny modal confirm() (Promise<boolean>) — zastępuje systemowy `confirm()` w panelu. */
      confirmDialog: {
        open: false,
        title: '',
        message: '',
        yesLabel: 'Tak',
        noLabel: 'Nie',
        tone: 'default', // default | danger
      },
      _confirmDialogResolve: null,
      hasUnsavedChanges: false,
      _stopContentWatch: null,
      /** Cichy auto-save stanu roboczego (draft_content). */
      _draftAutosaveTimer: null,
      draftSaving: false,
      draftSavedOnce: false,
      upgrading: false,
      checkoutLoading: false,
      /** Okres rozliczenia na ekranie pakietów: monthly | yearly */
      billingInterval: 'monthly',
      stripeSyncLoading: false,
      /** Profil rozliczeniowy z tabeli billing_profiles (źródło prawdy Stripe). */
      billingProfile: null,
      /** False do zakończenia pierwszego loadBillingProfile w bieżącej sesji panelu. */
      billingProfileReady: false,
      /** Jednorazowy toast o wygasającej / zakończonej subskrypcji (po pełnym stanie billing). */
      _billingStatusToastShown: false,
      /** Pierwsze loadData zakończone — dopiero potem silent sync na zakładce Subskrypcja. */
      _initialPanelLoadDone: false,
      /** Zapobiega podwójnemu sync przy loadData po syncStripeSubscription. */
      _loadDataSubscriptionStripeSync: false,
      /** Jednorazowy silent sync ze Stripe po wejściu w zakładkę Subskrypcja (świeży `cancel_at_period_end`). */
      _subscriptionTabStripeSynced: false,
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
      get billingSubscriptionView() {
        const trialSub = this.content?.pl?.settings?.subscription;
        if (typeof window.DFOPS_billingRowToSubscriptionView === 'function') {
          return window.DFOPS_billingRowToSubscriptionView(this.billingProfile, trialSub);
        }
        return trialSub && typeof trialSub === 'object' ? trialSub : { plan: 'trial' };
      },
      /** Panel gotowy do renderu (treść + profil billing po zalogowaniu). */
      get panelContentReady() {
        if (this.loadingAuth || this.isLoading) return false;
        if (!this.user || this.isForcedPasswordReset) return true;
        return this.billingProfileReady;
      },
      get panelBootLoading() {
        return (
          this.loadingAuth ||
          this.isLoading ||
          (!!this.user && !this.isForcedPasswordReset && !this.billingProfileReady)
        );
      },
      billingStripeStatusNormalized() {
        const sub = this.billingSubscriptionView;
        return typeof sub?.status === 'string' ? sub.status.trim().toLowerCase() : '';
      },
      get subscriptionPlan() {
        return this.billingSubscriptionView?.plan || 'trial';
      },
      /** Tier zapisany w CMS albo wybrany przed pełnym merge z webhookiem. */
      get activePaidTierForUi() {
        if (!this.hasActivePaidSubscription) return null;
        const p = this.subscriptionPlan;
        if (p === 'tier0' || p === 'tier1') return p;
        if (p === 'tier2' && typeof window.DFOPS_normalizePlan === 'function') {
          return window.DFOPS_normalizePlan(p);
        }
        if (p === 'tier2') return 'tier1';
        const sel = this.billingSubscriptionView?.selected_plan;
        if (sel === 'tier0' || sel === 'tier1') return sel;
        if (sel === 'tier2') return 'tier1';
        return null;
      },
      /** Kreator tylko po potwierdzeniu e-maila — zgodny z needsEmailConfirmation ustawianym po getUser(). */
      get isEmailVerified() {
        return !!this.user && !this.needsEmailConfirmation;
      },
      /**
       * Checklista „co jeszcze dołożyć” dopóki `onboarding_completed` jest false — tylko podstawy:
       * szablon (dopóki motyw `setup`), nazwa w menu, minimum kontaktu (tel. lub e-mail).
       * Nagłówek hero nie jest wymuszany — uzupełnisz go w kreatorze lub w zakładce powitalnej.
       */
      get incompleteOnboardingChecks() {
        if (!this.content?.pl?.settings || this.content.pl.settings.onboarding_completed === true) return [];
        const pl = this.content.pl;
        if (!pl) return [];
        const items = [];
        if (this.theme === 'setup') {
          items.push({ id: 'setup', label: 'Wybierz szablon (Beauty, Konsultant, Fitness…)', tab: null, openWizard: true });
        }
        if (!String(pl.nav?.logo || '').trim()) {
          items.push({ id: 'navlogo', label: 'Podaj nazwę marki w menu strony', tab: 'settings', openWizard: false });
        }
        const phone = String(pl.contact?.phone || '').trim();
        const email = String(pl.contact?.email || '').trim();
        if (!phone && !email) {
          items.push({ id: 'contact', label: 'Dodaj telefon lub e-mail do kontaktu', tab: 'contact', openWizard: false });
        }
        return items;
      },
      /**
       * Ukończenie profilu strony (0–100). Wagi sumują się do 100% — pola z `content.pl` + motyw strony (`theme` z rekordu `pages`, nie `setup`).
       * Aktualizuje się na żywo z Alpine (deep watch na `content`).
       */
      calculateProgress() {
        const pl = this.content?.pl;
        if (!pl?.settings) return 0;
        const weights = [
          { w: 12, ok: () => isNonEmptyContentString(pl.settings.business_name) },
          { w: 14, ok: () => !!this.theme && this.theme !== 'setup' },
          { w: 13, ok: () => isNonEmptyContentString(pl.hero?.headline) },
          { w: 12, ok: () => isNonEmptyContentString(pl.contact?.phone) },
          { w: 12, ok: () => isNonEmptyContentString(pl.nav?.logo) },
          {
            w: 12,
            ok: () =>
              isNonEmptyContentString(pl.nav?.logoImage) || isNonEmptyContentString(pl.hero?.image),
          },
          {
            w: 13,
            ok: () =>
              Array.isArray(pl.services) &&
              pl.services.some((s) => s && isNonEmptyContentString(s.title)),
          },
          {
            w: 12,
            ok: () =>
              isNonEmptyContentString(pl.seo?.title) || isNonEmptyContentString(pl.seo?.description),
          },
        ];
        let sum = 0;
        for (const { w, ok } of weights) {
          try {
            if (ok()) sum += w;
          } catch {
            /* ignore */
          }
        }
        return Math.min(100, Math.round(sum));
      },
      /** Zapisuje krok i motyw kreatora lokalnie (per slug), żeby po ponownym otwarciu nie zaczynać od zera. */
      persistWizardUiState() {
        if (!this.slug || !this.showWizard) return;
        writeWizardStateToStorage(this.slug, this.wizardStep, this.wizardTheme);
      },
      /**
       * @param {0|1} defaultStepWhenNoSave — gdy brak zapisanego stanu: 0 = ekran wyboru ścieżki, 1 = od razu krok 1 (np. „Uruchom kreator” z checklisty).
       */
      restoreWizardUiFromStorage(defaultStepWhenNoSave) {
        const pageTheme = this.theme || '';
        const saved = readWizardStateFromStorage(this.slug);
        if (!saved) {
          this.wizardStep = defaultStepWhenNoSave === 1 ? 1 : 0;
          this.wizardTheme = pageTheme === 'setup' ? 'beauty' : pageTheme || 'beauty';
          return;
        }
        const norm = normalizeWizardRestore(saved.step, saved.theme, pageTheme);
        this.wizardStep = norm.step;
        this.wizardTheme = norm.theme;
      },
      /**
       * Aktywna opłacona subskrypcja Stripe (`billing_profiles` → billingSubscriptionView).
       * Wyłącznie: niepuste `stripe_subscription_id` + status `active` lub `trialing`.
       */
      get hasActivePaidSubscription() {
        const sub = this.billingSubscriptionView;
        if (!sub || typeof sub !== 'object') return false;
        const sid =
          typeof sub.stripe_subscription_id === 'string' ? sub.stripe_subscription_id.trim() : '';
        if (!sid) return false;
        const st = typeof sub.status === 'string' ? sub.status.trim().toLowerCase() : '';
        return st === 'active' || st === 'trialing';
      },
      /**
       * Subskrypcja opłacona do końca okresu, ale zaplanowane zamknięcie (nie odnowi się).
       */
      get isSubscriptionCanceledButValid() {
        const sub = this.billingSubscriptionView;
        if (!sub || typeof sub !== 'object') return false;
        const st = typeof sub.status === 'string' ? sub.status.trim().toLowerCase() : '';
        if (st !== 'active' && st !== 'trialing') return false;
        return sub.cancel_at_period_end === true;
      },
      /**
       * Portal Stripe — aktywny pakiet lub anulowana subskrypcja z nadal istniejącym klientem (faktury, karta).
       */
      get showStripeBillingPortal() {
        if (this.hasActivePaidSubscription) return true;
        const sub = this.billingSubscriptionView;
        const cid = typeof sub?.stripe_customer_id === 'string' ? sub.stripe_customer_id.trim() : '';
        if (!cid) return false;
        const st = typeof sub?.status === 'string' ? sub.status.trim().toLowerCase() : '';
        return st === 'canceled' || st === 'cancelled';
      },
      /** Istniejący klient Stripe (CID lub SID) — nie oznacza aktywnej subskrypcji. */
      hasStripeBillingCustomer() {
        const sub = this.billingSubscriptionView;
        if (!sub || typeof sub !== 'object') return false;
        const cid = typeof sub.stripe_customer_id === 'string' ? sub.stripe_customer_id.trim() : '';
        const sid = typeof sub.stripe_subscription_id === 'string' ? sub.stripe_subscription_id.trim() : '';
        return !!(cid || sid);
      },
      /** Checkout vs portal — portal tylko: stripe_customer_id + status active | trialing | past_due. */
      shouldUseStripePortalForPlanChange() {
        const sub = this.billingSubscriptionView;
        const cid = typeof sub?.stripe_customer_id === 'string' ? sub.stripe_customer_id.trim() : '';
        if (!cid) return false;
        const st = this.billingStripeStatusNormalized();
        return st === 'active' || st === 'trialing' || st === 'past_due';
      },
      /**
       * True gdy w Stripe wisi jeszcze subskrypcja — wtedy nie udostępniamy prośby o usunięcie konta
       * (najpierw anulowanie w portalu Stripe).
       */
      get subscriptionBlocksAccountDeletion() {
        const sub = this.billingSubscriptionView;
        const sid = typeof sub?.stripe_subscription_id === 'string' ? sub.stripe_subscription_id.trim() : '';
        if (!sid) return false;
        const stRaw = typeof sub?.status === 'string' ? sub.status.trim().toLowerCase() : '';
        if (stRaw === 'canceled' || stRaw === 'cancelled' || stRaw === 'incomplete_expired') return false;
        if (!stRaw) return true;
        return ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(stRaw);
      },
      get activeSubscriptionBrandLabel() {
        const t = this.activePaidTierForUi;
        if (t === 'tier1' || t === 'tier2') return 'STANDARD';
        if (t === 'tier0') return 'STARTER';
        if (this.hasActivePaidSubscription) return 'SUBSKRYPCJA STRIPE';
        return '';
      },
      get activeSubscriptionPriceLine() {
        const t = this.activePaidTierForUi;
        if (t === 'tier1' || t === 'tier2') return '49 PLN netto / msc';
        if (t === 'tier0') return '29 PLN netto / msc';
        if (this.hasActivePaidSubscription) return 'Kwota zgodnie z aktywnym pakietem w Stripe';
        return '';
      },
      get isBillingCanceled() {
        const st = String(this.billingProfile?.status || '').trim().toLowerCase();
        return st === 'canceled' || st === 'cancelled' || st === 'incomplete_expired';
      },
      get trialDaysLeft() {
        if (this.isBillingCanceled) return 0;
        const sub = this.billingSubscriptionView;
        if (this.hasActivePaidSubscription) return 0;
        if (this.subscriptionPlan !== 'trial' || !sub?.trial_started_at) return 14;
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

      /** Trial / Starter — bez własnego koloru, fontu i tła (presety i zestawy są wolne). */
      get isCustomAppearanceLocked() {
        if (typeof window.DFOPS_planAllowsCustomAppearance === 'function') {
          return !window.DFOPS_planAllowsCustomAppearance(this.subscriptionPlan);
        }
        const p = this.subscriptionPlan;
        return p === 'trial' || p === 'tier0';
      },

      get appearancePickerAccentHex() {
        if (this.appearancePickerHex) return this.appearancePickerHex;
        return this.accentColor || '#D4AF37';
      },
      /** Na localhost podgląd wskazuje plik .html — brak pliku = proxy (Epik 3). */
      get previewHtmlBasename() {
        const t = String(this.theme || 'beauty').trim().toLowerCase();
        if (t === 'beauty' || t === 'consultant' || t === 'setup' || t === 'fitness' || t === 'services') return t;
        return 'beauty';
      },
      get previewUsesHtmlFallback() {
        const t = String(this.theme || '').trim().toLowerCase();
        if (!t) return false;
        return !(t === 'beauty' || t === 'consultant' || t === 'setup' || t === 'fitness' || t === 'services');
      },
      get templateCatalog() {
        if (typeof window.DFOPS_getTemplateCatalog === 'function') {
          return window.DFOPS_getTemplateCatalog();
        }
        return [
          { id: 'beauty', name: 'Beauty', desc: 'Salon, spa, usługi lokalne', available: true },
          { id: 'consultant', name: 'Konsultant', desc: 'Ekspert, freelancer, B2B', available: true },
          { id: 'fitness', name: 'Fitness', desc: 'Studio, trening, sport', available: true },
          { id: 'services', name: 'Usługi', desc: 'Rzemiosło, naprawy, lokalnie', available: true },
        ];
      },
      onTemplateTileClick(entry) {
        if (!entry || this.saving) return;
        if (!entry.available) {
          this.showToast('Ten szablon jest w przygotowaniu (Epik 3).', 'info');
          return;
        }
        if (this.theme === entry.id) return;
        this.switchTemplate(entry.id);
      },
      /**
       * Handoff wersji roboczej do karty podglądu przez localStorage (współdzielony między kartami
       * tego samego originu, niezależnie od „Zapamiętaj mnie”/sessionStorage). Tylko przeglądarka
       * właściciela ma ten wpis — anon nigdy → szczelne oddzielenie draft/content.
       */
      stashDraftForPreview() {
        try {
          if (!this.slug || !this.content?.pl) return;
          const payload = {
            slug: this.slug,
            theme: this.theme,
            content: this.content,
            ts: Date.now(),
          };
          window.localStorage.setItem('dfops_preview_draft:' + this.slug, JSON.stringify(payload));
        } catch (_) {
          /* brak localStorage — fallback do draftu z bazy (getDraftContentForOwner) */
        }
        // Najświeższy draft także w bazie (gdyby auto-save jeszcze nie zdążył).
        void this.autosaveDraftNow();
      },
      getPublicSiteUrl() {
        const preview = 'dfcms_preview=1';
        if (!this.slug || !this.theme) return '#';
        const siteQs = `site=${encodeURIComponent(this.slug)}&${preview}`;

        // Podgląd wersji roboczej MUSI być na tym samym originie co panel — inaczej handoff draftu
        // (`localStorage` `dfops_preview_draft:{slug}`) i sesja właściciela nie są dostępne w nowej karcie
        // (subdomena `{slug}.dfcms.pl` to inny origin). Dlatego zawsze otwieramy `/{motyw}.html?site=…`.
        const isLocalhost =
          window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const path = `/${this.previewHtmlBasename}.html?${siteQs}`;
        if (isLocalhost) return path;
        const origin = String(window.location.origin || '').replace(/\/$/, '');
        return origin ? `${origin}${path}` : path;
      },
      get planDisplayLabel() {
        const sub = this.billingSubscriptionView;
        if (typeof window.DFOPS_subscriptionDisplayName === 'function') {
          return window.DFOPS_subscriptionDisplayName(sub);
        }
        if (typeof window.DFOPS_planDisplayName === 'function') {
          return window.DFOPS_planDisplayName(this.subscriptionPlan);
        }
        return this.subscriptionPlan;
      },
      get selectedPlanHumanLabel() {
        const s = this.billingSubscriptionView?.selected_plan;
        if (s === 'tier0') return 'Starter';
        if (s === 'tier1' || s === 'tier2') return 'Standard';
        return '';
      },

      subscriptionPaymentActive() {
        return this.hasActivePaidSubscription;
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
        // UX: nieblokujące powiadomienia, znikają po 3 sekundach.
        this._toastTimer = setTimeout(() => { this.toast.show = false; }, 3000);
      },

      /**
       * Zastępnik systemowego `confirm()`:
       * - zwraca Promise<boolean>
       * - wyświetla modal o spójnym designie (Tailwind) w `admin.html`
       */
      confirmAsync(opts) {
        const options = opts && typeof opts === 'object' ? opts : {};
        const title = typeof options.title === 'string' ? options.title : 'Potwierdź';
        const message = typeof options.message === 'string' ? options.message : '';
        const yesLabel = typeof options.yesLabel === 'string' ? options.yesLabel : 'Tak';
        const noLabel = typeof options.noLabel === 'string' ? options.noLabel : 'Nie';
        const tone = options.tone === 'danger' ? 'danger' : 'default';

        // Jeśli jakiś confirm jest już otwarty, zamykamy go jako "Nie" (bez wieszania Promise).
        if (this.confirmDialog?.open && typeof this._confirmDialogResolve === 'function') {
          try { this._confirmDialogResolve(false); } catch (_) { /* ignore */ }
        }

        this.confirmDialog = { open: true, title, message, yesLabel, noLabel, tone };
        return new Promise((resolve) => {
          this._confirmDialogResolve = resolve;
        });
      },

      resolveConfirmDialog(result) {
        const r = typeof this._confirmDialogResolve === 'function' ? this._confirmDialogResolve : null;
        this._confirmDialogResolve = null;
        if (this.confirmDialog) this.confirmDialog.open = false;
        if (r) r(result === true);
      },

      /**
       * Wejście w zakładkę Subskrypcja NIE odpala już automatycznego synca ze Stripe.
       * Wcześniej powodowało to drugie `loadData()` (podwójne ładowanie panelu). Status pokazujemy
       * z `billing_profiles` (loadData), a aktualizację ze Stripe użytkownik uruchamia ręcznie
       * przyciskiem „Synchronizuj ze Stripe”. Metoda zostaje (call-site’y bez zmian) jako no-op.
       */
      maybeSyncSubscriptionTabFromStripe() {
        /* celowo pusto — patrz docstring (manualny sync zamiast auto). */
      },

      setTab(tab) {
        this.activeTab = tab;
        this.sidebarOpen = false;
        replaceAdminUrlHashForTab(tab);
        this.maybeSyncSubscriptionTabFromStripe();
        if (tab === 'google_reviews') this.syncGoogleReviewsPlaceInputFromContent();
      },

      /** Gdy zmieni się motyw (lub wczytano stronę), ukryte zakładki nie zostawiają pustego widoku. */
      ensureActiveTabForTheme() {
        const t = String(this.theme || '').trim();
        const tab = this.activeTab;
        const galleryOk = ['beauty', 'fitness', 'services'].includes(t);
        const faqOk = ['beauty', 'consultant', 'fitness', 'services'].includes(t);
        if (tab === 'gallery' && !galleryOk) this.setTab('hero');
        else if (tab === 'faq' && !faqOk) this.setTab('hero');
        else if (tab === 'schedule' && t !== 'fitness') this.setTab('hero');
        else if (tab === 'trust' && t !== 'services') this.setTab('hero');
        else if (tab === 'reviews' && t !== 'consultant') this.setTab('hero');
      },

      maybeShowPaymentReturnToast() {
        if (!this.billingProfileReady) return;
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

      /** Jednorazowy toast po pełnym wczytaniu billing_profiles (bez duplikatu przy drugim loadData). */
      maybeShowBillingStatusToastOnce() {
        if (this._billingStatusToastShown || !this.billingProfileReady || !this.user) return;
        if (this.isSubscriptionCanceledButValid) {
          this._billingStatusToastShown = true;
          const when = this.subscriptionRenewalDateFormatted;
          this.showToast(
            when && when !== '—'
              ? `Twoja subskrypcja wygasa ${when}. W portalu Stripe możesz cofnąć zamknięcie lub pobrać faktury.`
              : 'Twoja subskrypcja wygasa po zakończeniu bieżącego okresu. Zarządzaj nią w portalu Stripe.',
            'info',
          );
          return;
        }
        if (this.isBillingCanceled) {
          this._billingStatusToastShown = true;
          this.showToast(
            'Subskrypcja została zakończona — widok publiczny jest wyłączony. Wykup pakiet ponownie w sekcji Subskrypcja.',
            'error',
          );
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
        const raw = this.billingSubscriptionView?.current_period_end;
        if (typeof window.DFOPS_formatSubscriptionPeriodEndPl === 'function') {
          return window.DFOPS_formatSubscriptionPeriodEndPl(raw);
        }
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
      /** Krótka data (np. badge „Wygasa 3.06.2026”) — zgodna z timezone przeglądarki jak `subscriptionRenewalDateFormatted`. */
      get subscriptionRenewalDateBadgeShort() {
        const raw = this.billingSubscriptionView?.current_period_end;
        if (raw == null || raw === '') return '—';
        try {
          const d = new Date(typeof raw === 'number' ? raw * 1000 : String(raw));
          if (Number.isNaN(d.getTime())) return '—';
          const day = d.getDate();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const year = d.getFullYear();
          return `${day}.${month}.${year}`;
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

      /** Czy deep link do zmiany planu w portalu Stripe ma sens (active/trialing, nie wygasająca). */
      canOpenPortalPlanChangeFlow() {
        return (
          this.shouldUseStripePortalForPlanChange() &&
          this.hasActivePaidSubscription &&
          !this.isSubscriptionCanceledButValid
        );
      },

      /**
       * @param {{ subscriptionUpdate?: boolean, subscriptionCancel?: boolean }} [opts]
       *   subscriptionUpdate — deep link: zmiana planu (upgrade/downgrade).
       *   subscriptionCancel — deep link: anulowanie subskrypcji w Stripe.
       */
      async openCustomerPortal(opts = {}) {
        if (!this.supabase) {
          this.showToast('Brak połączenia z serwisem. Odśwież stronę.', 'error');
          return;
        }
        this.isPortalLoading = true;
        try {
          const { data: sessionData } = await this.supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          if (!token) throw new Error('Brak autoryzacji');
          const returnUrlObj = new URL(window.location.href);
          returnUrlObj.searchParams.set('billing', 'return');
          returnUrlObj.hash = 'subscription';
          const returnUrl = returnUrlObj.toString();
          const sub = this.billingSubscriptionView;
          const subscriptionId =
            typeof sub?.stripe_subscription_id === 'string'
              ? sub.stripe_subscription_id.trim()
              : '';
          const portalBody = { returnUrl };
          if (subscriptionId) portalBody.subscription_id = subscriptionId;
          if (opts.subscriptionCancel) portalBody.flow = 'subscription_cancel';
          else if (opts.subscriptionUpdate) portalBody.flow = 'subscription_update';
          const { data, error } = await this.supabase.functions.invoke('create-portal-session', {
            body: portalBody,
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

      async deleteAccount() {
        if (this.subscriptionBlocksAccountDeletion) {
          this.showToast(
            'Najpierw anuluj subskrypcję w Stripe: zakładka Subskrypcja → „Zarządzaj subskrypcją i fakturami”. Gdy subskrypcja w Stripe będzie anulowana, wróć tu i wyślij prośbę o usunięcie konta.',
            'error',
          );
          return;
        }
        const confirmed = await this.confirmAsync({
          title: 'Usunąć konto?',
          message: 'Czy na pewno chcesz bezpowrotnie usunąć swoje konto i stronę? Tej operacji nie można cofnąć.',
          yesLabel: 'Tak, usuń konto',
          noLabel: 'Nie',
          tone: 'danger',
        });
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
          this.billingProfileReady = false;
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
                this.showToast('Plan został pomyślnie zaktualizowany.', 'success');
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
       * Po powrocie z portalu Stripe (`?billing=return`) — sync + loadData + toast o zaktualizowanym planie.
       */
      schedulePostPortalBillingRefresh() {
        try {
          const u = new URL(window.location.href);
          if (u.searchParams.get('billing') !== 'return' || !this.user) return false;
          this.billingProfileReady = false;
          this.isLoading = true;
          this.showToast('Odświeżam status subskrypcji…', 'info');
          void (async () => {
            try {
              await this.syncStripeSubscription({ silent: true });
              await this.loadData();
              this.setTab('subscription');
              this.showToast('Plan został pomyślnie zaktualizowany.', 'success');
            } catch (e) {
              console.error(e);
              this.showToast(
                'Nie udało się odświeżyć planu. Użyj Subskrypcja → „Synchronizuj ze Stripe”.',
                'error',
              );
            } finally {
              const clean = new URL(window.location.href);
              clean.searchParams.delete('billing');
              const qs = clean.searchParams.toString();
              window.history.replaceState(
                {},
                document.title,
                clean.pathname + (qs ? `?${qs}` : '') + clean.hash,
              );
              this.isLoading = false;
            }
          })();
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
          this._loadDataSubscriptionStripeSync = true;
          try {
            await this.loadData();
          } finally {
            this._loadDataSubscriptionStripeSync = false;
          }
          this.syncUserPlanFromBilling();
          if (!silent) {
            this.showToast('Plan został pomyślnie zaktualizowany.', 'success');
          }
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
        if (p === 'tier1' || p === 'tier2') this.userPlan = 'standard';
        else this.userPlan = 'starter';
      },

      /** Gotowe palety kolorów — zawsze dostępne (freemium). */
      isLocked() {
        return false;
      },

      presetSwatchColor(presetId) {
        return (cfg.accentByPreset && cfg.accentByPreset[presetId]) || '#a1a1aa';
      },

      selectColorPreset(preset) {
        if (!preset?.id || !this.content?.pl?.settings) return;
        this.content.pl.settings.color_preset = preset.id;
        this.appearancePickerHex = '';
        this.applyThemeStylingFromContent();
      },

      _hexColorDistance(hexA, hexB) {
        const parse = (h) => {
          const s = String(h || '')
            .trim()
            .replace(/^#/, '');
          if (s.length === 3) {
            return [
              parseInt(s[0] + s[0], 16),
              parseInt(s[1] + s[1], 16),
              parseInt(s[2] + s[2], 16),
            ];
          }
          if (s.length !== 6) return null;
          return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
        };
        const a = parse(hexA);
        const b = parse(hexB);
        if (!a || !b) return Infinity;
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      },

      findPresetIdForAccentHex(hex) {
        const presets = cfg.accentByPreset || {};
        const current = this.content?.pl?.settings?.color_preset;
        let bestId = typeof current === 'string' && current ? current : 'gold';
        let best = Infinity;
        for (const [id, color] of Object.entries(presets)) {
          const d = this._hexColorDistance(hex, color);
          if (d < best) {
            best = d;
            bestId = id;
          }
        }
        return bestId;
      },

      promptAppearanceUpgrade() {
        this.showAppearanceUpgradeModal = true;
      },

      goAppearanceUpgrade() {
        this.showAppearanceUpgradeModal = false;
        this.setTab('subscription');
      },

      onCustomAccentColorInput(event) {
        if (this.isCustomAppearanceLocked) {
          this.promptAppearanceUpgrade();
          return;
        }
        const hex = event?.target?.value;
        if (!hex || !this.content?.pl?.settings) return;
        this.appearancePickerHex = hex;
        this.content.pl.settings.color_preset = this.findPresetIdForAccentHex(hex);
        this.applyThemeStylingFromContent();
      },

      onCustomFontPresetGuard(event) {
        if (!this.isCustomAppearanceLocked) {
          this.applyThemeStylingFromContent();
          return;
        }
        if (event?.target && this.content?.pl?.settings) {
          event.target.value = this.content.pl.settings.font_preset;
        }
        this.promptAppearanceUpgrade();
      },

      onCustomBackgroundStyleGuard(event) {
        if (!this.isCustomAppearanceLocked) {
          this.applyThemeStylingFromContent();
          return;
        }
        if (event?.target && this.content?.pl?.settings) {
          event.target.value = this.content.pl.settings.background_style;
        }
        this.promptAppearanceUpgrade();
      },

      enforceColorPresetForStarter() {
        /* Freemium: wszystkie gotowe presety kolorów dostępne na każdym planie. */
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
            this.activeTab = 'hero';
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
        this.billingProfile = null;
        this.billingProfileReady = false;
        this._billingStatusToastShown = false;
        this._initialPanelLoadDone = false;
        this._subscriptionTabStripeSynced = false;
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

      async loadBillingProfile() {
        if (!this.user?.id || !this.supabase) {
          this.billingProfile = null;
          return;
        }
        const { data, error } = await this.supabase
          .from('billing_profiles')
          .select('*')
          .eq('user_id', this.user.id)
          .maybeSingle();
        if (error) {
          console.warn('[DFCMS] loadBillingProfile:', error.message || error);
          this.billingProfile = null;
          return;
        }
        this.billingProfile = data || null;
      },

      async loadData() {
        this.isLoading = true;
        this.billingProfileReady = false;
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
          this.trialBlockedAt = data.trial_blocked_at ?? null;
          this.showTrialSuspendedModal = !!this.trialBlockedAt;
          this.customDomain = data.custom_domain || '';
          this.customDomainStatus = data.custom_domain_status || '';

          /**
           * Draft vs Published: panel pracuje na stanie roboczym (`draft_content`).
           * Gdy draft jest pusty/niespójny — startujemy od opublikowanej kolumny `content`.
           */
          const draftRaw =
            data.draft_content && typeof data.draft_content === 'object' ? data.draft_content : null;
          const usingDraft = !!(draftRaw && draftRaw.pl);
          const workingRaw = usingDraft ? draftRaw : data.content;
          this.theme =
            (workingRaw?.pl?.settings?.theme && String(workingRaw.pl.settings.theme).trim()) ||
            data.theme;

          /** Migawka opublikowanej wersji (kolumna `content`) — pod akcję „Odrzuć zmiany” (revert do produkcji). */
          this._publishedContentRaw = data.content ?? null;
          this._publishedTheme = data.theme;

          /** Z Supabase bez normalizacji — jeśli true, pomijamy modal i Driver.js także przy pustym localStorage kreatora. */
          const serverWelcomeOnboardingDone =
            workingRaw?.pl?.settings?.welcome_onboarding_completed === true;
          this.content = window.DFOPS_normalizeContent(workingRaw, this.theme);
          if (serverWelcomeOnboardingDone && this.content?.pl?.settings) {
            this.content.pl.settings.welcome_onboarding_completed = true;
          }
          if (
            this.content?.pl?.settings &&
            typeof window.DFOPS_stripBillingFromContentSubscription === 'function'
          ) {
            this.content.pl.settings.subscription = window.DFOPS_stripBillingFromContentSubscription(
              this.content.pl.settings.subscription,
            );
          }
          await this.loadBillingProfile();
          this.billingProfileReady = true;
          this.currentTemplateVersion = Number(this.content.pl.settings.template_version || 1);
          this.updateAvailable = this.currentTemplateVersion < this.latestTemplateVersion;
          this.syncUserPlanFromBilling();
          this.applyThemeStylingFromContent();
          this.enforceColorPresetForStarter();

          /** Pierwsze wejście po migracji (draft pusty): utrwalamy spójny stan roboczy = opublikowana treść. */
          if (!usingDraft && this.pageId && this.user?.id) {
            void this._persistDraft({ silent: true });
          }

          const fromHash = parseAdminTabFromHash();
          if (fromHash) this.activeTab = fromHash;
          this.ensureActiveTabForTheme();
          replaceAdminUrlHashForTab(this.activeTab);
          this.maybeSyncSubscriptionTabFromStripe();

          if (!this.isEmailVerified) {
            this.showWizard = false;
          } else if (
            this.content?.pl?.settings?.onboarding_completed === false &&
            this.incompleteOnboardingChecks.length === 0
          ) {
            this.content.pl.settings.onboarding_completed = true;
            this.content.pl.settings.welcome_onboarding_completed = true;
            await this.saveData({ silentSuccess: true });
          }

          this.showWelcomeModal =
            !!this.user &&
            this.isEmailVerified &&
            !this.isForcedPasswordReset &&
            !this.content?.pl?.settings?.welcome_onboarding_completed;

          if (this.content?.pl?.settings?.welcome_onboarding_completed === true) {
            this.showWizard = false;
            if (this.slug) clearWizardStateFromStorage(this.slug);
          }

          this.$nextTick(() => {
            setTimeout(() => {
              if (typeof this._stopContentWatch === 'function') {
                this._stopContentWatch();
                this._stopContentWatch = null;
              }
              this.hasUnsavedChanges = false;
              this._stopContentWatch = this.$watch('content', () => {
                this.hasUnsavedChanges = true;
                this.scheduleDraftAutosave();
              }, { deep: true });
            }, 0);
          });
        } finally {
          if (this.user?.id && !this.billingProfileReady) {
            this.billingProfileReady = true;
          }
          if (!this.user?.id) {
            this.billingProfileReady = true;
          }
          this.isLoading = false;
          if (this.user && this.billingProfileReady) {
            this.maybeShowPaymentReturnToast();
            this.maybeShowBillingStatusToastOnce();
          }
          if (!this._initialPanelLoadDone && this.billingProfileReady) {
            this._initialPanelLoadDone = true;
          }
        }
      },
      applyThemeStylingFromContent() {
        if (!this.content?.pl?.settings) return;
        window.DFOPS_applyThemeStyling(this.content.pl.settings, this.theme, 'admin');
      },

      async switchTemplate(newTemplateId) {
        if (
          newTemplateId !== 'beauty' &&
          newTemplateId !== 'consultant' &&
          newTemplateId !== 'fitness' &&
          newTemplateId !== 'services'
        )
          return;
        if (this.theme === newTemplateId) return;
        const confirmed = await this.confirmAsync({
          title: 'Zmienić szablon?',
          message:
            'Uwaga: zmiana szablonu nadpisze aktualne teksty i układ sekcji (hero, usługi, FAQ itd.). Zachowamy dane kontaktowe, logo tekstowe i logo graficzne oraz ustawienia subskrypcji. Kontynuować?',
          yesLabel: 'Tak, zmień szablon',
          noLabel: 'Nie',
        });
        if (!confirmed) return;
        if (typeof window.DFOPS_mergeContentWithTemplate !== 'function' || typeof window.DFOPS_getTemplate !== 'function') {
          this.showError('Brak konfiguracji szablonów (registry).');
          return;
        }
        try {
          const savedContact = JSON.parse(JSON.stringify(this.content?.pl?.contact || {}));
          const savedLogo = this.content?.pl?.nav?.logo ?? '';
          const savedLogoImage = this.content?.pl?.nav?.logoImage ?? '';
          const savedSubscription = JSON.parse(
            JSON.stringify(this.content?.pl?.settings?.subscription || {}),
          );
          const trialOnlySub =
            typeof window.DFOPS_stripBillingFromContentSubscription === 'function'
              ? window.DFOPS_stripBillingFromContentSubscription(savedSubscription)
              : savedSubscription;
          const savedWelcomeDone = this.content?.pl?.settings?.welcome_onboarding_completed === true;
          const savedOnboardingDone = this.content?.pl?.settings?.onboarding_completed === true;

          const merged = window.DFOPS_mergeContentWithTemplate(newTemplateId, {});
          merged.pl.contact = savedContact;
          if (!merged.pl.nav) merged.pl.nav = {};
          merged.pl.nav.logo = savedLogo;
          merged.pl.nav.logoImage = savedLogoImage;
          if (merged.pl.settings) {
            merged.pl.settings.subscription = {
              ...(merged.pl.settings.subscription || {}),
              ...trialOnlySub,
            };
            if (savedWelcomeDone) merged.pl.settings.welcome_onboarding_completed = true;
            if (savedOnboardingDone) merged.pl.settings.onboarding_completed = true;
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
          clearWizardStateFromStorage(this.slug);
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
        this.content.pl.settings.color_preset = bundle.color_preset;
        this.content.pl.settings.background_style = bundle.background_style;
        this.content.pl.settings.font_preset = bundle.font_preset;
        this.appearancePickerHex = '';
        this.applyThemeStylingFromContent();
      },
      validateWizardStep(step) {
        const pl = this.content?.pl;
        if (!pl) return '';
        if (step === 1) {
          if (!WIZARD_TEMPLATE_IDS.includes(this.wizardTheme)) {
            return 'Wybierz szablon (Salon, Konsultant, Fitness lub Usługi).';
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
        this.persistWizardUiState();
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_started', { slug: this.slug });
        }
      },
      /** Zamknięcie kreatora bez kończenia — zapis treści + stan kroku w localStorage (wznowienie w „Uruchom Kreator”). */
      async skipWizard() {
        if (!this.content?.[this.lang]?.settings) return;
        const ok = await this.saveData({ silentSuccess: true });
        if (!ok) return;
        this.persistWizardUiState();
        this.showWizard = false;
        this.wizardStep = 0;
        this.wizardFieldWarning = '';
        this.showWizardDismissModal = true;
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_skipped', { slug: this.slug });
        }
      },
      async nextWizardStep() {
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
          const savedSubscription = JSON.parse(
            JSON.stringify(this.content?.pl?.settings?.subscription || {}),
          );
          const trialOnlySub =
            typeof window.DFOPS_stripBillingFromContentSubscription === 'function'
              ? window.DFOPS_stripBillingFromContentSubscription(savedSubscription)
              : savedSubscription;

          const merged = window.DFOPS_mergeContentWithTemplate(this.wizardTheme, {});
          merged.pl.contact = savedContact;
          if (!merged.pl.nav) merged.pl.nav = {};
          merged.pl.nav.logo = savedLogo;
          merged.pl.nav.logoImage = savedLogoImage;
          if (merged.pl.settings) {
            merged.pl.settings.subscription = {
              ...(merged.pl.settings.subscription || {}),
              ...trialOnlySub,
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

        /** Zapis do bazy przed przejściem dalej — w tym wartości domyślne z szablonu po merge (krok 1). */
        const savedOk = await this.saveData({ silentSuccess: true });
        if (!savedOk) {
          this.wizardFieldWarning =
            'Nie udało się zapisać na serwerze. Sprawdź połączenie i spróbuj ponownie — albo użyj „Publikuj zmiany” w nagłówku panelu.';
          return;
        }

        if (this.wizardStep < 4) {
          if (typeof window.DFOPS_trackEvent === 'function') {
            window.DFOPS_trackEvent('onboarding_step_completed', { step: this.wizardStep });
          }
          this.wizardStep++;
        }
        this.persistWizardUiState();
      },
      prevWizardStep() {
        this.wizardFieldWarning = '';
        if (this.wizardStep > 1) this.wizardStep--;
        this.persistWizardUiState();
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
        /** Koniec kreatora = pierwsza publikacja na żywo (przycisk „Opublikuj moją stronę”). */
        const ok = await this.publishChanges({ silentSuccess: true });
        if (!ok) return;
        this.showWizard = false;
        this.wizardStep = 0;
        this.wizardFieldWarning = '';
        clearWizardStateFromStorage(this.slug);
        this.showStudioWelcomeModal = true;
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_finished', { slug: this.slug });
        }
      },
      closeStudioWelcomeModal() {
        this.showStudioWelcomeModal = false;
        this.setTab('hero');
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
       * Oprowadzenie (driver.js): najpierw ekran startowy kreatora (wybór ścieżki), potem podgląd i menu.
       * Pola treści (nazwa, logo w Studiu) pomijamy — sens mają dopiero po wyborze szablonu w kreatorze.
       */
      async startOnboardingTour() {
        if (this.content?.pl?.settings?.welcome_onboarding_completed === true) return;
        const driverFactory = this.resolveDriverFactory();
        if (!driverFactory) {
          this.showWizard = false;
          await this.markWelcomeOnboardingSeen();
          return;
        }

        const self = this;
        const ensureSidebarForTour = (driver) => {
          self.sidebarOpen = true;
          self.$nextTick(() => {
            requestAnimationFrame(() => {
              if (driver && typeof driver.refresh === 'function') driver.refresh();
            });
          });
        };
        const openWizardStep0ForTour = (driver) => {
          self.showWizard = true;
          self.wizardStep = 0;
          self.wizardFieldWarning = '';
          self.$nextTick(() => {
            requestAnimationFrame(() => {
              if (driver && typeof driver.refresh === 'function') driver.refresh();
            });
          });
        };
        const closeWizardForTour = (driver) => {
          self.showWizard = false;
          self.setTab('hero');
          self.$nextTick(() => {
            requestAnimationFrame(() => {
              if (driver && typeof driver.refresh === 'function') driver.refresh();
            });
          });
        };
        const d = driverFactory({
          showProgress: true,
          progressText: 'Krok {{current}} z {{total}}',
          nextBtnText: 'Dalej',
          prevBtnText: 'Wstecz',
          doneBtnText: 'Zakończ',
          smoothScroll: true,
          allowClose: true,
          disableActiveInteraction: true,
          overlayOpacity: 0.55,
          overlayColor: '#0f172a',
          onDestroyed: () => {
            self.showWizard = false;
            void self.markWelcomeOnboardingSeen();
          },
          steps: [
            {
              element: '#dfcms-onboarding-wizard-step0',
              popover: {
                title: 'Najpierw kreator',
                description:
                  'Zanim uzupełnisz treści w Studiu, wybierz szablon i przejdź przez krótki kreator — wtedy pola (nazwa, kolory, logo) mają sens. Ten krok jest tylko podglądem: nie musisz teraz nic klikać.',
                side: 'bottom',
                align: 'center',
              },
              onHighlightStarted: (element, step, { driver }) => {
                openWizardStep0ForTour(driver);
              },
            },
            {
              element: '#dfcms-onboarding-wizard-paths',
              popover: {
                title: 'Dwie ścieżki',
                description:
                  '„Krok po kroku” prowadzi przez wybór szablonu i podstawy. „Studio” to od razu pełny panel — też OK, ale wtedy sam wybierzesz szablon w kreatorze z menu.',
                side: 'top',
                align: 'center',
              },
              onHighlightStarted: (element, step, { driver }) => {
                openWizardStep0ForTour(driver);
              },
            },
            {
              element: '#dfcms-onboarding-site-preview',
              popover: {
                title: 'Podgląd na żywo',
                description:
                  'Gdy już masz szablon, link „Podgląd strony” pokaże witrynę tak, jak zobaczą ją goście.',
                side: 'bottom',
                align: 'center',
              },
              onHighlightStarted: (element, step, { driver }) => {
                closeWizardForTour(driver);
              },
            },
            {
              element: '#dfcms-onboarding-category-tresc',
              popover: {
                title: 'Treść strony',
                description:
                  'Tu edytujesz to, co widzą goście: powitanie, usługi, galeria, kontakt, FAQ… Na końcu opublikuj zmiany w nagłówku.',
                side: 'right',
                align: 'start',
              },
              onHighlightStarted: (element, step, { driver }) => {
                ensureSidebarForTour(driver);
              },
            },
            {
              element: '#dfcms-onboarding-category-konfiguracja',
              popover: {
                title: 'Konfiguracja',
                description:
                  'Szablon, kolory, integracje, dokumenty, konto — „rama” witryny obok pojedynczych sekcji treści.',
                side: 'right',
                align: 'start',
              },
              onHighlightStarted: (element, step, { driver }) => {
                ensureSidebarForTour(driver);
              },
            },
            {
              element: '#dfcms-onboarding-nav-subscription',
              popover: {
                title: 'Subskrypcja',
                description:
                  'Pakiet, płatność i dostęp do funkcji (np. własna domena). Tu też wrócisz do płatności w Stripe, gdy będzie potrzeba.',
                side: 'right',
                align: 'center',
              },
              onHighlightStarted: (element, step, { driver }) => {
                ensureSidebarForTour(driver);
              },
            },
          ],
        });

        await new Promise((resolve) => this.$nextTick(resolve));
        requestAnimationFrame(() => {
          d.drive();
        });
      },

      /** Zamknięcie modala powitalnego; przy otwartym kreatorze tylko zapis „widziane”, bez touru pod spodem. */
      async dismissWelcomeModalAndStartOnboarding() {
        this.showWelcomeModal = false;
        if (this.content?.pl?.settings?.welcome_onboarding_completed === true) {
          return;
        }
        if (this.showWizard) {
          await this.markWelcomeOnboardingSeen();
          return;
        }
        if (!this.resolveDriverFactory()) {
          await this.markWelcomeOnboardingSeen();
          return;
        }
        this.wizardStep = 0;
        this.wizardTheme = this.theme === 'setup' ? 'beauty' : (this.theme || 'beauty');
        this.wizardFieldWarning = '';
        this.showWizard = true;
        this.sidebarOpen = false;
        await new Promise((resolve) => this.$nextTick(resolve));
        await this.startOnboardingTour();
      },
      /** Pełny ekran startowy kreatora (wybór ścieżki). */
      openWizardFromStudio() {
        if (!this.isEmailVerified) {
          this.showToast('Potwierdź najpierw adres e-mail — link masz w wiadomości od DFCMS.', 'error');
          return;
        }
        this.restoreWizardUiFromStorage(0);
        this.wizardFieldWarning = '';
        this.showWizard = true;
        this.sidebarOpen = false;
        this.persistWizardUiState();
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_reopened', { slug: this.slug });
        }
      },
      reopenWizard() {
        if (!this.isEmailVerified) {
          this.showToast('Potwierdź najpierw adres e-mail — link masz w wiadomości od DFCMS.', 'error');
          return;
        }
        this.restoreWizardUiFromStorage(1);
        this.showWizard = true;
        this.wizardFieldWarning = '';
        this.persistWizardUiState();
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
        if (planType === 'premium') {
          this.showError('Pakiet Premium nie jest już dostępny. Wybierz Starter lub Standard.');
          return;
        }
        const plan = planType === 'pro' ? 'standard' : String(planType || '').trim();
        if (!plan || plan === 'custom') {
          this.showError('Pakiet Custom — skorzystaj z formularza zapytania.');
          return;
        }
        const interval = this.billingInterval === 'yearly' ? 'yearly' : 'monthly';
        if (plan !== 'starter' && plan !== 'standard') {
          this.showError('Nieprawidłowy plan. Wybierz Starter lub Standard.');
          return;
        }
        if (!this.user?.id) {
          this.showError('Zaloguj się, aby wykupić subskrypcję.');
          return;
        }
        if (!this.content?.pl?.settings) return;
        const tier = plan === 'starter' ? 'tier0' : 'tier1';
        const currentTier =
          this.subscriptionPlan === 'tier2' ? 'tier1' : this.subscriptionPlan;
        const isCurrentPaidTier = currentTier === 'tier0' || currentTier === 'tier1';

        if (!this.billingProfileReady) {
          await this.loadBillingProfile();
          this.billingProfileReady = true;
        }

        if (this.shouldUseStripePortalForPlanChange()) {
          if (isCurrentPaidTier && currentTier === tier) {
            this.showToast('Masz już wybrany ten plan rozliczeniowy.', 'success');
            await this.loadData();
            return;
          }
          this.showToast(
            'Zmianę pakietu wykonasz w portalu Stripe — zobaczysz podsumowanie kosztów i potwierdzisz płatność przed obciążeniem karty.',
            'info',
          );
          await this.openCustomerPortal({ subscriptionUpdate: true });
          return;
        }

        if (!this.content.pl.settings.subscription) {
          this.content.pl.settings.subscription = { plan: 'trial', trial_started_at: new Date().toISOString() };
        }
        this.content.pl.settings.subscription.selected_plan = tier;
        const saved = await this.saveData({ silentSuccess: true });
        if (!saved) return;

        const { data: sessionData } = await this.supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) {
          this.showToast('Błąd sesji. Wyloguj się i zaloguj ponownie.', 'error');
          return;
        }
        this.checkoutLoading = true;
        try {
          const returnUrlObj = new URL(window.location.href);
          returnUrlObj.searchParams.set('payment', 'success');
          returnUrlObj.hash = 'subscription';
          const returnUrl = returnUrlObj.toString();

          const { data, error } = await this.supabase.functions.invoke(
            'create-checkout',
            {
              body: {
                plan,
                interval,
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
            if (planType === 'starter' && typeof window.DFOPS_trackEvent === 'function') {
              window.DFOPS_trackEvent('starter_checkout_started', { slug: this.slug });
            }
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
      async upgradeTemplate() {
        if (!this.content || !this.theme) return;
        this.upgrading = true;
        try {
          const upgraded = window.DFOPS_upgradeContent(this.theme, this.content, this.latestTemplateVersion);
          this.content = upgraded;
          this.syncUserPlanFromBilling();
          this.enforceColorPresetForStarter();
          this.applyThemeStylingFromContent();
          const ok = await this._persistDraft({ silent: false });
          if (!ok) throw new Error('template upgrade draft save failed');
          this.currentTemplateVersion = this.latestTemplateVersion;
          this.updateAvailable = false;
          this.hasUnsavedChanges = false;
          this.message = `Szablon zaktualizowany do v${this.latestTemplateVersion}. Kliknij „Publikuj zmiany”, aby udostępnić.`;
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

        const confirmed = await this.confirmAsync({
          title: 'Podpiąć domenę?',
          message:
            'Podpięcie domeny spowoduje również zapisanie i opublikowanie wszystkich wprowadzonych przez Ciebie zmian na stronie. Czy chcesz kontynuować?',
          yesLabel: 'Tak, kontynuuj',
          noLabel: 'Nie',
        });
        if (!confirmed) return;

        const saved = await this.publishChanges();
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
      /** Czy plan pozwala publikować premium motyw. Premium = lista `cfg.premiumThemes` (domyślnie pusta → brak regresji). */
      get isPremiumDraftTheme() {
        const premium = Array.isArray(cfg?.premiumThemes) ? cfg.premiumThemes : [];
        return premium.includes(String(this.theme || '').trim());
      },
      /** Freemium: na darmowym planie (trial/Starter) premium motyw można edytować i podglądać, ale NIE publikować. */
      get isPublishBlockedByPlan() {
        return this.isPremiumDraftTheme && this.isCustomAppearanceLocked;
      },

      /** Zapis WYŁĄCZNIE stanu roboczego (`draft_content`) — nic nie trafia na stronę publiczną. */
      async _persistDraft(opts) {
        const options = opts && typeof opts === 'object' ? opts : {};
        if (!this.content?.pl || !this.pageId || !this.user?.id) return false;
        if (this.content.pl.settings) this.content.pl.settings.theme = this.theme;
        const { error } = await repo.saveCurrentUserPage(this.user.id, { draft_content: this.content });
        if (error) {
          if (!options.silent) console.error(error);
          return false;
        }
        return true;
      },

      /**
       * Cichy auto-save (debounce) stanu roboczego — jak w Webflow/Framer.
       * Pisze WYŁĄCZNIE do `draft_content`; publiczne `content` zmienia tylko „Publikuj”.
       */
      scheduleDraftAutosave() {
        if (!this.pageId || !this.user?.id || this.isLoading || this.isForcedPasswordReset) return;
        if (this._draftAutosaveTimer) clearTimeout(this._draftAutosaveTimer);
        const delay = (cfg?.timeouts?.draftAutosave) ?? 1000;
        this._draftAutosaveTimer = setTimeout(() => {
          this._draftAutosaveTimer = null;
          void this.autosaveDraftNow();
        }, delay);
      },

      async autosaveDraftNow() {
        if (!this.content?.pl || !this.pageId || !this.user?.id) return;
        if (this.isLoading || this.saving || this.draftSaving) return;
        this.draftSaving = true;
        try {
          const ok = await this._persistDraft({ silent: true });
          if (ok) {
            this.hasUnsavedChanges = false;
            this.draftSavedOnce = true;
          }
        } finally {
          this.draftSaving = false;
        }
      },

      /** Auto-save / zapis roboczy panelu — trafia tylko do `draft_content`. Publikacja: `publishChanges()`. */
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
          this.content.pl.settings.theme = this.theme;
          const ok = await this._persistDraft({ silent: silentSuccess });
          if (!ok) throw new Error('draft save failed');
          this.hasUnsavedChanges = false;
          if (!silentSuccess) {
            this.message = successMessage || 'Zapisano roboczo. Kliknij „Publikuj zmiany”, aby pokazać je na stronie.';
            setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
          }
          return true;
        } catch (e) {
          console.error(e);
          this.showError('Nie udało się zapisać zmian roboczych. Sprawdź połączenie i spróbuj ponownie.');
          this.showToast('Nie udało się zapisać zmian. Sprawdź połączenie i spróbuj ponownie.', 'error');
          return false;
        } finally {
          this.saving = false;
        }
      },

      /**
       * Pozytywne tarcie dla głównego przycisku „Publikuj zmiany”: nie strzela od razu do bazy —
       * najpierw freemium-guard, potem modal potwierdzenia. Właściwy zapis robi dopiero `confirmPublish()`.
       */
      requestPublish() {
        if (!this.content?.pl || this.isLoading || this.saving || !this.pageId) return;
        if (this.isPublishBlockedByPlan) {
          this.showPublishUpgradeModal = true;
          return;
        }
        this.showPublishConfirmModal = true;
      },

      /** Potwierdzenie z modala — uruchamia właściwą publikację; modal znika dopiero po sukcesie. */
      async confirmPublish() {
        const ok = await this.publishChanges();
        if (ok) this.showPublishConfirmModal = false;
      },

      /** Publikacja: kopiuje stan roboczy do `content` (widok publiczny) + synchronizuje `draft_content`. */
      async publishChanges(opts) {
        const options = opts && typeof opts === 'object' ? opts : {};
        const silentSuccess = options.silentSuccess === true;
        if (!this.content?.pl || this.isLoading || !this.pageId) return false;

        if (this.isPublishBlockedByPlan) {
          this.showPublishUpgradeModal = true;
          return false;
        }

        this.saving = true;
        try {
          const syncFn = window.DFOPS_googlePlacesSync?.syncGooglePlacesForPublish;
          if (typeof syncFn === 'function' && this.supabase) {
            const syncResult = await syncFn(this.supabase, this.content.pl);
            if (syncResult?.warnings?.length) {
              this.showToast(
                'Zapisano, ale nie udało się odświeżyć: ' + syncResult.warnings.join(', ') + '. Sprawdź konfigurację Google.',
                'error',
              );
            }
          }
          if (Array.isArray(this.content.pl.services)) {
            this.content.pl.services = this.content.pl.services.filter((s) => s.title && String(s.title).trim() !== '');
          }
          this.content.pl.settings.template_version = this.latestTemplateVersion;
          this.content.pl.settings.theme = this.theme;
          const payload = {
            content: this.content,
            draft_content: this.content,
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
          /** Migawka produkcji po udanej publikacji — żeby „Odrzuć zmiany” wracało do świeżo opublikowanej wersji. */
          this._publishedContentRaw = JSON.parse(JSON.stringify(this.content));
          this._publishedTheme = this.theme;
          this.hasUnsavedChanges = false;
          if (this._draftAutosaveTimer) {
            clearTimeout(this._draftAutosaveTimer);
            this._draftAutosaveTimer = null;
          }
          if (!silentSuccess) {
            this.message = 'Zmiany zostały opublikowane!';
            this.showToast('Zmiany zostały opublikowane i są widoczne dla klientów.', 'success');
            setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
          }
          return true;
        } catch (e) {
          console.error(e);
          this.showError('Nie udało się opublikować zmian. Sprawdź połączenie i spróbuj ponownie. Jeśli błąd się powtarza, napisz do nas.');
          this.showToast('Nie udało się opublikować zmian. Sprawdź połączenie i spróbuj ponownie.', 'error');
          return false;
        } finally {
          this.saving = false;
        }
      },

      /** Odrzucenie zmian roboczych — przywraca edytor do aktualnie opublikowanej wersji (`content`). */
      async revertChanges() {
        if (!this.pageId || !this.user?.id) return;
        if (!this._publishedContentRaw) {
          this.showToast('Brak opublikowanej wersji do przywrócenia.', 'error');
          return;
        }
        const confirmed = await this.confirmAsync({
          title: 'Odrzucić zmiany?',
          message:
            'Odrzucić zmiany robocze i przywrócić aktualnie opublikowaną wersję strony? Tej operacji nie można cofnąć.',
          yesLabel: 'Tak, odrzuć',
          noLabel: 'Nie',
          tone: 'danger',
        });
        if (!confirmed) return;
        this.saving = true;
        try {
          const publishedTheme =
            (this._publishedContentRaw?.pl?.settings?.theme &&
              String(this._publishedContentRaw.pl.settings.theme).trim()) ||
            this._publishedTheme ||
            this.theme;
          this.theme = publishedTheme;
          this.content = window.DFOPS_normalizeContent(
            JSON.parse(JSON.stringify(this._publishedContentRaw)),
            publishedTheme,
          );
          if (
            this.content?.pl?.settings &&
            typeof window.DFOPS_stripBillingFromContentSubscription === 'function'
          ) {
            this.content.pl.settings.subscription = window.DFOPS_stripBillingFromContentSubscription(
              this.content.pl.settings.subscription,
            );
          }
          this.selectedStyleBundle = '';
          this.appearancePickerHex = '';
          this.syncUserPlanFromBilling();
          this.applyThemeStylingFromContent();
          const ok = await this._persistDraft({ silent: true });
          if (!ok) throw new Error('revert persist failed');
          this.hasUnsavedChanges = false;
          this.message = 'Przywrócono opublikowaną wersję strony.';
          setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
        } catch (e) {
          console.error(e);
          this.showError('Nie udało się przywrócić wersji opublikowanej.');
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
            ? 'Zdjęcie jest zapisane w treści strony. Przy „Dalej” i na końcu kreatora wszystko trafia do bazy — możesz też użyć „Publikuj zmiany” w nagłówku.'
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

      showAppearanceUpgradeModal: false,
      showPublishUpgradeModal: false,
      /** Pozytywne tarcie: potwierdzenie przed publikacją draft_content → content. */
      showPublishConfirmModal: false,
      appearancePickerHex: '',
      /** Migawka opublikowanej treści (kolumna `content`) — pod „Odrzuć zmiany”. */
      _publishedContentRaw: null,
      _publishedTheme: '',

      googleReviewsPlaceInput: '',
      googleReviewsPlaceResults: [],
      googleReviewsPlaceLoading: false,
      googleReviewsPlaceError: '',
      googleReviewsPlaceSelectedId: null,
      googleReviewsPlaceDebounceTimer: null,

      formatPlacesListError(e) {
        const msg = e instanceof Error ? e.message : String(e);
        return /401|JWT|Unauthorized/i.test(msg)
          ? 'Brak uprawnień (401). Wdróż get-google-reviews z supabase/config.toml (verify_jwt) lub zaloguj się ponownie.'
          : 'Nie udało się wyszukać. Sprawdź połączenie i czy funkcja get-google-reviews jest wdrożona.';
      },

      async invokePlacesList(query, maxResults = 8) {
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
          throw new Error('Brak konfiguracji Supabase.');
        }
        const q = String(query || '').trim();
        if (!q || q.length < 2) {
          throw new Error('Wpisz co najmniej 2 znaki (nazwa firmy lub adres).');
        }
        const { data, error } = await this.supabase.functions.invoke('get-google-reviews', {
          body: { query: q, maxResults, listPlaces: true },
        });
        if (error) throw new Error(error.message || String(error));
        if (!data?.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Błąd wyszukiwania.');
        }
        return Array.isArray(data.places) ? data.places : [];
      },

      syncGoogleReviewsPlaceInputFromContent() {
        const gr = this.content?.pl?.google_reviews;
        if (!gr) return;
        this.googleReviewsPlaceInput = String(gr.place_query || '').trim();
        const pid = String(gr.place_id || '').trim();
        this.googleReviewsPlaceSelectedId = pid || null;
        this.googleReviewsPlaceResults = [];
        this.googleReviewsPlaceError = '';
      },

      onGoogleReviewsPlaceInput() {
        const input = String(this.googleReviewsPlaceInput || '').trim();
        const gr = this.content?.pl?.google_reviews;
        if (!gr) return;

        if (!input) {
          this.clearGoogleReviewsPlaceSelection();
          return;
        }

        if (this.googleReviewsPlaceSelectedId) {
          gr.place_id = '';
          this.googleReviewsPlaceSelectedId = null;
        }
        gr.place_query = '';

        if (this.googleReviewsPlaceDebounceTimer) {
          clearTimeout(this.googleReviewsPlaceDebounceTimer);
        }
        this.googleReviewsPlaceDebounceTimer = setTimeout(() => {
          this.googleReviewsPlaceDebounceTimer = null;
          void this.searchGoogleReviewsPlaces();
        }, 400);
      },

      async searchGoogleReviewsPlaces() {
        const q = String(this.googleReviewsPlaceInput || '').trim();
        if (!q || q.length < 2) {
          this.googleReviewsPlaceResults = [];
          return;
        }
        this.googleReviewsPlaceLoading = true;
        this.googleReviewsPlaceError = '';
        this.googleReviewsPlaceResults = [];
        try {
          const places = await this.invokePlacesList(q, 8);
          this.googleReviewsPlaceResults = places;
          if (!places.length) {
            this.googleReviewsPlaceError = 'Brak wyników — spróbuj innej frazy (np. miasto + nazwa).';
          }
        } catch (e) {
          console.error(e);
          const msg = e instanceof Error ? e.message : String(e);
          this.googleReviewsPlaceError =
            msg === 'Wpisz co najmniej 2 znaki (nazwa firmy lub adres).'
              ? msg
              : this.formatPlacesListError(e);
        } finally {
          this.googleReviewsPlaceLoading = false;
        }
      },

      selectGoogleReviewsPlace(place) {
        if (!place?.id || !this.content?.pl) return;
        if (!this.content.pl.google_reviews) {
          this.content.pl.google_reviews = {
            embed_url: '',
            place_query: '',
            place_id: '',
            max_reviews: 6,
            title: 'Opinie z Google',
          };
        }
        const gr = this.content.pl.google_reviews;
        gr.place_id = place.id;
        gr.place_query = place.address ? `${place.name}, ${place.address}` : String(place.name || '').trim();
        this.googleReviewsPlaceInput = gr.place_query;
        this.googleReviewsPlaceSelectedId = place.id;
        this.googleReviewsPlaceResults = [];
        this.googleReviewsPlaceError = '';
      },

      clearGoogleReviewsPlaceSelection() {
        const gr = this.content?.pl?.google_reviews;
        if (gr) {
          gr.place_id = '';
          gr.place_query = '';
        }
        this.googleReviewsPlaceInput = '';
        this.googleReviewsPlaceSelectedId = null;
        this.googleReviewsPlaceResults = [];
        this.googleReviewsPlaceError = '';
        if (this.googleReviewsPlaceDebounceTimer) {
          clearTimeout(this.googleReviewsPlaceDebounceTimer);
          this.googleReviewsPlaceDebounceTimer = null;
        }
      },

      async searchPlacesForMap() {
        const q = (this.mapPlaceQuery || '').trim();
        if (!q || q.length < 2) {
          this.mapPlaceError = 'Wpisz co najmniej 2 znaki (nazwa firmy lub adres).';
          return;
        }
        this.mapPlaceLoading = true;
        this.mapPlaceError = '';
        this.mapPlaceResults = [];
        this.mapPlaceSelectedId = null;
        try {
          this.mapPlaceResults = await this.invokePlacesList(q, 8);
          if (!this.mapPlaceResults.length) {
            this.mapPlaceError = 'Brak wyników — spróbuj innej frazy (np. miasto + nazwa).';
          }
        } catch (e) {
          console.error(e);
          this.mapPlaceError = this.formatPlacesListError(e);
        } finally {
          this.mapPlaceLoading = false;
        }
      },

      async confirmMapPlaceSelection() {
        if (!this.mapPlaceSelectedId || !this.content?.pl) return;
        const hit = this.mapPlaceResults.find((p) => p.id === this.mapPlaceSelectedId);
        if (!hit) return;
        if (!this.content.pl.contact) this.content.pl.contact = {};
        this.content.pl.contact.map_place_id = hit.id;
        this.content.pl.contact.map_embed_url = '';
        if (hit.address && !String(this.content.pl.contact.address || '').trim()) {
          this.content.pl.contact.address = hit.address;
        }
        this.mapPlaceLoading = true;
        try {
          const syncEmbed = window.DFOPS_googlePlacesSync?.syncMapEmbedIntoContact;
          if (typeof syncEmbed === 'function' && this.supabase) {
            await syncEmbed(this.supabase, this.content.pl.contact);
          }
        } catch (e) {
          console.warn('DFOPS map embed po wyborze miejsca:', e);
        } finally {
          this.mapPlaceLoading = false;
        }
        const hasEmbed = !!String(this.content.pl.contact.map_embed_url || '').trim();
        this.message = hasEmbed
          ? 'Wybrano lokalizację mapy. Opublikuj zmiany, żeby była widoczna na stronie.'
          : 'Wybrano lokalizację. Opublikuj zmiany — przy zapisie spróbujemy ponownie wygenerować embed mapy.';
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
