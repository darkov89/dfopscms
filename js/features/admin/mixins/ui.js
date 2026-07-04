function adminMixinUi(ctx) {
  const {
    cfg,
    repo,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
  } = ctx;
  return {
      get availablePresets() {
        const currentTheme = this.showWizard
          ? (this.wizardTheme || this.theme || 'beauty')
          : (this.theme || 'beauty');
        return cfg.presetsByTheme[currentTheme] || [];
      },
      get accentColor() { return cfg.accentByPreset[this.content?.pl?.settings?.color_preset] || '#D4AF37'; },
      get styleBundles() { return cfg.bundlesByTheme[this.theme] || []; },
      /** Spójne flagi ładowania panelu — jawne pola (nie gettery Alpine). */
      syncPanelReadyFlags() {
        this.panelBootLoading =
          !!this.loadingAuth ||
          !!this.isLoading ||
          (!!this.user && !this.isForcedPasswordReset && !this.billingProfileReady);
        if (this.loadingAuth || this.isLoading) {
          this.panelContentReady = false;
        } else if (!this.user) {
          this.panelContentReady = false;
        } else if (this.isForcedPasswordReset) {
          this.panelContentReady = true;
        } else {
          this.panelContentReady = !!this.billingProfileReady;
        }
      },
      /**
       * Checklista „co jeszcze dołożyć” dopóki `onboarding_completed` jest false — tylko podstawy:
       * szablon (dopóki motyw `setup`), nazwa w menu, minimum kontaktu (tel. lub e-mail).
       * Nagłówek hero nie jest wymuszany — uzupełnisz go w kreatorze lub w zakładce powitalnej.
       */
      get themeDisplayLabel() {
        const id = String(this.theme || '').trim().toLowerCase();
        if (typeof window.DFOPS_getTemplateCatalog === 'function') {
          const cat = window.DFOPS_getTemplateCatalog().find((t) => t.id === id);
          if (cat?.name) return cat.name;
        }
        return THEME_DISPLAY_LABELS[id] || id || '—';
      },
      /** Checklista na ekranie startowym — proste kroki dla właściciela firmy. */
      get dashboardStartTasks() {
        const pl = this.content?.pl;
        if (!pl) return [];
        const tasks = [];
        const phone = String(pl.contact?.phone || '').trim();
        const email = String(pl.contact?.email || '').trim();
        if (!phone && !email) {
          tasks.push({ id: 'phone', label: 'Dodaj numer telefonu', tab: 'contact', done: false });
        } else {
          tasks.push({ id: 'phone', label: 'Dodaj numer telefonu', tab: 'contact', done: true });
        }
        let hasOffer = false;
        if (themeHasSection(this.theme, 'menu')) {
          hasOffer =
            Array.isArray(pl.menu_items) &&
            pl.menu_items.some((row) => row && isNonEmptyContentString(row.name));
        } else if (themeHasSection(this.theme, 'services')) {
          hasOffer =
            Array.isArray(pl.services) &&
            pl.services.some((s) => s && isNonEmptyContentString(s.title));
        }
        tasks.push({
          id: 'offer',
          label: themeHasSection(this.theme, 'menu')
            ? 'Wpisz choć jedną pozycję menu'
            : 'Wpisz choć jedną usługę',
          tab: themeHasSection(this.theme, 'menu') ? 'menu' : 'services',
          done: hasOffer,
        });
        const hasHeroImage =
          isNonEmptyContentString(pl.hero?.image) || isNonEmptyContentString(pl.nav?.logoImage);
        tasks.push({
          id: 'heroimg',
          label: 'Wgraj zdjęcie banera',
          tab: 'hero',
          done: hasHeroImage,
        });
        const hasHeadline = isNonEmptyContentString(pl.hero?.headline);
        tasks.push({
          id: 'headline',
          label: 'Uzupełnij nagłówek na banerze',
          tab: 'hero',
          done: hasHeadline,
        });
        return tasks;
      },
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
            ok: () => {
              if (themeHasSection(this.theme, 'menu')) {
                return (
                  Array.isArray(pl.menu_items) &&
                  pl.menu_items.some((row) => row && isNonEmptyContentString(row.name))
                );
              }
              return (
                Array.isArray(pl.services) &&
                pl.services.some((s) => s && isNonEmptyContentString(s.title))
              );
            },
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
      /** Istniejący klient Stripe (CID lub SID) — nie oznacza aktywnej subskrypcji. */
      get subscriptionBlocksAccountDeletion() {
        const sub = this.billingSubscriptionView;
        const sid = typeof sub?.stripe_subscription_id === 'string' ? sub.stripe_subscription_id.trim() : '';
        if (!sid) return false;
        const stRaw = typeof sub?.status === 'string' ? sub.status.trim().toLowerCase() : '';
        if (stRaw === 'canceled' || stRaw === 'cancelled' || stRaw === 'incomplete_expired') return false;
        if (!stRaw) return true;
        return ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(stRaw);
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

      /** Opłacony Starter (tier0) — bez przycisku szybkiego kontaktu WhatsApp / Messenger. */
      get isQuickChatLocked() {
        if (typeof window.DFOPS_planAllowsQuickChat === 'function') {
          return !window.DFOPS_planAllowsQuickChat(this.subscriptionPlan);
        }
        return this.subscriptionPlan === 'tier0';
      },

      /** Etykieta adresu LIVE w panelu — zależy od środowiska (prod vs staging pages.dev). */
      get tenantSiteHostLabel() {
        if (!this.slug) return '—';
        if (typeof window.DFOPS_formatTenantHostname === 'function') {
          return (
            window.DFOPS_formatTenantHostname(
              this.slug,
              window.location.hostname,
              window.DFOPS_normalizeHostname,
            ) || this.slug
          );
        }
        return `${this.slug}.dfcms.pl`;
      },

      get appearancePickerAccentHex() {
        if (this.appearancePickerHex) return this.appearancePickerHex;
        return this.accentColor || '#D4AF37';
      },
      /** Na localhost podgląd wskazuje plik .html — brak pliku = proxy (Epik 3). */
      get previewHtmlBasename() {
        const t = String(this.theme || 'beauty').trim().toLowerCase();
        if (t === 'setup') return 'setup';
        if (isPublishedTheme(t)) return t;
        return 'beauty';
      },
      /** Pełna ścieżka do podglądu / live (setup → /setup.html). */
      themePublicHtmlPath() {
        return publicHtmlPathForTheme(this.theme || 'beauty');
      },
      get previewUsesHtmlFallback() {
        const t = String(this.theme || '').trim().toLowerCase();
        if (!t || t === 'setup') return false;
        return !isPublishedTheme(t);
      },
      get templateCatalog() {
        if (typeof window.DFOPS_getTemplateCatalog === 'function') {
          return window.DFOPS_getTemplateCatalog();
        }
        return [];
      },
      get wizardTemplateCatalog() {
        if (typeof window.DFOPS_getWizardTemplateCatalog === 'function') {
          return window.DFOPS_getWizardTemplateCatalog();
        }
        return this.templateCatalog;
      },
      get activeThemeSections() {
        return getThemeSections(this.wizardActiveTheme);
      },
      themeHasSection(section) {
        return themeHasSection(this.wizardActiveTheme, section);
      },
      adminTabVisible(tabId) {
        return adminTabVisibleForTheme(this.theme, tabId);
      },
      get navMenuFields() {
        if (typeof window.DFOPS_getNavMenuFields === 'function') {
          return window.DFOPS_getNavMenuFields(this.theme);
        }
        return [];
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
        // (subdomena `{slug}.dfcms.pl` to inny origin). Dlatego zawsze otwieramy `/templates/{motyw}.html?site=…`.
        const isLocalhost =
          window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const path = `${this.themePublicHtmlPath()}?${siteQs}`;
        if (isLocalhost) return path;
        const origin = String(window.location.origin || '').replace(/\/$/, '');
        return origin ? `${origin}${path}` : path;
      },

      getLiveSiteUrl() {
        if (!this.slug) return '#';
        const isLocalhost =
          window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocalhost) {
          const qs = `site=${encodeURIComponent(this.slug)}`;
          return `${publicHtmlPathForTheme(this.theme)}?${qs}`;
        }
        const hostCustom = typeof this.customDomain === 'string' ? this.customDomain.trim() : '';
        if (hostCustom && this.customDomainStatus === 'active') {
          const h = hostCustom.replace(/^https?:\/\//i, '').split('/')[0];
          return `https://${h}/`;
        }
        if (typeof window.DFOPS_buildTenantPublicSiteUrl === 'function') {
          const url = window.DFOPS_buildTenantPublicSiteUrl(
            this.slug,
            window.location.hostname,
            window.DFOPS_normalizeHostname,
            this.theme,
          );
          if (url) return url;
        }
        const base = (cfg.appDomain || 'dfcms.pl').toLowerCase();
        return `https://${this.slug}.${base}/`;
      },

      /** `admin.html?dfcms_debug=1` — stan routingu / auth w konsoli i overlay. */
      publishPanelDebugState() {
        if (new URLSearchParams(window.location.search).get('dfcms_debug') !== '1') return;
        const host = window.location.hostname;
        const state = {
          host,
          deployEnv: window.DFOPS_DEPLOY_ENVIRONMENT,
          supabaseProject: (window.DFOPS_SUPABASE_URL || '').replace(/^https:\/\//, '').split('.')[0] || '—',
          tenantBase:
            typeof window.DFOPS_resolveTenantBaseFromHostname === 'function'
              ? window.DFOPS_resolveTenantBaseFromHostname(host, window.DFOPS_normalizeHostname)
              : '—',
          subdomainRouting:
            typeof window.DFOPS_tenantBaseUsesSubdomainRouting === 'function'
              ? window.DFOPS_tenantBaseUsesSubdomainRouting(
                  window.DFOPS_resolveTenantBaseFromHostname?.(host, window.DFOPS_normalizeHostname),
                )
              : null,
          slug: this.slug,
          theme: this.theme,
          showWizard: this.showWizard,
          showWelcomeModal: this.showWelcomeModal,
          welcomeOnboardingDone: this.content?.pl?.settings?.welcome_onboarding_completed === true,
          onboardingDone: this.content?.pl?.settings?.onboarding_completed === true,
          liveUrl: typeof this.getLiveSiteUrl === 'function' ? this.getLiveSiteUrl() : '—',
          previewUrl: typeof this.getPublicSiteUrl === 'function' ? this.getPublicSiteUrl() : '—',
          needsEmailConfirmation: this.needsEmailConfirmation,
          isEmailVerified: this.isEmailVerified,
          userId: this.user?.id || null,
          userEmail: typeof userEmailAddress === 'function' ? userEmailAddress(this.user) : this.user?.email || null,
          sessionEmailField: this.user?.email || null,
          emailConfirmedAt: this.user?.email_confirmed_at || this.user?.confirmed_at || null,
          adminBundle:
            document.querySelector('script[src*="adminApp.js"]')?.getAttribute('src') || '—',
        };
        this.panelDebugState = state;
        console.info('[DFCMS panel debug]', state);
        window.DFOPS_panelDebugState = () => ({ ...state });
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
        if (this.isImpersonating) return false;
        return this.hasActivePaidSubscription;
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
        const norm = normalizeAdminTabId(tab);
        this.activeTab = norm;
        this.sidebarOpen = false;
        this.mobileMenuOpen = false;
        replaceAdminUrlHashForTab(norm);
        this.maybeSyncSubscriptionTabFromStripe();
        if (norm === 'reviews') this.syncGoogleReviewsPlaceInputFromContent();
      },

      isSidebarNavActive(tab) {
        const t = this.activeTab;
        if (tab === 'reviews') return t === 'reviews' || t === 'google_reviews';
        if (tab === 'offer') return t === 'services' || t === 'menu';
        if (tab === 'about') return t === 'manifesto' || t === 'care_profile';
        if (tab === 'contact') return t === 'contact' || t === 'booking';
        return t === tab;
      },

      adminManifestoTabVisible() {
        return themeHasSection(this.theme, 'manifesto');
      },

      /** Czy grupa „Więcej treści” ma choć jedną pozycję (ukryj pusty akordeon, np. gastro). */
      navGroupMoreHasItems() {
        return (
          this.adminManifestoTabVisible() ||
          this.adminTabVisible('care_profile') ||
          this.adminTabVisible('trust') ||
          this.adminTabVisible('faq') ||
          this.adminTabVisible('google_reviews') ||
          this.adminTabVisible('reviews') ||
          this.adminTabVisible('schedule')
        );
      },

      /** Etykieta zakładki care_profile w menu — nie duplikuj „O nas” obok manifesto. */
      careProfileNavLabel() {
        return this.adminManifestoTabVisible() ? 'Gabinet i certyfikaty' : 'O nas';
      },

      /** Gdy zmieni się motyw (lub wczytano stronę), ukryte zakładki nie zostawiają pustego widoku. */
      ensureActiveTabForTheme() {
        const t = String(this.theme || '').trim();
        const tab = this.activeTab;
        if (tab === 'dashboard') return;
        if (tab === 'manifesto' && !themeHasSection(t, 'manifesto')) {
          this.setTab('dashboard');
          return;
        }
        if (tab === 'care_profile' && !adminTabVisibleForTheme(t, 'care_profile')) {
          this.setTab('dashboard');
          return;
        }
        if (tab === 'reviews') {
          if (!adminTabVisibleForTheme(t, 'google_reviews') && !adminTabVisibleForTheme(t, 'reviews')) {
            this.setTab('dashboard');
          }
          return;
        }
        if (tab === 'manifesto') return;
        if (!adminTabVisibleForTheme(t, tab) && tab !== 'settings' && tab !== 'seo' && tab !== 'legal' && tab !== 'account' && tab !== 'subscription') {
          this.setTab('dashboard');
        }
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

      isLocked() {
        return false;
      },

      presetSwatchColor(presetId) {
        return (cfg.accentByPreset && cfg.accentByPreset[presetId]) || '#a1a1aa';
      },

      /** Aktywny preset w panelu — gastro/care używają `color_palette`, pozostałe `color_preset`. */
      isColorPresetActive(preset) {
        if (!preset?.id || !this.content?.pl?.settings) return false;
        const s = this.content.pl.settings;
        const theme = this.showWizard ? this.wizardTheme || this.theme : this.theme;
        if (themeUsesColorPalette(theme)) {
          return (s.color_palette || s.color_preset) === preset.id;
        }
        return s.color_preset === preset.id;
      },

      selectColorPreset(preset) {
        if (!preset?.id || !this.content?.pl?.settings) return;
        this.content.pl.settings.color_preset = preset.id;
        if (themeUsesColorPalette(this.theme)) {
          this.content.pl.settings.color_palette = preset.id;
        }
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

      promptQuickChatUpgrade() {
        this.setTab('subscription');
      },

      onQuickChatInputGuard() {
        if (!this.isQuickChatLocked) return;
        if (this.content?.pl?.contact) {
          this.content.pl.contact.whatsapp = '';
          this.content.pl.contact.messenger = '';
        }
        this.promptQuickChatUpgrade();
      },

      enforceQuickChatForStarter() {
        if (!this.isQuickChatLocked || !this.content?.pl?.contact) return;
        this.content.pl.contact.whatsapp = '';
        this.content.pl.contact.messenger = '';
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

      get isPremiumDraftTheme() {
        const premium = Array.isArray(cfg?.premiumThemes) ? cfg.premiumThemes : [];
        return premium.includes(String(this.theme || '').trim());
      },
      /** Freemium: na darmowym planie (trial/Starter) premium motyw można edytować i podglądać, ale NIE publikować. */
      get isPublishBlockedByPlan() {
        return this.isPremiumDraftTheme && this.isCustomAppearanceLocked;
      },

      /** Po zmianie linku/trybu rezerwacji — normalizacja i cichy auto-save. */
  };
}
