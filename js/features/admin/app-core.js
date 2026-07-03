function createAdminApp() {
    const t = window.DFOPS_CONFIG?.timeouts || {};
    const MS_PER_DAY = t.msPerDay ?? 86400000;
    const ERROR_MESSAGE_TIMEOUT = t.errorMessage ?? 5000;
    const SUCCESS_MESSAGE_TIMEOUT = t.successMessage ?? 3000;
    const UPGRADE_MESSAGE_TIMEOUT = t.upgradeMessage ?? 3500;
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
  const ctx = {
    t,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
    cfg,
    repo,
  };
  return Object.assign(
    {
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
      hasImpersonateParam: new URLSearchParams(window.location.search).has('impersonate'),
      impersonateSlug: normalizePageSlug(new URLSearchParams(window.location.search).get('impersonate')),
      isSuperadmin: false,
      isSuperAdmin: false,
      isImpersonating: false,
      impersonatedPageOwnerId: null,
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
      domainInput: '',
      pageId: null,
      isVerifyingDomain: false,
      domainMessage: '',
      domainError: '',
      showDnsInstructions: false,
      showTemplateSwitcher: false,
      activeTab: 'dashboard',
      mobileMenuOpen: false,
      headerMoreMenuOpen: false,
      navGroupStart: true,
      navGroupMore: false,
      navGroupSettings: false,
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
      showCheckoutModal: false,
      pendingCheckoutPlan: '',
      pendingCheckoutPlanType: '',
      pendingCheckoutTier: '',
      pendingCheckoutInterval: '',
      turnstileToken: '',
      turnstileWidgetId: null,
      /** Okres rozliczenia na ekranie pakietów: monthly | yearly */
      billingInterval: 'monthly',
      stripeSyncLoading: false,
      /** Profil rozliczeniowy z tabeli billing_profiles (źródło prawdy Stripe). */
      billingProfile: null,
      /** Lustrzany plan z `pages.billing_plan` — fallback UI gdy brak wiersza billing lub God Mode. */
      pageBillingPlan: 'trial',
      /** Widok subskrypcji — refreshBillingSubscriptionView(), nie getter (Alpine reactivity). */
      billingSubscriptionView: emptyBillingSubscriptionView(),
      /** Ustawiane w applyBillingSubscriptionView — nie gettery (Alpine zamraża je przy init). */
      subscriptionPlan: 'trial',
      hasActivePaidSubscription: false,
      billingDebugLog: [],
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
    },
    adminMixinUi(ctx),
    adminMixinAuth(ctx),
    adminMixinData(ctx),
    adminMixinBilling(ctx),
    adminMixinWizard(ctx),
    adminMixinIntegrations(ctx),
  );
}

  function buildAdminAlpineState() {
    const fromApp = createAdminApp();

    // Mutujemy oryginalny obiekt, aby zachować gettery (spread niszczyłby je przy inicjalizacji).
    fromApp.sidebarOpen = false;
    fromApp.mobileMenuOpen = false;
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
  window.DFOPS_billingRowToSubscriptionView = billingRowToSubscriptionView;
  window.DFOPS_stripBillingFromContentSubscription = stripBillingFromContentSubscription;
