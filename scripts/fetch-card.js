#!/usr/bin/env node
'use strict';
// Adds player cards to the static library (public/data/cards).
//   node scripts/fetch-card.js <efhub id or URL> [...]
//   node scripts/fetch-card.js --import <dir of cached card JSON>
const fs = require('fs');
const path = require('path');
const { parsePlayerHtml, CARD_TYPES, BASE_URL, UA } = require('../efhub_builder.js');

const OUT = path.join(__dirname, '..', 'public', 'data', 'cards');
const INDEX = path.join(OUT, 'index.json');

const readIndex = () => { try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { return []; } };

function save(card, index) {
  if (!card?.baseStats || !card.id) throw new Error('Card has no stats');
  fs.writeFileSync(path.join(OUT, `${card.id}.json`), JSON.stringify(card));
  const entry = { id: card.id, name: card.name, team: card.team, position: card.position, type: CARD_TYPES[card.playerType] || String(card.playerType ?? '') };
  const i = index.findIndex(e => e.id === card.id);
  if (i >= 0) index[i] = entry; else index.push(entry);
  return entry;
}

async function fetchCard(id) {
  const res = await fetch(`${BASE_URL}/players/${id}`, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`efhub returned HTTP ${res.status} for player ${id}`);
  const card = parsePlayerHtml(await res.text());
  if (!card.id) card.id = id;
  return card;
}

async function main(args) {
  fs.mkdirSync(OUT, { recursive: true });
  const index = readIndex();
  const added = [];
  if (args[0] === '--import') {
    const dir = path.resolve(args[1] || 'cache/players');
    for (const f of fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f))) {
      const card = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!card.id) card.id = path.basename(f, '.json');
      added.push(save(card, index));
    }
  } else {
    const ids = [...new Set(args.join(' ').match(/\d{6,}/g) || [])];
    if (!ids.length) throw new Error('No efhub player id found');
    for (const id of ids) {
      if (added.length) await new Promise(r => setTimeout(r, 5000));
      added.push(save(await fetchCard(id), index));
    }
  }
  index.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 1));
  for (const e of added) console.log(`${e.id}\t${e.name} (${e.type}, ${e.position})`);
}

main(process.argv.slice(2)).catch(e => { console.error(`error: ${e.message}`); process.exit(1); });
