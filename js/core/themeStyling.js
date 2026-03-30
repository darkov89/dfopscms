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
        setCssVar('--beauty-text', presetPalette.text);
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
          setCssVar('--beauty-text', '#E5E7EB');
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

    const fonts = (cfg.fontByPreset || {})[(s.font_preset || (theme === 'beauty' ? 'poppins' : 'inter'))] || cfg.fontByPreset?.inter;
    if (fonts) {
      setCssVar('--font-sans', fonts.sans);
      setCssVar('--font-serif', fonts.serif);
    }
  }

  window.DFOPS_applyThemeStyling = applyThemeStyling;
})();

