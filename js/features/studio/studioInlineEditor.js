/**
 * DFCMS — Studio Inline Editor & Visual Canvas Controller (Wzorzec Attach)
 * Dołącza obsługę zdarzeń edycji bezpośredniej, przesuwania i usuwania bloków do instancji createStudioApp.
 * Zgodny z Anti-Monolith (wzorzec attach, brak arrow functions na metodach instancji).
 */
;(function (root) {
  "use strict";

  function attachStudioInlineEditor(app) {
    if (!app || typeof app !== "object") return;

    app.inlineDebounceTimer = null;
    app.catalogTargetAfterBlockId = null;

    app.initInlineEditor = function () {
      var self = this;
      window.addEventListener("message", function (e) {
        if (e.origin !== window.location.origin) return;
        if (!e.data || typeof e.data.type !== "string") return;

        if (e.data.type === "dfcms:inline-edit") {
          self.handleInlineEditMessage(e.data);
        } else if (e.data.type === "dfcms:block-move") {
          self.handleBlockMoveMessage(e.data);
        } else if (e.data.type === "dfcms:block-remove") {
          self.handleBlockRemoveMessage(e.data);
        } else if (e.data.type === "dfcms:block-ai-prompt") {
          self.handleBlockAiPromptMessage(e.data);
        } else if (e.data.type === "dfcms:open-catalog-at") {
          self.catalogTargetAfterBlockId = e.data.afterBlockId || null;
          if (typeof self.openCatalog === "function") {
            self.openCatalog();
          }
        }
      });
    };

    app.handleInlineEditMessage = function (data) {
      var blockId = data.blockId;
      var path = data.path;
      var value = data.value;

      if (!blockId || !path || !this.pageRow || !this.pageRow.draft_content) return;

      var registry = root.DFOPS_customBlocksRegistry;
      if (!registry || typeof registry.applyBlockUpdate !== "function") return;

      // Zapisz migawkę do historii przy pierwszej edycji w serii
      if (!this.inlineDebounceTimer) {
        this.pushDraftSnapshot();
      }

      // Atomowa mutacja in-memory
      registry.applyBlockUpdate(this.pageRow.draft_content, blockId, path, value);

      // Debounce auto-save do Supabase
      if (this.inlineDebounceTimer) {
        clearTimeout(this.inlineDebounceTimer);
      }

      var self = this;
      this.inlineDebounceTimer = setTimeout(async function () {
        self.inlineDebounceTimer = null;
        var repo = root.DFOPS_pageRepository;
        if (repo && self.currentUser && self.pageId) {
          try {
            await repo.savePageByIdForOwner(self.currentUser.id, self.pageId, {
              draft_content: self.pageRow.draft_content,
            });
            self.showToast("Zapisano zmianę ✍️");
          } catch (err) {
            console.warn("[StudioInlineEditor] Auto-save failed:", err);
          }
        }
      }, 600);
    };

    app.handleBlockMoveMessage = async function (data) {
      var blockId = data.blockId;
      var direction = data.direction; // "up" | "down"
      if (!blockId || !direction || !this.pageRow || !this.pageRow.draft_content) return;

      var rules = root.DFOPS_studioInlineRules;
      if (!rules || typeof rules.moveBlockInList !== "function") return;

      var currentBlocks = this.pageRow.draft_content.blocks || [];
      var res = rules.moveBlockInList(currentBlocks, blockId, direction);
      if (!res.changed) return;

      this.pushDraftSnapshot();
      this.pageRow.draft_content.blocks = res.blocks;

      var repo = root.DFOPS_pageRepository;
      if (repo && this.currentUser && this.pageId) {
        try {
          await repo.savePageByIdForOwner(this.currentUser.id, this.pageId, {
            draft_content: this.pageRow.draft_content,
          });
          this.refreshPreview();
          this.showToast(direction === "up" ? "Przesunięto sekcję w górę ↑" : "Przesunięto sekcję w dół ↓");
        } catch (err) {
          console.error("[StudioInlineEditor] Błąd zapisu przesunięcia:", err);
          this.showToast("Nie udało się przesunąć sekcji.");
        }
      }
    };

    app.handleBlockRemoveMessage = async function (data) {
      var blockId = data.blockId;
      if (!blockId || !this.pageRow || !this.pageRow.draft_content) return;

      var rules = root.DFOPS_studioInlineRules;
      if (!rules || typeof rules.removeBlockFromList !== "function") return;

      var currentBlocks = this.pageRow.draft_content.blocks || [];
      var res = rules.removeBlockFromList(currentBlocks, blockId);
      if (!res.changed) return;

      this.pushDraftSnapshot();
      this.pageRow.draft_content.blocks = res.blocks;

      var repo = root.DFOPS_pageRepository;
      if (repo && this.currentUser && this.pageId) {
        try {
          await repo.savePageByIdForOwner(this.currentUser.id, this.pageId, {
            draft_content: this.pageRow.draft_content,
          });
          this.refreshPreview();
          this.showToast("Usunięto sekcję. Użyj ↩️ Cofnij, aby przywrócić.");
        } catch (err) {
          console.error("[StudioInlineEditor] Błąd zapisu usunięcia:", err);
          this.showToast("Nie udało się usunąć sekcji.");
        }
      }
    };

    app.handleBlockAiPromptMessage = function (data) {
      var blockId = data.blockId;
      var heading = data.heading || blockId;
      this.userInput = "Popraw lub przeprojektuj sekcję \"" + heading + "\": ";
      if (!this.chatOpen) {
        this.chatOpen = true;
      }
      this.mobileTab = "chat";
      var self = this;
      this.$nextTick(function () {
        var input = document.querySelector("input[x-model=\"userInput\"]");
        if (input) {
          input.focus();
          input.selectionStart = input.selectionEnd = input.value.length;
        }
      });
    };
  }

  root.DFOPS_attachStudioInlineEditor = attachStudioInlineEditor;
})(typeof globalThis !== "undefined" ? globalThis : this);
