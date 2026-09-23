/**
 * DFCMS — Studio Theme & Palette Customizer (Wzorzec Attach)
 * Dołącza wizualny panel stylów, palet i typografii do instancji createStudioApp.
 * Zgodny z Anti-Monolith (wzorzec attach, brak arrow functions na metodach instancji).
 */
;(function (root) {
  "use strict";

  var PALETTE_COLORS = {
    dark_gold: "#D4AF37",
    gold: "#D4AF37",
    amber: "#f59e0b",
    warm_amber: "#f59e0b",
    emerald: "#10b981",
    green: "#10b981",
    cobalt: "#3b82f6",
    blue: "#3b82f6",
    crimson: "#ef4444",
    red: "#ef4444",
    silver: "#94a3b8",
    dark_silver: "#94a3b8",
    clean_light: "#2563eb",
  };

  function attachStudioThemeCustomizer(app) {
    if (!app || typeof app !== "object") return;

    app.themeCustomizerOpen = false;

    app.availablePalettes = [
      { id: "dark_gold", name: "Złoto & Czerń", color: "#D4AF37" },
      { id: "amber", name: "Ciepły Bursztyn", color: "#f59e0b" },
      { id: "emerald", name: "Szmaragdowa Zieleń", color: "#10b981" },
      { id: "cobalt", name: "Kobaltowy Błękit", color: "#3b82f6" },
      { id: "crimson", name: "Karminowa Czerwień", color: "#ef4444" },
      { id: "silver", name: "Tytanowe Srebro", color: "#94a3b8" },
      { id: "clean_light", name: "Klasyczny Błękit", color: "#2563eb" },
    ];

    app.availableFontThemes = [
      { id: "cinematic_sans", name: "Kinowy Sans (Inter + Cinzel)", desc: "Dla filmowców, marek premium i twórców" },
      { id: "modern_display", name: "Modern Display (Space Grotesk)", desc: "Dla architektury, designu i technologii" },
      { id: "classic_clean", name: "Czysty Modern (Inter)", desc: "Dla wizytówek, fachowców i gabinetów" },
    ];

    app.toggleThemeCustomizer = function () {
      this.themeCustomizerOpen = !this.themeCustomizerOpen;
    };

    app.selectPalette = async function (paletteId) {
      if (!paletteId || !this.pageRow || !this.pageRow.draft_content) return;
      var color = PALETTE_COLORS[paletteId] || "#D4AF37";

      var reg = root.DFOPS_customBlocksRegistry;
      if (!reg || typeof reg.updateDesign !== "function") return;

      this.pushDraftSnapshot();
      reg.updateDesign(this.pageRow.draft_content, { palette: paletteId, accentColor: color });

      // Natychmiastowy preview przez postMessage do iframe (0 lag)
      var iframe = document.getElementById("dfcms-studio-iframe");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: "dfcms:theme-preview",
          design: { palette: paletteId, accentColor: color, themeType: this.themeType },
        }, window.location.origin);
      }

      var repo = root.DFOPS_pageRepository;
      if (repo && this.currentUser && this.pageId) {
        try {
          await repo.savePageByIdForOwner(this.currentUser.id, this.pageId, {
            draft_content: this.pageRow.draft_content,
          });
          this.showToast("Zastosowano paletę " + paletteId + " 🎨");
        } catch (err) {
          console.warn("[StudioThemeCustomizer] Błąd zapisu palety:", err);
        }
      }
    };

    app.selectThemeType = async function (type) {
      if (!type || !this.pageRow || !this.pageRow.draft_content) return;
      if (type !== "quick_card" && type !== "cinematic") return;

      var reg = root.DFOPS_customBlocksRegistry;
      if (!reg || typeof reg.updateDesign !== "function") return;

      this.pushDraftSnapshot();
      reg.updateDesign(this.pageRow.draft_content, { themeType: type });
      this.themeType = type;

      var iframe = document.getElementById("dfcms-studio-iframe");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: "dfcms:theme-preview",
          design: { themeType: type },
        }, window.location.origin);
      }

      var repo = root.DFOPS_pageRepository;
      if (repo && this.currentUser && this.pageId) {
        try {
          await repo.savePageByIdForOwner(this.currentUser.id, this.pageId, {
            draft_content: this.pageRow.draft_content,
          });
          this.refreshPreview();
          this.showToast(type === "cinematic" ? "Przełączono na styl Kinowy (Dark) ✨" : "Przełączono na styl Wizytówki (Light) ⚡");
        } catch (err) {
          console.warn("[StudioThemeCustomizer] Błąd zapisu stylu:", err);
        }
      }
    };

    app.selectFontTheme = async function (fontThemeId) {
      if (!fontThemeId || !this.pageRow || !this.pageRow.draft_content) return;

      var reg = root.DFOPS_customBlocksRegistry;
      if (!reg || typeof reg.updateDesign !== "function") return;

      this.pushDraftSnapshot();
      reg.updateDesign(this.pageRow.draft_content, { fontTheme: fontThemeId });

      var repo = root.DFOPS_pageRepository;
      if (repo && this.currentUser && this.pageId) {
        try {
          await repo.savePageByIdForOwner(this.currentUser.id, this.pageId, {
            draft_content: this.pageRow.draft_content,
          });
          this.refreshPreview();
          this.showToast("Zaktualizowano krój pisma ✍️");
        } catch (err) {
          console.warn("[StudioThemeCustomizer] Błąd zapisu fontu:", err);
        }
      }
    };
  }

  root.DFOPS_attachStudioThemeCustomizer = attachStudioThemeCustomizer;
})(typeof globalThis !== "undefined" ? globalThis : this);
