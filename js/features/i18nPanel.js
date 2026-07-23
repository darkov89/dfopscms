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

  window.DFOPS_attachI18nPanel = function attachI18nPanel(app) {
    if (!app || typeof app !== 'object') return;

    app.editLocale = 'pl';
    app._localePack = null;

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
      if (typeof window.DFOPS_finalizeI18nContent === 'function') {
        window.DFOPS_finalizeI18nContent(this.content);
      }
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
      this.editLocale = def;
      this._bindEditLocaleShim();
    };

    app._bindEditLocaleShim = function _bindEditLocaleShim() {
      if (!this._localePack) return;
      const loc = this.editLocale || this.i18nDefaultLocale();
      if (!this._localePack[loc]) {
        const def = this.i18nDefaultLocale();
        this._localePack[loc] = deepClone(this._localePack[def] || this.content.pl || {});
      }
      this.content.pl = this._localePack[loc];
      // Utrzymaj top-level klucze dla save
      const enabled = this.i18nEnabledLocales();
      for (let i = 0; i < enabled.length; i++) {
        const code = enabled[i];
        if (this._localePack[code]) this.content[code] = this._localePack[code];
      }
    };

    app.setEditLocale = function setEditLocale(code) {
      const loc = String(code || '')
        .trim()
        .toLowerCase();
      if (!loc || this.i18nEnabledLocales().indexOf(loc) === -1) return;
      // Zapisz aktualny shim z powrotem do packa
      if (this.editLocale && this.content && this.content.pl) {
        this._localePack[this.editLocale] = this.content.pl;
        this.content[this.editLocale] = this.content.pl;
      }
      this.editLocale = loc;
      this._bindEditLocaleShim();
    };

    app.enableSiteLocale = function enableSiteLocale(code) {
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
      this._localePack[loc] = this.content[loc];
      this.setEditLocale(loc);
      if (typeof this.scheduleDraftAutosave === 'function') this.scheduleDraftAutosave();
      this.showToast('Dodano język: ' + this.i18nLocaleLabel(loc) + '. Możesz teraz edytować treści.', 'success');
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
        message: 'Treści w języku ' + this.i18nLocaleLabel(loc) + ' zostaną usunięte z wersji roboczej. Opublikuj, żeby zniknęły też z LIVE.',
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
      if (typeof window.DFOPS_prepareContentForSave === 'function') {
        window.DFOPS_prepareContentForSave(this.content);
      }
      return this.content;
    };
  };
})();
