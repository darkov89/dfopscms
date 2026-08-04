// Panel i18n — przełącznik języka edycji (shim content.pl = aktywne locale).
// window.DFOPS_attachI18nPanel(app) w buildAdminAlpineState.
;(function () {
  function deepClone(v) {
    if (typeof window.DFOPS_deepClone === 'function') return window.DFOPS_deepClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  function labels() {
    return window.DFOPS_SITE_LOCALE_LABELS || { pl: 'Polski', en: 'English', de: 'Deutsch' };
  }

  function ensureTranslationMode(content) {
    if (!content || typeof content !== 'object') return 'manual';
    if (!content.meta || typeof content.meta !== 'object') content.meta = {};
    const mode = content.meta.translationMode === 'ai' ? 'ai' : 'manual';
    if (content.meta.translationMode !== mode) {
      content.meta.translationMode = mode;
    }
    return mode;
  }

  /** Odczyt bez mutacji — bezpieczny w deep $watch('content'). */
  function readDefaultLocale(content) {
    if (!content || typeof content !== 'object') return 'pl';
    const def = String(content.meta?.defaultLocale || 'pl')
      .trim()
      .toLowerCase();
    return def === 'en' || def === 'de' || def === 'pl' ? def : 'pl';
  }

  function readEnabledLocales(content) {
    if (!content || typeof content !== 'object') return ['pl'];
    const def = readDefaultLocale(content);
    const raw = Array.isArray(content.meta?.locales) ? content.meta.locales : [def];
    const out = [];
    const seen = {};
    for (let i = 0; i < raw.length; i++) {
      const c = String(raw[i] || '')
        .trim()
        .toLowerCase();
      if ((c !== 'pl' && c !== 'en' && c !== 'de') || seen[c]) continue;
      seen[c] = true;
      out.push(c);
    }
    if (!seen[def]) out.unshift(def);
    if (!out.length) out.push('pl');
    return out;
  }

  window.DFOPS_attachI18nPanel = function attachI18nPanel(app) {
    if (!app || typeof app !== 'object') return;

    app.editLocale = 'pl';
    app._localePack = null;
    app._localeCopyDirty = false;

    app.i18nEnabledLocales = function i18nEnabledLocales() {
      if (typeof window.DFOPS_enabledLocales === 'function' && this.content) {
        return window.DFOPS_enabledLocales(this.content);
      }
      return ['pl'];
    };

    app.i18nDefaultLocale = function i18nDefaultLocale() {
      if (typeof window.DFOPS_defaultLocale === 'function' && this.content) {
        return window.DFOPS_defaultLocale(this.content);
      }
      return 'pl';
    };

    app.i18nLocaleLabel = function i18nLocaleLabel(code) {
      const map = labels();
      return map[code] || String(code || '').toUpperCase();
    };

    app.i18nTranslationMode = function i18nTranslationMode() {
      return ensureTranslationMode(this.content);
    };

    app.setTranslationMode = function setTranslationMode(mode) {
      if (!this.content) return;
      if (!this.content.meta || typeof this.content.meta !== 'object') this.content.meta = {};
      const next = mode === 'ai' ? 'ai' : 'manual';
      if (this.content.meta.translationMode === next) return;
      this.content.meta.translationMode = next;
      if (typeof this.scheduleDraftAutosave === 'function') this.scheduleDraftAutosave();
      this.showToast(
        next === 'ai'
          ? 'Tryb tłumaczenia: AI — przy zmianach w języku podstawowym zapytamy o aktualizację innych języków.'
          : 'Tryb tłumaczenia: ręcznie — edytujesz każdy język osobno.',
        'info',
      );
    };

    app.markLocaleCopyDirty = function markLocaleCopyDirty() {
      // Bez ensureMeta / i18nDefaultLocale — te mutują content.meta i w deep $watch = freeze UI
      const def = readDefaultLocale(this.content);
      if ((this.editLocale || def) !== def) return;
      if (readEnabledLocales(this.content).length > 1) {
        this._localeCopyDirty = true;
      }
    };

    app.clearLocaleCopyDirty = function clearLocaleCopyDirty() {
      this._localeCopyDirty = false;
    };

    app.canUseExtraLocales = function canUseExtraLocales() {
      if (this.isImpersonating) return true;
      const plan = this.subscriptionPlan || 'trial';
      if (typeof window.DFOPS_planAllowsExtraLocales === 'function') {
        return window.DFOPS_planAllowsExtraLocales(plan);
      }
      return false;
    };

    app.i18nMaxLocales = function i18nMaxLocales() {
      if (this.isImpersonating) return 3;
      const plan = this.subscriptionPlan || 'trial';
      if (typeof window.DFOPS_planMaxLocales === 'function') {
        return window.DFOPS_planMaxLocales(plan);
      }
      return 1;
    };

    app.i18nAvailableToAdd = function i18nAvailableToAdd() {
      const allowed = window.DFOPS_ALLOWED_SITE_LOCALES || ['pl', 'en', 'de'];
      const enabled = this.i18nEnabledLocales();
      const def = this.i18nDefaultLocale();
      return allowed.filter((c) => c !== def && enabled.indexOf(c) === -1);
    };

    /** Po loadData / normalize — zbuduj pack i podepnij shim pl. */
    app.i18nAfterContentLoad = function i18nAfterContentLoad() {
      if (!this.content || typeof this.content !== 'object') return;
      const prevSuppress = this._suppressContentWatch;
      this._suppressContentWatch = true;
      try {
        if (typeof window.DFOPS_finalizeI18nContent === 'function') {
          window.DFOPS_finalizeI18nContent(this.content);
        }
        ensureTranslationMode(this.content);
        const def = this.i18nDefaultLocale();
        this._localePack = {};
        const enabled = this.i18nEnabledLocales();
        for (let i = 0; i < enabled.length; i++) {
          const loc = enabled[i];
          if (this.content[loc] && typeof this.content[loc] === 'object') {
            this._localePack[loc] = this.content[loc];
          }
        }
        if (!this._localePack[def] && this.content.pl) {
          this._localePack[def] = this.content.pl;
        }
        if (!this.editLocale || enabled.indexOf(this.editLocale) === -1) {
          this.editLocale = def;
        }
        this._bindEditLocaleShim();
        this._localeCopyDirty = false;
      } finally {
        this._suppressContentWatch = prevSuppress;
      }
    };

    app._bindEditLocaleShim = function _bindEditLocaleShim() {
      if (!this._localePack || !this.content) return;
      const loc = this.editLocale || this.i18nDefaultLocale();
      if (!this._localePack[loc]) {
        const def = this.i18nDefaultLocale();
        this._localePack[loc] = deepClone(this._localePack[def] || this.content.pl || {});
      }
      // Unikaj zbędnego przypisania (deep $watch → pętla autosave)
      if (this.content.pl !== this._localePack[loc]) {
        this.content.pl = this._localePack[loc];
      }
      const enabled = this.i18nEnabledLocales();
      for (let i = 0; i < enabled.length; i++) {
        const code = enabled[i];
        if (this._localePack[code] && this.content[code] !== this._localePack[code]) {
          this.content[code] = this._localePack[code];
        }
      }
    };

    app.setEditLocale = async function setEditLocale(code) {
      const loc = String(code || '')
        .trim()
        .toLowerCase();
      if (!loc || this.i18nEnabledLocales().indexOf(loc) === -1) return;
      if (loc === this.editLocale) return;

      const def = this.i18nDefaultLocale();
      // Przy wyjściu z języka podstawowego — pytanie o sync AI
      if (
        this.editLocale === def &&
        loc !== def &&
        this._localeCopyDirty &&
        this.i18nTranslationMode() === 'ai' &&
        typeof this.promptSyncOtherLocales === 'function'
      ) {
        await this.promptSyncOtherLocales({ reason: 'switch' });
      }

      this._suppressContentWatch = true;
      try {
        if (this.editLocale && this.content && this.content.pl) {
          this._localePack[this.editLocale] = this.content.pl;
          this.content[this.editLocale] = this.content.pl;
        }
        this.editLocale = loc;
        this._bindEditLocaleShim();
      } finally {
        setTimeout(() => {
          this._suppressContentWatch = false;
        }, 0);
      }
    };

    /** Pytanie: zaktualizować inne języki przez AI? */
    app.promptSyncOtherLocales = async function promptSyncOtherLocales(opts) {
      const options = opts && typeof opts === 'object' ? opts : {};
      if (!this._localeCopyDirty) return false;
      if (this.i18nTranslationMode() !== 'ai') {
        this._localeCopyDirty = false;
        return false;
      }
      const enabled = this.i18nEnabledLocales();
      const def = this.i18nDefaultLocale();
      const others = enabled.filter((c) => c !== def);
      if (!others.length) {
        this._localeCopyDirty = false;
        return false;
      }
      if (!this.canUseAiGenerator || !this.canUseAiGenerator()) {
        this.showToast(
          'Zmieniłeś treść w języku podstawowym. Zaktualizuj tłumaczenia ręcznie (lub włącz AI na planie Starter+).',
          'info',
        );
        this._localeCopyDirty = false;
        return false;
      }

      const names = others.map((c) => this.i18nLocaleLabel(c)).join(', ');
      const ok = await this.confirmAsync({
        title: 'Zaktualizować inne języki?',
        message:
          'Zmieniłeś treści w języku podstawowym. Czy AI ma zaktualizować tłumaczenia (' +
          names +
          ')?' +
          (options.reason === 'publish' ? ' (przed publikacją)' : ''),
        yesLabel: 'Tak, przetłumacz AI',
        noLabel: 'Nie teraz',
        tone: 'default',
      });
      if (!ok) {
        this._localeCopyDirty = false;
        return false;
      }

      let allOk = true;
      for (let i = 0; i < others.length; i++) {
        if (typeof this.adaptLocaleWithAi !== 'function') {
          allOk = false;
          break;
        }
        const adapted = await this.adaptLocaleWithAi(others[i], { silent: others.length > 1 });
        if (!adapted) allOk = false;
      }
      this._localeCopyDirty = false;
      if (allOk && others.length > 1) {
        this.showToast('Zaktualizowano tłumaczenia AI.', 'success');
      }
      return allOk;
    };

    app.enableSiteLocale = async function enableSiteLocale(code) {
      const loc = String(code || '')
        .trim()
        .toLowerCase();
      if (!this.canUseExtraLocales()) {
        this.showToast('Dodatkowe języki są dostępne od planu Standard.', 'info');
        if (typeof this.setTab === 'function') this.setTab('subscription');
        return;
      }
      if (this.i18nEnabledLocales().length >= this.i18nMaxLocales()) {
        this.showToast('Osiągnięto limit języków dla Twojego planu.', 'error');
        return;
      }
      if (!this.content) return;
      const def = this.i18nDefaultLocale();

      // Wybór: AI vs ręcznie
      const useAi = await this.confirmAsync({
        title: 'Jak tłumaczyć treści?',
        message:
          'Dodajesz język ' +
          this.i18nLocaleLabel(loc) +
          '. AI może od razu przetłumaczyć teksty z ' +
          this.i18nLocaleLabel(def) +
          ', albo skopiujemy treść i przetłumaczysz ręcznie.',
        yesLabel: 'Przez AI',
        noLabel: 'Ręcznie',
        tone: 'default',
      });

      // Flush current edit
      if (this.editLocale && this.content.pl) {
        this._localePack = this._localePack || {};
        this._localePack[this.editLocale] = this.content.pl;
        this.content[this.editLocale] = this.content.pl;
      }
      if (typeof window.DFOPS_cloneLocaleFromSource === 'function') {
        window.DFOPS_cloneLocaleFromSource(this.content, def, loc);
      } else {
        this.content[loc] = deepClone(this.content[def] || this.content.pl);
        if (!this.content.meta) this.content.meta = { defaultLocale: def, locales: [def] };
        if (this.content.meta.locales.indexOf(loc) === -1) this.content.meta.locales.push(loc);
      }
      ensureTranslationMode(this.content);
      this.content.meta.translationMode = useAi ? 'ai' : 'manual';
      this._localePack[loc] = this.content[loc];
      this.setEditLocale(loc);
      if (typeof this.scheduleDraftAutosave === 'function') this.scheduleDraftAutosave();

      if (useAi && typeof this.adaptLocaleWithAi === 'function') {
        this.showToast('Dodano język — tłumaczę przez AI…', 'info');
        const adapted = await this.adaptLocaleWithAi(loc, { silent: false });
        if (!adapted) {
          this.showToast(
            'Język dodany (kopia PL). AI nie przetłumaczyło — możesz spróbować „Zlokalizuj z PL”.',
            'info',
          );
        }
      } else {
        this.showToast(
          'Dodano język: ' + this.i18nLocaleLabel(loc) + '. Edytuj teksty ręcznie.',
          'success',
        );
      }
    };

    app.disableSiteLocale = async function disableSiteLocale(code) {
      const loc = String(code || '')
        .trim()
        .toLowerCase();
      const def = this.i18nDefaultLocale();
      if (loc === def) {
        this.showToast('Nie można usunąć domyślnego języka.', 'error');
        return;
      }
      const ok = await this.confirmAsync({
        title: 'Usunąć język?',
        message:
          'Treści w języku ' +
          this.i18nLocaleLabel(loc) +
          ' zostaną usunięte z wersji roboczej. Opublikuj, żeby zniknęły też z LIVE.',
        yesLabel: 'Usuń',
        noLabel: 'Anuluj',
        tone: 'danger',
      });
      if (!ok) return;
      if (this.editLocale === loc) this.setEditLocale(def);
      if (typeof window.DFOPS_removeLocale === 'function') {
        window.DFOPS_removeLocale(this.content, loc);
      } else {
        delete this.content[loc];
        if (this.content.meta && Array.isArray(this.content.meta.locales)) {
          this.content.meta.locales = this.content.meta.locales.filter((x) => x !== loc);
        }
      }
      if (this._localePack) delete this._localePack[loc];
      this._bindEditLocaleShim();
      if (typeof this.scheduleDraftAutosave === 'function') this.scheduleDraftAutosave();
      this.showToast('Usunięto język ' + this.i18nLocaleLabel(loc) + '.', 'success');
    };

    app.prepareContentForPersist = function prepareContentForPersist() {
      if (!this.content) return this.content;
      if (this.editLocale && this.content.pl) {
        this._localePack = this._localePack || {};
        this._localePack[this.editLocale] = this.content.pl;
        this.content[this.editLocale] = this.content.pl;
      }
      const enabled = this.i18nEnabledLocales();
      for (let i = 0; i < enabled.length; i++) {
        const code = enabled[i];
        if (this._localePack && this._localePack[code]) {
          this.content[code] = this._localePack[code];
        }
      }
      // Domyślny locale zawsze pod swoim kluczem i jako pl dla kompatybilności loaderów
      const def = this.i18nDefaultLocale();
      if (this.content[def]) this.content.pl = this.content[def];
      ensureTranslationMode(this.content);
      if (typeof window.DFOPS_prepareContentForSave === 'function') {
        window.DFOPS_prepareContentForSave(this.content);
      }
      return this.content;
    };
  };
})();
