// Onboarding panel — kreator (wizard) + Driver.js tour + welcome.
// Jeden moduł: rollback 2026-07-04 to była regresja interakcji tour ↔ kreator; nie rozdzielać.
// Jedyny punkt wejścia do kernela: window.DFOPS_attachOnboardingPanel(app) — TYLKO metody
// (named function, nie arrow). Pola i gettery zostają w createAdminApp().
// SoT: docs/specs/admin-split.md §4. Wzorzec attach: js/features/growth/growthPanel.js
// (metody + onAfterLoadData; bez nowych pól, bez wrapu loadData).
;(function () {
  const BOOKING_MODES = new Set(['schedule', 'embed', 'button', 'both']);

  function wizardStepIdAtIndex(theme, index) {
    if (typeof window.DFOPS_wizardStepIdAtIndex === 'function') {
      return window.DFOPS_wizardStepIdAtIndex(theme, index);
    }
    const legacy = ['', 'template', 'brand', 'hero', 'offer', 'about', 'contact'];
    return legacy[index] || 'template';
  }

  function wizardOfferSection(theme) {
    if (typeof window.DFOPS_wizardOfferSection === 'function') {
      return window.DFOPS_wizardOfferSection(theme);
    }
    if (typeof window.DFOPS_themeHasSection === 'function') {
      return window.DFOPS_themeHasSection(theme, 'services') ? 'services' : null;
    }
    return null;
  }

  function readWizardStateFromStorage(slug) {
    if (typeof window.DFOPS_readWizardStateFromStorage === 'function') {
      return window.DFOPS_readWizardStateFromStorage(slug);
    }
    return null;
  }

  function writeWizardStateToStorage(slug, step, theme) {
    if (typeof window.DFOPS_writeWizardStateToStorage === 'function') {
      window.DFOPS_writeWizardStateToStorage(slug, step, theme);
    }
  }

  function clearWizardStateFromStorage(slug) {
    if (typeof window.DFOPS_clearWizardStateFromStorage === 'function') {
      window.DFOPS_clearWizardStateFromStorage(slug);
    }
  }

  function normalizeWizardRestore(step, wizardTheme, pageTheme) {
    if (typeof window.DFOPS_normalizeWizardRestore === 'function') {
      return window.DFOPS_normalizeWizardRestore(step, wizardTheme, pageTheme);
    }
    return { step, theme: wizardTheme || pageTheme || 'beauty' };
  }

  function emptyWizardService(theme) {
    if (typeof window.DFOPS_emptyWizardService === 'function') {
      return window.DFOPS_emptyWizardService(theme);
    }
    return {
      title: '',
      desc: '',
      price: '',
      duration: '',
      details: '',
      icon: theme === 'services' ? 'wrench' : '',
    };
  }

  function emptyWizardMenuItem() {
    if (typeof window.DFOPS_emptyWizardMenuItem === 'function') {
      return window.DFOPS_emptyWizardMenuItem();
    }
    return { category: '', name: '', ingredients: '', price: '' };
  }

  function prepareWizardMenuStep(pl, theme) {
    if (typeof window.DFOPS_prepareWizardMenuStep === 'function') {
      window.DFOPS_prepareWizardMenuStep(pl, theme);
    }
  }

  function syncWizardDerivedFields(pl, theme) {
    if (typeof window.DFOPS_syncWizardDerivedFields === 'function') {
      window.DFOPS_syncWizardDerivedFields(pl, theme);
    }
  }

  function prepareWizardServicesStep(pl, theme) {
    if (typeof window.DFOPS_prepareWizardServicesStep === 'function') {
      window.DFOPS_prepareWizardServicesStep(pl, theme);
    }
  }

  function prepareWizardManifestoStep(pl, theme) {
    if (typeof window.DFOPS_prepareWizardManifestoStep === 'function') {
      window.DFOPS_prepareWizardManifestoStep(pl, theme);
    }
  }

  function prepareWizardHeroStep(pl, theme) {
    if (typeof window.DFOPS_prepareWizardHeroStep === 'function') {
      window.DFOPS_prepareWizardHeroStep(pl, theme);
    }
  }

  function wizardStepSkippable(stepId) {
    if (typeof window.DFOPS_wizardStepSkippable === 'function') {
      return window.DFOPS_wizardStepSkippable(stepId);
    }
    return stepId === 'offer' || stepId === 'about';
  }

  function finalizeWizardContent(pl, theme) {
    if (typeof window.DFOPS_finalizeWizardContent === 'function') {
      window.DFOPS_finalizeWizardContent(pl, theme);
    }
  }

  /** To samo co kernel IIFE — finishWizard normalizuje booking przed publishChanges. */
  function normalizeBookingSettings(plBlock) {
    if (!plBlock || typeof plBlock !== 'object') return;
    if (!plBlock.contact || typeof plBlock.contact !== 'object') plBlock.contact = {};
    const contact = plBlock.contact;
    const raw = String(contact.booking_url || contact.bookingUrl || contact.booksyUrl || '').trim();
    contact.booking_url = raw;
    contact.bookingUrl = raw;
    contact.booksyUrl = raw;
    contact.booksyIframeUrl = '';
    if (!plBlock.settings || typeof plBlock.settings !== 'object') plBlock.settings = {};
    const mode = String(plBlock.settings.booking_mode || '').trim();
    if (!BOOKING_MODES.has(mode)) {
      plBlock.settings.booking_mode = !raw
        ? 'schedule'
        : (raw.toLowerCase().includes('calendly') ? 'embed' : 'button');
    }
  }

  window.DFOPS_attachOnboardingPanel = function attachOnboardingPanel(app) {
    if (!app || typeof app !== 'object') return;

    app.persistWizardUiState = function persistWizardUiState() {
      if (!this.slug || !this.showWizard) return;
      writeWizardStateToStorage(this.slug, this.wizardStep, this.wizardTheme);
    };

    /**
     * @param {0|1} defaultStepWhenNoSave — gdy brak zapisanego stanu: 0 = ekran wyboru ścieżki, 1 = od razu krok 1 (np. „Uruchom kreator” z checklisty).
     */
    app.restoreWizardUiFromStorage = function restoreWizardUiFromStorage(defaultStepWhenNoSave) {
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
      const pl = this.content?.pl;
      const theme = this.wizardTheme || pageTheme;
      const stepId = wizardStepIdAtIndex(theme, this.wizardStep);
      if (pl && stepId === 'offer') {
        if (wizardOfferSection(theme) === 'menu') prepareWizardMenuStep(pl, theme);
        else prepareWizardServicesStep(pl, theme);
      }
      if (pl && stepId === 'about') {
        prepareWizardManifestoStep(pl, theme);
      }
    };

    app.validateWizardStep = function validateWizardStep(step) {
      const pl = this.content?.pl;
      if (!pl) return '';
      const theme = this.wizardActiveTheme;
      const stepId = wizardStepIdAtIndex(theme, step);
      if (typeof window.DFOPS_validateWizardStep !== 'function') return '';
      const themeArg =
        stepId === 'template'
          ? this.wizardTheme
          : stepId === 'hero'
            ? this.wizardTheme || this.theme
            : theme;
      return window.DFOPS_validateWizardStep(pl, themeArg, stepId) || '';
    };

    app.startWizard = function startWizard() {
      this.wizardStep = 1;
      this.wizardTheme = this.theme === 'setup' ? 'beauty' : (this.theme || 'beauty');
      this.wizardFieldWarning = '';
      this.persistWizardUiState();
    };

    /** Zamknięcie kreatora bez kończenia — zapis treści + stan kroku w localStorage (wznowienie w „Uruchom Kreator”). */
    app.skipWizard = async function skipWizard() {
      if (!this.content?.[this.lang]?.settings) return;
      const ok = await this.saveData({ silentSuccess: true });
      if (!ok) return;
      this.persistWizardUiState();
      this.showWizard = false;
      this.wizardStep = 0;
      this.wizardFieldWarning = '';
      this.showWizardDismissModal = true;
    };

    /** Pomiń bieżącą sekcję kreatora (oferta / o nas) — ukryje ją przy publikacji. */
    app.skipWizardSection = async function skipWizardSection() {
      const activeTheme = this.wizardTheme || this.theme;
      const stepId = wizardStepIdAtIndex(activeTheme, this.wizardStep);
      if (!wizardStepSkippable(stepId)) return;
      const pl = this.content?.pl;
      if (!pl) return;
      this.wizardFieldWarning = '';
      if (!pl.settings) pl.settings = {};
      if (stepId === 'offer') {
        if (wizardOfferSection(activeTheme) === 'menu') {
          pl.menu_items = [];
        } else {
          pl.services = [];
          pl.settings.showServices = false;
        }
        prepareWizardManifestoStep(pl, activeTheme);
      } else if (stepId === 'about') {
        pl.manifesto = { label: '', title: '', text: '' };
        pl.settings.showManifesto = false;
      }
      const savedOk = await this.saveData({ silentSuccess: true });
      if (!savedOk) {
        this.wizardFieldWarning =
          'Nie udało się zapisać na serwerze. Sprawdź połączenie i spróbuj ponownie.';
        return;
      }
      if (this.wizardStep < this.wizardStepCount) {
        this.wizardStep++;
      }
      this.persistWizardUiState();
    };

    app.wizardCanSkipSection = function wizardCanSkipSection() {
      const activeTheme = this.wizardTheme || this.theme;
      return wizardStepSkippable(wizardStepIdAtIndex(activeTheme, this.wizardStep));
    };

    app.nextWizardStep = async function nextWizardStep() {
      const err = this.validateWizardStep(this.wizardStep);
      if (err) {
        this.wizardFieldWarning = err;
        return;
      }
      this.wizardFieldWarning = '';

      const pl = this.content?.pl;
      const activeTheme = this.wizardTheme || this.theme;
      const stepId = wizardStepIdAtIndex(activeTheme, this.wizardStep);
      if (pl && (stepId === 'brand' || stepId === 'hero')) {
        syncWizardDerivedFields(pl, activeTheme);
      }
      if (pl && stepId === 'brand') {
        prepareWizardHeroStep(pl, activeTheme);
      }
      if (pl && stepId === 'hero') {
        const offerKind = wizardOfferSection(activeTheme);
        if (offerKind === 'menu') prepareWizardMenuStep(pl, activeTheme);
        else if (offerKind === 'services') prepareWizardServicesStep(pl, activeTheme);
      }
      if (pl && stepId === 'offer') {
        prepareWizardManifestoStep(pl, activeTheme);
      }

      if (this.wizardStep === 1 && this.wizardTheme !== this.theme) {
        if (typeof window.DFOPS_mergeContentWithTemplate !== 'function') {
          this.showError('Brak konfiguracji szablonów (registry).');
          return;
        }
        const savedContact = JSON.parse(JSON.stringify(this.content?.pl?.contact || {}));
        const savedLogo = this.content?.pl?.nav?.logo ?? '';
        const savedLogoImage = this.content?.pl?.nav?.logoImage ?? '';
        const savedPrivacy = JSON.parse(JSON.stringify(this.content?.pl?.privacy || { mode: 'default', customText: '' }));
        const savedSubscription = JSON.parse(
          JSON.stringify(this.content?.pl?.settings?.subscription || {}),
        );
        const trialOnlySub =
          typeof window.DFOPS_stripBillingFromContentSubscription === 'function'
            ? window.DFOPS_stripBillingFromContentSubscription(savedSubscription)
            : savedSubscription;

        const merged = window.DFOPS_mergeContentWithTemplate(this.wizardTheme, {});
        merged.pl.contact = savedContact;
        merged.pl.privacy = savedPrivacy;
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

        const cfg = window.DFOPS_CONFIG;
        const presets = cfg.presetsByTheme[this.wizardTheme] || [];
        const cp = this.content.pl.settings.color_preset;
        if (presets.length && !presets.some((p) => p.id === cp)) {
          this.content.pl.settings.color_preset = presets[0].id;
        }
        this.selectedStyleBundle = '';
        this.syncUserPlanFromBilling();
        this.enforceColorPresetForStarter();
        this.enforceQuickChatForStarter();
        this.applyThemeStylingFromContent();
      }

      /** Zapis do bazy przed przejściem dalej — w tym wartości domyślne z szablonu po merge (krok 1). */
      const savedOk = await this.saveData({ silentSuccess: true });
      if (!savedOk) {
        this.wizardFieldWarning =
          'Nie udało się zapisać na serwerze. Sprawdź połączenie i spróbuj ponownie — albo użyj „Publikuj zmiany” w nagłówku panelu.';
        return;
      }

      if (this.wizardStep < this.wizardStepCount) {
        this.wizardStep++;
      }
      this.persistWizardUiState();
    };

    app.wizardAddServiceRow = function wizardAddServiceRow() {
      const pl = this.content?.pl;
      if (!pl) return;
      if (!Array.isArray(pl.services)) pl.services = [];
      if (pl.services.length >= 3) return;
      const theme = this.wizardTheme || this.theme || 'beauty';
      pl.services.push(emptyWizardService(theme));
    };

    app.wizardAddMenuRow = function wizardAddMenuRow() {
      const pl = this.content?.pl;
      if (!pl) return;
      if (!Array.isArray(pl.menu_items)) pl.menu_items = [];
      if (pl.menu_items.length >= 6) return;
      pl.menu_items.push(emptyWizardMenuItem());
    };

    app.ensureMenuContentShape = function ensureMenuContentShape() {
      const pl = this.content?.pl;
      if (!pl) return;
      if (!pl.hours || typeof pl.hours !== 'object') {
        pl.hours = { title: 'Godziny otwarcia', lines: [] };
      }
      if (!Array.isArray(pl.hours.lines)) pl.hours.lines = [];
      if (!Array.isArray(pl.menu_items)) pl.menu_items = [];
      if (!pl.orders || typeof pl.orders !== 'object') {
        pl.orders = { label: '', title: '', description: '', call_button: '' };
      }
      if (!pl.menu_mode) pl.menu_mode = 'manual';
    };

    app.addMenuHourLine = function addMenuHourLine() {
      this.ensureMenuContentShape();
      this.content.pl.hours.lines.push('');
    };

    app.addMenuItemRow = function addMenuItemRow() {
      this.ensureMenuContentShape();
      this.content.pl.menu_items.push(emptyWizardMenuItem());
    };

    app.prevWizardStep = function prevWizardStep() {
      this.wizardFieldWarning = '';
      if (this.wizardStep > 1) this.wizardStep--;
      this.persistWizardUiState();
    };

    app.finishWizard = async function finishWizard() {
      if (!this.content?.[this.lang]?.settings) return;
      const err = this.validateWizardStep(this.wizardStepCount);
      if (err) {
        this.wizardFieldWarning = err;
        return;
      }
      this.wizardFieldWarning = '';
      const pl = this.content.pl;
      const activeTheme = this.wizardTheme || this.theme;
      if (pl) {
        finalizeWizardContent(pl, activeTheme);
        normalizeBookingSettings(pl);
      }
      this.content[this.lang].settings.onboarding_completed = true;
      /** Koniec kreatora = pierwsza publikacja na żywo (przycisk „Opublikuj moją stronę”). */
      const ok = await this.publishChanges({ silentSuccess: true });
      if (!ok) return;
      this.showWizard = false;
      this.wizardStep = 0;
      this.wizardFieldWarning = '';
      clearWizardStateFromStorage(this.slug);
      this.showStudioWelcomeModal = true;
    };

    app.closeStudioWelcomeModal = function closeStudioWelcomeModal() {
      this.showStudioWelcomeModal = false;
      this.setTab('dashboard');
    };

    app.resolveDriverFactory = function resolveDriverFactory() {
      const pkg = typeof window !== 'undefined' && window.driver && window.driver.js;
      if (pkg && typeof pkg.driver === 'function') return pkg.driver;
      return null;
    };

    /** Zapis w `content` (Supabase): ukończono powitanie / tour — modal nie wraca przy kolejnych logowaniach. */
    app.markWelcomeOnboardingSeen = async function markWelcomeOnboardingSeen() {
      if (!this.content?.pl?.settings) return;
      if (this.content.pl.settings.welcome_onboarding_completed === true) return;
      this.content.pl.settings.welcome_onboarding_completed = true;
      await this.saveData({ silentSuccess: true });
    };

    /**
     * Oprowadzenie (driver.js): najpierw ekran startowy kreatora (wybór ścieżki), potem podgląd i menu.
     * Pola treści (nazwa, logo w Studiu) pomijamy — sens mają dopiero po wyborze szablonu w kreatorze.
     */
    app.startOnboardingTour = async function startOnboardingTour() {
      if (this.content?.pl?.settings?.welcome_onboarding_completed === true) return;
      const driverFactory = this.resolveDriverFactory();
      if (!driverFactory) {
        await this.markWelcomeOnboardingSeen();
        this.openWizardForBuilding();
        return;
      }

      const self = this;
      const ensureSidebarForTour = (driver) => {
        self.sidebarOpen = true;
        self.mobileMenuOpen = true;
        self.$nextTick(() => {
          requestAnimationFrame(() => {
            if (driver && typeof driver.refresh === 'function') driver.refresh();
          });
        });
      };
      // Tour NIE otwiera/zamyka kreatora — pokazuje tylko stałe elementy panelu,
      // żeby nie „migać” ekranem. Na końcu (przycisk „Przejdź do kreatora”) oddajemy
      // sterowanie do kreatora na kroku 1 (patrz onDestroyed → openWizardForBuilding).
      const goToDashboardForTour = (driver) => {
        self.showWizard = false;
        self.setTab('dashboard');
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
        doneBtnText: 'Przejdź do kreatora →',
        smoothScroll: true,
        allowClose: true,
        disableActiveInteraction: true,
        overlayOpacity: 0.55,
        overlayColor: '#0f172a',
        onDestroyed: () => {
          void self.markWelcomeOnboardingSeen();
          // Po samouczku od razu ląduj w kreatorze — user zaczyna budować stronę.
          self.openWizardForBuilding();
        },
        steps: [
          {
            element: '#dfcms-onboarding-site-preview',
            popover: {
              title: 'Najpierw krótka orientacja',
              description:
                'W kilku krokach pokażę Ci panel, a na końcu otworzę kreator, w którym zbudujesz stronę. Ten link „Podgląd strony” zawsze pokaże witrynę tak, jak zobaczą ją goście.',
              side: 'bottom',
              align: 'center',
            },
            onHighlightStarted: (element, step, { driver }) => {
              goToDashboardForTour(driver);
            },
          },
          {
            element: '#dfops-admin-sidebar',
            popover: {
              title: 'Menu po lewej',
              description:
                '„Na start” to najważniejsze sekcje strony. Reszta jest w „Więcej treści” i „Ustawieniach”. Na końcu kliknij Opublikuj zmiany w górnym pasku.',
              side: 'right',
              align: 'start',
            },
            onHighlightStarted: (element, step, { driver }) => {
              ensureSidebarForTour(driver);
            },
          },
          {
            element: '#dfcms-onboarding-wizard-btn',
            popover: {
              title: 'Kreator krok po kroku',
              description:
                'To Twój przewodnik: wybór szablonu i podstawowe treści (nazwa, kolory, logo, oferta, kontakt). Zawsze możesz go tu uruchomić ponownie, gdy utkniesz.',
              side: 'right',
              align: 'center',
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
    };

    /** Zamknięcie modala powitalnego; przy otwartym kreatorze tylko zapis „widziane”, bez touru pod spodem. */
    app.dismissWelcomeModalAndStartOnboarding = async function dismissWelcomeModalAndStartOnboarding() {
      this.showWelcomeModal = false;
      if (this.shouldSkipFirstRunOnboarding) return;
      if (this.content?.pl?.settings?.welcome_onboarding_completed === true) {
        return;
      }
      if (this.showWizard) {
        await this.markWelcomeOnboardingSeen();
        return;
      }
      // Samouczek startuje na dashboardzie, bez otwierania kreatora — kreator
      // otworzy się dopiero na końcu touru (onDestroyed → openWizardForBuilding).
      this.showWizard = false;
      this.setTab('dashboard');
      this.sidebarOpen = false;
      this.mobileMenuOpen = false;
      await new Promise((resolve) => this.$nextTick(resolve));
      await this.startOnboardingTour();
    };

    /** Otwiera kreator gotowy do budowania (krok 1, wybrany szablon) — używane po samouczku. */
    app.openWizardForBuilding = function openWizardForBuilding() {
      this.wizardStep = 1;
      this.wizardTheme = this.theme === 'setup' ? 'beauty' : (this.theme || 'beauty');
      this.wizardFieldWarning = '';
      this.showWizard = true;
      this.sidebarOpen = false;
      this.mobileMenuOpen = false;
      this.persistWizardUiState();
    };

    /** Pełny ekran startowy kreatora (wybór ścieżki). */
    app.openWizardFromStudio = function openWizardFromStudio() {
      if (!this.isEmailVerified) {
        this.showToast('Potwierdź najpierw adres e-mail — link masz w wiadomości od DFCMS.', 'error');
        return;
      }
      this.restoreWizardUiFromStorage(0);
      this.wizardFieldWarning = '';
      this.showWizard = true;
      this.sidebarOpen = false;
      this.mobileMenuOpen = false;
      this.persistWizardUiState();
    };

    app.reopenWizard = function reopenWizard() {
      if (!this.isEmailVerified) {
        this.showToast('Potwierdź najpierw adres e-mail — link masz w wiadomości od DFCMS.', 'error');
        return;
      }
      this.restoreWizardUiFromStorage(1);
      this.showWizard = true;
      this.wizardFieldWarning = '';
      this.persistWizardUiState();
    };

    app.sidebarTabNeedsAttention = function sidebarTabNeedsAttention(tab) {
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
    };

    app.goToOnboardingItem = function goToOnboardingItem(item) {
      if (!item) return;
      if (item.openWizard) this.openWizardFromStudio();
      else if (item.tab) this.setTab(item.tab);
      this.sidebarOpen = false;
      this.mobileMenuOpen = false;
    };

    app.closeWizardDismissModal = function closeWizardDismissModal() {
      this.showWizardDismissModal = false;
    };

    /**
     * Decyzja welcome / wizard po loadData (wyniesione z kernela).
     * Nie auto-startuje touru — to robi dismissWelcomeModalAndStartOnboarding.
     */
    app.maybeResumeOnboardingAfterLoad = async function maybeResumeOnboardingAfterLoad() {
      if (!this.pageId || !this.content?.pl?.settings) return;

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
        !this.shouldSkipFirstRunOnboarding &&
        !this.content?.pl?.settings?.welcome_onboarding_completed;

      if (this.content?.pl?.settings?.welcome_onboarding_completed === true) {
        this.showWizard = false;
        if (this.slug) clearWizardStateFromStorage(this.slug);
      }
    };

    // Lifecycle — rejestr kernela. Zakaz owijania loadData.
    if (typeof app.onAfterLoadData === 'function') {
      app.onAfterLoadData(function onboardingAfterLoad() {
        return this.maybeResumeOnboardingAfterLoad();
      });
    }
  };
})();
