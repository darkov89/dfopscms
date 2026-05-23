/**
 * Pobieranie mapy / opinii Google wyłącznie z panelu (sesja JWT).
 * Widok publiczny czyta zapisane pola w pages.content — bez wywołań Edge.
 */
;(function () {
  function clampMaxReviews(n, fallback) {
    const x = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(x)) return fallback;
    return Math.max(1, Math.min(20, Math.floor(x)));
  }

  async function fetchMapEmbedUrl(supabase, placeId) {
    const { data, error } = await supabase.functions.invoke('get-google-reviews', {
      body: { embed_for_place_id: placeId },
    });
    if (error) throw new Error(error.message || String(error));
    if (!data?.ok || typeof data.embedUrl !== 'string') {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Brak adresu embed mapy.');
    }
    if (!data.embedUrl.startsWith('https://')) {
      throw new Error('Nieprawidłowy adres embed mapy.');
    }
    return data.embedUrl;
  }

  async function fetchGoogleReviewsBundle(supabase, query, maxReviews) {
    const { data, error } = await supabase.functions.invoke('get-google-reviews', {
      body: { query, maxReviews: clampMaxReviews(maxReviews, 8) },
    });
    if (error) throw new Error(error.message || String(error));
    if (!data?.ok) {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Błąd pobierania opinii Google.');
    }
    return {
      placeId: typeof data.placeId === 'string' ? data.placeId : '',
      placeRating: data.placeRating ?? null,
      userRatingCount: data.userRatingCount ?? null,
      reviews: Array.isArray(data.reviews) ? data.reviews : [],
    };
  }

  function apiReviewsToContentRows(apiReviews) {
    return (apiReviews || []).map((r) => ({
      author: String(r?.author_name || '').trim() || 'Klient',
      content: String(r?.text || ''),
      stars: Number(r?.rating) > 0 ? Number(r.rating) : 5,
      publishTime: typeof r?.publishTime === 'string' ? r.publishTime : '',
      logoImage: '',
    }));
  }

  /**
   * Uzupełnia contact.map_embed_url, gdy jest place_id bez gotowego URL.
   * @returns {boolean} czy zapisano nowy URL
   */
  async function syncMapEmbedIntoContact(supabase, contact) {
    if (!contact || typeof contact !== 'object') return false;
    const pid = String(contact.map_place_id || '').trim();
    if (!pid) return false;
    if (String(contact.map_embed_url || '').trim()) return false;
    contact.map_embed_url = await fetchMapEmbedUrl(supabase, pid);
    return true;
  }

  /**
   * Pobiera opinie z Google i zapisuje w content.pl (reviews + metadane w google_reviews).
   * @returns {boolean} czy wykonano sync
   */
  async function syncGoogleReviewsIntoPl(supabase, pl) {
    if (!pl || typeof pl !== 'object') return false;
    const gr = pl.google_reviews;
    if (!gr || typeof gr !== 'object') return false;
    const query = String(gr.place_query || '').trim();
    if (!query) return false;

    const bundle = await fetchGoogleReviewsBundle(supabase, query, gr.max_reviews);
    const rows = apiReviewsToContentRows(bundle.reviews);
    if (rows.length) pl.reviews = rows;

    gr.cached_place_id = bundle.placeId || '';
    gr.cached_place_rating =
      bundle.placeRating != null && Number.isFinite(Number(bundle.placeRating))
        ? Number(bundle.placeRating)
        : null;
    gr.cached_user_rating_count =
      bundle.userRatingCount != null && Number.isFinite(Number(bundle.userRatingCount))
        ? Number(bundle.userRatingCount)
        : null;
    gr.google_synced_at = new Date().toISOString();
    gr.google_sync_query = query;
    return true;
  }

  /**
   * Przed zapisem strony: mapa + opinie (gdy skonfigurowane).
   * @returns {{ mapEmbed: boolean, reviews: boolean, warnings: string[] }}
   */
  async function syncGooglePlacesForPublish(supabase, pl) {
    const out = { mapEmbed: false, reviews: false, warnings: [] };
    if (!supabase || !pl) return out;

    const contact = pl.contact;
    if (contact && String(contact.map_place_id || '').trim()) {
      try {
        out.mapEmbed = await syncMapEmbedIntoContact(supabase, contact);
      } catch (e) {
        console.warn('DFOPS sync map embed:', e);
        out.warnings.push('mapa');
      }
    }

    const gr = pl.google_reviews;
    const query = gr && typeof gr === 'object' ? String(gr.place_query || '').trim() : '';
    if (query) {
      try {
        out.reviews = await syncGoogleReviewsIntoPl(supabase, pl);
      } catch (e) {
        console.warn('DFOPS sync google reviews:', e);
        out.warnings.push('opinie Google');
      }
    }

    return out;
  }

  window.DFOPS_googlePlacesSync = {
    fetchMapEmbedUrl,
    fetchGoogleReviewsBundle,
    apiReviewsToContentRows,
    syncMapEmbedIntoContact,
    syncGoogleReviewsIntoPl,
    syncGooglePlacesForPublish,
  };
})();
