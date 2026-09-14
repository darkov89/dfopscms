/**
 * DFCMS AI Studio — Katalog Komponentów (Klocków)
 * Logika panelu przeglądania i natychmiastowego wstawiania bloków do podglądu (Zero-LLM latency / 0 quota).
 */
;(function (root) {
  'use strict';

  function attachStudioCatalog(app) {
    if (!app || typeof app !== 'object') return;

    // Metody otwierania / zamykania
    app.openCatalog = function () {
      this.catalogOpen = true;
    };

    app.closeCatalog = function () {
      this.catalogOpen = false;
    };

    app.setCatalogFilter = function (filterId) {
      this.catalogFilter = filterId || 'all';
    };

    // Pobieranie grup katalogu z czystego rejestru
    app.getCatalogGroups = function () {
      const reg = root.DFOPS_customBlocksRegistry;
      return reg && typeof reg.getCatalogGroups === 'function'
        ? reg.getCatalogGroups()
        : [
            { id: 'all', label: 'Wszystkie' },
            { id: 'offer', label: 'Oferta i cennik' },
            { id: 'trust', label: 'Opinie i zaufanie' },
            { id: 'contact', label: 'Kontakt' },
            { id: 'info', label: 'Informacje i FAQ' },
            { id: 'hero', label: 'Ekrany główne' },
          ];
    };

    // Pobieranie listy bloków z rejestru z adnotacją obecności na stronie
    app.getCatalogBlocksList = function () {
      const reg = root.DFOPS_customBlocksRegistry;
      if (!reg || typeof reg.getCatalogBlocks !== 'function') return [];

      const currentBlocks = this.pageRow?.draft_content?.blocks || [];
      const all = reg.getCatalogBlocks(currentBlocks);

      if (!this.catalogFilter || this.catalogFilter === 'all') {
        return all;
      }
      return all.filter((b) => b.catalog_group === this.catalogFilter);
    };

    // Całkowita liczba dostępnych typów bloków
    app.getCatalogTotalCount = function () {
      const reg = root.DFOPS_customBlocksRegistry;
      if (!reg || !reg.BLOCK_DEFINITIONS) return 0;
      return Object.keys(reg.BLOCK_DEFINITIONS).length;
    };

    // Błyskawiczne dodanie bloku z katalogu na żywy podgląd (lokalny insertBlock)
    app.insertBlockFromCatalog = async function (blockType) {
      const reg = root.DFOPS_customBlocksRegistry;
      if (!reg || typeof reg.insertBlock !== 'function') {
        if (typeof this.showToast === 'function') this.showToast('Błąd rejestru bloków');
        return;
      }

      const def = reg.BLOCK_DEFINITIONS ? reg.BLOCK_DEFINITIONS[blockType] : null;
      if (!def) {
        if (typeof this.showToast === 'function') this.showToast('Nieznany typ sekcji: ' + blockType);
        return;
      }

      if (!this.pageRow) return;
      if (!this.pageRow.draft_content) this.pageRow.draft_content = { blocks: [] };
      if (!Array.isArray(this.pageRow.draft_content.blocks)) {
        this.pageRow.draft_content.blocks = [];
      }

      const currentBlocks = this.pageRow.draft_content.blocks;
      const alreadyExists = currentBlocks.some((b) => b && b.type === blockType);

      // Jeśli sekcja jest unikalna i już istnieje, nie dodawaj duplikatu — zaproponuj edycję
      if (def.allow_multiple === false && alreadyExists) {
        this.closeCatalog();
        this.messages.push({
          role: 'model',
          text: `Sekcja „${def.label}” znajduje się już na Twojej stronie. Co chcesz w niej zmienić?`,
        });
        if (typeof this.scrollToBottom === 'function') this.scrollToBottom();
        return;
      }

      // 1. Zapisz snapshot przed zmianą (działa Undo!)
      if (typeof this.pushDraftSnapshot === 'function') {
        this.pushDraftSnapshot();
      }

      // 2. Wstaw blok lokalnie
      const res = reg.insertBlock(currentBlocks, null, blockType);
      if (!res.success) {
        if (typeof this.showToast === 'function') this.showToast(res.error || 'Nie udało się dodać sekcji');
        return;
      }

      this.pageRow.draft_content.blocks = res.blocks;

      // 3. Zapisz w bazie (Supabase / PageRepository)
      const repo = root.DFOPS_pageRepository;
      let saveFailed = false;
      if (repo && this.currentUser && this.pageId) {
        this.catalogSaving = true;
        try {
          const saveRes = await repo.savePageByIdForOwner(this.currentUser.id, this.pageId, {
            draft_content: this.pageRow.draft_content,
          });
          if (saveRes && saveRes.error) {
            saveFailed = true;
            console.warn('[StudioCatalog] Błąd zapisu draftu:', saveRes.error);
          }
        } catch (err) {
          saveFailed = true;
          console.warn('[StudioCatalog] Wyjątek podczas zapisu draftu:', err);
        } finally {
          this.catalogSaving = false;
        }
      }

      if (saveFailed) {
        // Rollback do poprzedniego stanu — nie okłamuj użytkownika
        if (this.draftHistory && this.draftHistory.length > 0) {
          const prev = this.draftHistory.pop();
          this.pageRow.draft_content = prev;
        } else {
          this.pageRow.draft_content.blocks = currentBlocks;
        }
        if (typeof this.refreshPreview === 'function') {
          this.refreshPreview();
        }
        if (typeof this.showToast === 'function') {
          this.showToast('Nie udało się zapisać sekcji w bazie danych.');
        }
        return;
      }

      // 4. Odśwież natychmiast podgląd iframe
      if (typeof this.refreshPreview === 'function') {
        this.refreshPreview();
      }

      // 5. Zamknij katalog
      this.closeCatalog();
      if (typeof this.showToast === 'function') {
        this.showToast('Dodano sekcję: ' + def.label);
      }

      // 6. Wstrzyknij lokalną, deterministyczną wiadomość asystenta do czatu (bez uderzania w LLM i cooldown 30s!)
      const requiredFields = Array.isArray(def.required_fields) ? def.required_fields : [];
      let assistantMsg = '';
      if (requiredFields.length > 0 && requiredFields[0]?.ask) {
        assistantMsg = `Dodałem sekcję „${def.label}” na stronę! ${requiredFields[0].ask}`;
      } else {
        assistantMsg = `Dodałem sekcję „${def.label}” na Twoją stronę. Zobacz na podglądzie po prawej — co chciałbyś w niej dostosować?`;
      }

      this.messages.push({
        role: 'model',
        text: assistantMsg,
      });

      if (typeof this.scrollToBottom === 'function') {
        this.scrollToBottom();
      }
    };
  }

  root.DFOPS_attachStudioCatalog = attachStudioCatalog;
})(typeof window !== 'undefined' ? window : this);
