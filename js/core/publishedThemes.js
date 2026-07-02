/**
 * Opublikowane motywy routowane przez Cloudflare middleware (Workers — bez `window`).
 * Panel/kreator biorą listę z `js/templates/registry.js` (templatesV3).
 * Przy nowym szablonie: dodaj id tutaj + wpis w registry + `/templates/{id}.html`.
 */
;(function () {
  const PUBLISHED_THEME_IDS = [
    'beauty',
    'consultant',
    'fitness',
    'services',
    'gastro',
    'care',
  ];

  function getPublishedThemeIds() {
    return PUBLISHED_THEME_IDS.slice();
  }

  globalThis.DFOPS_PUBLISHED_THEME_IDS = PUBLISHED_THEME_IDS;
  globalThis.DFOPS_getPublishedThemeIds = getPublishedThemeIds;
})();
