;(function () {
  function setCssVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  function applyThemeStyling(settings, theme, scope) {
    const cfg = window.DFOPS_CONFIG || {};
    const resolvedScope = scope || 'public';

    /** Panel admina: stały, neutralny chrome (gray + złoto DFOPS) — bez gradientu z kolorystyki strony klienta. */
    if (resolvedScope === 'admin') {
      document.documentElement.setAttribute('data-dfops-scope', 'admin');
      document.documentElement.setAttribute('data-theme', '');
      document.documentElement.setAttribute('data-bg-style', 'admin-shell');
      setCssVar('--accent', '#D4AF37');
      setCssVar('--accent-contrast', '#121212');
      setCssVar('--bg-a', '#f9fafb');
      setCssVar('--bg-b', '#f3f4f6');
      setCssVar('--bg-c', 'transparent');
      setCssVar('--bg-texture-opacity', '0');
      setCssVar('--surface-bg', '#ffffff');
      setCssVar('--surface-accent', '#f3f4f6');
      setCssVar('--surface-card', '#ffffff');
      setCssVar('--beauty-text', '#1f2937');
      setCssVar('--beauty-text-muted', 'rgba(31, 41, 55, 0.72)');
      setCssVar('--beauty-white', '#ffffff');
      const inter = cfg.fontByPreset?.inter;
      if (inter) {
        setCssVar('--font-sans', inter.sans);
        setCssVar('--font-serif', inter.serif);
      }
      setCssVar('--bg-main', '#f9fafb');
      setCssVar('--text-main', '#1f2937');
      setCssVar('--color-primary', '#D4AF37');
      setCssVar('--color-text-body', '#1f2937');
      setCssVar('--color-accent-text', '#121212');
      return;
    }

    const s = settings || {};
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

    /** Tekst na ciemnym tle: unikamy czystej #fff (męczy wzrok); slate-200 */
    const darkBodyText = '#E2E8F0';

    // Beauty text contrast for dark backgrounds (barber luxe)
    if (theme === 'beauty') {
      const isDark = (bgStyle === 'smoky' || bgStyle === 'glow');
      setCssVar('--beauty-text', isDark ? darkBodyText : '#2b2b2b');
      setCssVar('--beauty-white', '#ffffff');
    }

    // Consultant: opcjonalna pełna paleta per color_preset (np. dfops-tech), inaczej darkMode vs jasny
    if (theme === 'consultant') {
      const presetPalette = (cfg.consultantPresetPalette || {})[s.color_preset];
      if (presetPalette) {
        setCssVar('--accent', presetPalette.accent);
        setCssVar('--accent-contrast', presetPalette.accentContrast || '#121212');
        setCssVar('--bg-a', presetPalette.bgA);
        setCssVar('--bg-b', presetPalette.bgB);
        setCssVar('--bg-c', presetPalette.bgC);
        if (presetPalette.bgTextureOpacity != null) {
          setCssVar('--bg-texture-opacity', String(presetPalette.bgTextureOpacity));
        }
        setCssVar('--surface-bg', presetPalette.surfaceBg);
        setCssVar('--surface-accent', presetPalette.surfaceAccent);
        setCssVar('--surface-card', presetPalette.surfaceCard);
        setCssVar('--beauty-text', darkBodyText);
        setCssVar('--beauty-text-muted', presetPalette.textMuted);
        setCssVar('--beauty-white', '#ffffff');
      } else {
        const isDark = !!s.darkMode;
        const gradientStyle = isDark ? 'glow' : 'clean';
        const gradientBg = (cfg.backgroundByStyle || {})[gradientStyle] || cfg.backgroundByStyle?.glow;
        if (gradientBg) {
          setCssVar('--bg-a', gradientBg.a);
          setCssVar('--bg-b', gradientBg.b);
          setCssVar('--bg-c', gradientBg.c);
          setCssVar('--bg-texture-opacity', String(gradientBg.texture ?? 0.06));
        }
        if (isDark) {
          setCssVar('--surface-bg', 'transparent');
          setCssVar('--surface-accent', 'rgba(18,18,18,0.9)');
          setCssVar('--surface-card', 'rgba(18,18,18,0.55)');
          setCssVar('--beauty-text', darkBodyText);
          setCssVar('--beauty-white', '#ffffff');
        } else {
          setCssVar('--surface-bg', '#f4f4f5');
          setCssVar('--surface-accent', 'rgba(255,255,255,0.95)');
          setCssVar('--surface-card', 'rgba(255,255,255,0.92)');
          setCssVar('--beauty-text', '#171717');
          setCssVar('--beauty-white', '#ffffff');
        }
      }
    }

    if (theme === 'fitness') {
      setCssVar('--beauty-text', darkBodyText);
      setCssVar('--beauty-text-muted', '#a1a1aa');
      setCssVar('--beauty-white', '#fafafa');
      setCssVar('--accent-contrast', '#0c0a09');
    }

    const fonts = (cfg.fontByPreset || {})[(s.font_preset || (theme === 'beauty' ? 'poppins' : 'inter'))] || cfg.fontByPreset?.inter;
    if (fonts) {
      setCssVar('--font-sans', fonts.sans);
      setCssVar('--font-serif', fonts.serif);
    }

    // Główne tło / tekst strony (body) — każdy preset musi je nadpisać, żeby nie „zapinać” się przy zmianie jasny ↔ ciemny
    if (theme === 'beauty') {
      const isDark = bgStyle === 'smoky' || bgStyle === 'glow';
      setCssVar('--bg-main', isDark ? '#0b0b0f' : '#Fdfbf7');
      setCssVar('--text-main', isDark ? darkBodyText : '#2b2b2b');
    } else if (theme === 'consultant') {
      const presetPalette = (cfg.consultantPresetPalette || {})[s.color_preset];
      if (presetPalette) {
        setCssVar('--bg-main', presetPalette.bgA || '#0B132B');
        setCssVar('--text-main', darkBodyText);
      } else {
        const isDark = !!s.darkMode;
        setCssVar('--bg-main', isDark ? '#121212' : '#ffffff');
        setCssVar('--text-main', isDark ? darkBodyText : '#1f2937');
      }
    } else if (theme === 'fitness') {
      setCssVar('--bg-main', '#09090b');
      setCssVar('--text-main', '#fafafa');
    } else {
      setCssVar('--bg-main', 'transparent');
      setCssVar('--text-main', '#ffffff');
    }

    const root = document.documentElement;
    const accentResolved = getComputedStyle(root).getPropertyValue('--accent').trim() || accent;
    const beautyTextResolved = getComputedStyle(root).getPropertyValue('--beauty-text').trim();
    const accentContrastResolved = getComputedStyle(root).getPropertyValue('--accent-contrast').trim() || '#121212';
    setCssVar('--color-primary', accentResolved);
    setCssVar(
      '--color-text-body',
      beautyTextResolved ||
        (theme === 'beauty' ? '#2b2b2b' : theme === 'consultant' ? '#171717' : theme === 'fitness' ? darkBodyText : darkBodyText)
    );
    setCssVar('--color-accent-text', accentContrastResolved);
  }

  window.DFOPS_applyThemeStyling = applyThemeStyling;
})();

