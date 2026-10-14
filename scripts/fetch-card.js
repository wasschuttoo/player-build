#!/usr/bin/env node
'use strict';
// Adds player cards to the static library (public/data/cards).
//   node scripts/fetch-card.js <efhub id or URL> [...]
//   node scripts/fetch-card.js --import <dir of cached card JSON>
const fs = require('fs');
const path = require('path');
const { parsePlayerHtml, CARD_TYPES, POSITION_COLUMN, BASE_URL, UA } = require('../efhub_builder.js');

const OUT = path.join(__dirname, '..', 'public', 'data', 'cards');
const INDEX = path.join(OUT, 'index.json');

const readIndex = () => { try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { return []; } };

// Write then rename, so a git commit running alongside the crawl never picks up a half-written file.
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// Errors that retrying won't fix (the card itself is unusable).
const unusable = msg => Object.assign(new Error(msg), { permanent: true });

// id -> array position, so upserts stay fast with tens of thousands of cards.
const positions = new WeakMap();
function slotOf(index, id) {
  let map = positions.get(index);
  if (!map || map.size !== index.length) {
    map = new Map(index.map((e, i) => [String(e.id), i]));
    positions.set(index, map);
  }
  return map;
}

function save(card, index) {
  if (!card?.baseStats || !card.id) throw unusable('Card has no stats');
  if (POSITION_COLUMN[card.position] === undefined) throw unusable(`Card has unknown position "${card.position}"`);
  writeAtomic(path.join(OUT, `${card.id}.json`), JSON.stringify(card));
  const entry = { id: card.id, name: card.name, team: card.team, position: card.position, type: CARD_TYPES[card.playerType] || String(card.playerType ?? '') };
  const map = slotOf(index, card.id);
  const i = map.get(String(card.id));
  if (i !== undefined) index[i] = entry;
  else { map.set(String(card.id), index.length); index.push(entry); }
  return entry;
}

async function fetchCard(id) {
  const res = await fetch(`${BASE_URL}/players/${id}`, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw Object.assign(new Error(`efhub returned HTTP ${res.status} for player ${id}`), { status: res.status, permanent: res.status === 404 || res.status === 410 });
  let card;
  try { card = parsePlayerHtml(await res.text()); } catch (e) { throw unusable(`Could not read player ${id}: ${e.message}`); }
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
  writeIndex(index);
  for (const e of added) console.log(`${e.id}\t${e.name} (${e.type}, ${e.position})`);
}

// One entry per line: compact for tens of thousands of cards, still readable in diffs.
function writeIndex(index) {
  index.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  positions.delete(index);
  writeAtomic(INDEX, `[\n${index.map(e => JSON.stringify(e)).join(',\n')}\n]\n`);
}

module.exports = { save, fetchCard, readIndex, writeIndex, writeAtomic, OUT, INDEX };

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(`error: ${e.message}`); process.exit(1); });
