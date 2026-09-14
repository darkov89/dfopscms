/**
 * DFCMS — Reguły historii i odrzucania zmian w AI Studio
 * Czyste funkcje zarządzające powiązaniem wiadomości czatu z migawkami stanu.
 * Zero zależności od Alpine, DOM i Supabase.
 */
;(function (root) {
  'use strict';

  function cloneDraft(draft) {
    if (!draft || typeof draft !== 'object') return null;
    return JSON.parse(JSON.stringify(draft));
  }

  function createAiMessage(params) {
    const p = params || {};
    const hasChanges = Boolean(p.hasChanges && p.snapshotBefore);
    return {
      id: p.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: p.role || 'model',
      text: p.text || '',
      hasChanges,
      snapshotBefore: hasChanges ? cloneDraft(p.snapshotBefore) : null,
      rejected: false,
      stale: false,
    };
  }

  /**
   * Oznacza wskazaną wiadomość jako odrzuconą,
   * a wszystkie nowsze wiadomości posiadające zmiany jako przestarzałe (stale).
   * Zwraca snapshot, który należy przywrócić.
   *
   * @param {Array<object>} messages
   * @param {string|number} targetIdentifier - id lub indeks wiadomości
   * @returns {{ snapshotToRestore: object | null, targetMessage: object | null }}
   */
  function markMessageRejected(messages, targetIdentifier) {
    if (!Array.isArray(messages)) return { snapshotToRestore: null, targetMessage: null };

    const targetIdx = typeof targetIdentifier === 'number'
      ? targetIdentifier
      : messages.findIndex((m) => m && m.id === targetIdentifier);

    if (targetIdx === -1 || !messages[targetIdx]) {
      return { snapshotToRestore: null, targetMessage: null };
    }

    const target = messages[targetIdx];
    if (!target.snapshotBefore || target.rejected) {
      return { snapshotToRestore: null, targetMessage: target };
    }

    target.rejected = true;
    target.hasChanges = false;

    // Wszystkie późniejsze wiadomości ze zmianami stają się stale (unieważnione)
    for (let i = targetIdx + 1; i < messages.length; i++) {
      if (messages[i] && messages[i].hasChanges) {
        messages[i].stale = true;
        messages[i].hasChanges = false;
      }
    }

    return {
      snapshotToRestore: cloneDraft(target.snapshotBefore),
      targetMessage: target,
    };
  }

  const api = {
    cloneDraft,
    createAiMessage,
    markMessageRejected,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DFOPS_studioDraftHistoryRules = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
