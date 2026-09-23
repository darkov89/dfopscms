import test from "node:test";
import assert from "node:assert/strict";
import studioInlineRules from "../js/core/studioInlineRules.js";

test("findBlockIndex i findBlockById", () => {
  const blocks = [
    { id: "b1", type: "cinematic_hero" },
    { id: "b2", type: "projects_grid" },
    { id: "b3", type: "minimal_contact" },
  ];

  assert.equal(studioInlineRules.findBlockIndex(blocks, "b2"), 1);
  assert.equal(studioInlineRules.findBlockIndex(blocks, "b999"), -1);

  const found = studioInlineRules.findBlockById(blocks, "b3");
  assert.equal(found.type, "minimal_contact");
  assert.equal(studioInlineRules.findBlockById(blocks, "unknown"), null);
});

test("moveBlockInList przemieszcza w górę i w dół", () => {
  const blocks = [
    { id: "b1", type: "hero" },
    { id: "b2", type: "projects" },
    { id: "b3", type: "contact" },
  ];

  // Przesunięcie b2 w górę
  const up = studioInlineRules.moveBlockInList(blocks, "b2", "up");
  assert.equal(up.changed, true);
  assert.deepEqual(up.blocks.map(b => b.id), ["b2", "b1", "b3"]);

  // Próba przesunięcia pierwszego w górę (brak zmiany)
  const upFirst = studioInlineRules.moveBlockInList(blocks, "b1", "up");
  assert.equal(upFirst.changed, false);
  assert.deepEqual(upFirst.blocks.map(b => b.id), ["b1", "b2", "b3"]);

  // Przesunięcie b2 w dół
  const down = studioInlineRules.moveBlockInList(blocks, "b2", "down");
  assert.equal(down.changed, true);
  assert.deepEqual(down.blocks.map(b => b.id), ["b1", "b3", "b2"]);

  // Próba przesunięcia ostatniego w dół (brak zmiany)
  const downLast = studioInlineRules.moveBlockInList(blocks, "b3", "down");
  assert.equal(downLast.changed, false);
});

test("removeBlockFromList usuwa wskazany blok", () => {
  const blocks = [
    { id: "b1", type: "hero" },
    { id: "b2", type: "projects" },
    { id: "b3", type: "contact" },
  ];

  const res = studioInlineRules.removeBlockFromList(blocks, "b2");
  assert.equal(res.changed, true);
  assert.equal(res.removedBlock.id, "b2");
  assert.deepEqual(res.blocks.map(b => b.id), ["b1", "b3"]);

  const noop = studioInlineRules.removeBlockFromList(blocks, "nonexistent");
  assert.equal(noop.changed, false);
  assert.equal(noop.removedBlock, null);
  assert.equal(noop.blocks.length, 3);
});

test("insertBlockAt wstawia po afterBlockId lub na końcu", () => {
  const blocks = [
    { id: "b1", type: "hero" },
    { id: "b3", type: "contact" },
  ];
  const newBlock = { id: "b2", type: "projects" };

  const res = studioInlineRules.insertBlockAt(blocks, newBlock, "b1");
  assert.equal(res.changed, true);
  assert.deepEqual(res.blocks.map(b => b.id), ["b1", "b2", "b3"]);

  const resEnd = studioInlineRules.insertBlockAt(blocks, newBlock, null);
  assert.equal(resEnd.changed, true);
  assert.deepEqual(resEnd.blocks.map(b => b.id), ["b1", "b3", "b2"]);
});

test("resolveFieldPath poprawnie mapuje pola", () => {
  assert.equal(studioInlineRules.resolveFieldPath("title"), "title");
  assert.equal(studioInlineRules.resolveFieldPath("", 2, "desc"), "items.2.desc");
  assert.equal(studioInlineRules.resolveFieldPath("", null, "desc"), "");
});
