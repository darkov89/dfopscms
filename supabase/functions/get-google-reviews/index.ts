;(function () {
  function googleReviews() {
    return {
      loading: true,
      reviews: [],
      error: '',
      slide: 0,
      placeId: '',
      placeRating: null,
      userRatingCount: null,
      _lastFetchedQuery: null,

      init() {
        const tryLoad = () => {
          // Alpine.js automatycznie dziedziczy zmienne z publicSiteApp. 
          // Używamy bezposrednio this.content i this.lang!
          const c = this.content;
          const l = this.lang || 'pl';
          
          if (!c) return; // Jeśli dane z bazy jeszcze nie zeszły - czekamy

          // Pobieramy konfigurację niezależnie od tego, czy jest w 'settings' czy bezpośrednio
          const gr = c[l]?.settings?.google_reviews || c[l]?.google_reviews;
          const query = gr?.place_query?.trim();

          if (query && query !== this._lastFetchedQuery) {
            this.loadReviews();
          } else if (query === '' || (gr && !query)) {
            this.loading = false;
            this.error = 'Brak konfiguracji place_query.';
          }
        };

        // 1. Sprawdzamy przy starcie
        tryLoad();

        // 2. Obserwujemy zmiany w obiekcie content (poprawna składnia Alpine.js)
        this.$watch('content', () => {
          tryLoad();
        });
      },

      avgFromReviews() {
        if (!this.reviews.length) return null;
        const sum = this.reviews.reduce((a, r) => a + (Number(r.rating) || 0), 0);
        return Math.round((sum / this.reviews.length) * 10) / 10;
      },

      headerRating() {
        const pr = this.placeRating != null && !Number.isNaN(Number(this.placeRating)) ? Number(this.placeRating) : null;
        return pr != null ? pr : this.avgFromReviews();
      },

      displayCount() {
        if (this.userRatingCount != null && this.userRatingCount > 0) return this.userRatingCount;
        return this.reviews.length;
      },

      t(key, L) {
        const pl = { excellent: 'Doskonała', writeReview: 'Napisz recenzję', readMore: 'Czytaj więcej', readLess: 'Zwiń', reviews: 'opinii' };
        const en = { excellent: 'Excellent', writeReview: 'Write a review', readMore: 'Read more', readLess: 'Show less', reviews: 'reviews' };
        return (L === 'en' ? en : pl)[key] || key;
      },

      labelExcellent(L) {
        const h = this.headerRating();
        const pl = L !== 'en';
        if (h == null) return this.t('excellent', L);
        if (h >= 4.5) return this.t('excellent', L);
        if (h >= 4) return pl ? 'Bardzo dobrze' : 'Very good';
        return pl ? 'Dobrze' : 'Good';
      },

      writeReviewUrl() {
        if (!this.placeId) return 'https://www.google.com/maps';
        return 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(this.placeId);
      },

      formatRel(iso, L) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const pl = L !== 'en';
        const msPerDay = (window.DFOPS_CONFIG?.timeouts?.msPerDay ?? 86400000);
        const days = Math.floor((Date.now() - d.getTime()) / msPerDay);
        if (days <= 0) return pl ? 'Dzisiaj' : 'Today';
        if (days === 1) return pl ? 'Wczoraj' : 'Yesterday';
        if (days < 7) return pl ? (days + ' dni temu') : (days + ' days ago');
        if (days < 30) return pl ? (Math.floor(days / 7) + ' tyg. temu') : (Math.floor(days / 7) + ' wk ago');
        return d.toLocaleDateString(pl ? 'pl-PL' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
      },

      prevSlide() {
        this.slide = Math.max(0, this.slide - 1);
      },

      nextSlide() {
        this.slide = Math.min(Math.max(0, (this.reviews || []).length - 1), this.slide + 1);
      },

      async loadReviews() {
        const c = this.content;
        const l = this.lang || 'pl';
        const gr = c?.[l]?.settings?.google_reviews || c?.[l]?.google_reviews;
        const query = gr?.place_query?.trim();
        const maxReviews = gr?.max_reviews ?? 8;

        if (!query) return;

        this._lastFetchedQuery = query;
        this.loading = true;
        this.reviews = [];
        this.error = '';
        this.slide = 0;
        let failSafeId = null;
        let timeoutId = null;

        try {
          const t = window.DFOPS_CONFIG?.timeouts || {};
          const apiTimeout = t.apiTimeout ?? 25000;
          const abortTimeout = t.abortTimeout ?? 12000;
          
          failSafeId = setTimeout(() => {
            this.loading = false;
            this.error = 'Timeout pobierania opinii.';
          }, apiTimeout);

          const controller = new AbortController();
          timeoutId = setTimeout(() => controller.abort(), abortTimeout);

          const fnUrl = (window.DFOPS_CONFIG?.supabaseUrl
            ? window.DFOPS_CONFIG.supabaseUrl + '/functions/v1/get-google-reviews'
            : '/functions/v1/get-google-reviews');

          const resp = await fetch(fnUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer ' + (window.DFOPS_CONFIG?.supabaseAnonKey || '')
            },
            signal: controller.signal,
            body: JSON.stringify({
              query,
              maxReviews: typeof maxReviews === 'number' ? Math.min(20, Math.max(1, maxReviews)) : 8
            })
          });

          if (timeoutId) clearTimeout(timeoutId);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);

          const json = await resp.json();
          this.placeId = json?.placeId || '';
          this.placeRating = json?.placeRating ?? null;
          this.userRatingCount = json?.userRatingCount ?? null;
          this.reviews = json?.reviews || [];
          this.error = json?.error || '';
        } catch (e) {
          this.error = e?.message || 'Błąd pobierania opinii.';
        } finally {
          if (failSafeId) clearTimeout(failSafeId);
          this.loading = false;
        }
      }
    };
  }

  window.googleReviews = googleReviews;
})();