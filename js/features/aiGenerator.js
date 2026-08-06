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

  function setByPath(root, path, value) {
    const parts = String(path || '').split('.');
    if (!parts.length || !root) return false;
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const nextKey = parts[i + 1];
      const nextIsIndex = /^\d+$/.test(nextKey);
      if (Array.isArray(cur)) {
        const idx = Number(key);
        if (!Number.isFinite(idx)) return false;
        if (!cur[idx] || typeof cur[idx] !== 'object') cur[idx] = nextIsIndex ? [] : {};
        cur = cur[idx];
      } else if (cur && typeof cur === 'object') {
        if (!(key in cur) || cur[key] == null) cur[key] = nextIsIndex ? [] : {};
        cur = cur[key];
      } else {
        return false;
      }
    }
    const last = parts[parts.length - 1];
    if (Array.isArray(cur) && /^\d+$/.test(last)) {
      cur[Number(last)] = value;
      return true;
    }
    if (cur && typeof cur === 'object') {
      cur[last] = value;
      return true;
    }
    return false;
  }

  function resolveAiTheme(self) {
    return String(self.wizardTheme || self.theme || '')
      .trim()
      .toLowerCase();
  }

  window.DFOPS_attachAiGenerator = function attachAiGenerator(app) {
    if (!app || typeof app !== 'object') return;

    app.aiPrompt = '';
    app.isGeneratingAi = false;
    app.aiGeneratingField = '';
    app.aiProgressLabel = '';
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
      const theme = resolveAiTheme(this);
      if (!theme || theme === 'setup') {
        this.showToast('Najpierw wybierz szablon branżowy w kreatorze lub w ustawieniach.', 'info');
        return;
      }
      this.aiMode = mode === 'adapt' ? 'adapt' : 'generate';
      if (this.aiMode === 'adapt') {
        const loc = this.editLocale || 'pl';
        const def = typeof this.i18nDefaultLocale === 'function' ? this.i18nDefaultLocale() : 'pl';
        if (loc === def) {
          this.showToast(
            'Najpierw przełącz język edycji na English lub Deutsch (górny pasek), potem tłumacz.',
            'info',
          );
          return;
        }
      }
      this.aiPrompt = '';
      this.aiModalOpen = true;
    };

    app.closeAiGeneratorModal = function closeAiGeneratorModal() {
      if (this.isGeneratingAi) return;
      this.aiModalOpen = false;
    };

    /** Generuj pojedyncze pole (kreator / panel) — mode: field. */
    app.generateFieldWithAi = async function generateFieldWithAi(targetPath, hint) {
      if (this.isGeneratingAi) return;
      if (!this.canUseAiGenerator()) {
        this.showToast(
          'Generowanie AI jest dostępne na planach Starter i Standard. Przejdź do Subskrypcji.',
          'info',
        );
        if (typeof this.setTab === 'function') this.setTab('subscription');
        return;
      }
      const path = String(targetPath || '').trim();
      if (!path) return;
      if (!this.pageId || !this.supabase) {
        this.showToast('Brak połączenia z serwisem. Odśwież stronę.', 'error');
        return;
      }
      const theme = resolveAiTheme(this);
      if (!theme || theme === 'setup') {
        this.showToast('Najpierw wybierz szablon branżowy.', 'info');
        return;
      }

      this.isGeneratingAi = true;
      this.aiProgressLabel = 'Generuję tekst…';
      this.aiGeneratingField = path;
      this._suppressContentWatch = true;
      if (this._draftAutosaveTimer) {
        clearTimeout(this._draftAutosaveTimer);
        this._draftAutosaveTimer = null;
      }
      try {
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

        const locale = this.editLocale || 'pl';
        const { data, error } = await this.supabase.functions.invoke('generate-ai-content', {
          body: {
            pageId: this.pageId,
            prompt: String(hint || '').trim(),
            theme,
            locale,
            mode: 'field',
            targetPath: path,
          },
          headers: { Authorization: `Bearer ${token}` },
        });

        if (error || !data?.success) {
          const parsed = await parseInvokeError(error, data);
          this.showToast(parsed.message, 'error');
          return;
        }

        const value =
          typeof data.value === 'string'
            ? data.value
            : data.draft_content && this.content
              ? null
              : '';

        if (data.draft_content && typeof data.draft_content === 'object') {
          this._suppressContentWatch = true;
          this.content =
            typeof window.DFOPS_normalizeContent === 'function'
              ? window.DFOPS_normalizeContent(data.draft_content, theme)
              : data.draft_content;
          if (typeof this.i18nAfterContentLoad === 'function') {
            this.i18nAfterContentLoad();
            if (locale && typeof this.setEditLocale === 'function') {
              this.setEditLocale(locale);
            }
          }
        } else if (value != null && this.content?.pl) {
          setByPath(this.content.pl, path, value);
        }

        if (typeof data.remaining === 'number') this.aiRemaining = data.remaining;
        if (typeof data.limit === 'number') this.aiLimit = data.limit;
        this.showToast('Wygenerowano tekst AI — możesz go edytować.', 'success');
        if (typeof this.markLocaleCopyDirty === 'function') this.markLocaleCopyDirty();
      } catch (e) {
        safeDebug('generateFieldWithAi', e);
        this.showToast('Nie udało się wygenerować tekstu. Spróbuj ponownie.', 'error');
      } finally {
        this.isGeneratingAi = false;
        this.aiGeneratingField = '';
        this.aiProgressLabel = '';
        setTimeout(() => {
          this._suppressContentWatch = false;
        }, 0);
      }
    };

    /** Adaptuj locale źródłowe → docelowe (bez modala). Używane przy włączaniu języka / sync. */
    app.adaptLocaleWithAi = async function adaptLocaleWithAi(targetLocale, opts) {
      const options = opts && typeof opts === 'object' ? opts : {};
      const silent = options.silent === true;
      const extraPrompt = String(options.prompt || '').trim();
      if (this.isGeneratingAi) {
        if (!silent) this.showToast('AI już pracuje — poczekaj na zakończenie.', 'info');
        return false;
      }
      if (!this.canUseAiGenerator()) {
        if (!silent) {
          this.showToast('Tłumaczenie AI wymaga planu Starter lub Standard.', 'info');
          if (typeof this.setTab === 'function') this.setTab('subscription');
        }
        return false;
      }
      const locale = String(targetLocale || '')
        .trim()
        .toLowerCase();
      const sourceLocale =
        typeof this.i18nDefaultLocale === 'function' ? this.i18nDefaultLocale() : 'pl';
      const localeLabel =
        typeof this.i18nLocaleLabel === 'function' ? this.i18nLocaleLabel(locale) : locale;
      if (!locale || locale === sourceLocale) {
        if (!silent) this.showToast('Wybierz dodatkowy język (English / Deutsch).', 'info');
        return false;
      }
      if (!this.pageId || !this.supabase) {
        if (!silent) this.showToast('Brak połączenia z serwisem. Odśwież stronę.', 'error');
        return false;
      }

      const theme = resolveAiTheme(this);
      if (!theme || theme === 'setup') {
        if (!silent) {
          this.showToast('Najpierw wybierz szablon branżowy w kreatorze lub w ustawieniach.', 'info');
        }
        return false;
      }

      this.isGeneratingAi = true;
      this.aiProgressLabel = 'Tłumaczę na ' + localeLabel + '… To zwykle trwa 15–40 sekund.';
      this._suppressContentWatch = true;
      if (this._draftAutosaveTimer) {
        clearTimeout(this._draftAutosaveTimer);
        this._draftAutosaveTimer = null;
      }
      try {
        if (typeof this._persistDraft === 'function') {
          await this._persistDraft({ silent: true });
        }
        this._suppressContentWatch = true;

        const {
          data: { session },
        } = await this.supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          if (!silent) this.showToast('Sesja wygasła — zaloguj się ponownie.', 'error');
          return false;
        }

        const { data, error } = await this.supabase.functions.invoke('generate-ai-content', {
          body: {
            pageId: this.pageId,
            prompt: extraPrompt,
            theme,
            locale,
            mode: 'adapt',
            sourceLocale,
          },
          headers: { Authorization: `Bearer ${token}` },
        });

        if (error || !data?.success) {
          const parsed = await parseInvokeError(error, data);
          if (!silent) this.showToast(parsed.message, 'error');
          return false;
        }

        if (data.draft_content && typeof data.draft_content === 'object') {
          this._suppressContentWatch = true;
          this.content =
            typeof window.DFOPS_normalizeContent === 'function'
              ? window.DFOPS_normalizeContent(data.draft_content, theme)
              : data.draft_content;
          if (typeof this.i18nAfterContentLoad === 'function') {
            this.i18nAfterContentLoad();
            if (typeof this.setEditLocale === 'function') await this.setEditLocale(locale);
          }
        }
        if (typeof data.remaining === 'number') this.aiRemaining = data.remaining;
        if (typeof data.limit === 'number') this.aiLimit = data.limit;
        if (!silent) {
          this.showToast(
            'Gotowe — strona ma wersję ' +
              localeLabel +
              '. Sprawdź Podgląd, potem kliknij Opublikuj zmiany.',
            'success',
          );
        }
        if (typeof this.clearLocaleCopyDirty === 'function') this.clearLocaleCopyDirty();
        return true;
      } catch (e) {
        safeDebug('adaptLocaleWithAi', e);
        if (!silent) this.showToast('Nie udało się przetłumaczyć. Spróbuj ponownie.', 'error');
        return false;
      } finally {
        this.isGeneratingAi = false;
        this.aiProgressLabel = '';
        setTimeout(() => {
          this._suppressContentWatch = false;
        }, 0);
      }
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

      const theme = resolveAiTheme(this);
      if (!theme || theme === 'setup') {
        this.showToast('Najpierw wybierz szablon branżowy w kreatorze lub w ustawieniach.', 'info');
        return;
      }

      const locale = this.editLocale || 'pl';
      const sourceLocale =
        typeof this.i18nDefaultLocale === 'function' ? this.i18nDefaultLocale() : 'pl';
      const localeLabel =
        typeof this.i18nLocaleLabel === 'function' ? this.i18nLocaleLabel(locale) : locale;

      if (mode === 'adapt' && locale === sourceLocale) {
        this.showToast('Przełącz język edycji na English lub Deutsch, potem tłumacz.', 'info');
        return;
      }

      // Adapt: bez drugiego confirm — user już kliknął CTA w modalu (pusty prompt OK).
      if (mode === 'generate') {
        const ok = await this.confirmAsync({
          title: 'Nadpisać treść roboczą?',
          message:
            'AI uzupełni teksty w wersji roboczej (draft) dla aktywnego języka. Opublikowana strona LIVE się nie zmieni, dopóki nie klikniesz „Opublikuj zmiany”.',
          yesLabel: 'Generuj',
          noLabel: 'Anuluj',
          tone: 'default',
        });
        if (!ok) return;
      }

      this.isGeneratingAi = true;
      this.aiProgressLabel =
        mode === 'adapt'
          ? 'Tłumaczę na ' + localeLabel + '… To zwykle trwa 15–40 sekund.'
          : 'Generuję teksty AI…';
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
            theme,
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
          // Normalizacja jak po loadData — pełne pola admina + tablica services zawsze obecna.
          this.content =
            typeof window.DFOPS_normalizeContent === 'function'
              ? window.DFOPS_normalizeContent(data.draft_content, theme)
              : data.draft_content;
          if (typeof this.i18nAfterContentLoad === 'function') {
            this.i18nAfterContentLoad();
            if (locale && typeof this.setEditLocale === 'function') {
              await this.setEditLocale(locale);
            }
          }
          // Upewnij się, że usługi są tablicą (x-for w zakładce Oferta).
          const pl = this.content && this.content.pl;
          if (pl && !Array.isArray(pl.services)) pl.services = [];
          if (
            pl &&
            pl.settings &&
            Array.isArray(pl.services) &&
            pl.services.some((s) => s && String(s.title || '').trim())
          ) {
            pl.settings.showServices = true;
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
            ? 'Gotowe — treść przetłumaczona na ' +
              localeLabel +
              '. Sprawdź Podgląd, potem Opublikuj zmiany.'
            : 'AI wygenerowało teksty w polach panelu (oferta, baner, FAQ…). Sprawdź zakładkę „Twoja oferta i ceny” i opublikuj.';
        if (remaining != null && limit != null) {
          toastMsg += ` Zostało ${remaining} z ${limit} generacji w tym miesiącu.`;
        }
        this.showToast(toastMsg, 'success');
        if (typeof this.clearLocaleCopyDirty === 'function') this.clearLocaleCopyDirty();
        // Po generacji otwórz ofertę, jeśli motyw ma usługi / menu — od razu widać edycję.
        if (mode === 'generate' && typeof this.setTab === 'function') {
          if (typeof this.adminTabVisible === 'function' && this.adminTabVisible('services')) {
            this.setTab('services');
          } else if (typeof this.adminTabVisible === 'function' && this.adminTabVisible('menu')) {
            this.setTab('menu');
          }
        } else if (mode === 'adapt' && typeof this.setTab === 'function') {
          this.setTab('hero');
        }
      } catch (e) {
        safeDebug('generateSiteWithAi', e);
        this.showToast('Nie udało się wygenerować treści. Spróbuj ponownie.', 'error');
      } finally {
        this.isGeneratingAi = false;
        this.aiProgressLabel = '';
        setTimeout(() => {
          this._suppressContentWatch = false;
        }, 0);
      }
    };
  };
})();
