;(function () {
  function setCssVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  function applyThemeStyling(settings, theme, scope) {
    const cfg = window.DFOPS_CONFIG || {};
    const s = settings || {};
    const resolvedScope = scope || 'public';
    const bgStyle = s.background_style || (theme === 'beauty' ? 'soft' : 'glow');

    document.documentElement.setAttribute('data-dfops-scope', resolvedScope);
    document.documentElement.setAttribute('data-theme', theme || '');
    document.documentElement.setAttribute('data-bg-style', bgStyle);

    const accent = (cfg.accentByPreset || {})[s.color_preset] || '#D4AF37';
    setCssVar('--accent', accent);
    setCssVar('--accent-contrast', '#121212');

    const bg = (cfg.backgroundByStyle || {})[bgStyle] || cfg.backgroundByStyle?.glow;
    if (bg) {
      setCssVar('--bg-a', bg.a);
      setCssVar('--bg-b', bg.b);
      setCssVar('--bg-c', bg.c);
      setCssVar('--bg-texture-opacity', String(bg.texture ?? 0.06));
    }

    const surface = (cfg.surfaceByStyle || {})[bgStyle] || cfg.surfaceByStyle?.soft;
    if (surface) {
      setCssVar('--surface-bg', surface.bg);
      setCssVar('--surface-accent', surface.accent);
      setCssVar('--surface-card', surface.card);
    }

    // Beauty text contrast for dark backgrounds (barber luxe)
    if (theme === 'beauty') {
      const isDark = (bgStyle === 'smoky' || bgStyle === 'glow');
      setCssVar('--beauty-text', isDark ? '#E5E7EB' : '#2b2b2b');
      setCssVar('--beauty-white', '#ffffff');
    }

    const fonts = (cfg.fontByPreset || {})[(s.font_preset || (theme === 'beauty' ? 'poppins' : 'inter'))] || cfg.fontByPreset?.inter;
    if (fonts) {
      setCssVar('--font-sans', fonts.sans);
      setCssVar('--font-serif', fonts.serif);
    }
  }

  window.DFOPS_applyThemeStyling = applyThemeStyling;
})();

