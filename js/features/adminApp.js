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
      activeTab: 'hero',
      saving: false,
      uploadingImage: false,
      message: '',
      upgrading: false,
      latestTemplateVersion: window.DFOPS_LATEST_TEMPLATE_VERSION || 3,
      currentTemplateVersion: 1,
      updateAvailable: false,
      selectedStyleBundle: '',
      get availablePresets() { return cfg.presetsByTheme[this.theme] || []; },
      get accentColor() { return cfg.accentByPreset[this.content?.pl?.settings?.color_preset] || '#D4AF37'; },
      get styleBundles() { return cfg.bundlesByTheme[this.theme] || []; },

      init() {
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
        await this.supabase.auth.signOut();
        this.user = null;
        this.content = null;
      },
      ensureSettingsDefaults() {
        const s = this.content.pl.settings;
        if (!s.color_preset) s.color_preset = this.theme === 'beauty' ? 'beige' : 'gold';
        if (!s.background_style) s.background_style = this.theme === 'beauty' ? 'soft' : 'glow';
        if (!s.font_preset) s.font_preset = this.theme === 'beauty' ? 'poppins' : 'inter';
      },
      async loadData() {
        this.content = null;
        const { data, error } = await repo.getCurrentUserPage(this.user.id);
        if (error || !data) { alert('Nie znaleziono Twojej strony.'); return; }
        this.slug = data.slug;
        this.theme = data.theme;
        this.content = window.DFOPS_normalizeContent(this.theme, data.content);
        this.ensureSettingsDefaults();
        if (!this.content.pl.nav) this.content.pl.nav = {};
        if (this.theme === 'beauty') {
          if (!this.content.pl.nav.menu) this.content.pl.nav.menu = { about: 'O nas', pricing: 'Cennik', faq: 'Q&A', contact: 'Kontakt' };
          if (this.content.pl.nav.menu.about === undefined) this.content.pl.nav.menu.about = 'O nas';
          if (this.content.pl.nav.menu.pricing === undefined) this.content.pl.nav.menu.pricing = 'Cennik';
          if (this.content.pl.nav.menu.faq === undefined) this.content.pl.nav.menu.faq = 'Q&A';
          if (this.content.pl.nav.menu.contact === undefined) this.content.pl.nav.menu.contact = 'Kontakt';
        }
        if (!this.content.pl.contact) this.content.pl.contact = {};
        if (!this.content.pl.contact.map_embed_url) this.content.pl.contact.map_embed_url = '';
        if (!this.content.pl.google_reviews) this.content.pl.google_reviews = { embed_url: '', place_query: '', max_reviews: 6, title: 'Opinie z Google' };
        if (this.content.pl.google_reviews.embed_url === undefined) this.content.pl.google_reviews.embed_url = '';
        if (this.content.pl.google_reviews.place_query === undefined) this.content.pl.google_reviews.place_query = '';
        if (this.content.pl.google_reviews.max_reviews === undefined) this.content.pl.google_reviews.max_reviews = 6;
        if (this.content.pl.google_reviews.title === undefined) this.content.pl.google_reviews.title = 'Opinie z Google';
        if (!this.content.pl.social) this.content.pl.social = {};
        if (this.theme === 'consultant') {
          if (this.content.pl.social.facebook === undefined) this.content.pl.social.facebook = '';
          if (this.content.pl.social.instagram === undefined) this.content.pl.social.instagram = '';
          if (this.content.pl.social.tiktok === undefined) this.content.pl.social.tiktok = '';
        }
        this.currentTemplateVersion = Number(this.content.pl.settings.template_version || 1);
        this.updateAvailable = this.currentTemplateVersion < this.latestTemplateVersion;
        this.applyThemeStylingFromContent();
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
          this.message = `Szablon zaktualizowany do v${this.latestTemplateVersion}.`;
          setTimeout(() => { this.message = ''; }, 3500);
        } catch (e) {
          console.error(e);
          alert('Upgrade nie powiódł się.');
        } finally {
          this.upgrading = false;
        }
      },
      async saveData() {
        if (!this.content) return;
        this.saving = true;
        try {
          this.content.pl.settings.template_version = this.latestTemplateVersion;
          const { error } = await repo.saveCurrentUserPage(this.user.id, { content: this.content, color_preset: this.content.pl.settings.color_preset });
          if (error) throw error;
          this.message = 'Zmiany zostały opublikowane!';
          setTimeout(() => { this.message = ''; }, 3000);
        } catch (e) {
          console.error(e);
          alert('Błąd zapisu (RLS lub walidacja).');
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
          if (index !== null) this.content.pl[section][index][field] = publicUrlData.publicUrl;
          else {
            if (!this.content.pl[section]) this.content.pl[section] = {};
            this.content.pl[section][field] = publicUrlData.publicUrl;
          }
          this.message = 'Plik załadowany. Kliknij "Publikuj Zmiany".';
          setTimeout(() => { this.message = ''; }, 3000);
        } catch (e) {
          console.error(e);
          alert('Nie udało się wgrać pliku.');
        } finally {
          this.uploadingImage = false;
          event.target.value = '';
        }
      },
    };
  }

  window.createAdminApp = createAdminApp;
})();

