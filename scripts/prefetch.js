#!/usr/bin/env node
'use strict';
// Backfills the static card library with every efhub card: Epic, Big Time, Highlight, Show Time
// and Trending first, then other featured cards, then standard ones (highest OVR first in each).
//   node scripts/prefetch.js [--limit all] [--min-ovr 0] [--minutes 50] [--delay 5000]
// Env vars LIMIT, MIN_OVR, MINUTES and DELAY_MS work too (flags win). The default
// delay follows efhub's robots.txt Crawl-delay of 5 seconds.
// If PREFETCH_STATUS names a file, "added=N" and "remaining=N" are appended to it
// so the workflow can commit in chunks and decide whether to keep going.
const fs = require('fs');
const path = require('path');
const { BASE_URL, UA } = require('../efhub_builder.js');
const { save, fetchCard, readIndex, writeIndex, OUT } = require('./fetch-card.js');

const SKIP = path.join(OUT, 'skip.json');
const SKIP_DAYS = 14;
const MAX_CONSECUTIVE_FAILURES = 25;

function opts(argv) {
  const flag = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  const limit = flag('limit') ?? process.env.LIMIT;
  return {
    limit: /^all$/i.test(String(limit ?? '').trim()) ? Infinity : num(limit, Infinity),
    minOvr: num(flag('min-ovr') ?? process.env.MIN_OVR, 0),
    minutes: num(flag('minutes') ?? process.env.MINUTES, 50),
    delay: num(flag('delay') ?? process.env.DELAY_MS, 5000),
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function playerIndex() {
  const res = await fetch(`${BASE_URL}/search/player-index.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`efhub player index returned HTTP ${res.status}`);
  return res.json();
}

// Cards that 404 or can't be parsed are parked for two weeks instead of retried every run.
function readSkip() {
  let skip = {};
  try { skip = JSON.parse(fs.readFileSync(SKIP, 'utf8')) || {}; } catch {}
  const cutoff = Date.now() - SKIP_DAYS * 864e5;
  for (const [id, when] of Object.entries(skip)) if (!(Date.parse(when) > cutoff)) delete skip[id];
  return skip;
}
function writeSkip(skip) {
  const ids = Object.keys(skip).sort();
  if (!ids.length) { fs.rmSync(SKIP, { force: true }); return; }
  fs.writeFileSync(SKIP, `{\n${ids.map(id => `${JSON.stringify(id)}:${JSON.stringify(skip[id])}`).join(',\n')}\n}\n`);
}

// Crawl order: the cards people actually play with come first. efhub ids carry the card type in
// their prefix: 88 Epic, 89 Big Time, 105 Highlight, 106 Show Time, 52-56 Trending/POTW.
// Then every other featured card (13+ digit id), then standard cards. Within a tier, highest OVR
// first, and players with more versions (the popular ones) break ties.
const FEATURED = /^(88|89|105|106|5[2-6])/;
function tier(p) {
  const id = String(p.i);
  if (id.length < 13) return 2;
  return FEATURED.test(id) ? 0 : 1;
}

function report(added, remaining) {
  const file = process.env.PREFETCH_STATUS;
  if (file) fs.appendFileSync(file, `added=${added}\nremaining=${remaining}\n`);
}

async function main() {
  const o = opts(process.argv.slice(2));
  const deadline = Date.now() + o.minutes * 60e3;
  fs.mkdirSync(OUT, { recursive: true });
  const index = readIndex();
  const skip = readSkip();
  const have = new Set(index.map(e => String(e.id)));
  for (const f of fs.readdirSync(OUT)) if (/^\d+\.json$/.test(f)) have.add(path.basename(f, '.json'));

  const all = (await playerIndex()).filter(p => p && p.i != null);
  const versions = new Map();
  for (const p of all) versions.set(p.e, (versions.get(p.e) || 0) + 1);
  const wanted = all
    .filter(p => Number(p.o) < 120 && Number(p.o) >= o.minOvr && !have.has(String(p.i)) && !skip[String(p.i)])
    .sort((a, b) => tier(a) - tier(b) || Number(b.o) - Number(a.o) || versions.get(b.e) - versions.get(a.e));
  const queue = wanted.slice(0, o.limit);
  const featured = wanted.filter(p => tier(p) === 0).length;
  console.log(`Library has ${have.size} cards, ${Object.keys(skip).length} parked; ${wanted.length} missing (${featured} featured), queued ${queue.length} (limit ${o.limit}, min OVR ${o.minOvr}, ${o.delay} ms apart).`);

  let added = 0, failed = 0, parked = 0, streak = 0, done = 0, backoff = 0, sinceFlush = 0;
  for (const p of queue) {
    if (Date.now() > deadline) { console.log('Time budget reached, stopping.'); break; }
    const id = String(p.i);
    let tries = 0;
    for (;;) {
      try {
        const e = save(await fetchCard(id), index);
        added++; sinceFlush++; streak = 0; backoff = 0;
        console.log(`+ ${e.id}\t${p.o}\t${e.name} (${e.type}, ${e.position})`);
        break;
      } catch (err) {
        const retry = err.status === 429 || err.status >= 500 || !err.status && !err.permanent && /fetch failed|ECONN|ETIMEDOUT|socket|aborted/i.test(err.message);
        if (retry && ++tries <= 3) {
          backoff = Math.min(120e3, backoff ? backoff * 2 : 15e3);
          console.log(`  ${id}: ${err.message}; waiting ${backoff / 1e3}s`);
          await sleep(backoff);
          continue;
        }
        if (err.permanent) { skip[id] = new Date().toISOString().slice(0, 10); parked++; }
        else { failed++; streak++; }
        console.log(`! ${id}\t${p.e}: ${err.message}${err.permanent ? ' (parked)' : ''}`);
        break;
      }
    }
    done++;
    if (sinceFlush >= 50) { writeIndex(index); writeSkip(skip); sinceFlush = 0; }
    if (streak >= MAX_CONSECUTIVE_FAILURES) {
      console.log(`${streak} failures in a row; efhub may be limiting us. Stopping this run.`);
      break;
    }
    await sleep(o.delay);
  }
  writeIndex(index);
  writeSkip(skip);
  const remaining = wanted.length - done;
  report(added, streak >= MAX_CONSECUTIVE_FAILURES ? 0 : remaining);
  console.log(`Done: ${added} added, ${parked} parked, ${failed} failed, library now ${index.length} cards, ${remaining} still missing.`);
  if (streak >= MAX_CONSECUTIVE_FAILURES && !added) throw new Error('Nothing could be fetched; efhub may be blocking us.');
}

main().catch(e => { console.error(`error: ${e.message}`); process.exit(1); });