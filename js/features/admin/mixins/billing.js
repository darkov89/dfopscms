function adminMixinBilling(ctx) {
  const {
    cfg,
    repo,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
  } = ctx;
  return {
      billingStripeStatusNormalized() {
        const sub = this.billingSubscriptionView;
        return typeof sub?.status === 'string' ? sub.status.trim().toLowerCase() : '';
      },
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
      closeSuccessModal() {
        this.showSuccessModal = false;
      },

      /** Stripe Customer Portal (anulacja / metoda płatności) — Edge Function `create-portal-session`. */
      openStripeCustomerPortal() {
        return this.openCustomerPortal();
      },

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
          if (!data || data.ok !== true) {
            if (!silent) {
              this.showToast('Nieoczekiwana odpowiedź synchronizacji Stripe. Sprawdź konsolę (DFCMS).', 'error');
            }
            console.warn('[DFCMS] sync-stripe unexpected response', data);
            return false;
          }
          this._loadDataSubscriptionStripeSync = true;
          try {
            await this.loadData();
          } finally {
            this._loadDataSubscriptionStripeSync = false;
          }
          this.syncUserPlanFromBilling();
          const paidAfter = this.hasActivePaidSubscription;
          const planAfter = this.subscriptionPlan;
          if (!paidAfter && planAfter === 'trial') {
            console.warn('[DFCMS] sync OK, panel nadal trial', {
              stripe_status: data.stripe_status,
              subscription_id: data.subscription_id,
              pageBillingPlan: this.pageBillingPlan,
              billingProfile: this.billingProfile
                ? {
                    plan: this.billingProfile.plan,
                    status: this.billingProfile.status,
                    stripe_subscription_id: this.billingProfile.stripe_subscription_id,
                  }
                : null,
            });
            if (!silent) {
              this.showToast(
                'Stripe zsynchronizowany, ale panel nie widzi opłaconego planu. Sprawdź billing_profiles (plan + status) dla tego user_id.',
                'error',
              );
            }
            return false;
          }
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
          console.warn('[DFCMS] loadBillingProfile:', error.message || error, { userId: this.user?.id });
          this.billingProfile = null;
          return;
        }
        this.billingProfile = data || null;
        if (!data && this.user?.id) {
          console.info('[DFCMS] loadBillingProfile: brak wiersza billing_profiles', { userId: this.user.id });
        }
      },

      clearCheckoutTurnstile() {
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
      },
      closeCheckoutModal(force = false) {
        if (this.checkoutLoading && !force) return;
        this.showCheckoutModal = false;
        this.pendingCheckoutPlan = '';
        this.pendingCheckoutPlanType = '';
        this.pendingCheckoutTier = '';
        this.pendingCheckoutInterval = '';
        this.clearCheckoutTurnstile();
      },
      renderCheckoutTurnstile(attempt = 0) {
        if (!this.showCheckoutModal) return;
        const sitekey = cfg?.turnstileSiteKey;
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
      },
      async subscribe(planType) {
        if (this.isImpersonating) {
          this.showToast('W trybie God Mode płatności klienta nie są obsługiwane z sesji superadmina.', 'error');
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
          this.showToast(
            'Zmianę pakietu wykonasz w portalu Stripe — zobaczysz podsumowanie kosztów i potwierdzisz płatność przed obciążeniem karty.',
            'info',
          );
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
      },
      async executeStripeCheckout(turnstileToken) {
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
            if (planType === 'starter' && typeof window.DFOPS_trackEvent === 'function') {
              window.DFOPS_trackEvent('starter_checkout_started', { slug: this.slug });
            }
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
      },
  };
}
