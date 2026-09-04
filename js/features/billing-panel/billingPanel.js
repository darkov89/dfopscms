// Billing panel — checkout Stripe, Customer Portal, sync, trial modal, toasty powrotu.
// Jedyny punkt wejścia do kernela: window.DFOPS_attachBillingPanel(app) — TYLKO metody
// (named function, nie arrow). Pola (checkoutLoading, turnstileWidgetId, billingProfile, …)
// i gettery planu/trial/locków zostają w createAdminApp().
// SoT: docs/specs/admin-split.md §5. Wzorzec attach: js/features/onboarding/onboardingPanel.js
// (metody + onAfterLoadData; bez nowych pól, bez wrapu loadData).
//
// HTML (admin/partials): hasStripeBillingCustomer / subscriptionPaymentActive /
// shouldUseStripePortalForPlanChange — brak wiązań; canOpenPortalPlanChangeFlow() z ().
// Te cztery zostają na kernelu (metody-aliasy / cienkie helpery nad getterami).
;(function () {
  const IMPERSONATE_BILLING_BLOCKED =
    'W trybie God Mode rozliczenia klienta są tylko do odczytu. Portal Stripe (karta, faktury) i Checkout są zablokowane — to sesja superadmina, nie klienta.';

  function impersonationBlocksBilling(app) {
    return !!(app && app.isImpersonating);
  }

  window.DFOPS_attachBillingPanel = function attachBillingPanel(app) {
    if (!app || typeof app !== 'object') return;

    app.loadBillingProfile = async function loadBillingProfile() {
      if (!this.supabase) {
        this.billingProfile = null;
        return;
      }
      // Impersonacja: profil właściciela strony (read-only). Checkout i tak zablokowany.
      const ownerId = this.isImpersonating
        ? this.impersonatedPageOwnerId
        : this.user?.id;
      if (!ownerId) {
        this.billingProfile = null;
        return;
      }
      const { data, error } = await this.supabase
        .from('billing_profiles')
        .select('*')
        .eq('user_id', ownerId)
        .maybeSingle();
      if (error) {
        console.warn('[DFCMS] loadBillingProfile:', error.message || error);
        this.billingProfile = null;
        return;
      }
      this.billingProfile = data || null;
    };

    /**
     * Edge Function sync-stripe-subscription — naprawia opóźniony webhook.
     * @param {{ silent?: boolean }} opts — `silent: true` bez toastów (retry po checkout).
     */
    app.syncStripeSubscription = async function syncStripeSubscription(opts) {
      const options = opts && typeof opts === 'object' ? opts : {};
      const silent = options.silent === true;
      if (impersonationBlocksBilling(this)) {
        if (!silent) this.showToast(IMPERSONATE_BILLING_BLOCKED, 'error');
        return false;
      }
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
    };

    app.syncUserPlanFromBilling = function syncUserPlanFromBilling() {
      const p = this.subscriptionPlan;
      if (p === 'tier1' || p === 'tier2') this.userPlan = 'standard';
      else this.userPlan = 'starter';
    };

    app.subscribe = async function subscribe(planType) {
      if (impersonationBlocksBilling(this)) {
        this.showToast(IMPERSONATE_BILLING_BLOCKED, 'error');
        return;
      }
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
        await this.openCustomerPortal({ subscriptionUpdate: true });
        return;
      }

      this.pendingCheckoutPlan = plan;
      this.pendingCheckoutPlanType = planType;
      this.pendingCheckoutTier = tier;
      this.pendingCheckoutInterval = interval;
      this.turnstileToken = '';
      this.showCheckoutModal = true;
      this.$nextTick(() => {
        this.renderCheckoutTurnstile();
      });
    };

    app.executeStripeCheckout = async function executeStripeCheckout(turnstileToken) {
      if (impersonationBlocksBilling(this)) {
        this.showToast(IMPERSONATE_BILLING_BLOCKED, 'error');
        this.closeCheckoutModal(true);
        return;
      }
      const plan = String(this.pendingCheckoutPlan || '').trim();
      const planType = String(this.pendingCheckoutPlanType || plan).trim();
      const tier = String(this.pendingCheckoutTier || '').trim();
      const interval = this.pendingCheckoutInterval === 'yearly' ? 'yearly' : 'monthly';

      if (!plan || !tier || (plan !== 'starter' && plan !== 'standard')) {
        this.showToast('Nieprawidłowy plan płatności. Wybierz pakiet jeszcze raz.', 'error');
        this.closeCheckoutModal();
        return;
      }
      if (!turnstileToken) {
        this.showToast('Potwierdź, że nie jesteś botem, a potem ponów płatność.', 'error');
        return;
      }
      if (!this.user?.id) {
        this.showToast('Zaloguj się, aby wykupić subskrypcję.', 'error');
        this.closeCheckoutModal();
        return;
      }
      if (!this.content?.pl?.settings) {
        this.showToast('Nie udało się odczytać ustawień strony. Odśwież panel i spróbuj ponownie.', 'error');
        this.closeCheckoutModal(true);
        return;
      }

      this.checkoutLoading = true;
      if (!this.content.pl.settings.subscription) {
        this.content.pl.settings.subscription = { plan: 'trial', trial_started_at: new Date().toISOString() };
      }
      this.content.pl.settings.subscription.selected_plan = tier;
      const saved = await this.saveData({ silentSuccess: true });
      if (!saved) {
        this.checkoutLoading = false;
        this.closeCheckoutModal(true);
        return;
      }

      const { data: sessionData } = await this.supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        this.showToast('Błąd sesji. Wyloguj się i zaloguj ponownie.', 'error');
        this.checkoutLoading = false;
        this.closeCheckoutModal(true);
        return;
      }
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
              turnstileToken,
            },
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        if (error) {
          const detail =
            (data && typeof data.error === 'string' && data.error) ||
            (typeof error.message === 'string' && error.message) ||
            'Błąd podczas łączenia z systemem płatności.';
          throw new Error(detail);
        }
        const url = data && typeof data.url === 'string' ? data.url : '';
        if (url) {
          this.showCheckoutModal = false;
          this.clearCheckoutTurnstile();
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
        this.clearCheckoutTurnstile();
        const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : '';
        if (msg.includes('HAS_STRIPE_SUBSCRIPTION') || /subskrypcję Stripe/i.test(msg)) {
          this.showToast(
            'Masz już subskrypcję — użyj zmiany planu w panelu albo portalu płatności.',
            'error',
          );
        } else {
          this.showToast(msg || 'Błąd podczas łączenia z systemem płatności.', 'error');
        }
        this.closeCheckoutModal(true);
      } finally {
        this.checkoutLoading = false;
      }
    };

    app.renderCheckoutTurnstile = function renderCheckoutTurnstile(attempt = 0) {
      if (!this.showCheckoutModal) return;
      const cfg = window.DFOPS_CONFIG || {};
      const sitekey = cfg.turnstileSiteKey;
      const container = document.getElementById('turnstile-checkout-container');
      const turnstile = window.turnstile;
      const ready = sitekey && container && turnstile && typeof turnstile.render === 'function';

      if (!ready) {
        if (attempt < 30) {
          window.setTimeout(() => this.renderCheckoutTurnstile(attempt + 1), 150);
        } else {
          this.showToast('Nie udało się załadować weryfikacji płatności. Odśwież stronę i spróbuj ponownie.', 'error');
          this.closeCheckoutModal();
        }
        return;
      }

      this.clearCheckoutTurnstile();
      try {
        this.turnstileWidgetId = turnstile.render('#turnstile-checkout-container', {
          sitekey,
          callback: (token) => {
            const value = typeof token === 'string' ? token.trim() : '';
            if (!value || this.checkoutLoading) return;
            this.turnstileToken = value;
            void this.executeStripeCheckout(value);
          },
          'expired-callback': () => {
            this.turnstileToken = '';
          },
          'error-callback': () => {
            this.turnstileToken = '';
            this.showToast('Weryfikacja nie powiodła się. Spróbuj ponownie.', 'error');
          },
        });
      } catch (e) {
        console.warn('Turnstile render failed', e);
        this.showToast('Nie udało się uruchomić weryfikacji płatności.', 'error');
        this.closeCheckoutModal();
      }
    };

    app.clearCheckoutTurnstile = function clearCheckoutTurnstile() {
      this.turnstileToken = '';
      const turnstile = window.turnstile;
      if (turnstile && typeof turnstile.remove === 'function') {
        try {
          if (this.turnstileWidgetId !== null) turnstile.remove(this.turnstileWidgetId);
          else turnstile.remove('#turnstile-checkout-container');
        } catch (e) {
          /* ignore */
        }
      }
      this.turnstileWidgetId = null;
      const container = document.getElementById('turnstile-checkout-container');
      if (container) container.innerHTML = '';
    };

    app.closeCheckoutModal = function closeCheckoutModal(force = false) {
      if (this.checkoutLoading && !force) return;
      this.showCheckoutModal = false;
      this.pendingCheckoutPlan = '';
      this.pendingCheckoutPlanType = '';
      this.pendingCheckoutTier = '';
      this.pendingCheckoutInterval = '';
      this.clearCheckoutTurnstile();
    };

    /**
     * @param {{ subscriptionUpdate?: boolean, subscriptionCancel?: boolean }} [opts]
     *   subscriptionUpdate — deep link: zmiana planu (upgrade/downgrade).
     *   subscriptionCancel — deep link: anulowanie subskrypcji w Stripe.
     */
    app.openCustomerPortal = async function openCustomerPortal(opts = {}) {
      if (impersonationBlocksBilling(this)) {
        this.showToast(IMPERSONATE_BILLING_BLOCKED, 'error');
        return;
      }
      if (!this.supabase) {
        this.showToast('Brak połączenia z serwisem. Odśwież stronę.', 'error');
        return;
      }
      if (opts.subscriptionUpdate && typeof this.confirmAsync === 'function') {
        const t = this.activePaidTierForUi;
        const when = this.subscriptionRenewalDateFormatted;
        const whenLabel = when && when !== '—' ? when : 'końca opłaconego okresu';
        let confirmed = true;
        if (t === 'tier1' || t === 'tier2') {
          confirmed = await this.confirmAsync({
            title: 'Obniżyć plan do Starter?',
            message:
              'Starter zacznie obowiązywać od ' +
              whenLabel +
              ' (następny okres rozliczeniowy). Do tej daty zostajesz na Standard — własna domena i pełna paleta bez zmian. W portalu Stripe potwierdzisz zmianę.',
            yesLabel: 'Przejdź do Stripe',
            noLabel: 'Anuluj',
          });
        } else if (t === 'tier0') {
          confirmed = await this.confirmAsync({
            title: 'Podnieść plan do Standard?',
            message:
              'Po potwierdzeniu w Stripe Standard zwykle włączamy od razu (dopłata proporcjonalna za pozostałe dni okresu). Szczegóły i kwotę zobaczysz w portalu przed obciążeniem karty.',
            yesLabel: 'Przejdź do Stripe',
            noLabel: 'Anuluj',
          });
        }
        if (!confirmed) return;
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
    };

    /** Stripe Customer Portal (anulacja / metoda płatności) — Edge Function `create-portal-session`. */
    app.openStripeCustomerPortal = function openStripeCustomerPortal() {
      return this.openCustomerPortal();
    };

    /**
     * Po ?payment=success czekamy na webhook Stripe, potem ponownie loadData (świeży content + trial_blocked_at).
     * Zwraca true, jeśli zaplanowano opóźnione odświeżenie (pierwsze loadData nie wołamy od razu).
     */
    app.schedulePostPaymentDataRefresh = function schedulePostPaymentDataRefresh() {
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
              this.subscriptionActivationBanner = true;
              this.setTab('subscription');
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
    };

    /**
     * Po powrocie z portalu Stripe (`?billing=return`) — sync + loadData + toast o zaktualizowanym planie.
     */
    app.schedulePostPortalBillingRefresh = function schedulePostPortalBillingRefresh() {
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
            this.showToast(
              'Status subskrypcji odświeżony. Jeśli obniżyłeś pakiet, nowy plan zaczyna obowiązywać od końca opłaconego okresu.',
              'success',
            );
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
    };

    app.maybeShowPaymentReturnToast = function maybeShowPaymentReturnToast() {
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
    };

    /** Jednorazowy toast po pełnym wczytaniu billing_profiles (bez duplikatu przy drugim loadData). */
    app.maybeShowBillingStatusToastOnce = function maybeShowBillingStatusToastOnce() {
      if (this._billingStatusToastShown || !this.billingProfileReady || !this.user) return;
      if (this.isImpersonating) return;
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
    };

    /**
     * Wejście w zakładkę Subskrypcja NIE odpala już automatycznego synca ze Stripe.
     * Wcześniej powodowało to drugie `loadData()` (podwójne ładowanie panelu). Status pokazujemy
     * z `billing_profiles` (loadData), a aktualizację ze Stripe użytkownik uruchamia ręcznie
     * przyciskiem „Synchronizuj ze Stripe”. Metoda zostaje (call-site’y bez zmian) jako no-op.
     */
    app.maybeSyncSubscriptionTabFromStripe = function maybeSyncSubscriptionTabFromStripe() {
      /* celowo pusto — patrz docstring (manualny sync zamiast auto). */
    };

    app.dismissTrialSuspendedModal = function dismissTrialSuspendedModal() {
      this.showTrialSuspendedModal = false;
      if (!this.slug) return;
      try {
        sessionStorage.setItem('dfops_trial_suspended_dismissed:' + this.slug, '1');
      } catch (_) {
        /* ignore */
      }
    };

    app.syncTrialSuspendedModalVisibility = function syncTrialSuspendedModalVisibility() {
      if (!this.isTrialPublicBlocked) {
        this.showTrialSuspendedModal = false;
        if (this.slug) {
          try {
            sessionStorage.removeItem('dfops_trial_suspended_dismissed:' + this.slug);
          } catch (_) {
            /* ignore */
          }
        }
        return;
      }
      let dismissed = false;
      if (this.slug) {
        try {
          dismissed = sessionStorage.getItem('dfops_trial_suspended_dismissed:' + this.slug) === '1';
        } catch (_) {
          dismissed = false;
        }
      }
      this.showTrialSuspendedModal = !dismissed;
    };

    app.dismissSubscriptionActivationBanner = function dismissSubscriptionActivationBanner() {
      this.subscriptionActivationBanner = false;
    };

    // Lifecycle — rejestr kernela. Zakaz owijania loadData.
    // loadBillingProfile / syncUserPlanFromBilling / syncTrialSuspendedModalVisibility zostają
    // wywołaniami w kernelowym loadData (kolejność przed getterami, enforce* i onboardingiem).
    // Tu tylko toasty, które siedziały w finally po billingProfileReady.
    if (typeof app.onAfterLoadData === 'function') {
      app.onAfterLoadData(function billingAfterLoad() {
        if (this.user && this.billingProfileReady) {
          this.maybeShowPaymentReturnToast();
          this.maybeShowBillingStatusToastOnce();
        }
      });
    }
  };
})();
