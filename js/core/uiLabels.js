/**
 * Etykiety UI strony (Telefon, Polityka…): nie wymagają edycji w panelu,
 * ale AI adapt je tłumaczy (content.<locale>.ui).
 */
;(function () {
  const DEFAULT_UI_LABELS = {
    phone: 'Telefon',
    email: 'E-mail',
    address: 'Adres',
    privacy_policy: 'Polityka prywatności',
    terms: 'Regulamin',
    back_to_site: '← Wróć na stronę',
    map_unavailable: 'Mapa niedostępna',
    cookies_accept_all: 'Akceptuję wszystkie',
    cookies_essential_only: 'Tylko niezbędne',
    cookies_customize: 'Dostosuj',
    cookies_necessary: 'Niezbędne',
    cookies_analytics: 'Analityczne',
    cookies_marketing: 'Marketingowe',
    cookies_save: 'Zapisz ustawienia',
    cookies_banner:
      'Ta strona korzysta z ciasteczek, aby zapewnić działanie podstawowych funkcji oraz (opcjonalnie) analityki i marketingu. Możesz wybrać, które kategorie akceptujesz.',
  };

  function ensureUiLabels(pack) {
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return pack;
    if (!pack.ui || typeof pack.ui !== 'object' || Array.isArray(pack.ui)) {
      pack.ui = {};
    }
    const keys = Object.keys(DEFAULT_UI_LABELS);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!String(pack.ui[k] == null ? '' : pack.ui[k]).trim()) {
        pack.ui[k] = DEFAULT_UI_LABELS[k];
      }
    }
    return pack;
  }

  function uiLabelFromPack(pack, key) {
    const k = String(key || '').trim();
    if (!k) return '';
    const fromUi =
      pack && pack.ui && typeof pack.ui === 'object'
        ? String(pack.ui[k] == null ? '' : pack.ui[k]).trim()
        : '';
    if (fromUi) return fromUi;
    if (k === 'cookies_accept_all' && pack && pack.cookies) {
      const a = String(pack.cookies.accept == null ? '' : pack.cookies.accept).trim();
      if (a) return a;
    }
    if (k === 'cookies_banner' && pack && pack.cookies) {
      const t = String(pack.cookies.text == null ? '' : pack.cookies.text).trim();
      if (t) return t;
    }
    return DEFAULT_UI_LABELS[k] || k;
  }

  window.DFOPS_DEFAULT_UI_LABELS = DEFAULT_UI_LABELS;
  window.DFOPS_ensureUiLabels = ensureUiLabels;
  window.DFOPS_uiLabelFromPack = uiLabelFromPack;
})();
