#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Prosty parser .env / .env.local bez zewnętrznych zależności
function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.join(rootDir, file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnv();

const apiKey = process.env.TRELLO_API;
const token = process.env.TRELLO_TOKEN;
const boardId = process.env.TRELLO_BOARD_ID || '69bec5f8834fd43d93d3b716';

if (!apiKey || !token) {
  console.error('❌ Błąd: Brak TRELLO_API lub TRELLO_TOKEN w .env.local lub zmiennych środowiskowych.');
  process.exit(1);
}

const authQuery = `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;

async function trelloFetch(endpoint, options = {}) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `https://api.trello.com/1${endpoint}${sep}${authQuery}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trello API Error (${res.status} ${res.statusText}): ${text}`);
  }
  return res.json();
}

async function getBoardLists() {
  const lists = await trelloFetch(`/boards/${boardId}/lists?filter=open`);
  return lists;
}

async function getBoardData() {
  const board = await trelloFetch(`/boards/${boardId}?lists=open&members=all`);
  return board;
}

async function getCards() {
  return trelloFetch(`/boards/${boardId}/cards?filter=open`);
}

async function findListByNameOrId(lists, identifier) {
  const lower = identifier.toLowerCase();
  return lists.find(l => l.id === identifier || l.name.toLowerCase() === lower || l.name.toLowerCase().includes(lower));
}

async function findCard(identifier, cards) {
  if (!cards) cards = await getCards();
  const direct = cards.find(c => c.id === identifier || c.shortLink === identifier);
  if (direct) return direct;
  
  const lower = identifier.toLowerCase();
  const matches = cards.filter(c => c.name.toLowerCase().includes(lower));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.warn(`⚠️ Znaleziono wiele kart pasujących do "${identifier}":`);
    matches.forEach(m => console.warn(`   - [${m.id}] ${m.name}`));
    throw new Error(`Doprecyzuj ID karty (${matches.map(m => m.id).join(', ')})`);
  }
  return null;
}

// Komendy CLI
async function showStatus() {
  const board = await getBoardData();
  const cards = await getCards();
  console.log(`\n📋 Tablica Trello: ${board.name} (${board.url})`);
  console.log(`🆔 ID Tablicy: ${board.id}`);
  console.log(`👤 Członkowie: ${board.members.map(m => `${m.fullName} (@${m.username})`).join(', ')}`);
  console.log('\n📑 Kolumny (Listy):');
  
  for (const list of board.lists) {
    const listCards = cards.filter(c => c.idList === list.id);
    console.log(`  • ${list.name.padEnd(16)} [ID: ${list.id}] → ${listCards.length} kart`);
  }
  console.log(`\nŁącznie aktywnych kart: ${cards.length}\n`);
}

async function listCards(listFilter) {
  const lists = await getBoardLists();
  const cards = await getCards();
  const listMap = Object.fromEntries(lists.map(l => [l.id, l.name]));

  let filtered = cards;
  if (listFilter) {
    const targetList = await findListByNameOrId(lists, listFilter);
    if (!targetList) {
      console.error(`❌ Nie znaleziono listy: "${listFilter}". Dostępne: ${lists.map(l => l.name).join(', ')}`);
      return;
    }
    filtered = cards.filter(c => c.idList === targetList.id);
    console.log(`\n📋 Karty w kolumnie: [${targetList.name}] (${filtered.length} kart)`);
  } else {
    console.log(`\n📋 Wszystkie aktywne karty na tablicy (${cards.length}):`);
  }

  // Grupowanie według list
  const grouped = {};
  for (const l of lists) grouped[l.name] = [];
  for (const c of filtered) {
    const lName = listMap[c.idList] || 'Inne';
    if (!grouped[lName]) grouped[lName] = [];
    grouped[lName].push(c);
  }

  for (const [lName, cList] of Object.entries(grouped)) {
    if (cList.length === 0 && listFilter) continue;
    console.log(`\n📌 ${lName} (${cList.length}):`);
    for (const c of cList) {
      const labels = c.labels && c.labels.length > 0 ? ` [${c.labels.map(l => l.name || l.color).join(', ')}]` : '';
      console.log(`  - [${c.id}] ${c.name}${labels}`);
    }
  }
  console.log('');
}

async function showCard(cardIdOrQuery) {
  const card = await findCard(cardIdOrQuery);
  if (!card) {
    console.error(`❌ Nie znaleziono karty dla zapytania: "${cardIdOrQuery}"`);
    return;
  }
  const lists = await getBoardLists();
  const listMap = Object.fromEntries(lists.map(l => [l.id, l.name]));

  // Pobierz akcje/komentarze
  const actions = await trelloFetch(`/cards/${card.id}/actions?filter=commentCard`);

  console.log(`\n========================================`);
  console.log(`📌 Karta: ${card.name}`);
  console.log(`🆔 ID: ${card.id} (URL: ${card.shortUrl})`);
  console.log(`📂 Kolumna: ${listMap[card.idList]} (${card.idList})`);
  if (card.labels?.length) {
    console.log(`🏷️  Etykiety: ${card.labels.map(l => l.name || l.color).join(', ')}`);
  }
  if (card.desc) {
    console.log(`\n📝 Opis:\n${card.desc}`);
  }
  if (actions.length > 0) {
    console.log(`\n💬 Ostatnie komentarze (${actions.length}):`);
    for (const a of actions.slice(0, 5)) {
      const date = new Date(a.date).toLocaleString('pl-PL');
      console.log(`  [${date}] ${a.memberCreator.fullName}:`);
      console.log(`  ${a.data.text.replace(/\n/g, '\n  ')}\n`);
    }
  }
  console.log(`========================================\n`);
}

