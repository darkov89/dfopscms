function adminMixinIntegrations(ctx) {
  const {
    cfg,
    repo,
    MS_PER_DAY,
    ERROR_MESSAGE_TIMEOUT,
    SUCCESS_MESSAGE_TIMEOUT,
    UPGRADE_MESSAGE_TIMEOUT,
  } = ctx;
  return {
      async uploadImage(event, section, field, index = null) {
        const file = event.target.files?.[0];
        if (!file || !this.slug) return;
        const pl = this.content?.pl;
        if (!pl) return;
        this.uploadingMessage = uploadingMessageFor(section, field);
        this.uploadingImage = true;
        try {
          const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
          const mime = String(file.type || '').toLowerCase();
          if (!allowedTypes.has(mime)) {
            throw new Error('Nieprawidłowy typ pliku. Dozwolone: JPG, PNG, WEBP.');
          }

          // Dodatkowy bezpiecznik: blokuj svg/html nawet przy błędnym MIME od systemu.
          const nameLower = String(file.name || '').toLowerCase();
          if (/\.(svg|html?|xml)$/i.test(nameLower) || mime === 'image/svg+xml') {
            throw new Error('Ten typ pliku jest zablokowany ze względów bezpieczeństwa.');
          }

          const fileExt = file.name.split('.').pop() || 'png';
          const fileName = `${this.slug}-${section}-${field}-${Date.now()}.${fileExt}`;
          const { error } = await this.supabase.storage.from('images').upload(fileName, file);
          if (error) throw error;
          const { data: publicUrlData } = this.supabase.storage.from('images').getPublicUrl(fileName);
          if (section === 'gallery' && field === 'images') {
            if (!pl.gallery) pl.gallery = { title: 'Nasze realizacje', images: [] };
            if (!Array.isArray(pl.gallery.images)) pl.gallery.images = [];
            pl.gallery.images.push(publicUrlData.publicUrl);
          } else if (section === 'menu' && field === 'menu_image') {
            pl.menu_image = publicUrlData.publicUrl;
          } else if (index !== null) {
            const sec = pl[section];
            const el = Array.isArray(sec) ? sec[index] : sec?.[index];
            if (el == null) return;
            el[field] = publicUrlData.publicUrl;
          } else {
            if (!pl[section]) pl[section] = {};
            pl[section][field] = publicUrlData.publicUrl;
          }
          this.message = this.showWizard
            ? 'Zdjęcie jest zapisane w treści strony. Przy „Dalej” i na końcu kreatora wszystko trafia do bazy — możesz też użyć „Publikuj zmiany” w nagłówku.'
            : 'Gotowe! Kliknij „Publikuj zmiany”, żeby pokazać je na stronie.';
          setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
        } catch (e) {
          console.error(e);
          this.showError('Nie udało się dodać zdjęcia. Spróbuj jeszcze raz.');
        } finally {
          this.uploadingImage = false;
          this.uploadingMessage = '';
          event.target.value = '';
        }
      },
      removeGalleryImage(index) {
        if (!this.content?.pl?.gallery?.images || !Array.isArray(this.content.pl.gallery.images)) return;
        this.content.pl.gallery.images.splice(index, 1);
      },

      mapPlaceQuery: '',
      mapPlaceResults: [],
      mapPlaceLoading: false,
      mapPlaceError: '',
      mapPlaceSelectedId: null,

      showAppearanceUpgradeModal: false,
      showPublishUpgradeModal: false,
      /** Pozytywne tarcie: potwierdzenie przed publikacją draft_content → content. */
      showPublishConfirmModal: false,
      appearancePickerHex: '',
      /** Migawka opublikowanej treści (kolumna `content`) — pod „Odrzuć zmiany”. */
      _publishedContentRaw: null,
      _publishedTheme: '',

      googleReviewsPlaceInput: '',
      googleReviewsPlaceResults: [],
      googleReviewsPlaceLoading: false,
      googleReviewsPlaceError: '',
      googleReviewsPlaceSelectedId: null,
      googleReviewsPlaceDebounceTimer: null,

      formatPlacesListError(e) {
        const msg = e instanceof Error ? e.message : String(e);
        return /401|JWT|Unauthorized/i.test(msg)
          ? 'Brak uprawnień (401). Wdróż get-google-reviews z supabase/config.toml (verify_jwt) lub zaloguj się ponownie.'
          : 'Nie udało się wyszukać. Sprawdź połączenie i czy funkcja get-google-reviews jest wdrożona.';
      },

      async invokePlacesList(query, maxResults = 8) {
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
          throw new Error('Brak konfiguracji Supabase.');
        }
        const q = String(query || '').trim();
        if (!q || q.length < 2) {
          throw new Error('Wpisz co najmniej 2 znaki (nazwa firmy lub adres).');
        }
        const { data, error } = await this.supabase.functions.invoke('get-google-reviews', {
          body: { query: q, maxResults, listPlaces: true },
        });
        if (error) throw new Error(error.message || String(error));
        if (!data?.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Błąd wyszukiwania.');
        }
        return Array.isArray(data.places) ? data.places : [];
      },

      syncGoogleReviewsPlaceInputFromContent() {
        const gr = this.content?.pl?.google_reviews;
        if (!gr) return;
        this.googleReviewsPlaceInput = String(gr.place_query || '').trim();
        const pid = String(gr.place_id || '').trim();
        this.googleReviewsPlaceSelectedId = pid || null;
        this.googleReviewsPlaceResults = [];
        this.googleReviewsPlaceError = '';
      },

      onGoogleReviewsPlaceInput() {
        const input = String(this.googleReviewsPlaceInput || '').trim();
        const gr = this.content?.pl?.google_reviews;
        if (!gr) return;

        if (!input) {
          this.clearGoogleReviewsPlaceSelection();
          return;
        }

        if (this.googleReviewsPlaceSelectedId) {
          gr.place_id = '';
          this.googleReviewsPlaceSelectedId = null;
        }
        gr.place_query = '';

        if (this.googleReviewsPlaceDebounceTimer) {
          clearTimeout(this.googleReviewsPlaceDebounceTimer);
        }
        this.googleReviewsPlaceDebounceTimer = setTimeout(() => {
          this.googleReviewsPlaceDebounceTimer = null;
          void this.searchGoogleReviewsPlaces();
        }, 400);
      },

      async searchGoogleReviewsPlaces() {
        const q = String(this.googleReviewsPlaceInput || '').trim();
        if (!q || q.length < 2) {
          this.googleReviewsPlaceResults = [];
          return;
        }
        this.googleReviewsPlaceLoading = true;
        this.googleReviewsPlaceError = '';
        this.googleReviewsPlaceResults = [];
        try {
          const places = await this.invokePlacesList(q, 8);
          this.googleReviewsPlaceResults = places;
          if (!places.length) {
            this.googleReviewsPlaceError = 'Brak wyników — spróbuj innej frazy (np. miasto + nazwa).';
          }
        } catch (e) {
          console.error(e);
          const msg = e instanceof Error ? e.message : String(e);
          this.googleReviewsPlaceError =
            msg === 'Wpisz co najmniej 2 znaki (nazwa firmy lub adres).'
              ? msg
              : this.formatPlacesListError(e);
        } finally {
          this.googleReviewsPlaceLoading = false;
        }
      },

      selectGoogleReviewsPlace(place) {
        if (!place?.id || !this.content?.pl) return;
        if (!this.content.pl.google_reviews) {
          this.content.pl.google_reviews = {
            embed_url: '',
            place_query: '',
            place_id: '',
            max_reviews: 6,
            title: 'Opinie z Google',
          };
        }
        const gr = this.content.pl.google_reviews;
        gr.place_id = place.id;
        gr.place_query = place.address ? `${place.name}, ${place.address}` : String(place.name || '').trim();
        this.googleReviewsPlaceInput = gr.place_query;
        this.googleReviewsPlaceSelectedId = place.id;
        this.googleReviewsPlaceResults = [];
        this.googleReviewsPlaceError = '';
      },

      clearGoogleReviewsPlaceSelection() {
        const gr = this.content?.pl?.google_reviews;
        if (gr) {
          gr.place_id = '';
          gr.place_query = '';
        }
        this.googleReviewsPlaceInput = '';
        this.googleReviewsPlaceSelectedId = null;
        this.googleReviewsPlaceResults = [];
        this.googleReviewsPlaceError = '';
        if (this.googleReviewsPlaceDebounceTimer) {
          clearTimeout(this.googleReviewsPlaceDebounceTimer);
          this.googleReviewsPlaceDebounceTimer = null;
        }
      },

      async searchPlacesForMap() {
        const q = (this.mapPlaceQuery || '').trim();
        if (!q || q.length < 2) {
          this.mapPlaceError = 'Wpisz co najmniej 2 znaki (nazwa firmy lub adres).';
          return;
        }
        this.mapPlaceLoading = true;
        this.mapPlaceError = '';
        this.mapPlaceResults = [];
        this.mapPlaceSelectedId = null;
        try {
          this.mapPlaceResults = await this.invokePlacesList(q, 8);
          if (!this.mapPlaceResults.length) {
            this.mapPlaceError = 'Brak wyników — spróbuj innej frazy (np. miasto + nazwa).';
          }
        } catch (e) {
          console.error(e);
          this.mapPlaceError = this.formatPlacesListError(e);
        } finally {
          this.mapPlaceLoading = false;
        }
      },

      async confirmMapPlaceSelection() {
        if (!this.mapPlaceSelectedId || !this.content?.pl) return;
        const hit = this.mapPlaceResults.find((p) => p.id === this.mapPlaceSelectedId);
        if (!hit) return;
        if (!this.content.pl.contact) this.content.pl.contact = {};
        this.content.pl.contact.map_place_id = hit.id;
        this.content.pl.contact.map_embed_url = '';
        if (hit.address && !String(this.content.pl.contact.address || '').trim()) {
          this.content.pl.contact.address = hit.address;
        }
        this.mapPlaceLoading = true;
        try {
          const syncEmbed = window.DFOPS_googlePlacesSync?.syncMapEmbedIntoContact;
          if (typeof syncEmbed === 'function' && this.supabase) {
            await syncEmbed(this.supabase, this.content.pl.contact);
          }
        } catch (e) {
          console.warn('DFOPS map embed po wyborze miejsca:', e);
        } finally {
          this.mapPlaceLoading = false;
        }
        const hasEmbed = !!String(this.content.pl.contact.map_embed_url || '').trim();
        this.message = hasEmbed
          ? 'Wybrano lokalizację mapy. Opublikuj zmiany, żeby była widoczna na stronie.'
          : 'Wybrano lokalizację. Opublikuj zmiany — system spróbuje ponownie przygotować mapę.';
        setTimeout(() => { this.message = ''; }, SUCCESS_MESSAGE_TIMEOUT);
      },

      clearMapPlaceSelection() {
        if (this.content?.pl?.contact) {
          this.content.pl.contact.map_place_id = '';
        }
        this.mapPlaceSelectedId = null;
      },
  };
}
