function adminMixinData(ctx) {
  const {
    cfg,
    repo,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
  } = ctx;
  return {
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
        this.billingProfileReady = false;
        this.showTrialBanner = false;
        this.syncPanelReadyFlags();
        this.showWizardDismissModal = false;
        try {
          if (this.user) {
            await this.syncAuthUserFromServer();
          }
          if (this.hasImpersonateParam && !this.impersonateSlug) {
            window.location.href = 'index.html';
            return;
          }
          let data = null;
          let error = null;
          if (this.impersonateSlug) {
            const access = await repo.isCurrentUserSuperadmin(this.user?.id);
            if (access.error || !access.allowed) {
              window.location.href = 'index.html';
              return;
            }
            this.isSuperadmin = true;
            this.isSuperAdmin = true;
            this.isImpersonating = true;
            ({ data, error } = await repo.getPageBySlugForSuperadmin(this.impersonateSlug));
            if (error) {
              this.showError('Nie udało się wczytać strony klienta.');
              return;
            }
            if (!data) {
              this.showError('Nie znaleziono strony klienta o podanym slugu.');
              return;
            }
          } else {
            this.isImpersonating = false;
            this.impersonatedPageOwnerId = null;
            ({ data, error } = await repo.getCurrentUserPage(this.user.id));
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
          }
          this.pageId = data.id;
          this.slug = data.slug;
          this.impersonatedPageOwnerId = this.isImpersonating ? (data.user_id || null) : null;
          this.pageBillingPlan = data.billing_plan || 'trial';
          this.trialBlockedAt = data.trial_blocked_at ?? null;
          this.showTrialSuspendedModal = !!this.trialBlockedAt;
          this.customDomain = data.custom_domain || '';
          this.customDomainStatus = data.custom_domain_status || '';
          this.domainInput = data.custom_domain || '';

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
          if (this.content?.pl) normalizeBookingSettings(this.content.pl);
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
          if (this.isImpersonating) {
            this.billingProfile = null;
            this.refreshBillingSubscriptionView();
          } else {
            await this.loadBillingProfile();
          }
          this.billingProfileReady = true;
          this.currentTemplateVersion = Number(this.content.pl.settings.template_version || 1);
          this.updateAvailable = this.currentTemplateVersion < this.latestTemplateVersion;
          this.syncUserPlanFromBilling();
          this.applyThemeStylingFromContent();
          this.enforceColorPresetForStarter();
          this.enforceQuickChatForStarter();

          /** Pierwsze wejście po migracji (draft pusty): utrwalamy spójny stan roboczy = opublikowana treść. */
          if (!usingDraft && this.pageId && this.user?.id) {
            void this._persistDraft({ silent: true });
          }

          const fromHash = parseAdminTabFromHash();
          if (fromHash) this.activeTab = fromHash;
          else this.activeTab = 'dashboard';
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
            this.theme !== 'setup' &&
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
          this.syncPanelReadyFlags();
          if (this.user && this.billingProfileReady) {
            this.maybeShowPaymentReturnToast();
            this.maybeShowBillingStatusToastOnce();
          }
          if (!this._initialPanelLoadDone && this.billingProfileReady) {
            this._initialPanelLoadDone = true;
          }
          if (
            !this._setupWizardAutoOpened &&
            this.user &&
            this.isEmailVerified &&
            !this.isForcedPasswordReset &&
            this.theme === 'setup' &&
            this.content?.pl?.settings?.onboarding_completed === false
          ) {
            this._setupWizardAutoOpened = true;
            this.$nextTick(() => {
              setTimeout(() => {
                if (
                  this.theme === 'setup' &&
                  this.content?.pl?.settings?.onboarding_completed === false &&
                  !this.showWizard
                ) {
                  this.openWizardFromStudio();
                }
              }, 350);
            });
          }
          this.publishPanelDebugState();
        }
      },
      applyThemeStylingFromContent() {
        if (!this.content?.pl?.settings) return;
        window.DFOPS_applyThemeStyling(this.content.pl.settings, this.theme, 'admin');
      },

      async switchTemplate(newTemplateId) {
        const id = String(newTemplateId || '').trim().toLowerCase();
        if (!getSwitchableTemplateIds().includes(id)) return;
        if (this.theme === id) return;
        const confirmed = await this.confirmAsync({
          title: 'Zmienić szablon?',
          message:
            'Uwaga: zmiana szablonu nadpisze aktualne teksty i układ sekcji (powitanie, usługi, FAQ itd.). Zachowamy dane kontaktowe, logo tekstowe i logo graficzne oraz ustawienia subskrypcji. Kontynuować?',
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
          const savedPrivacy = JSON.parse(JSON.stringify(this.content?.pl?.privacy || { mode: 'default', customText: '' }));
          const savedSubscription = JSON.parse(
            JSON.stringify(this.content?.pl?.settings?.subscription || {}),
          );
          const trialOnlySub =
            typeof window.DFOPS_stripBillingFromContentSubscription === 'function'
              ? window.DFOPS_stripBillingFromContentSubscription(savedSubscription)
              : savedSubscription;
          const savedWelcomeDone = this.content?.pl?.settings?.welcome_onboarding_completed === true;
          const savedOnboardingDone = this.content?.pl?.settings?.onboarding_completed === true;

          const merged = window.DFOPS_mergeContentWithTemplate(id, {});
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
            if (savedWelcomeDone) merged.pl.settings.welcome_onboarding_completed = true;
            if (savedOnboardingDone) merged.pl.settings.onboarding_completed = true;
          }

          this.theme = id;
          this.content = window.DFOPS_normalizeContent(merged, id);

          const presets = cfg.presetsByTheme[id] || [];
          const cp = this.content.pl.settings.color_preset;
          if (presets.length && !presets.some((p) => p.id === cp)) {
            this.content.pl.settings.color_preset = presets[0].id;
          }
          if (themeUsesColorPalette(id)) {
            this.content.pl.settings.color_palette =
              this.content.pl.settings.color_palette || this.content.pl.settings.color_preset;
          }

          this.selectedStyleBundle = '';
          this.syncUserPlanFromBilling();
          this.enforceColorPresetForStarter();
          this.enforceQuickChatForStarter();
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
        if (bundle.color_palette && themeUsesColorPalette(this.theme)) {
          this.content.pl.settings.color_preset = bundle.color_palette;
          this.content.pl.settings.color_palette = bundle.color_palette;
        } else {
          this.content.pl.settings.color_preset = bundle.color_preset;
          if (bundle.color_palette) {
            this.content.pl.settings.color_palette = bundle.color_palette;
          }
        }
        this.content.pl.settings.background_style = bundle.background_style;
        this.content.pl.settings.font_preset = bundle.font_preset;
        this.appearancePickerHex = '';
        this.applyThemeStylingFromContent();
      },
      async upgradeTemplate() {
        if (!this.content || !this.theme) return;
        this.upgrading = true;
        try {
          const upgraded = window.DFOPS_upgradeContent(this.theme, this.content, this.latestTemplateVersion);
          this.content = upgraded;
          this.syncUserPlanFromBilling();
          this.enforceColorPresetForStarter();
          this.enforceQuickChatForStarter();
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
      cleanDomainInput(raw) {
        if (raw == null || typeof raw !== 'string') return '';
        const withoutProtocolAndPath = raw
          .trim()
          .replace(/^https?:\/\//i, '')
          .replace(/\/.*$/, '')
          .replace(/[?#].*$/, '');
        return window.DFOPS_normalizeHostname(withoutProtocolAndPath);
      },

      async verifyAndSaveDomain() {
        if (this.isCustomDomainLocked) return;
        if (window.location.protocol === 'file:') {
          this.domainError =
            'Otwórz panel przez adres http:// (np. Live Server na localhost), nie z dysku (file://).';
          this.domainMessage = '';
          return;
        }

        const cleanDomain = this.cleanDomainInput(this.domainInput);
        this.domainInput = cleanDomain;

        if (!this.pageId || !cleanDomain) {
          this.domainError = 'Podaj domenę (hostname, np. twojadomena.pl).';
          this.domainMessage = '';
          return;
        }

        this.isVerifyingDomain = true;
        this.domainMessage = '';
        this.domainError = '';

        try {
          const response = await fetch(
            `/api/verify-domain?domain=${encodeURIComponent(cleanDomain)}`,
          );
          const result = await response.json().catch(() => ({}));

          if (result.error === 'INVALID_DOMAIN') {
            this.domainError = 'Nieprawidłowy adres domeny.';
            return;
          }

          const dbStatus = result.status === 'verified' ? 'active' : 'pending';

          const { error } = await this.saveActivePage({
            custom_domain: cleanDomain,
            custom_domain_status: dbStatus,
          });
          if (error) throw error;

          this.customDomain = cleanDomain;
          this.customDomainStatus = dbStatus;

          if (dbStatus === 'active') {
            this.domainMessage = 'Domena zweryfikowana i zapisana.';
            this.showDnsInstructions = false;
            this.showToast('Własna domena jest aktywna.', 'success');
          } else {
            this.domainMessage =
              'Domena zapisana. Dodaj rekord CNAME u operatora — po propagacji DNS kliknij „Zapisz i sprawdź” ponownie.';
            this.showDnsInstructions = true;
          }
        } catch (e) {
          console.error('Błąd weryfikacji domeny:', e);
          const raw = e instanceof Error ? e.message : String(e);
          this.domainError =
            raw === 'Failed to fetch'
              ? 'Brak połączenia z serwerem. Otwórz panel przez http/https i spróbuj ponownie.'
              : raw || 'Nie udało się zapisać domeny.';
        } finally {
          this.isVerifyingDomain = false;
        }
      },
      /** Czy plan pozwala publikować premium motyw. Premium = lista `cfg.premiumThemes` (domyślnie pusta → brak regresji). */
      syncBookingSettings() {
        if (!this.content?.pl) return;
        normalizeBookingSettings(this.content.pl);
        this.scheduleDraftAutosave();
      },

      async saveActivePage(payload) {
        if (!this.pageId || !this.user?.id) {
          return { data: null, error: new Error('missing active page') };
        }
        if (this.isImpersonating) {
          if (!this.isSuperadmin) {
            return { data: null, error: new Error('superadmin access required') };
          }
          return repo.savePageByIdForSuperadmin(this.pageId, payload);
        }
        return repo.saveCurrentUserPage(this.user.id, payload);
      },

      /** Zapis WYŁĄCZNIE stanu roboczego (`draft_content`) — nic nie trafia na stronę publiczną. */
      async _persistDraft(opts) {
        const options = opts && typeof opts === 'object' ? opts : {};
        if (!this.content?.pl || !this.pageId || !this.user?.id) return false;
        normalizeBookingSettings(this.content.pl);
        if (this.content.pl.settings) this.content.pl.settings.theme = this.theme;
        const { error } = await this.saveActivePage({ draft_content: this.content });
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
          normalizeBookingSettings(this.content.pl);
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
          const { error } = await this.saveActivePage(payload);
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
  };
}
