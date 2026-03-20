;(function () {
  function createAdminApp() {
    const cfg = window.DFOPS_CONFIG;
    const repo = window.DFOPS_pageRepository;
    return {
      supabase: null,
      user: null,
      loadingAuth: true,
      email: '',
      password: '',
      authError: '',
      slug: new URLSearchParams(window.location.search).get('site') || 'moj-test',
      theme: '',
      content: null,
      customDomain: '',
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
        const elapsed = Math.floor((now - start) / 86400000);
        return Math.max(0, 14 - elapsed);
      },
      get isCustomDomainLocked() { return this.subscriptionPlan === 'trial' || this.subscriptionPlan === 'tier0'; },

      showError(msg) {
        this.errorMessage = msg;
        setTimeout(() => { this.errorMessage = ''; }, 5000);
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
        this.hasUnsavedChanges = false;
      },
      async loadData() {
        this.content = null;
        const { data, error } = await repo.getCurrentUserPage(this.user.id);
        if (error || !data) {
          this.showError('Nie znaleziono Twojej strony.');
          return;
        }
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
          setTimeout(() => { this.message = ''; }, 3500);
        } catch (e) {
          console.error(e);
          this.showError('Upgrade nie powiódł się.');
        } finally {
          this.upgrading = false;
        }
      },
      async saveData() {
        if (!this.content) return;
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
          setTimeout(() => { this.message = ''; }, 3000);
        } catch (e) {
          console.error(e);
          this.showError('Błąd zapisu (RLS lub walidacja).');
        } finally {
          this.saving = false;
        }
      },
      async uploadImage(event, section, field, index = null) {
        const file = event.target.files?.[0];
        if (!file || !this.slug) return;
        this.uploadingImage = true;
        try {
          const fileExt = file.name.split('.').pop() || 'png';
          const fileName = `${this.slug}-${section}-${field}-${Date.now()}.${fileExt}`;
          const { error } = await this.supabase.storage.from('images').upload(fileName, file);
          if (error) throw error;
          const { data: publicUrlData } = this.supabase.storage.from('images').getPublicUrl(fileName);
          if (section === 'gallery' && field === 'images') {
            if (!this.content.pl.gallery) this.content.pl.gallery = { title: 'Nasze realizacje', images: [] };
            if (!Array.isArray(this.content.pl.gallery.images)) this.content.pl.gallery.images = [];
            this.content.pl.gallery.images.push(publicUrlData.publicUrl);
          } else if (index !== null) {
            this.content.pl[section][index][field] = publicUrlData.publicUrl;
          } else {
            if (!this.content.pl[section]) this.content.pl[section] = {};
            this.content.pl[section][field] = publicUrlData.publicUrl;
          }
          this.message = 'Plik załadowany. Kliknij "Publikuj Zmiany".';
          setTimeout(() => { this.message = ''; }, 3000);
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
