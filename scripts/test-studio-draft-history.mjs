import test from 'node:test';
import assert from 'node:assert/strict';
import studioDraftHistoryRules from '../js/core/studioDraftHistoryRules.js';

test('createAiMessage: tworzy poprawny obiekt wiadomości z migawką', () => {
  const snapshot = { theme_type: 'cinematic', blocks: [{ id: 'b1' }] };
  const msg = studioDraftHistoryRules.createAiMessage({
    role: 'model',
    text: 'Zmieniłem nagłówek',
    hasChanges: true,
    snapshotBefore: snapshot,
  });

  assert.equal(msg.role, 'model');
  assert.equal(msg.text, 'Zmieniłem nagłówek');
  assert.equal(msg.hasChanges, true);
  assert.deepEqual(msg.snapshotBefore, snapshot);
  assert.equal(msg.rejected, false);
  assert.equal(msg.stale, false);
  assert.ok(msg.id.startsWith('msg_'));
});

test('markMessageRejected: przywraca dokładnie ten snapshot sprzed danej odpowiedzi i unieważnia nowsze zmiany', () => {
  const snap1 = { v: 1 };
  const snap2 = { v: 2 };

  const msg1 = studioDraftHistoryRules.createAiMessage({ text: 'AI zmiana 1', hasChanges: true, snapshotBefore: snap1 });
  const msg2 = studioDraftHistoryRules.createAiMessage({ text: 'AI zmiana 2', hasChanges: true, snapshotBefore: snap2 });
  const messages = [msg1, msg2];

  // Użytkownik odrzuca zmianę nr 1
  const res = studioDraftHistoryRules.markMessageRejected(messages, msg1.id);

  assert.deepEqual(res.snapshotToRestore, snap1);
  assert.equal(msg1.rejected, true);
  assert.equal(msg1.hasChanges, false);

  // Nowsza wiadomość 2 została oznaczona jako stale i hasChanges=false
  assert.equal(msg2.stale, true);
  assert.equal(msg2.hasChanges, false);
});

test('markMessageRejected: odrzucenie tylko najnowszej zmiany zachowuje starszą aktywną', () => {
  const snap1 = { v: 1 };
  const snap2 = { v: 2 };

  const msg1 = studioDraftHistoryRules.createAiMessage({ text: 'AI zmiana 1', hasChanges: true, snapshotBefore: snap1 });
  const msg2 = studioDraftHistoryRules.createAiMessage({ text: 'AI zmiana 2', hasChanges: true, snapshotBefore: snap2 });
  const messages = [msg1, msg2];

  // Użytkownik odrzuca tylko zmianę nr 2
  const res = studioDraftHistoryRules.markMessageRejected(messages, msg2.id);

  assert.deepEqual(res.snapshotToRestore, snap2);
  assert.equal(msg2.rejected, true);
  assert.equal(msg2.hasChanges, false);

  // Starsza wiadomość msg1 nie została naruszona
  assert.equal(msg1.rejected, false);
  assert.equal(msg1.hasChanges, true);
  assert.equal(msg1.stale, false);
});

test('studioDraftManager: save-first gwarantuje brak mutacji UI w razie błędu zapisu DB', async () => {
  globalThis.DFOPS_studioDraftHistoryRules = studioDraftHistoryRules;
  globalThis.DFOPS_pageRepository = {
    savePageByIdForOwner: async () => ({ error: 'Błąd połączenia z bazą' }),
  };

  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const managerCode = readFileSync(path.join(process.cwd(), 'js/features/studio/studioDraftManager.js'), 'utf8');
  new Function(managerCode)();

  const snap1 = { v: 1 };
  const msg1 = studioDraftHistoryRules.createAiMessage({ text: 'AI zmiana', hasChanges: true, snapshotBefore: snap1 });
  let toastMsg = '';

  const fakeApp = {
    currentUser: { id: 'u1' },
    pageId: 'p1',
    pageRow: { draft_content: { v: 2 } },
    draftHistory: [snap1],
    draftRedoStack: [],
    messages: [msg1],
    historySaving: false,
    agentThinking: false,
    publishing: false,
    showToast: (m) => { toastMsg = m; },
    refreshPreview: () => {},
  };

  globalThis.DFOPS_attachStudioDraftManager(fakeApp);

  // Wywołanie reject przy błędzie DB
  await fakeApp.rejectMessageDraft(msg1);

  // Weryfikacja: wiadomość NIE została oznaczona jako odrzucona, hasChanges nadal true
  assert.equal(msg1.rejected, false, 'Wiadomość nie może być odrzucona przy błędzie zapisu');
  assert.equal(msg1.hasChanges, true, 'Przycisk odrzucenia musi pozostać dostępny');
  assert.ok(toastMsg.includes('Nie udało się zapisać'), 'Musi pojawić się toast błędu zapisu');
  assert.equal(fakeApp.pageRow.draft_content.v, 2, 'Stan draft_content nie może ulec zmianie');
});

