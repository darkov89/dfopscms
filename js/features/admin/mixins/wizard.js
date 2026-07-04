function adminMixinWizard(ctx) {
  const {
    cfg,
    repo,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
  } = ctx;
  return {
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
      },
      /**
       * Aktywna opłacona subskrypcja Stripe (`billing_profiles` → billingSubscriptionView).
       * Wyłącznie: niepuste `stripe_subscription_id` + status `active` lub `trialing`.
       */
      validateWizardStep(step) {
        const pl = this.content?.pl;
        if (!pl) return '';
        const theme = this.wizardActiveTheme;
        const stepId = wizardStepIdAtIndex(theme, step);
        if (stepId === 'template') {
          if (!getWizardTemplateIds().includes(this.wizardTheme)) {
            return 'Wybierz szablon branżowy.';
          }
        }
        if (stepId === 'brand') {
          if (!String(pl.nav?.logo || '').trim()) {
            return 'Podaj nazwę firmy — wyświetli się w menu i buduje rozpoznawalność marki.';
          }
        }
        if (stepId === 'hero') {
          const tmpl = getWizardTemplatePl(this.wizardTheme || this.theme);
          if (isWizardPlaceholder(pl.hero?.headline, tmpl?.hero?.headline)) {
            return 'Podaj główne hasło na stronie — zastąp przykładowy tekst z szablonu.';
          }
          if (isWizardPlaceholder(pl.hero?.description, tmpl?.hero?.description)) {
            return 'Napisz krótki opis pod nagłówkiem — goście muszą wiedzieć, czym się zajmujesz.';
          }
        }
        if (stepId === 'offer') {
          const offerKind = wizardOfferSection(theme);
          if (offerKind === 'menu') {
            const hasMenu =
              Array.isArray(pl.menu_items) && pl.menu_items.some((row) => normWizardText(row?.name));
            if (!hasMenu) {
              return 'Dodaj co najmniej jedno danie z nazwą — goście muszą wiedzieć, co serwujesz.';
            }
          } else {
            const hasService =
              Array.isArray(pl.services) && pl.services.some((s) => normWizardText(s?.title));
            if (!hasService) {
              return 'Dodaj co najmniej jedną usługę z nazwą — klienci muszą wiedzieć, co oferujesz.';
            }
          }
        }
        if (stepId === 'about') {
          if (!normWizardText(pl.manifesto?.text)) {
            return 'Napisz kilka zdań o sobie lub swojej firmie — sekcja „O nas” nie może zostać pusta.';
          }
        }
        if (stepId === 'contact') {
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

        const pl = this.content?.pl;
        const activeTheme = this.wizardTheme || this.theme;
        const stepId = wizardStepIdAtIndex(activeTheme, this.wizardStep);
        if (pl && (stepId === 'brand' || stepId === 'hero')) {
          syncWizardDerivedFields(pl, activeTheme);
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
          if (typeof window.DFOPS_trackEvent === 'function') {
            window.DFOPS_trackEvent('onboarding_step_completed', { step: this.wizardStep });
          }
          this.wizardStep++;
        }
        this.persistWizardUiState();
      },
      wizardAddServiceRow() {
        const pl = this.content?.pl;
        if (!pl) return;
        if (!Array.isArray(pl.services)) pl.services = [];
        if (pl.services.length >= 3) return;
        const theme = this.wizardTheme || this.theme || 'beauty';
        pl.services.push(emptyWizardService(theme));
      },
      wizardAddMenuRow() {
        const pl = this.content?.pl;
        if (!pl) return;
        if (!Array.isArray(pl.menu_items)) pl.menu_items = [];
        if (pl.menu_items.length >= 6) return;
        pl.menu_items.push(emptyWizardMenuItem());
      },
      ensureMenuContentShape() {
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
      },
      addMenuHourLine() {
        this.ensureMenuContentShape();
        this.content.pl.hours.lines.push('');
      },
      addMenuItemRow() {
        this.ensureMenuContentShape();
        this.content.pl.menu_items.push(emptyWizardMenuItem());
      },
      prevWizardStep() {
        this.wizardFieldWarning = '';
        if (this.wizardStep > 1) this.wizardStep--;
        this.persistWizardUiState();
      },
      async finishWizard() {
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
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_finished', { slug: this.slug });
        }
      },
      closeStudioWelcomeModal() {
        this.showStudioWelcomeModal = false;
        this.setTab('dashboard');
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
          self.mobileMenuOpen = true;
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
                title: 'Pomocnik krok po kroku',
                description:
                  'Gdy utkniesz — uruchom pomocnika. Przeprowadzi Cię przez wybór szablonu i podstawowe treści.',
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
        this.mobileMenuOpen = false;
        await new Promise((resolve) => this.$nextTick(resolve));
        await this.startOnboardingTour();
      },
      /** Pełny ekran startowy kreatora (wybór ścieżki). */
      async openWizardFromStudio() {
        await this.syncAuthUserFromServer();
        const host = String(window.location?.hostname || '');
        const stagingSurface =
          window.DFOPS_DEPLOY_ENVIRONMENT === 'staging' || /\.pages\.dev$/i.test(host);
        if (!stagingSurface && !this.isEmailVerified) {
          this.showToast('Potwierdź najpierw adres e-mail — link masz w wiadomości od DFCMS.', 'error');
          return;
        }
        this.restoreWizardUiFromStorage(0);
        this.wizardFieldWarning = '';
        this.showWizard = true;
        this.sidebarOpen = false;
        this.mobileMenuOpen = false;
        this.persistWizardUiState();
        if (new URLSearchParams(window.location.search).get('dfcms_debug') === '1') {
          console.info('[DFCMS] openWizardFromStudio → showWizard', this.showWizard, 'step', this.wizardStep);
        }
        if (typeof window.DFOPS_trackEvent === 'function') {
          window.DFOPS_trackEvent('onboarding_reopened', { slug: this.slug });
        }
      },
      async reopenWizard() {
        await this.syncAuthUserFromServer();
        const host = String(window.location?.hostname || '');
        const stagingSurface =
          window.DFOPS_DEPLOY_ENVIRONMENT === 'staging' || /\.pages\.dev$/i.test(host);
        if (!stagingSurface && !this.isEmailVerified) {
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
        this.mobileMenuOpen = false;
      },
      closeWizardDismissModal() {
        this.showWizardDismissModal = false;
      },
  };
}