async function moveCard(cardIdOrQuery, targetListName) {
  const card = await findCard(cardIdOrQuery);
  if (!card) {
    console.error(`❌ Nie znaleziono karty dla zapytania: "${cardIdOrQuery}"`);
    return;
  }
  const lists = await getBoardLists();
  const targetList = await findListByNameOrId(lists, targetListName);
  if (!targetList) {
    console.error(`❌ Nie znaleziono kolumny docelowej: "${targetListName}". Dostępne: ${lists.map(l => l.name).join(', ')}`);
    return;
  }

  await trelloFetch(`/cards/${card.id}?idList=${targetList.id}`, { method: 'PUT' });
  console.log(`✅ Przeniesiono kartę "${card.name}" (${card.id}) do listy: [${targetList.name}]`);
}

async function commentCard(cardIdOrQuery, text) {
  const card = await findCard(cardIdOrQuery);
  if (!card) {
    console.error(`❌ Nie znaleziono karty dla zapytania: "${cardIdOrQuery}"`);
    return;
  }

  await trelloFetch(`/cards/${card.id}/actions/comments?text=${encodeURIComponent(text)}`, { method: 'POST' });
  console.log(`✅ Dodano komentarz do karty "${card.name}" (${card.id})`);
}

async function addCard(targetListName, name, desc = '') {
  const lists = await getBoardLists();
  const targetList = await findListByNameOrId(lists, targetListName);
  if (!targetList) {
    console.error(`❌ Nie znaleziono kolumny docelowej: "${targetListName}". Dostępne: ${lists.map(l => l.name).join(', ')}`);
    return;
  }

  const endpoint = `/cards?idList=${targetList.id}&name=${encodeURIComponent(name)}&desc=${encodeURIComponent(desc)}`;
  const newCard = await trelloFetch(endpoint, { method: 'POST' });
  console.log(`✅ Utworzono kartę: "${newCard.name}" [${newCard.id}] w liście: [${targetList.name}]`);
  console.log(`🔗 ${newCard.shortUrl}`);
}

// Główny dispatcher CLI
const [,, cmd, arg1, arg2, arg3] = process.argv;

async function main() {
  switch (cmd) {
    case 'status':
    case 'board':
      await showStatus();
      break;
    case 'list':
    case 'ls':
      await listCards(arg1);
      break;
    case 'show':
    case 'card':
    case 'get':
      if (!arg1) {
        console.error('Użycie: node tools/trello.mjs show <cardId|nazwa>');
        process.exit(1);
      }
      await showCard(arg1);
      break;
    case 'move':
    case 'mv':
      if (!arg1 || !arg2) {
        console.error('Użycie: node tools/trello.mjs move <cardId|nazwa> <nazwaListy>');
        process.exit(1);
      }
      await moveCard(arg1, arg2);
      break;
    case 'comment':
      if (!arg1 || !arg2) {
        console.error('Użycie: node tools/trello.mjs comment <cardId|nazwa> "<tekst komentarza>"');
        process.exit(1);
      }
      await commentCard(arg1, arg2);
      break;
    case 'add':
    case 'create':
      if (!arg1 || !arg2) {
        console.error('Użycie: node tools/trello.mjs add <nazwaListy> "<tytuł>" "[opis]"');
        process.exit(1);
      }
      await addCard(arg1, arg2, arg3 || '');
      break;
    default:
      console.log(`
🛠️  DFCMS Trello CLI
====================
Dostępne polecenia:
  node tools/trello.mjs status               - Wyświetla podsumowanie tablicy DFCMS i stan kolumn
  node tools/trello.mjs list [nazwaListy]    - Wyświetla listę kart (np. 'To do', 'In progress', 'Done')
  node tools/trello.mjs show <karta>         - Szczegóły karty i ostatnie komentarze
  node tools/trello.mjs move <karta> <lista> - Przenosi kartę do innej kolumny (np. 'Done')
  node tools/trello.mjs comment <karta> "txt"- Dodaje komentarz do karty
  node tools/trello.mjs add <lista> "Tytuł"  - Tworzy nową kartę w podanej kolumnie
`);
      await showStatus();
  }
}

main().catch(err => {
  console.error('\n❌ Wystąpił błąd:', err.message);
  process.exit(1);
});
