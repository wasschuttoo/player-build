'use strict';
// Build Album — web UI for manager-aware eFootball training builds (data: efhub.com).
// Run: node server.js (or start.cmd). Stateless: each visitor's managers, club and squads live in their browser;
// the server only fetches and caches efhub data and does the maths. Serves on 0.0.0.0 (PORT env, default 4747).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

if (!process.execArgv.includes('--use-system-ca') && !process.env.EFHUB_CHILD
  && process.allowedNodeEnvironmentFlags.has('--use-system-ca')) {
  const r = require('child_process').spawnSync(process.execPath, ['--use-system-ca', __filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, EFHUB_CHILD: '1' } });
  process.exit(r.status ?? 1);
}

const B = require('./efhub_builder.js');
const M = require('./manager.js');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const MANAGERS_FILE = path.join(B.CACHE, 'managers.json');
const PORT = Number(process.env.PORT) || 4747;
const HOSTED = !!process.env.RENDER;
fs.mkdirSync(path.join(B.CACHE, 'players'), { recursive: true });

// efhub asks for a 5 s crawl delay; serialise every outbound fetch so parallel requests can't race it.
// The cap keeps a busy public server from queueing minutes of work behind one visitor.
const QUEUE_MAX = 30;
let queue = Promise.resolve(), pending = 0;
const serial = fn => {
  if (pending >= QUEUE_MAX) return Promise.reject(new UserError('efhub lookups are busy right now. Try again in a minute.', 503));
  pending++;
  const p = queue.then(fn, fn).finally(() => { pending--; });
  queue = p.catch(() => {});
  return p;
};

const loadManagers = refresh => serial(() => B.cachedJson(MANAGERS_FILE, `${B.BASE_URL}/data/managers.json`, refresh));
const loadIndex = () => serial(() => B.loadIndex(false));
const loadBoosts = () => serial(() => B.loadBoosts(false));
const loadCard = (id, refresh) => {
  const file = path.join(B.CACHE, 'players', `${id}.json`);
  if (!refresh && fs.existsSync(file)) return B.loadCard(id);
  return serial(() => B.loadCard(id, { refresh }));
};

