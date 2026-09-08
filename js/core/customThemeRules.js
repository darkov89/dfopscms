/**
 * DFCMS — Czyste reguły rozstrzygania i leczenia motywu witryny
 * Zapewnia jednoznaczne źródło prawdy dla theme_type ('cinematic' | 'quick_card')
 * bez heurystyk niszczących rendering i bez zależności od DOM/Alpine.
 */
;(function (root) {
  'use strict';

  /**
   * Rozstrzyga motyw witryny.
   * Jeśli content posiada jawne pole theme_type ('cinematic' lub 'quick_card'), uznaje je za źródło prawdy.
   * W przeciwnym razie (brak pola / null) dokonuje jednorazowego 'leczenia' (healing):
   * sprawdza, czy zestaw bloków zawiera klocki wizytówki ('quick_hero', 'quick_contact_card').
   *
   * @param {object} content - Obiekt treści witryny (content lub draft_content)
   * @param {object} [pageRow] - Opcjonalny wiersz strony z bazy danych
   * @returns {{ themeType: 'cinematic' | 'quick_card', healed: boolean }}
   */
  function resolveThemeType(content, pageRow) {
    const rawType = content?.theme_type || pageRow?.theme_type;
    if (rawType === 'cinematic' || rawType === 'quick_card') {
      return {
        themeType: rawType,
        healed: false,
      };
    }

    const blocks = Array.isArray(content?.blocks)
      ? content.blocks
      : Array.isArray(pageRow?.content?.blocks)
        ? pageRow.content.blocks
        : [];

    const hasQuickBlocks = blocks.some(
      (b) => b && typeof b.type === 'string' && (b.type === 'quick_hero' || b.type === 'quick_contact_card')
    );

    return {
      themeType: hasQuickBlocks ? 'quick_card' : 'cinematic',
      healed: true,
    };
  }

  const api = {
    resolveThemeType,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DFOPS_customThemeRules = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
