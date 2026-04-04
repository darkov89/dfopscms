;(function () {
  /** Pusty szkielet `content` — Alpine nie wywołuje wtedy błędów typu `null.pl` przed `loadData`. */
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
      showNinjaChecklist: false,
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
      latestTemplateVersion: window.DFOPS_LATEST_TEMPLATE_VERSION || 3,
      currentTemplateVersion: 1,
      updateAvailable: false,
      selectedStyleBundle: '',
      /** Ustawiane z pages.trial_blocked_at — po trialu bez płatności strona publiczna jest zablokowana. */
      trialBlockedAt: null,
      showTrialSuspendedModal: true,
      /** Powrót z Stripe ?payment=success — modal gratulacyjny + toast po wczytaniu treści. */
      showSuccessModal: false,
      _pendingPaymentSuccessToast: false,
      get availablePresets() {
        const currentTheme = this.showWizard
          ? (this.wizardTheme || this.theme || 'beauty')
          : (this.theme || 'beauty');
        return cfg.presetsByTheme[currentTheme] || [];
      },
      get accentColor() { return cfg.accentByPreset[this.content?.pl?.settings?.color_preset] || '#D4AF37'; },
      get styleBundles() { return cfg.bundlesByTheme[this.theme] || []; },
      get subscriptionPlan() { return this.content?.pl?.settings?.subscription?.plan || 'trial'; },
      /** Aktywna opłacona subskrypcja (tier w content, nie trial). */
      get hasActivePaidSubscription() {
        const p = this.subscriptionPlan;
        return p === 'tier0' || p === 'tier1' || p === 'tier2';
      },
      get activeSubscriptionBrandLabel() {
        const p = this.subscriptionPlan;
        if (p === 'tier2') return 'PREMIUM';
        if (p === 'tier1') return 'PRO';
        if (p === 'tier0') return 'STARTER';
        return '';
      },
      get activeSubscriptionPriceLine() {
        const p = this.subscriptionPlan;
        if (p === 'tier2') return '99 PLN netto / msc';
        if (p === 'tier1') return '49 PLN netto / msc';
        if (p === 'tier0') return '19 PLN netto / msc';
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
        this.toast.type = type === 'error' ? 'error' : 'success';
        this.toast.show = true;
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { this.toast.show = false; }, 4000);
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

      /** Stripe Customer Portal — docelowo redirect; na razie komunikat. */
      openStripeCustomerPortal() {
        this.showToast('Zarządzanie płatnościami (Stripe Customer Portal) uruchomimy wkrótce.', 'success');
      },

      flushPendingPaymentSuccessToast() {
        if (!this._pendingPaymentSuccessToast || !this.user) return;
        this._pendingPaymentSuccessToast = false;
        const p = this.subscriptionPlan;
        let planWord = 'PRO';
        if (p === 'tier2') planWord = 'Premium';
        else if (p === 'tier0') planWord = 'Starter';
        this.showToast(
          `Wspaniale! Twój plan ${planWord} jest już aktywny. Twoja strona znów lśni!`,
          'success',
        );
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
          const pay = url.searchParams.get('payment');
          if (pay === 'success' || pay === 'cancelled') {
            url.searchParams.delete('payment');
            const qs = url.searchParams.toString();
            window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash);
            if (pay === 'success') {
              this.showSuccessModal = true;
              this._pendingPaymentSuccessToast = true;
            } else {
              this.showToast(
                'Płatność nie została dokończona — możesz spróbować ponownie w sekcji Subskrypcja.',
                'error',
              );
            }
          }
        } catch {
          /* ignore */
        }
        this.supabase = window.DFOPS_getSupabaseClient();
        this.supabase.auth.getSession().then(({ data: { session } }) => {
          this.user = session?.user || null;
          this.loadingAuth = false;
          if (this.user) {
            this.isLoading = true;
            this.loadData();
          }
        });
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
          this.user = data.user;
          this.isLoading = true;
          await this.loadData();
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
        this.user = null;
        this.content = createAdminContentShell();
        this.pageId = null;
        this.isLoading = false;
        this.customDomainStatus = '';
        this.showDnsInstructions = false;
        this.showWizard = false;
        this.wizardStep = 0;
        this.wizardTheme = '';
        this.wizardFieldWarning = '';
        this.showNinjaChecklist = false;
        this.hasUnsavedChanges = false;
        this.showSuccessModal = false;
        this._pendingPaymentSuccessToast = false;
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
        this.showNinjaChecklist = false;
        try {
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

          if (
            this.content &&
            this.content[this.lang] &&
            this.content[this.lang].settings &&
            this.content[this.lang].settings.onboarding_completed === false
          ) {
            this.showWizard = true;
          }

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
          if (this.user) {
            this.flushPendingPaymentSuccessToast();
            this.maybeShowPaymentReturnToast();
          }
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
        this.showNinjaChecklist = true;
        this.message = 'Kreator pominięty. Poniżej masz krótką listę — uzupełnij stronę, gdy będziesz gotów.';
        setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
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
      /** Pełny ekran startowy kreatora (wybór ścieżki). */
      openWizardFromStudio() {
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
        this.wizardStep = 1;
        this.wizardTheme = this.theme === 'setup' ? 'beauty' : (this.theme || 'beauty');
        this.showWizard = true;
        this.wizardFieldWarning = '';
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_reopened', { slug: this.slug });
        }
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
        if (!this.content.pl.settings.subscription) {
          this.content.pl.settings.subscription = { plan: 'trial', trial_started_at: new Date().toISOString() };
        }
        const tier = planType === 'pro' ? 'tier1' : 'tier2';
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
          const returnUrl = `${window.location.origin}${window.location.pathname}`;
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
          this.showToast('Błąd podczas łączenia z systemem płatności.', 'error');
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
    const content =
      fromApp.content && typeof fromApp.content === 'object' && fromApp.content.pl
        ? fromApp.content
        : createAdminContentShell();
    const isLoading = fromApp.isLoading === true || fromApp.isLoading === false ? fromApp.isLoading : false;
    return {
      sidebarOpen: false,
      ...fromApp,
      isLoading,
      content,
    };
  }

  window.createAdminApp = createAdminApp;
  window.DFOPS_adminAlpineState = buildAdminAlpineState;
  window.DFOPS_createAdminContentShell = createAdminContentShell;
})();