const slug = s => B.deaccent(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manager';

function publicManager(m, extra = {}) {
  const n = M.normalizeManager(m);
  return { id: String(m.id), name: n.name, skills: n.skills, boosts: n.boosts, bestTactic: M.bestTactic(n), ...extra };
}

function findPlayerId(raw) {
  const m = String(raw ?? '').match(/(\d{6,})/);
  return m ? m[1] : null;
}
const cleanIds = (list, max) => (Array.isArray(list) ? list : []).slice(0, max).map(v => (v ? findPlayerId(v) : null));

class UserError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

async function getCard(id, refresh) {
  if (refresh) ovrMemo.clear();
  else if (!fs.existsSync(cardFile(id)) && sentInline(id)) return cachedCard(id);
  try { return await loadCard(id, !!refresh); } catch (e) {
    if (/Could not find stats|HTTP 404/.test(e.message)) throw new UserError(`efhub has no player card with id ${id}. Check the link, or search by name.`, 404);
    throw new UserError(`Could not reach efhub (${e.cause?.code || e.message}). Check your connection, then try again.`, 502);
  }
}

// Custom managers live in the visitor's browser and arrive inline; clamp them like the in-game editor does.
function customManager(m) {
  const n = M.normalizeManager(m);
  for (const t of M.TACTICS) n.skills[t.key] = Math.min(99, Math.max(40, Math.round(n.skills[t.key]) || 40));
  return { id: String(m.id ?? 'custom').slice(0, 80), name: String(n.name).slice(0, 40), skills: n.skills, boosts: n.boosts.slice(0, 2) };
}

async function resolveManager(body) {
  if (body.manager && typeof body.manager === 'object') return customManager(body.manager);
  if (!body.managerId) return null;
  const mid = String(body.managerId);
  const m = mid.startsWith('custom-') ? null : (await loadManagers()).find(x => String(x.id) === mid);
  if (!m) throw new UserError('That manager could not be found. Pick another from your team.', 404);
  return m;
}

// ---------------------------------------------------------------- club + squads
// The club list itself is client-side; the server just makes sure every card it is asked about is cached.
const CLUB_MAX = 200;
const BENCH_MAX = 12;

const cardFile = id => path.join(B.CACHE, 'players', `${id}.json`);
const diskCard = id => { try { return JSON.parse(fs.readFileSync(cardFile(id), 'utf8')); } catch { return null; } };

// Browsers keep the card JSON they've been sent and return it inline, so a just-restarted host (empty cache)
// needn't recrawl efhub at 5 s a card. Inline cards serve only that request: never written to the cache or the shared memo.
const reqCtx = new AsyncLocalStorage();
const inlineCards = new WeakSet();
function readInlineCards(body) {
  const map = new Map();
  const src = body && body.cards && typeof body.cards === 'object' && !Array.isArray(body.cards) ? body.cards : {};
  for (const [k, c] of Object.entries(src).slice(0, CLUB_MAX + 40)) {
    const id = findPlayerId(k);
    if (!id || !c || typeof c !== 'object' || (c.id != null && String(c.id) !== id)) continue;
    if (!c.baseStats || typeof c.baseStats !== 'object' || B.POSITION_COLUMN[c.position] === undefined) continue;
    c.id = id;
    inlineCards.add(c);
    map.set(id, c);
  }
  return map;
}
const cachedCard = id => diskCard(id) || reqCtx.getStore()?.cards.get(String(id)) || null;
const sentInline = id => !!reqCtx.getStore()?.cards.has(String(id));
const personOf = c => B.deaccent(c.name || '').trim();

function fitOf(card, pos) {
  if (card.position === pos) return 'main';
  const a = (card.additionalPositions || []).find(p => p.position === pos);
  if (!a) return 'off';
  return a.familiarity >= 2 ? 'strong' : 'learned';
}

function clubSummary(id, added) {
  const c = cachedCard(id);
  if (!c) return { id: String(id), missing: true, added };
  return {
    id: String(c.id || id), name: c.name, team: c.team, position: c.position,
    positions: [{ pos: c.position, fit: 'main' }, ...(c.additionalPositions || []).map(p => ({ pos: p.position, fit: p.familiarity >= 2 ? 'strong' : 'learned' }))],
    type: B.CARD_TYPES[c.playerType] || '', levelCap: c.levelCap, playingStyle: c.playingStyle,
    baseOvr: c.overallRating || B.ovr(c.baseStats, c.position, c.height, c.weakFootAccuracy), person: personOf(c), added,
  };
}
// Cards drop out of the cache when a hosted instance restarts; refetch the ones a request needs (errors leave them missing).
async function ensureCards(ids) {
  for (const id of new Set(ids.filter(Boolean))) {
    if (!fs.existsSync(cardFile(id)) && !sentInline(id)) { try { await getCard(id, false); } catch {} }
  }
}

const FORMATIONS = (() => {
  const back4 = [['LB', 12, 70], ['CB', 37, 74], ['CB', 63, 74], ['RB', 88, 70]];
  const back3 = [['CB', 22, 72], ['CB', 50, 75], ['CB', 78, 72]];
  const front3 = [['LWF', 15, 19], ['CF', 50, 12], ['RWF', 85, 19]];
  const f = (key, rows) => ({ key, slots: [['GK', 50, 90], ...rows].map(([pos, x, y]) => ({ pos, x, y })) });
  return [
    f('4-3-3', [...back4, ['CMF', 24, 48], ['DMF', 50, 55], ['CMF', 76, 48], ...front3]),
    f('4-2-1-3', [...back4, ['DMF', 33, 55], ['DMF', 67, 55], ['AMF', 50, 37], ...front3]),
    f('4-2-3-1', [...back4, ['DMF', 33, 55], ['DMF', 67, 55], ['LMF', 13, 35], ['AMF', 50, 35], ['RMF', 87, 35], ['CF', 50, 12]]),
    f('4-1-2-3', [...back4, ['DMF', 50, 56], ['CMF', 28, 41], ['CMF', 72, 41], ...front3]),
    f('4-3-1-2', [...back4, ['CMF', 22, 50], ['DMF', 50, 56], ['CMF', 78, 50], ['AMF', 50, 34], ['CF', 33, 13], ['CF', 67, 13]]),
    f('4-4-2', [...back4, ['LMF', 12, 44], ['CMF', 37, 49], ['CMF', 63, 49], ['RMF', 88, 44], ['CF', 33, 13], ['CF', 67, 13]]),
    f('4-1-4-1', [...back4, ['DMF', 50, 56], ['LMF', 12, 37], ['CMF', 37, 40], ['CMF', 63, 40], ['RMF', 88, 37], ['CF', 50, 12]]),
    f('3-4-3', [...back3, ['LMF', 12, 45], ['CMF', 37, 50], ['CMF', 63, 50], ['RMF', 88, 45], ...front3]),
    f('3-2-4-1', [...back3, ['DMF', 33, 55], ['DMF', 67, 55], ['LMF', 12, 34], ['AMF', 37, 35], ['AMF', 63, 35], ['RMF', 88, 34], ['CF', 50, 12]]),
  ];
})();
// Typed formations ("4-1-2-1-2", "352"): lines from defence to attack, 3–5 lines of 1–5 players adding up to 10.
function customFormation(input) {
  const s = String(input ?? '').trim();
  const parts = /^\d{3,5}$/.test(s) ? s.split('') : s.replace(/^\D+|\D+$/g, '').split(/\D+/);
  if (parts.length < 3 || parts.length > 5 || parts.some(p => !/^[1-5]$/.test(p))) return null;
  const lines = parts.map(Number);
  if (lines.reduce((a, b) => a + b, 0) !== 10) return null;
  const key = lines.join('-');
  const preset = FORMATIONS.find(f => f.key === key);
  if (preset) return preset;
  const n = lines.length, m = n - 2;
  const rolesFor = (c, i) => {
    if (i === 0) return c >= 4 ? ['LB', ...Array(c - 2).fill('CB'), 'RB'] : Array(c).fill('CB');
    if (i === n - 1) return c <= 2 ? Array(c).fill('CF') : ['LWF', ...Array(c - 2).fill('CF'), 'RWF'];
    const j = i - 1;
    const base = m === 1 ? 'CMF' : m === 2 ? (j === 0 ? (c <= 2 ? 'DMF' : 'CMF') : (c >= 4 ? 'CMF' : 'AMF')) : ['DMF', 'CMF', 'AMF'][j];
    const r = Array(c).fill(base);
    if (c >= 4 || (c === 3 && base === 'AMF')) { r[0] = 'LMF'; r[c - 1] = 'RMF'; }
    return r;
  };
  const lift = { LB: -4, RB: -4, LMF: -3, RMF: -3, LWF: 6, RWF: 6 };
  const slots = [{ pos: 'GK', x: 50, y: 90 }];
  lines.forEach((c, i) => {
    const roles = rolesFor(c, i);
    const y = Math.round(72 - i * (59 / (n - 1)));
    const wide = roles.some(r => r in lift);
    const margin = c >= 4 ? 12 : c === 3 ? (wide ? 14 : 22) : c === 2 ? 33 : 50;
    roles.forEach((pos, k) => slots.push({ pos, x: c === 1 ? 50 : Math.round(margin + k * (100 - 2 * margin) / (c - 1)), y: y + (lift[pos] || 0) }));
  });
  return { key, custom: true, slots };
}
const formationOf = key => FORMATIONS.find(f => f.key === key) || customFormation(key) || FORMATIONS[0];

// quickOvr is ~2 ms per card/position; memoise per manager + playstyle so suggest and re-renders stay instant.
const ovrMemo = new Map();
function slotOvr(card, boosts, pos, manager, tactic) {
  const memo = inlineCards.has(card) ? reqCtx.getStore().memo : ovrMemo;
  const key = `${card.id}|${pos}|${tactic || ''}|${manager ? JSON.stringify(M.normalizeManager(manager)) : '-'}`;
  let v = memo.get(key);
  if (!v) {
    v = M.quickOvr(card, boosts, { pos, manager, tactic });
    if (memo.size > 20000) memo.clear();
    memo.set(key, v);
  }
  return v;
}

const OFF_PENALTY = 8;
function slotScore(card, boosts, pos, manager, tactic) {
  const fit = fitOf(card, pos);
  if ((pos === 'GK') !== M.positionsOf(card).includes('GK') && fit === 'off') return null;
  const r = slotOvr(card, boosts, pos, manager, tactic);
  const bonus = { main: 0.6, strong: 0.4, learned: 0, off: -OFF_PENALTY }[fit];
  return r.ovrDec + bonus;
}

// Hungarian algorithm (min-cost, square). Returns assignment row -> col.
function hungarian(cost) {
  const n = cost.length, INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const rowToCol = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

function playerOut(card, extra) {
  return { id: String(card.id), name: card.name, team: card.team, type: B.CARD_TYPES[card.playerType] || '', playingStyle: card.playingStyle, position: card.position, person: personOf(card), ...extra };
}

async function evaluateSquad(body, manager) {
  const form = formationOf(body.formation);
  const boosts = await loadBoosts();
  const tactic = M.TACTICS.some(t => t.key === body.tactic) ? body.tactic : M.bestTactic(M.normalizeManager(manager));
  const ids = form.slots.map((_, i) => (body.slots || [])[i] || null);
  const rate = (card, pos, t) => slotOvr(card, boosts, pos, manager, t);
  const slots = ids.map((id, i) => {
    if (!id) return null;
    const card = cachedCard(id);
    const pos = form.slots[i].pos;
    if (!card) return { id: String(id), missing: true, pos };
    const r = rate(card, pos, tactic);
    return playerOut(card, { pos, ovr: r.ovr, cardOvr: r.cardOvr, fit: fitOf(card, pos), levelCap: card.levelCap });
  });
  const bench = (body.bench || []).slice(0, BENCH_MAX).map(id => {
    const card = cachedCard(id);
    if (!card) return { id: String(id), missing: true };
    const r = rate(card, card.position, tactic);
    return playerOut(card, { pos: card.position, ovr: r.ovr, cardOvr: r.cardOvr, fit: 'main' });
  });
  const filled = slots.filter(s => s && !s.missing);
  const avgFor = t => {
    if (!filled.length) return null;
    const sum = filled.reduce((a, s) => a + rate(cachedCard(s.id), s.pos, t).ovrDec, 0);
    return Math.round((sum / filled.length) * 10) / 10;
  };
  const mgr = manager ? M.normalizeManager(manager) : null;
  return {
    formation: form.key, tactic, slots, bench, filled: filled.length,
    avg: avgFor(tactic),
    byTactic: M.TACTICS.map(t => ({ key: t.key, avg: avgFor(t.key), proficiency: mgr ? mgr.skills[t.key] : null })),
    manager: mgr && { id: String(mgr.id ?? ''), name: mgr.name, proficiency: mgr.skills[tactic], multiplier: M.mSkill(mgr.skills[tactic]) },
  };
}

async function suggestSquad(body, manager) {
  const form = formationOf(body.formation);
  const boosts = await loadBoosts();
  const tactic = M.TACTICS.some(t => t.key === body.tactic) ? body.tactic : M.bestTactic(M.normalizeManager(manager));
  const cards = cleanIds(body.club, CLUB_MAX).filter(Boolean).map(cachedCard).filter(Boolean);
  // One version per player: in eFootball a squad can't hold the same player twice.
  const people = new Map();
  for (const c of cards) { const k = personOf(c); if (!people.has(k)) people.set(k, []); people.get(k).push(c); }
  const persons = [...people.values()];
  const S = form.slots.length, P = persons.length, n = P + S;
  const best = persons.map(() => new Array(S).fill(null));
  const cost = Array.from({ length: n }, () => new Array(n).fill(0));
  persons.forEach((versions, r) => {
    form.slots.forEach((slot, c) => {
      let top = null;
      for (const card of versions) {
        const sc = slotScore(card, boosts, slot.pos, manager, tactic);
        if (sc !== null && (!top || sc > top.sc)) top = { sc, card };
      }
      best[r][c] = top;
      cost[r][c] = top ? -top.sc : 1e9;
    });
  });
  const assign = hungarian(cost);
  const slots = new Array(S).fill(null);
  const used = new Set();
  assign.forEach((c, r) => {
    if (r < P && c >= 0 && c < S && best[r][c]) { slots[c] = String(best[r][c].card.id); used.add(r); }
  });
  const rest = persons.map((versions, r) => ({ r, versions })).filter(x => !used.has(x.r)).map(({ versions }) => {
    const ranked = versions.map(card => ({ card, ovr: slotOvr(card, boosts, card.position, manager, tactic).ovrDec })).sort((a, b) => b.ovr - a.ovr);
    return ranked[0];
  }).sort((a, b) => b.ovr - a.ovr);
  const benchGk = rest.find(x => x.card.position === 'GK');
  const benchPick = [...(benchGk ? [benchGk] : []), ...rest.filter(x => x !== benchGk)].slice(0, BENCH_MAX);
  const out = await evaluateSquad({ ...body, formation: form.key, tactic, slots, bench: benchPick.map(x => String(x.card.id)) }, manager);
  const empty = form.slots.map((s, i) => (slots[i] ? null : s.pos)).filter(Boolean);
  out.ids = { slots, bench: benchPick.map(x => String(x.card.id)) };
  out.empty = empty;
  out.versionsSkipped = cards.length - P;
  return out;
}

// ---------------------------------------------------------------- API
const api = {
  async 'GET /api/search'(q) {
    const term = B.deaccent(q.get('q') || '').trim();
    if (!term) return [];
    const id = findPlayerId(term);
    const idx = await loadIndex();
    const words = term.split(/\s+/);
    const hits = id
      ? idx.filter(e => String(e.i) === id)
      : idx.filter(e => { const n = B.deaccent(e.e); return words.every(w => n.includes(w)); });
    const cached = new Set(fs.readdirSync(path.join(B.CACHE, 'players')).map(f => f.replace('.json', '')));
    return hits.sort((a, b) => (b.o || 0) - (a.o || 0)).slice(0, 24).map(e => {
      const out = { id: String(e.i), name: e.e, ovr: e.o, cached: cached.has(String(e.i)) };
      if (out.cached) {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(B.CACHE, 'players', `${e.i}.json`), 'utf8'));
          Object.assign(out, { team: c.team, position: c.position, type: B.CARD_TYPES[c.playerType] });
        } catch {}
      }
      return out;
    });
  },

  async 'GET /api/managers'() {
    const all = await loadManagers();
    return {
      tactics: M.TACTICS,
      mult: M.MULT,
      abilities: M.ABILITY_MAP.map(k => ({ stat: k, label: B.STAT_LABEL[k] })),
      all: all.map(m => publicManager(m)).sort((a, b) => a.name.localeCompare(b.name)),
      mine: [],
    };
  },

  async 'POST /api/managers/refresh'() {
    const all = await loadManagers(true);
    return { count: all.length };
  },
  async 'POST /api/build'(q, body) {
    const id = findPlayerId(body.id);
    if (!id) throw new UserError('Paste an efhub player link (efhub.com/players/…) or search by name.');
    const card = await getCard(id, body.refresh);
    const boosts = await loadBoosts();
    const manager = await resolveManager(body);
    try {
      const out = M.buildAll(card, boosts, { pos: body.pos, level: body.level, manager, tactic: body.tactic, stat: body.stat });
      out.extras = { skills: card.skills || [], comSkills: card.comSkills || [], preferredFoot: card.preferredFoot || null, age: card.age || null };
      out.raw = card;
      return out;
    } catch (e) {
      if (/^Unknown position/.test(e.message)) throw new UserError(`${e.message}. Pick one of the card's positions.`);
      throw e;
    }
  },

  async 'GET /api/formations'() { return FORMATIONS; },

  // One card for the club: the browser stores the summary and the raw card it can send back later.
  async 'POST /api/card-summary'(q, body) {
    const id = findPlayerId(body.id);
    if (!id) throw new UserError('Paste an efhub player link (efhub.com/players/…) or search by name.');
    const card = await getCard(id, false);
    return { ...clubSummary(id), name: card.name, card };
  },

  async 'POST /api/club/summaries'(q, body) {
    const ids = [...new Set(cleanIds(body.ids, CLUB_MAX).filter(Boolean))];
    await ensureCards(ids);
    const cards = {};
    for (const id of ids) { if (!sentInline(id)) { const c = diskCard(id); if (c) cards[id] = c; } }
    return { players: ids.map(id => clubSummary(id)), cards };
  },

  // Local installs used to keep these files next to the server; hand them to the browser once.
  async 'GET /api/legacy-import'() {
    if (HOSTED) return {};
    const read = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
    return { managers: read('my-managers.json')?.managers || [], club: read('my-club.json')?.players || [], squads: read('my-squads.json')?.squads || [] };
  },

  async 'POST /api/squad/evaluate'(q, body) {
    await ensureCards([...cleanIds(body.slots, 11), ...cleanIds(body.bench, BENCH_MAX)]);
    return evaluateSquad(body, await resolveManager(body));
  },

  async 'POST /api/squad/suggest'(q, body) {
    const ids = cleanIds(body.club, CLUB_MAX).filter(Boolean);
    if (!ids.length) throw new UserError('Your club is empty. Add a few cards first, then ask for a suggestion.');
    await ensureCards(ids);
    return suggestSquad(body, await resolveManager(body));
  },

  async 'POST /api/squad/slot-options'(q, body) {
    const manager = await resolveManager(body);
    const pos = String(body.pos || '').toUpperCase();
    if (B.POSITION_COLUMN[pos] === undefined) throw new UserError(`Unknown position "${pos}".`);
    const ids = cleanIds(body.club, CLUB_MAX).filter(Boolean);
    await ensureCards(ids);
    const boosts = await loadBoosts();
    const tactic = M.TACTICS.some(t => t.key === body.tactic) ? body.tactic : M.bestTactic(M.normalizeManager(manager));
    return ids.map(cachedCard).filter(Boolean).map(card => {
      const fit = fitOf(card, pos);
      const r = slotOvr(card, boosts, pos, manager, tactic);
      return playerOut(card, { pos, ovr: r.ovr, cardOvr: r.cardOvr, fit, levelCap: card.levelCap });
    }).sort((a, b) => (a.fit === 'off') - (b.fit === 'off') || b.ovr - a.ovr);
  },
};
// ---------------------------------------------------------------- HTTP
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1.5e6) { reject(new UserError('Request too large.', 413)); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new UserError('Request body was not valid JSON.')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = `${req.method} ${url.pathname}`;
  try {
    if (api[route]) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const ctx = { cards: readInlineCards(body), memo: new Map() };
      return send(res, 200, await reqCtx.run(ctx, () => api[route](url.searchParams, body)));
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown API route.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
    let rel;
    try { rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
    catch { return send(res, 400, 'Bad path', 'text/plain'); }
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(route, e);
    send(res, status, { error: e instanceof UserError ? e.message : `Something went wrong on the server (${e.message}). Try again in a moment.` });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  if (HOSTED) return console.log(`Build Album running on port ${PORT}`);
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${PORT}`);
  console.log(`Build Album running\n  This PC: http://localhost:${PORT}\n  Phone (same Wi-Fi): ${lan.join('  ') || '(no LAN address found)'}\nCtrl+C to stop.`);
});
