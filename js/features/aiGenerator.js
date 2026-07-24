// AI Site Generator — wiązanie Alpine (stan + metody).
// Jedyny punkt wejścia do monolitu: window.DFOPS_attachAiGenerator(app)
// wywoływany w buildAdminAlpineState() (js/features/adminApp.js).
;(function () {
  function safeDebug(scope, err) {
    if (typeof console !== 'undefined' && console.debug) console.debug(`[DFOPS aiGenerator] ${scope}`, err);
  }

  async function parseInvokeError(error, data) {
    if (data && data.success === false && data.message) {
      return { code: data.code || 'INTERNAL', message: String(data.message) };
    }
    if (error && error.context && typeof error.context.json === 'function') {
      try {
        const body = await error.context.json();
        if (body && body.message) {
          return { code: body.code || 'INTERNAL', message: String(body.message) };
        }
      } catch (e) {
        safeDebug('parseInvokeError', e);
      }
    }
    const msg = error && error.message ? String(error.message) : 'Nie udało się wygenerować treści.';
    return { code: 'INTERNAL', message: msg };
  }

  window.DFOPS_attachAiGenerator = function attachAiGenerator(app) {
    if (!app || typeof app !== 'object') return;

    app.aiPrompt = '';
    app.isGeneratingAi = false;
    app.aiModalOpen = false;
    app.aiRemaining = null;
    app.aiLimit = null;
    app.aiMode = 'generate'; // generate | adapt

    app.canUseAiGenerator = function canUseAiGenerator() {
      if (this.isImpersonating) return true;
      const plan = this.subscriptionPlan || 'trial';
      if (typeof window.DFOPS_planAllowsAiGenerator === 'function') {
        return window.DFOPS_planAllowsAiGenerator(plan);
      }
      return false;
    };

    app.aiGeneratorLimit = function aiGeneratorLimit() {
      if (this.isImpersonating) return null;
      const plan = this.subscriptionPlan || 'trial';
      if (typeof window.DFOPS_aiGeneratorMonthlyLimit === 'function') {
        return window.DFOPS_aiGeneratorMonthlyLimit(plan);
      }
      return 0;
    };

    app.openAiGeneratorModal = function openAiGeneratorModal(mode) {
      if (!this.canUseAiGenerator()) {
        this.showToast(
          'Generator AI jest dostępny na planach Starter i Standard. Przejdź do Subskrypcji, aby wybrać pakiet.',
          'info',
        );
        if (typeof this.setTab === 'function') this.setTab('subscription');
        return;
      }
      if (!this.pageId) {
        this.showToast('Brak aktywnej strony.', 'error');
        return;
      }
      const theme = String(this.theme || '').trim().toLowerCase();
      if (!theme || theme === 'setup') {
        this.showToast('Najpierw wybierz szablon branżowy w kreatorze lub w ustawieniach.', 'info');
        return;
      }
      this.aiMode = mode === 'adapt' ? 'adapt' : 'generate';
      if (this.aiMode === 'adapt') {
        const loc = this.editLocale || 'pl';
        const def = typeof this.i18nDefaultLocale === 'function' ? this.i18nDefaultLocale() : 'pl';
        if (loc === def) {
          this.showToast('Zlokalizuj działa dla dodatkowego języka (EN/DE). Przełącz język edycji.', 'info');
          return;
        }
      }
      this.aiModalOpen = true;
    };

    app.closeAiGeneratorModal = function closeAiGeneratorModal() {
      if (this.isGeneratingAi) return;
      this.aiModalOpen = false;
    };

    app.generateSiteWithAi = async function generateSiteWithAi() {
      if (this.isGeneratingAi) return;
      if (!this.canUseAiGenerator()) {
        this.showToast('Generator AI wymaga aktywnego pakietu Starter lub Standard.', 'error');
        return;
      }
      const mode = this.aiMode === 'adapt' ? 'adapt' : 'generate';
      const prompt = String(this.aiPrompt || '').trim();
      if (mode === 'generate' && prompt.length < 10) {
        this.showToast('Opisz swój biznes w kilku zdaniach (min. 10 znaków).', 'error');
        return;
      }
      if (!this.pageId || !this.supabase) {
        this.showToast('Brak połączenia z serwisem. Odśwież stronę.', 'error');
        return;
      }

      const locale = this.editLocale || 'pl';
      const sourceLocale =
        typeof this.i18nDefaultLocale === 'function' ? this.i18nDefaultLocale() : 'pl';

      const ok = await this.confirmAsync({
        title: mode === 'adapt' ? 'Zlokalizować treść?' : 'Nadpisać treść roboczą?',
        message:
          mode === 'adapt'
            ? 'AI zaadaptuje copy z języka źródłowego do języka edycji w wersji roboczej. LIVE bez zmian do publikacji.'
            : 'AI uzupełni teksty w wersji roboczej (draft) dla aktywnego języka. Opublikowana strona LIVE się nie zmieni, dopóki nie klikniesz „Opublikuj zmiany”.',
        yesLabel: mode === 'adapt' ? 'Zlokalizuj' : 'Generuj',
        noLabel: 'Anuluj',
        tone: 'default',
      });
      if (!ok) return;

      this.isGeneratingAi = true;
      this._suppressContentWatch = true;
      if (this._draftAutosaveTimer) {
        clearTimeout(this._draftAutosaveTimer);
        this._draftAutosaveTimer = null;
      }
      try {
        // Edge czyta draft z DB — najpierw dopchnij lokalne edycje (1×, bez pętli watch)
        if (typeof this._persistDraft === 'function') {
          await this._persistDraft({ silent: true });
        }
        this._suppressContentWatch = true;

        const {
          data: { session },
        } = await this.supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          this.showToast('Sesja wygasła — zaloguj się ponownie.', 'error');
          return;
        }

        const { data, error } = await this.supabase.functions.invoke('generate-ai-content', {
          body: {
            pageId: this.pageId,
            prompt: mode === 'adapt' ? prompt || '' : prompt,
            theme: String(this.theme || '').trim().toLowerCase(),
            locale,
            mode,
            sourceLocale,
          },
          headers: { Authorization: `Bearer ${token}` },
        });

        if (error || !data?.success) {
          const parsed = await parseInvokeError(error, data);
          this.showToast(parsed.message, 'error');
          return;
        }

        if (data.draft_content && typeof data.draft_content === 'object') {
          this._suppressContentWatch = true;
          this.content = data.draft_content;
          if (typeof this.i18nAfterContentLoad === 'function') {
            this.i18nAfterContentLoad();
            if (locale && typeof this.setEditLocale === 'function') {
              this.setEditLocale(locale);
            }
          }
        }
        const remaining = typeof data.remaining === 'number' ? data.remaining : null;
        const limit = typeof data.limit === 'number' ? data.limit : this.aiGeneratorLimit();
        this.aiRemaining = remaining;
        this.aiLimit = limit;

        this.aiModalOpen = false;
        this.aiPrompt = '';

        let toastMsg =
          mode === 'adapt'
            ? 'AI zlokalizowało treść! Sprawdź podgląd i opublikuj.'
            : 'AI wygenerowało nową treść! Sprawdź podgląd i opublikuj zmiany.';
        if (remaining != null && limit != null) {
          toastMsg += ` Zostało ${remaining} z ${limit} generacji w tym miesiącu.`;
        }
        this.showToast(toastMsg, 'success');
      } catch (e) {
        safeDebug('generateSiteWithAi', e);
        this.showToast('Nie udało się wygenerować treści. Spróbuj ponownie.', 'error');
      } finally {
        this.isGeneratingAi = false;
        setTimeout(() => {
          this._suppressContentWatch = false;
        }, 0);
      }
    };
  };
})();
