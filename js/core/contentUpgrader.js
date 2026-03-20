;(function () {
  /**
   * Pełna normalizacja contentu pod dany motyw: merge z szablonem + domyślne pola
   * (settings, contact, social, google_reviews, menu beauty itd.).
   * Sygnatura: (content, theme) — spójna z panelem admina.
   */
  function normalizeContent(content, theme) {
    const merged = window.DFOPS_mergeContentWithTemplate(theme, content);
    const pl = merged.pl;
    if (!pl) merged.pl = {};
    if (!pl.settings) pl.settings = {};

    if (!pl.settings.color_preset) pl.settings.color_preset = theme === 'beauty' ? 'beige' : 'gold';
    if (!pl.settings.background_style) pl.settings.background_style = theme === 'beauty' ? 'soft' : 'glow';
    if (!pl.settings.font_preset) pl.settings.font_preset = theme === 'beauty' ? 'poppins' : 'inter';

    if (!pl.nav) pl.nav = {};
    if (theme === 'beauty') {
      if (!pl.nav.menu) pl.nav.menu = { about: 'O nas', pricing: 'Cennik', gallery: 'Galeria', faq: 'Q&A', contact: 'Kontakt' };
      if (pl.nav.menu.about === undefined) pl.nav.menu.about = 'O nas';
      if (pl.nav.menu.pricing === undefined) pl.nav.menu.pricing = 'Cennik';
      if (pl.nav.menu.gallery === undefined) pl.nav.menu.gallery = 'Galeria';
      if (pl.nav.menu.faq === undefined) pl.nav.menu.faq = 'Q&A';
      if (pl.nav.menu.contact === undefined) pl.nav.menu.contact = 'Kontakt';
    }

    if (!pl.contact) pl.contact = {};
    if (!pl.contact.map_embed_url) pl.contact.map_embed_url = '';

    if (!pl.google_reviews) pl.google_reviews = { embed_url: '', place_query: '', max_reviews: 6, title: 'Opinie z Google' };
    if (pl.google_reviews.embed_url === undefined) pl.google_reviews.embed_url = '';
    if (pl.google_reviews.place_query === undefined) pl.google_reviews.place_query = '';
    if (pl.google_reviews.max_reviews === undefined) pl.google_reviews.max_reviews = 6;
    if (pl.google_reviews.title === undefined) pl.google_reviews.title = 'Opinie z Google';

    if (!pl.gallery) pl.gallery = { title: 'Nasze realizacje', images: [] };
    if (!Array.isArray(pl.gallery.images)) pl.gallery.images = [];
    if (pl.gallery.title === undefined || pl.gallery.title === null) pl.gallery.title = 'Nasze realizacje';

    if (!pl.social) pl.social = {};
    if (pl.social.facebook === undefined) pl.social.facebook = '';
    if (pl.social.instagram === undefined) pl.social.instagram = '';
    if (pl.social.tiktok === undefined) pl.social.tiktok = '';

    function ensureSeo(block) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return;
      if (!block.seo) {
        block.seo = { title: '', description: '', ogImage: '' };
      } else {
        if (block.seo.title === undefined || block.seo.title === null) block.seo.title = '';
        if (block.seo.description === undefined || block.seo.description === null) block.seo.description = '';
        if (block.seo.ogImage === undefined || block.seo.ogImage === null) block.seo.ogImage = '';
      }
    }

    for (const _lang of Object.keys(merged)) {
      ensureSeo(merged[_lang]);
    }

    return merged;
  }

  function upgradeContent(theme, content, targetVersion) {
    const normalized = normalizeContent(content, theme);
    if (!normalized.pl) normalized.pl = {};
    if (!normalized.pl.settings) normalized.pl.settings = {};
    normalized.pl.settings.template_version = targetVersion || window.DFOPS_LATEST_TEMPLATE_VERSION || 1;
    return normalized;
  }

  window.DFOPS_normalizeContent = normalizeContent;
  window.DFOPS_upgradeContent = upgradeContent;
})();
