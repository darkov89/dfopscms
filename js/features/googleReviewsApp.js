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
      _demoReviewsKey: null,

      demoStaggerIso(i) {
        const msPerDay = window.DFOPS_CONFIG?.timeouts?.msPerDay ?? 86400000;
        const d = new Date(Date.now() - (Number(i) + 1) * 4 * msPerDay);
        return d.toISOString();
      },

      hydrateFromContent() {
        const c = this.content;
        const l = this.lang || 'pl';
        const rows = Array.isArray(c[l]?.reviews) ? c[l].reviews : [];
        const gr = c[l]?.settings?.google_reviews || c[l]?.google_reviews;
        const key = `${l}:${rows.map((x) => (x?.author || '') + '|' + String(x?.content || '').slice(0, 48)).join(';')}:${gr?.google_synced_at || ''}`;
        if (this._demoReviewsKey === key) return;
        this._demoReviewsKey = key;
        this._lastFetchedQuery = gr?.place_query?.trim() || null;
        this.loading = false;
        this.error = '';
        this.slide = 0;
        this.placeId = String(gr?.cached_place_id || '').trim();
        const pr = gr?.cached_place_rating;
        const uc = gr?.cached_user_rating_count;
        this.placeRating =
          pr != null && Number.isFinite(Number(pr)) ? Number(pr) : null;
        this.userRatingCount =
          uc != null && Number.isFinite(Number(uc)) ? Number(uc) : null;
        this.reviews = rows.map((row, i) => ({
          author_name: typeof row.author === 'string' && row.author.trim() ? row.author.trim() : 'Klient',
          text: typeof row.content === 'string' ? row.content : '',
          rating: Number(row.stars) > 0 ? Number(row.stars) : 5,
          publishTime:
            typeof row.publishTime === 'string' && row.publishTime.trim()
              ? row.publishTime.trim()
              : this.demoStaggerIso(i),
        }));
        if (this.placeRating == null) {
          const ratings = this.reviews.map((r) => Number(r.rating) || 0).filter((n) => n > 0);
          if (ratings.length) {
            const avg = ratings.reduce((a, n) => a + n, 0) / ratings.length;
            this.placeRating = Math.round(avg * 10) / 10;
          }
        }
        if (this.userRatingCount == null || this.userRatingCount <= 0) {
          this.userRatingCount = this.reviews.length;
        }
      },

      init() {
        const tryLoad = () => {
          const c = this.content;
          const l = this.lang || 'pl';

          if (!c) return;

          const gr = c[l]?.settings?.google_reviews || c[l]?.google_reviews;
          const query = gr?.place_query?.trim();
          const placeId = gr?.place_id?.trim();
          const hasGoogleSource = !!(query || placeId);
          const isDemoCatalog = !!c[l]?.settings?.is_demo_catalog;
          const ownReviews = Array.isArray(c[l]?.reviews) ? c[l].reviews : [];

          if (hasGoogleSource) {
            if (ownReviews.length) {
              this.hydrateFromContent();
            } else {
              this.loading = false;
              this.reviews = [];
              this.error =
                'Opinie z Google pojawią się po publikacji strony w panelu (zakładka Opinie z Google → Publikuj zmiany).';
            }
            return;
          }

          if (!hasGoogleSource && isDemoCatalog && ownReviews.length) {
            this.hydrateFromContent();
          } else if (gr && !hasGoogleSource) {
            this.loading = false;
            this._demoReviewsKey = null;
            this.error = 'Brak konfiguracji wizytówki Google.';
          } else {
            this.loading = false;
          }
        };

        tryLoad();
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
    };
  }

  window.googleReviews = googleReviews;
})();
