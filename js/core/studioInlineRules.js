/**
 * DFCMS AI Studio — Czyste reguły manipulacji blokami i edycji inline.
 * Używany w Studio, podglądzie oraz testach Node.js.
 * Zgodny z Anti-Monolith (pure functions, zero zależności od DOM/Alpine).
 */
;(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DFOPS_studioInlineRules = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function deepClone(obj) {
    if (obj == null) return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Zwraca indeks bloku o podanym ID.
   */
  function findBlockIndex(blocks, blockId) {
    if (!Array.isArray(blocks) || !blockId) return -1;
    return blocks.findIndex(function (b) {
      return b && String(b.id) === String(blockId);
    });
  }

  /**
   * Zwraca blok o podanym ID lub null.
   */
  function findBlockById(blocks, blockId) {
    if (!Array.isArray(blocks) || !blockId) return null;
    var found = blocks.find(function (b) {
      return b && String(b.id) === String(blockId);
    });
    return found ? deepClone(found) : null;
  }

  /**
   * Przemieszcza blok o jeden stopień w górę lub w dół.
   * Zwraca nową tablicę bloków i flagę changed.
   */
  function moveBlockInList(blocks, blockId, direction) {
    if (!Array.isArray(blocks) || !blockId) {
      return { blocks: Array.isArray(blocks) ? deepClone(blocks) : [], changed: false };
    }
    var list = deepClone(blocks);
    var idx = findBlockIndex(list, blockId);
    if (idx === -1) return { blocks: list, changed: false };

    var targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) {
      return { blocks: list, changed: false };
    }

    var item = list.splice(idx, 1)[0];
    list.splice(targetIdx, 0, item);
    return { blocks: list, changed: true };
  }

  /**
   * Usuwa blok z listy.
   */
  function removeBlockFromList(blocks, blockId) {
    if (!Array.isArray(blocks) || !blockId) {
      return { blocks: Array.isArray(blocks) ? deepClone(blocks) : [], removedBlock: null, changed: false };
    }
    var list = deepClone(blocks);
    var idx = findBlockIndex(list, blockId);
    if (idx === -1) {
      return { blocks: list, removedBlock: null, changed: false };
    }

    var removed = list.splice(idx, 1)[0];
    return { blocks: list, removedBlock: removed, changed: true };
  }

  /**
   * Wstawia nowy blok po wskazanym ID (afterBlockId).
   * Jeśli afterBlockId jest puste lub nieznalezione, dokleja na koniec.
   */
  function insertBlockAt(blocks, blockToInsert, afterBlockId) {
    if (!blockToInsert || typeof blockToInsert !== "object") {
      return { blocks: Array.isArray(blocks) ? deepClone(blocks) : [], changed: false };
    }
    var list = Array.isArray(blocks) ? deepClone(blocks) : [];
    var blockClone = deepClone(blockToInsert);

    if (!afterBlockId) {
      list.push(blockClone);
      return { blocks: list, changed: true };
    }

    var idx = findBlockIndex(list, afterBlockId);
    if (idx === -1) {
      list.push(blockClone);
    } else {
      list.splice(idx + 1, 0, blockClone);
    }
    return { blocks: list, changed: true };
  }

  /**
   * Oblicza ścieżkę w obiekcie data bloku na podstawie atrybutów elementu DOM lub domyślnych reguł.
   */
  function resolveFieldPath(dataField, itemIndex, itemField) {
    if (dataField) return String(dataField).trim();
    if (itemIndex != null && itemIndex !== "" && itemField) {
      return "items." + Number(itemIndex) + "." + String(itemField).trim();
    }
    return "";
  }

  return {
    deepClone: deepClone,
    findBlockIndex: findBlockIndex,
    findBlockById: findBlockById,
    moveBlockInList: moveBlockInList,
    removeBlockFromList: removeBlockFromList,
    insertBlockAt: insertBlockAt,
    resolveFieldPath: resolveFieldPath,
  };
});
