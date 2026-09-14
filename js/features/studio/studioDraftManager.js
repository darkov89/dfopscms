/**
 * DFCMS — Studio Draft Manager (Wzorzec Attach)
 * Dołącza metody zarządzania historią i odrzucania zmian AI do instancji createStudioApp.
 * Zgodne z wytycznymi Anti-Monolith (brak arrow functions, brak spreadu).
 */
;(function (root) {
  'use strict';

  function attachStudioDraftManager(app) {
    if (!app || typeof app !== 'object') return;

    app.rejectMessageDraft = async function (msg) {
      if (!msg || !msg.snapshotBefore || this.agentThinking || this.historySaving || this.publishing) return;

      const rules = root.DFOPS_studioDraftHistoryRules;
      if (!rules) {
        console.warn('[StudioDraftManager] Brak modułu reguł studioDraftHistoryRules.');
        return;
      }

      const repo = root.DFOPS_pageRepository;
      if (!repo || !this.currentUser || !this.pageId) {
        this.showToast('Brak uprawnień do edycji strony.');
        return;
      }

      const snapshotToRestore = rules.cloneDraft(msg.snapshotBefore);
      if (!snapshotToRestore) {
        this.showToast('Nie można odnaleźć wersji sprzed zmiany.');
        return;
      }

      this.historySaving = true;
      try {
        // 1. Save-first: najpierw zapisujemy stan do bazy danych
        const res = await repo.savePageByIdForOwner(this.currentUser.id, this.pageId, {
          draft_content: snapshotToRestore,
        });

        if (res?.error) {
          console.error('[StudioDraftManager] Błąd zapisu odrzuconego draftu do bazy:', res.error);
          this.showToast('Nie udało się zapisać zmian w bazie. Spróbuj ponownie.');
          return;
        }

        // 2. Sukces DB -> dopiero teraz oznaczamy wiadomość jako odrzuconą
        rules.markMessageRejected(this.messages, msg.id);

        // 3. Synchronizacja stosów historii:
        // Wyczyść wpisy w draftHistory, które nastąpiły w lub po przywracanym stanie,
        // aby toolbar Undo nie przywracał odrzuconych wersji AI
        const snapStr = JSON.stringify(snapshotToRestore);
        const matchIdx = (this.draftHistory || []).findIndex(function (s) {
          return JSON.stringify(s) === snapStr;
        });
        if (matchIdx !== -1) {
          this.draftHistory = this.draftHistory.slice(0, matchIdx);
        }
        this.draftRedoStack = [];

        this.pageRow.draft_content = snapshotToRestore;
        if (snapshotToRestore.theme_type) {
          this.themeType = snapshotToRestore.theme_type;
        }

        this.refreshPreview();
        this.showToast('Odrzucono zmianę AI — przywrócono poprzednią wersję ↩️');
      } catch (err) {
        console.error('[StudioDraftManager] Błąd podczas odrzucania zmiany:', err);
        this.showToast('Wystąpił błąd podczas odrzucania zmiany.');
      } finally {
        this.historySaving = false;
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { attachStudioDraftManager };
  }
  if (root) {
    root.DFOPS_attachStudioDraftManager = attachStudioDraftManager;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.DFOPS_attachStudioDraftManager = attachStudioDraftManager;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
