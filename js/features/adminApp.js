;(function () {
  function createAdminApp() {
    const t = window.DFOPS_CONFIG?.timeouts || {};
    const MS_PER_DAY = t.msPerDay ?? 86400000;
    const ERROR_MESSAGE_TIMEOUT = t.errorMessage ?? 5000;
    const SUCCESS_MESSAGE_TIMEOUT = t.successMessage ?? 3000;
    const UPGRADE_MESSAGE_TIMEOUT = t.upgradeMessage ?? 3500;
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    return {
      supabase: null,
      user: null,
      loadingAuth: true,
      email: '',
      password: '',
      authError: '',
      slug: new URLSearchParams(window.location.search).get('site') || '',
      theme: '',
      content: null,
      customDomain: '',
      pageId: null,
      verifyingDomain: false,
      domainMessage: '',
      domainError: '',
      showDnsInstructions: false,
      activeTab: 'hero',
      saving: false,
      uploadingImage: false,
      message: '',
      errorMessage: '',
      hasUnsavedChanges: false,
      _stopContentWatch: null,
      upgrading: false,
      latestTemplateVersion: window.DFOPS_LATEST_TEMPLATE_VERSION || 3,
      currentTemplateVersion: 1,
      updateAvailable: false,
      selectedStyleBundle: '',
      get availablePresets() { return cfg.presetsByTheme[this.theme] || []; },
      get accentColor() { return cfg.accentByPreset[this.content?.pl?.settings?.color_preset] || '#D4AF37'; },
      get styleBundles() { return cfg.bundlesByTheme[this.theme] || []; },
      get subscriptionPlan() { return this.content?.pl?.settings?.subscription?.plan || 'trial'; },
      get trialDaysLeft() {
        const sub = this.content?.pl?.settings?.subscription;
        if (!sub || sub.plan !== 'trial' || !sub.trial_started_at) return 14;
        const start = new Date(sub.trial_started_at).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - start) / MS_PER_DAY);
        return Math.max(0, 14 - elapsed);
      },
      get isCustomDomainLocked() { return false;}, //this.subscriptionPlan === 'trial' || this.subscriptionPlan === 'tier0'; },

      showError(msg) {
        this.errorMessage = msg;
        setTimeout(() => { this.errorMessage = ''; }, ERROR_MESSAGE_TIMEOUT);
      },

      init() {
        window.addEventListener('beforeunload', (e) => {
          if (this.hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = 'Masz niezapisane zmiany!';
          }
        });
        this.supabase = window.DFOPS_getSupabaseClient();
        this.supabase.auth.getSession().then(({ data: { session } }) => {
          this.user = session?.user || null;
          this.loadingAuth = false;
          if (this.user) this.loadData();
        });
      },
      async login() {
        this.authError = '';
        const { data, error } = await this.supabase.auth.signInWithPassword({ email: this.email, password: this.password });
        if (error) this.authError = 'Błędny e-mail lub hasło.';
        else { this.user = data.user; await this.loadData(); }
      },
      async logout() {
        if (typeof this._stopContentWatch === 'function') {
          this._stopContentWatch();
          this._stopContentWatch = null;
        }
        await this.supabase.auth.signOut();
        this.user = null;
        this.content = null;
        this.pageId = null;
        this.showDnsInstructions = false;
        this.hasUnsavedChanges = false;
      },
      async loadData() {
        this.content = null;
        const { data, error } = await repo.getCurrentUserPage(this.user.id);
        if (error || !data) {
          this.showError('Nie znaleziono Twojej strony.');
          return;
        }
        this.pageId = data.id;
        this.slug = data.slug;
        this.theme = data.theme;
        this.customDomain = data.custom_domain || '';
        this.content = window.DFOPS_normalizeContent(data.content, this.theme);
        this.currentTemplateVersion = Number(this.content.pl.settings.template_version || 1);
        this.updateAvailable = this.currentTemplateVersion < this.latestTemplateVersion;
        this.applyThemeStylingFromContent();

        this.$nextTick(() => {
          setTimeout(() => {
            if (typeof this._stopContentWatch === 'function') {
              this._stopContentWatch();
              this._stopContentWatch = null;
            }
            this.hasUnsavedChanges = false;
            this._stopContentWatch = this.$watch('content', () => { this.hasUnsavedChanges = true; }, { deep: true });
          }, 0);
        });
      },
      applyThemeStylingFromContent() {
        if (!this.content?.pl?.settings) return;
        window.DFOPS_applyThemeStyling(this.content.pl.settings, this.theme, 'admin');
      },
      applyStyleBundle() {
        const bundle = this.styleBundles.find((b) => b.id === this.selectedStyleBundle);
        if (!bundle || !this.content?.pl?.settings) return;
        this.content.pl.settings.color_preset = bundle.color_preset;
        this.content.pl.settings.background_style = bundle.background_style;
        this.content.pl.settings.font_preset = bundle.font_preset;
        this.applyThemeStylingFromContent();
      },
      async upgradeTemplate() {
        if (!this.content || !this.theme) return;
        this.upgrading = true;
        try {
          const upgraded = window.DFOPS_upgradeContent(this.theme, this.content, this.latestTemplateVersion);
          const { error } = await repo.saveCurrentUserPage(this.user.id, { content: upgraded });
          if (error) throw error;
          this.content = upgraded;
          this.currentTemplateVersion = this.latestTemplateVersion;
          this.updateAvailable = false;
          this.hasUnsavedChanges = false;
          this.message = `Szablon zaktualizowany do v${this.latestTemplateVersion}.`;
          setTimeout(() => { this.message = ''; }, UPGRADE_MESSAGE_TIMEOUT);
        } catch (e) {
          console.error(e);
          this.showError('Upgrade nie powiódł się.');
        } finally {
          this.upgrading = false;
        }
      },
      async verifyCustomDomain() {
        if (this.isCustomDomainLocked) return;
        if (window.location.protocol === 'file:') {
          this.domainError = 'Otwórz panel przez adres http:// (np. Live Server na localhost), nie z dysku (file://) — inaczej przeglądarka blokuje połączenie z Supabase.';
          this.domainMessage = '';
          return;
        }
        const domain = typeof this.customDomain === 'string' ? this.customDomain.trim() : '';
        if (!this.pageId || !domain) {
          this.domainError = 'Podaj domenę (hostname, np. twojadomena.pl).';
          this.domainMessage = '';
          return;
        }

        if (!confirm('Podpięcie domeny spowoduje również zapisanie i opublikowanie wszystkich wprowadzonych przez Ciebie zmian na stronie. Czy chcesz kontynuować?')) {
          return;
        }

        const saved = await this.saveData();
        if (!saved) {
          this.domainError = 'Nie udało się zapisać zmian — domena nie została zgłoszona do Cloudflare. Popraw błędy i spróbuj ponownie.';
          this.domainMessage = '';
          return;
        }

        this.verifyingDomain = true;
        this.domainMessage = '';
        this.domainError = '';
        this.showDnsInstructions = false;

        try {
          const { data: { session } } = await this.supabase.auth.getSession();

          if (!session) {
            throw new Error('Brak aktywnej sesji. Zaloguj się ponownie.');
          }

          const cfg = window.DFOPS_CONFIG || {};
          const response = await fetch(`${cfg.supabaseUrl}/functions/v1/add-custom-domain`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
              apikey: cfg.supabaseAnonKey || '',
            },
            body: JSON.stringify({
              domain,
              pageId: this.pageId,
            }),
          });

          const result = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(result.error || result.message || `HTTP ${response.status}`);
          }
          if (result.success === false) {
            throw new Error(result.error || 'Odmowa dostępu z serwera Cloudflare.');
          }

          this.domainMessage = 'Domena zgłoszona! Cloudflare weryfikuje rekordy DNS (może to potrwać do kilkunastu minut).';
          this.showDnsInstructions = true;
          await this.loadData();
        } catch (e) {
          console.error('Błąd weryfikacji domeny:', e);
          const raw = e instanceof Error ? e.message : String(e);
          this.domainError = raw === 'Failed to fetch'
            ? 'Brak połączenia z serwerem (CORS, sieć lub otwórz stronę przez http/https, nie file://).'
            : (raw || 'Wystąpił błąd podczas komunikacji z serwerem.');
        } finally {
          this.verifyingDomain = false;
        }
      },
      async saveData() {
        if (!this.content) return false;
        this.saving = true;
        try {
          if (Array.isArray(this.content.pl.services)) {
            this.content.pl.services = this.content.pl.services.filter((s) => s.title && String(s.title).trim() !== '');
          }
          this.content.pl.settings.template_version = this.latestTemplateVersion;
          const payload = { content: this.content, color_preset: this.content.pl.settings.color_preset };
          if (!this.isCustomDomainLocked) payload.custom_domain = this.customDomain;
          const { error } = await repo.saveCurrentUserPage(this.user.id, payload);
          if (error) throw error;
          this.hasUnsavedChanges = false;
          this.message = 'Zmiany zostały opublikowane!';
          setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
          return true;
        } catch (e) {
          console.error(e);
          this.showError('Błąd zapisu (RLS lub walidacja).');
          return false;
        } finally {
          this.saving = false;
        }
      },
      async uploadImage(event, section, field, index = null) {
        const file = event.target.files?.[0];
        if (!file || !this.slug) return;
        const pl = this.content?.pl;
        if (!pl) return;
        this.uploadingImage = true;
        try {
          const fileExt = file.name.split('.').pop() || 'png';
          const fileName = `${this.slug}-${section}-${field}-${Date.now()}.${fileExt}`;
          const { error } = await this.supabase.storage.from('images').upload(fileName, file);
          if (error) throw error;
          const { data: publicUrlData } = this.supabase.storage.from('images').getPublicUrl(fileName);
          if (section === 'gallery' && field === 'images') {
            if (!pl.gallery) pl.gallery = { title: 'Nasze realizacje', images: [] };
            if (!Array.isArray(pl.gallery.images)) pl.gallery.images = [];
            pl.gallery.images.push(publicUrlData.publicUrl);
          } else if (index !== null) {
            const sec = pl[section];
            const el = Array.isArray(sec) ? sec[index] : sec?.[index];
            if (el == null) return;
            el[field] = publicUrlData.publicUrl;
          } else {
            if (!pl[section]) pl[section] = {};
            pl[section][field] = publicUrlData.publicUrl;
          }
          this.message = 'Plik załadowany. Kliknij "Publikuj Zmiany".';
          setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
        } catch (e) {
          console.error(e);
          this.showError('Nie udało się wgrać pliku.');
        } finally {
          this.uploadingImage = false;
          event.target.value = '';
        }
      },
      removeGalleryImage(index) {
        if (!this.content?.pl?.gallery?.images || !Array.isArray(this.content.pl.gallery.images)) return;
        this.content.pl.gallery.images.splice(index, 1);
      },
    };
  }

  window.createAdminApp = createAdminApp;
})();