test('studioDraftManager: sukces zapisu synchronizuje draftHistory i czyści redoStack', async () => {
  let savedPayload = null;
  globalThis.DFOPS_studioDraftHistoryRules = studioDraftHistoryRules;
  globalThis.DFOPS_pageRepository = {
    savePageByIdForOwner: async (uid, pid, payload) => {
      savedPayload = payload;
      return { data: payload, error: null };
    },
  };

  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const managerCode = readFileSync(path.join(process.cwd(), 'js/features/studio/studioDraftManager.js'), 'utf8');
  new Function(managerCode)();

  const snap0 = { v: 0 };
  const snap1 = { v: 1 };
  const msg1 = studioDraftHistoryRules.createAiMessage({ text: 'AI zmiana 1', hasChanges: true, snapshotBefore: snap0 });
  const msg2 = studioDraftHistoryRules.createAiMessage({ text: 'AI zmiana 2', hasChanges: true, snapshotBefore: snap1 });

  let refreshed = false;
  const fakeApp = {
    currentUser: { id: 'u1' },
    pageId: 'p1',
    pageRow: { draft_content: { v: 2 } },
    draftHistory: [snap0, snap1],
    draftRedoStack: [{ v: 'future' }],
    messages: [msg1, msg2],
    historySaving: false,
    agentThinking: false,
    publishing: false,
    showToast: () => {},
    refreshPreview: () => { refreshed = true; },
  };

  globalThis.DFOPS_attachStudioDraftManager(fakeApp);

  // Odrzucamy pierwszą zmianę (przywraca snap0)
  await fakeApp.rejectMessageDraft(msg1);

  assert.deepEqual(savedPayload, { draft_content: snap0 });
  assert.equal(msg1.rejected, true);
  assert.equal(msg2.stale, true);
  assert.deepEqual(fakeApp.pageRow.draft_content, snap0);
  assert.deepEqual(fakeApp.draftRedoStack, [], 'RedoStack musi zostać wyczyszczony');
  assert.deepEqual(fakeApp.draftHistory, [], 'draftHistory od snap0 wzwyż musi zostać wyczyszczone');
  assert.equal(refreshed, true, 'Podgląd musi zostać odświeżony');
});

test('templates/custom.html: kotwice menu hamburgerowego (#uslugi, #cennik, #faq) istnieją w znacznikach', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const html = readFileSync(path.join(process.cwd(), 'templates/custom.html'), 'utf8');

  assert.ok(html.includes('id="uslugi"'), 'Musi istnieć element z id="uslugi" dla linku hamburgera');
  assert.ok(html.includes('id="cennik"'), 'Musi istnieć element z id="cennik" dla linku hamburgera');
  assert.ok(html.includes('id="faq"'), 'Musi istnieć element z id="faq" dla linku hamburgera');
  assert.ok(html.includes('id="atuty"'), 'Musi istnieć element z id="atuty" dla linku hamburgera');
  assert.ok(html.includes('id="projekty"'), 'Musi istnieć element z id="projekty" dla linku hamburgera');
  assert.ok(html.includes('id="kontakt"'), 'Musi istnieć element z id="kontakt" dla linku hamburgera');
  assert.ok(html.includes('@keydown.window.escape="mobileMenuOpen = false"'), 'Menu mobilne musi zamykać się klawiszem Escape');
});
