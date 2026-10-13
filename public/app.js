'use strict';

const $ = s => document.querySelector(s);
const TAC_SHORT = { PossessionGame: 'PG', QuickCounter: 'QC', LongBallCounter: 'LBC', OutWide: 'OW', LongBall: 'LB', OverLoad: 'OL' };
const SLOT_SHORT = { shooting: 'SHO', passing: 'PAS', dribbling: 'DRI', dexterity: 'DEX', lowerBodyStrength: 'LBS', aerialStrength: 'AER', defending: 'DEF', gk1: 'GK1', gk2: 'GK2', gk3: 'GK3' };
const ALL_POS = ['GK', 'CB', 'LB', 'RB', 'DMF', 'CMF', 'LMF', 'RMF', 'AMF', 'LWF', 'RWF', 'SS', 'CF'];
const COACH_IMG = id => `https://efimg.com/efootballhub22/images/coach_cards/${id}.png`;
const CARD_IMG = id => `https://efimg.com/efootballhub22/images/mini-cards/mini-cards/${id}_l.png`;
const CARD_IMG2 = id => `https://efimg.com/efootballhub22/images/player_cards/${id}_l.png`;
const WIDE = window.matchMedia('(min-width: 960px)');
const ENGINE = window.BA_ENGINE || null;
const SLOW_NOTE = ENGINE ? "Cards come from Build Album's library; new ones are added on request." : 'efhub asks for 5 s between requests, so a new card can take a few seconds.';

const S = {
  tactics: [], mult: [], abilities: [], all: [], mine: [],
  playerId: null, level: null, pos: null, managerId: null, tactic: null, stat: 'finishing', sel: 0,
  build: null, morePos: false,
  view: 'mine', filter: '', replace: null, ratings: null,
};

// ---------------------------------------------------------------- helpers
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

const bc = i => `bc-${i % 3 + 1}`;

// ---------------------------------------------------------------- data
// The server keeps nothing per visitor. Your team, club, squads and the raw cards they
// need live in this browser's localStorage and travel inline with each request.
// On GitHub Pages there is no server: engine.js answers the same /api/* routes in the page.
const LIMITS = { club: 200, bench: 12, recent: 24 };
const K = { managers: 'ba.managers', club: 'ba.club', squads: 'ba.squads', recent: 'ba.recent', cards: 'ba.cards', migrated: 'ba.migrated' };
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const abortErr = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });

async function netApi(path, { method = 'GET', body, signal } = {}) {
  if (ENGINE) {
    if (signal?.aborted) throw abortErr();
    const u = new URL(path, location.origin);
    const d = await ENGINE.handle(method, u.pathname, u.searchParams, body);
    if (signal?.aborted) throw abortErr();
    return d;
  }
  let res;
  try {
    res = await fetch(path, {
      method, signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw fail("Couldn't reach the Build Album server. Check your connection, then try again.", 0);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw fail(data?.error || `That request failed (${res.status}). Try again.`, res.status);
  return data;
}

function readStore(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeStore(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
const listOf = k => { const v = readStore(k); return Array.isArray(v) ? v : []; };
const isCard = c => !!c && typeof c === 'object' && !!c.baseStats && typeof c.baseStats === 'object' && !!c.position;
const cardBank = () => { const v = readStore(K.cards); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const clubIds = () => listOf(K.club).map(p => String(p.id));

// Drop cached cards that neither the club nor the recent list needs.
function pruneCards(bank = cardBank(), extra = []) {
  const keep = new Set([...clubIds(), ...listOf(K.recent).map(p => String(p.id)), ...extra]);
  for (const id of Object.keys(bank)) if (!keep.has(id)) delete bank[id];
  return writeStore(K.cards, bank);
}
function save(k, v) {
  if (writeStore(k, v)) return;
  pruneCards();
  if (writeStore(k, v)) return;
  writeStore(K.cards, {});
  if (writeStore(k, v)) return;
  throw fail('This browser is out of space for Build Album. Remove a few saved squads or club cards, then try again.', 507);
}
function keepCards(add) {
  const fresh = Object.entries(add || {}).filter(([, c]) => isCard(c));
  if (!fresh.length) return;
  const bank = Object.assign(cardBank(), Object.fromEntries(fresh));
  // Still too big after pruning: the server refetches any card it isn't sent.
  if (!writeStore(K.cards, bank)) pruneCards(bank, fresh.map(([id]) => id));
}
function cardsFor(ids) {
  const bank = cardBank(), out = {};
  for (const id of new Set(ids.filter(x => x != null && x !== '').map(String))) if (isCard(bank[id])) out[id] = bank[id];
  return out;
}

const slugOf = s => deaccent(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manager';
const bestOf = (skills, tactics) => tactics.reduce((a, t) => ((skills?.[t.key] || 0) > (skills?.[a] || 0) ? t.key : a), tactics[0]?.key);
function mineFrom(list, all = S.all, tactics = S.tactics) {
  return list.map(m => {
    if (m.custom) return { ...m, id: String(m.id), bestTactic: bestOf(m.skills, tactics), custom: true, mine: true };
    const hit = all.find(x => x.id === String(m.id));
    return hit ? { ...hit, mine: true } : { id: String(m.id), name: m.name || 'Unknown manager', missing: true };
  });
}

// Requests answered from this browser instead of the server.
const local = {
  async 'GET /api/managers'() {
    const d = await netApi('/api/managers');
    return { ...d, mine: mineFrom(listOf(K.managers), d.all, d.tactics) };
  },
  async 'POST /api/my-managers'(q, body) {
    const list = listOf(K.managers);
    if (body.custom) {
      const name = String(body.name || '').trim().slice(0, 40);
      if (!name) throw fail('Give the manager a name, then save again.');
      const skills = {};
      for (const t of S.tactics) skills[t.key] = Math.min(99, Math.max(40, Math.round(Number(body.skills?.[t.key])) || 40));
      const boosts = [...new Set((body.boosts || []).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n < S.abilities.length).slice(0, 2);
      const at = body.id ? list.findIndex(m => m.custom && String(m.id) === String(body.id)) : -1;
      const entry = { id: at >= 0 ? String(list[at].id) : `custom-${slugOf(name)}-${Date.now().toString(36)}`, custom: true, name, skills, boosts };
      if (at >= 0) list[at] = entry; else list.push(entry);
    } else {
      const id = String(body.id || '');
      const hit = S.all.find(m => m.id === id);
      if (!hit) throw fail('That manager is not in the efhub list. Refresh managers, then try again.', 404);
      const swap = body.replace == null ? -1 : list.findIndex(m => String(m.id) === String(body.replace));
      if (list.some((m, i) => String(m.id) === id && i !== swap)) throw fail(`${hit.name} (this version) is already in your team.`, 409);
      if (swap >= 0) list[swap] = { id, name: hit.name }; else list.push({ id, name: hit.name });
    }
    save(K.managers, list);
    return { mine: mineFrom(list) };
  },
  async 'DELETE /api/my-managers'(q) {
    const list = listOf(K.managers);
    const i = list.findIndex(m => String(m.id) === String(q.get('id') || ''));
    if (i < 0) throw fail('That manager is not in your team any more. Reload the page.', 404);
    list.splice(i, 1);
    save(K.managers, list);
    return { mine: mineFrom(list) };
  },

  async 'GET /api/collection'() { return listOf(K.recent); },

  async 'GET /api/club'() {
    const club = listOf(K.club);
    if (!club.length) return { players: [] };
    const ids = club.map(p => String(p.id));
    const d = await netApi('/api/club/summaries', { method: 'POST', body: { ids, cards: cardsFor(ids) } });
    keepCards(d.cards);
    const added = new Map(club.map(p => [String(p.id), p.added]));
    return { players: d.players.map(p => ({ ...p, added: added.get(String(p.id)) })) };
  },
  async 'POST /api/club'(q, body) {
    if (listOf(K.club).length >= LIMITS.club) throw fail(`Your club is full at ${LIMITS.club} cards. Remove one, then add this card.`, 409);
    const ref = String(body.id || '');
    const { card, ...sum } = await netApi('/api/card-summary', { method: 'POST', body: { id: ref, cards: cardsFor([ref]) } });
    const id = String(sum.id);
    const club = listOf(K.club);
    if (club.some(p => String(p.id) === id)) throw fail(`${sum.name || 'That card'} is already in your club.`, 409);
    club.push({ id, added: new Date().toISOString() });
    save(K.club, club);
    keepCards({ [id]: card });
    const { players } = await local['GET /api/club']();
    return { players, name: sum.name, added: { id, name: sum.name } };
  },
  async 'DELETE /api/club'(q) {
    const club = listOf(K.club);
    const i = club.findIndex(p => String(p.id) === String(q.get('id') || ''));
    if (i < 0) throw fail('That card is not in your club any more. Reload the page.', 404);
    club.splice(i, 1);
    save(K.club, club);
    return local['GET /api/club']();
  },

  async 'GET /api/squads'() { return { squads: listOf(K.squads) }; },
  async 'POST /api/squads'(q, body) {
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) throw fail('Give the squad a name, then save again.');
    const squads = listOf(K.squads);
    const keepId = /^sq-[a-z0-9-]+$/.test(String(body.id || '')) && squads.some(s => s.id === body.id);
    const id = keepId ? body.id : `sq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = (v, n) => (Array.isArray(v) ? v : []).slice(0, n).map(x => (x == null || x === '' ? null : String(x)));
    const saved = {
      id, name, formation: String(body.formation || ''),
      managerId: body.managerId == null ? null : String(body.managerId), tactic: body.tactic || null,
      slots: ids(body.slots, 11), bench: ids(body.bench, LIMITS.bench), updated: new Date().toISOString(),
    };
    const i = squads.findIndex(s => s.id === id);
    if (i >= 0) squads[i] = saved; else squads.unshift(saved);
    save(K.squads, squads);
    return { squads, saved };
  },
  async 'DELETE /api/squads'(q) {
    const squads = listOf(K.squads);
    const i = squads.findIndex(s => s.id === String(q.get('id') || ''));
    if (i < 0) throw fail('That squad was already deleted. Reload the page.', 404);
    squads.splice(i, 1);
    save(K.squads, squads);
    return { squads };
  },
};

// Server-bound requests carry what the server no longer stores: custom managers, club ids and cards.
function prepare(route, body) {
  const b = { ...body };
  const cm = String(b.managerId || '').startsWith('custom-') && !b.manager ? listOf(K.managers).find(m => m.custom && String(m.id) === String(b.managerId)) : null;
  if (cm) b.manager = { id: String(cm.id), name: cm.name, skills: cm.skills, boosts: cm.boosts };
  const squadIds = [...(b.slots || []), ...(b.bench || [])];
  if (route === '/api/squad/suggest' || route === '/api/squad/slot-options') {
    b.club = clubIds();
    b.cards = cardsFor([...b.club, ...squadIds]);
  } else if (route === '/api/squad/evaluate') {
    b.cards = cardsFor(squadIds);
  } else if (route === '/api/build' && !b.refresh) {
    b.cards = cardsFor([b.id]);
  }
  return b;
}

function learn(route, d) {
  if (route !== '/api/build' || !d?.card) return;
  const c = d.card;
  const entry = { id: String(c.id), name: c.name, team: c.team, position: c.position, type: c.type, levelCap: c.levelCap, ovr: c.baseOvr };
  try { save(K.recent, [entry, ...listOf(K.recent).filter(p => String(p.id) !== entry.id)].slice(0, LIMITS.recent)); } catch {}
  keepCards({ [entry.id]: d.raw });
}

async function api(path, opts = {}) {
  const url = new URL(path, location.origin);
  const handler = local[`${opts.method || 'GET'} ${url.pathname}`];
  if (handler) return handler(url.searchParams, opts.body || {}, opts);
  const d = await netApi(path, { ...opts, body: opts.body && prepare(url.pathname, opts.body) });
  learn(url.pathname, d);
  return d;
}

// Local installs used to keep the team, club and squads in files next to the server; move them in once.
async function importLegacy() {
  if (readStore(K.migrated)) return;
  let d;
  try { d = await netApi('/api/legacy-import'); } catch { return; }
  const fill = (k, v) => { if (Array.isArray(v) && v.length && !listOf(k).length) save(k, v); };
  try {
    fill(K.managers, (d?.managers || []).filter(m => m && m.id != null).map(m => ({ ...m, id: String(m.id) })));
    fill(K.club, (d?.club || []).filter(p => p && p.id != null).map(p => ({ id: String(p.id), added: p.added })));
    fill(K.squads, d?.squads);
  } catch { /* out of space: start fresh rather than block the app */ }
  writeStore(K.migrated, 1);
}

let toastTimer;
function toast(msg, kind = 'error', link = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (link) t.append(' ', h('a', { href: link.href, target: '_blank', rel: 'noopener' }, link.text));
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, link ? 15000 : kind === 'error' ? 7000 : 3500);
}
const requestLink = e => (e?.needsRequest ? { href: e.requestUrl, text: 'Request it on GitHub' } : null);

const deaccent = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const initials = name => String(name || '?').split(/\s+/).map(w => w.replace(/[^A-Za-z]/g, '')[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
const skillName = k => String(k).replace(/^gk/, 'GK ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const tacLabel = key => S.tactics.find(t => t.key === key)?.label || key;
const statLabel = key => S.build?.statRows.find(r => r.key === key)?.label || skillName(key);
const multOf = prof => (prof == null ? 1 : S.mult[Math.max(0, Math.min(S.mult.length - 1, prof - 50))] ?? 1);
const pct = m => {
  const p = Math.round((m - 1) * 1000) / 10;
  return p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : '±0%';
};
const mgr = id => (id == null ? null : S.mine.find(m => m.id === String(id)) || S.all.find(m => m.id === String(id)) || null);
const firstUsable = () => S.mine.find(m => !m.missing) || null;
const boostText = m => (m.boosts || []).map(id => S.abilities[id]?.label).filter(Boolean).join(', ');
const bestByMult = m => S.tactics.reduce((best, t) => (multOf(m.skills[t.key]) > multOf(m.skills[best]) ? t.key : best), m.bestTactic || S.tactics[0].key);

function coach(m, size) {
  const fig = h('span', { class: `coach${size ? ` coach-${size}` : ''}`, 'aria-hidden': 'true' },
    h('span', { class: 'coach-init', text: initials(m?.name) }));
  if (m && !m.custom && !m.missing && /^\d+$/.test(m.id)) {
    const img = h('img', { src: COACH_IMG(m.id), alt: '', loading: 'lazy', decoding: 'async', width: '48', height: '64' });
    img.addEventListener('load', () => fig.classList.add('has-img'));
    img.addEventListener('error', () => img.remove());
    fig.append(img);
  }
  return fig;
}

// Keep keyboard focus on the same control when a region re-renders.
function keepFocus(fn) {
  const fk = document.activeElement?.dataset?.fk;
  fn();
  if (fk) document.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus();
}

// On phones the playstyle strip scrolls sideways; bring the chosen one into view
// without moving the page or undoing a scroll the user made themselves.
function revealChecked(strip) {
  const on = strip?.querySelector('[aria-checked="true"]');
  if (!on || !strip.clientWidth) return;
  const l = on.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
  const r = l + on.offsetWidth;
  if (l < strip.scrollLeft) strip.scrollLeft = Math.max(0, l - 16);
  else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 16;
}

// ---------------------------------------------------------------- URL state
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  S.playerId = p.get('p');
  S.level = Number(p.get('lv')) || null;
  S.pos = p.get('pos');
  S.managerId = p.get('m');
  S.tactic = p.get('t');
  S.stat = p.get('s') || 'finishing';
  S.sel = Math.min(2, Math.max(0, Number(p.get('b')) || 0));
  S.v = p.get('v');
}

function writeHash() {
  const p = new URLSearchParams();
  if (S.playerId) p.set('p', S.playerId);
  if (S.managerId) p.set('m', S.managerId);
  if (S.tactic) p.set('t', S.tactic);
  if (S.level) p.set('lv', S.level);
  if (S.pos) p.set('pos', S.pos);
  if (S.stat && S.stat !== 'finishing') p.set('s', S.stat);
  if (S.sel) p.set('b', S.sel);
  const v = document.body.dataset.view;
  if (v === 'squad' || v === 'album' || (v === 'home' && S.playerId)) p.set('v', v);
  history.replaceState(null, '', `#${p}`);
}

// ---------------------------------------------------------------- data
async function loadManagers() {
  const d = await api('/api/managers');
  Object.assign(S, { tactics: d.tactics, mult: d.mult, abilities: d.abilities, all: d.all, mine: d.mine });
  renderCounts();
}

let buildCtrl, buildTimer;
function scheduleBuild(delay = 150) {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => build(), delay);
}

async function build({ newPlayer = false, refresh = false } = {}) {
  if (!S.playerId) return;
  clearTimeout(buildTimer);
  buildCtrl?.abort();
  const ctrl = buildCtrl = new AbortController();
  setBusy(true, newPlayer || !S.build);
  try {
    const d = await api('/api/build', {
      method: 'POST', signal: ctrl.signal,
      body: { id: S.playerId, level: S.level, pos: S.pos, managerId: S.managerId, tactic: S.tactic, stat: S.stat, refresh },
    });
    const placing = !S.build || S.build.card.id !== d.card.id;
    Object.assign(S, { build: d, playerId: d.card.id, level: d.level, pos: d.pos, tactic: d.tactic, stat: d.stat });
    writeHash();
    renderAll(placing);
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (/manager could not be found/i.test(e.message)) {
      S.managerId = firstUsable()?.id || null;
      S.tactic = mgr(S.managerId)?.bestTactic || null;
      renderManager();
    }
    if (S.build) {
      S.playerId = S.build.card.id;
      S.level = S.build.level;
      S.pos = S.build.pos;
      renderLevel();
      toast(e.message, 'error', requestLink(e));
    } else {
      renderError(e);
    }
  } finally {
    if (buildCtrl === ctrl) setBusy(false);
  }
}

function setBusy(on, slow) {
  const album = $('#album');
  album.classList.toggle('is-busy', on);
  album.setAttribute('aria-busy', String(on));
  if (on && slow) renderLoading();
}

// ---------------------------------------------------------------- album render
function renderAll(placing) {
  keepFocus(() => {
    renderLevel();
    renderManager();
    renderSticker(placing);
    renderTwin();
    renderPositions();
    renderBuilds();
    renderDiff();
    renderStats();
  });
  document.body.classList.add('has-build');
}

function renderCounts() {
  $('#teamCount').textContent = S.mine.length;
  $('#tabMineCount').textContent = S.mine.length;
  $('#tabAllCount').textContent = S.all.length;
}

function renderLevel() {
  const lv = $('#level');
  const d = S.build;
  if (!d) {
    lv.disabled = true;
    $('#levelDown').disabled = $('#levelUp').disabled = true;
    $('#levelOut').textContent = '–';
    $('#levelCap').textContent = '';
    $('#levelPts').textContent = 'No player yet';
    $('#levelStrip').classList.remove('is-stale');
    return;
  }
  const cap = d.card.levelCap || d.level;
  lv.max = cap;
  lv.value = S.level ?? d.level;
  lv.disabled = cap <= 1;
  lv.setAttribute('aria-valuetext', `Level ${lv.value} of ${cap}`);
  $('#levelOut').textContent = lv.value;
  $('#levelCap').textContent = ` / ${cap}`;
  $('#levelPts').textContent = `${d.points} Progression Points`;
  $('#levelStrip').classList.toggle('is-stale', Number(lv.value) !== d.level);
  $('#levelDown').disabled = Number(lv.value) <= 1;
  $('#levelUp').disabled = Number(lv.value) >= cap;
}

function renderManager() {
  const head = $('#mgrHead');
  const m = mgr(S.managerId);
  head.replaceChildren();
  $('#pageBand').replaceChildren(...(m ? [
    h('span', { class: 'band-crest' }),
    h('span', { class: 'band-name', text: m.name.trim().split(/\s+/).pop() }),
    h('span', { text: S.tactic ? tacLabel(S.tactic) : '' }),
  ] : []));
  if (!m) {
    head.append(
      h('span', { class: 'coach coach-empty', 'aria-hidden': 'true' }),
      h('div', { class: 'mgr-text' },
        h('p', { class: 'mgr-name', text: 'No manager picked' }),
        h('p', { class: 'mgr-meta', text: S.mine.length ? 'Pick one from your team to apply their boosts.' : 'Collect the managers you own, then pick one.' })),
      h('button', { class: 'btn btn-print', type: 'button', onclick: () => openTeam() }, S.mine.length ? 'Pick manager' : 'Collect managers'));
  } else {
    head.append(
      coach(m),
      h('div', { class: 'mgr-text' },
        h('p', { class: 'mgr-name', text: m.name }),
        h('p', { class: 'mgr-meta', text: m.boosts?.length ? `Boosts ${boostText(m)} +1` : 'No boosted skills' })),
      h('button', { class: 'btn btn-print', type: 'button', onclick: () => openTeam('mine') }, 'Change'));
  }

  const ps = $('#playstyles');
  const active = S.tactic || S.tactics[0]?.key;
  ps.replaceChildren(...S.tactics.map(t => {
    const prof = m?.skills?.[t.key];
    const on = t.key === S.tactic;
    return h('button', {
      type: 'button', role: 'radio', class: 'ps', 'aria-checked': String(on), tabindex: t.key === active ? '0' : '-1',
      dataset: { tactic: t.key, fk: `ps-${t.key}` }, onclick: () => setTactic(t.key),
    },
    h('span', { class: 'ps-name', text: t.label }),
    prof != null
      ? h('span', { class: 'ps-prof' },
        h('span', { class: 'ps-n', text: prof }),
        h('span', { class: 'vh', text: ' proficiency, ' }),
        h('span', { class: 'ps-m', text: pct(multOf(prof)) }))
      : null);
  }));
  revealChecked(ps);
}

function renderLoading() {
  $('#playerSlot').replaceChildren(h('div', { class: 'slot slot-loading', role: 'status' },
    h('span', { class: 'slot-spinner', 'aria-hidden': 'true' }),
    h('p', { class: 'slot-title', text: 'Fetching the card…' }),
    h('p', { class: 'slot-note', text: SLOW_NOTE })));
}

function renderError(err) {
  const message = typeof err === 'string' ? err : err?.message || 'Something went wrong. Try again.';
  $('#playerSlot').replaceChildren(h('div', { class: 'slot slot-error', role: 'alert' },
    h('p', { class: 'slot-title', text: err?.needsRequest ? 'Not in Build Album yet' : "Couldn't load this card" }),
    h('p', { class: 'slot-note', text: message }),
    err?.needsRequest
      ? h('a', { class: 'btn btn-stick', href: err.requestUrl, target: '_blank', rel: 'noopener' }, 'Request this card on GitHub')
      : h('button', { class: 'btn btn-stick', type: 'button', onclick: () => build({ newPlayer: true }) }, 'Try again')));
}

async function renderEmpty() {
  renderLevel();
  document.body.classList.remove('has-build');
  $('#diffStrip').replaceChildren();
  $('#twin').hidden = true;
  $('#positions').hidden = true;
  const slot = h('div', { class: 'slot slot-empty' },
    h('p', { class: 'slot-title', text: 'No player yet' }),
    h('p', { class: 'slot-note', text: 'Paste an efhub player link above, or search by name.' }));
  $('#playerSlot').replaceChildren(slot);
  $('#buildsSub').textContent = 'Three ways to spend the same Progression Points.';
  $('#buildList').replaceChildren(...['Max OVR', 'Team Playstyle build', 'Max Finishing'].map((title, i) =>
    h('li', { class: `build build-empty ${bc(i)}` },
      h('div', { class: 'build-head' },
        h('span', { class: 'build-no', text: i + 1 }),
        h('span', { class: 'build-title', text: title })),
      h('ol', { class: 'slots', 'aria-hidden': 'true' },
        Object.values(SLOT_SHORT).slice(0, 7).map(k => h('li', { class: 'slot-n is-zero' }, h('span', { class: 'slot-k', text: k }), h('span', { class: 'slot-v', text: '' })))))));
  $('#statsWrap').replaceChildren(h('p', { class: 'stats-empty', text: 'Stats show up once you pick a player.' }));

  try {
    const picks = await api('/api/collection');
    if (!picks.length || S.build) return;
    slot.append(h('div', { class: 'picks' },
      h('p', { class: 'picks-head', text: 'Recently built' }),
      h('ul', { class: 'pick-list' }, picks.slice(0, 8).map(p =>
        h('li', null, h('button', { class: 'btn btn-print pick', type: 'button', onclick: () => pickPlayer(p.id) },
          h('span', { class: 'pick-pos', text: p.position || '' }), ` ${p.name}`))))));
  } catch {}
}

function fact(label, value) {
  return value == null || value === '' ? null : h('div', null, h('dt', { text: label }), h('dd', { text: value }));
}

function cardPhoto(id, big) {
  const [first, second] = big ? [CARD_IMG2, CARD_IMG] : [CARD_IMG, CARD_IMG2];
  const box = h('div', { class: big ? 'st-photo st-photo-card' : 'st-photo', 'aria-hidden': 'true' });
  const img = h('img', { src: first(id), alt: '', loading: big ? 'eager' : 'lazy', decoding: 'async', width: big ? '240' : '72', height: big ? '340' : '88' });
  let tried = false;
  img.addEventListener('load', () => box.classList.add('has-img'));
  img.addEventListener('error', () => {
    if (!tried) { tried = true; img.src = second(id); return; }
    box.classList.add('is-empty');
  });
  box.append(img);
  return box;
}

function stickerSlots() {
  const b = S.build.builds[S.sel];
  return h('div', { class: `st-slots ${bc(S.sel)}` },
    h('p', { class: 'st-slots-h' }, h('b', { text: b.title }), h('span', { text: `Build ${S.sel + 1} of ${S.build.builds.length}` })),
    h('ol', { class: 'slots', 'aria-label': `Build ${S.sel + 1} training points` },
      b.sliders.map(s => h('li', { class: `slot-n${s.value ? '' : ' is-zero'}`, title: s.label },
        h('span', { class: 'slot-k', 'aria-hidden': 'true', text: SLOT_SHORT[s.key] || s.label.slice(0, 3).toUpperCase() }),
        h('span', { class: 'vh', text: `${s.label} ` }),
        h('span', { class: 'slot-v', text: s.value })))));
}

function renderSticker(placing) {
  const d = S.build, c = d.card, b = d.builds[S.sel], x = d.extras || {};
  const skills = x.skills || [], ai = x.comSkills || [];
  const st = h('article', { class: 'sticker', 'aria-labelledby': 'stName', dataset: { type: c.type } },
    h('div', { class: 'st-top' },
      h('p', { class: 'st-ovr' },
        h('span', { class: 'st-ovr-n', text: b.ovr }),
        h('span', { class: 'vh', text: ' OVR as ' }),
        h('span', { class: 'st-pos', text: d.pos })),
      cardPhoto(c.id, true),
      h('p', { class: 'st-type', text: c.type })),
    h('h2', { class: 'st-name', id: 'stName', text: c.name }),
    h('p', { class: 'st-team', text: [c.team, c.league].filter(Boolean).join(' · ') }),
    stickerSlots(),
    h('details', { class: 'st-more', open: WIDE.matches },
      h('summary', null, 'Card details'),
      h('div', { class: 'st-more-body' },
        h('dl', { class: 'st-facts' },
          fact('Style', c.playingStyle),
          fact('Foot', x.preferredFoot),
          fact('Age', x.age),
          fact('Height', c.height ? `${c.height} cm` : null)),
        c.cardBoosts?.length ? h('p', { class: 'st-boost', text: `Card boost ${c.cardBoosts.join(', ')}` }) : null,
        skills.length || ai.length
          ? h('details', { class: 'st-skills' },
            h('summary', null, `Player Skills ${skills.length}`, ai.length ? ` · AI Playing Styles ${ai.length}` : ''),
            skills.length ? h('ul', { class: 'skill-list', 'aria-label': 'Player Skills' }, skills.map(s => h('li', { text: skillName(s) }))) : null,
            ai.length ? h('ul', { class: 'skill-list skill-ai', 'aria-label': 'AI Playing Styles' }, ai.map(s => h('li', { text: skillName(s) }))) : null)
          : null,
        h('p', { class: 'st-links' },
          h('a', { href: `https://efhub.com/players/${encodeURIComponent(c.id)}`, target: '_blank', rel: 'noopener' }, 'Open on efhub'),
          ENGINE ? null : h('button', { type: 'button', class: 'linkish', onclick: () => build({ refresh: true }) }, 'Refetch card')))));
  if (placing) {
    st.classList.add('is-placing');
    st.addEventListener('animationend', () => st.classList.remove('is-placing'), { once: true });
  }
  $('#playerSlot').replaceChildren(st);
}

function updateStickerOvr() {
  const n = document.querySelector('.st-ovr-n');
  if (n && S.build) n.textContent = S.build.builds[S.sel].ovr;
  document.querySelector('.st-slots')?.replaceWith(stickerSlots());
}

function renderDiff() {
  const d = S.build, box = $('#diffStrip');
  if (!d || d.builds.length < 2) return box.replaceChildren();
  const keys = d.builds[0].sliders.map(s => s.key);
  const differ = [], same = [];
  keys.forEach((k, j) => {
    const vals = d.builds.map(b => b.sliders[j]?.value ?? 0);
    (new Set(vals).size > 1 ? differ : same).push({ k, vals });
  });
  const short = k => SLOT_SHORT[k] || k.slice(0, 3).toUpperCase();
  box.replaceChildren(
    h('p', { class: 'diff-h', text: differ.length ? 'Where the builds differ' : 'All builds use the same slots' }),
    differ.length ? h('div', { class: 'diff-cols' }, differ.map(({ k, vals }) =>
      h('div', { class: 'diff-col' },
        h('span', { class: 'diff-k', text: short(k) }),
        vals.map((v, i) => h('span', { class: `diff-v ${bc(i)}${i === S.sel ? ' is-sel' : ''}` }, `Build ${i + 1}`, h('b', { text: v })))))) : null,
    same.length && differ.length ? h('p', { class: 'diff-same', text: `${same.map(s => short(s.k)).join(', ')} same in all ${d.builds.length}` }) : null);
}

function renderTwin() {
  const d = S.build, b = d.builds[S.sel], m = d.manager;
  const tw = $('#twin');
  tw.hidden = false;
  const step = (label, n, extra) => h('li', { class: 'tw-step' },
    h('span', { class: 'tw-n', text: n }),
    h('span', { class: 'tw-l', text: label }),
    extra ? h('span', { class: 'tw-d', text: extra }) : null);
  const diff = b.ovr - b.cardOvr;
  tw.replaceChildren(h('ol', { class: 'tw-steps', 'aria-label': `OVR for build ${S.sel + 1}` },
    step('Card', d.card.baseOvr),
    step(`Trained, build ${S.sel + 1}`, b.cardOvr),
    m ? step(`With ${m.name} · ${tacLabel(d.tactic)} ${m.proficiency}`, b.ovr, diff ? `${diff > 0 ? '+' : '−'}${Math.abs(diff)}` : '±0') : null));
}

function renderPositions() {
  const d = S.build, box = $('#positions');
  const own = d.card.positions?.length ? d.card.positions : [d.card.position];
  const list = S.morePos ? ALL_POS : [...new Set([...own, d.pos])];
  box.hidden = false;
  box.replaceChildren(
    h('p', { class: 'pos-label', id: 'posLabel', text: 'Position' }),
    h('div', { class: 'pos-chips', role: 'group', 'aria-labelledby': 'posLabel' },
      list.map(p => h('button', {
        type: 'button', class: `chip${own.includes(p) ? '' : ' chip-off'}`, 'aria-pressed': String(p === d.pos),
        dataset: { fk: `pos-${p}` }, onclick: () => setPos(p),
      }, p)),
      h('button', {
        type: 'button', class: 'chip chip-more', 'aria-expanded': String(S.morePos), dataset: { fk: 'pos-more' },
        onclick: () => { S.morePos = !S.morePos; keepFocus(renderPositions); },
      }, S.morePos ? 'Card positions only' : 'All positions')));
}

function renderBuilds() {
  const d = S.build;
  $('#buildsSub').textContent = `Lv ${d.level} · ${d.points} Progression Points · ${d.pos}`
    + (d.manager ? ` · ${d.manager.name}, ${tacLabel(d.tactic)}` : ' · no manager');
  $('#buildList').replaceChildren(...d.builds.map((b, i) => buildRow(d, b, i)));
}

function buildRow(d, b, i) {
  const on = i === S.sel;
  let note = null;
  if (b.key === 'tactic') note = `Estimate: leans toward the stats ${tacLabel(b.weights?.tactic || d.tactic)} relies on. A heuristic, not a game rule.`;
  if (b.key === 'stat' && !b.reachable) note = `Training can't raise ${statLabel(b.stat)}, so these are the Max OVR slots.`;
  const chase = b.key === 'stat' && b.reachable
    ? h('span', { class: 'build-chase' }, `${statLabel(b.stat)} `, h('strong', { text: b.stats[b.stat] }))
    : null;
  return h('li', { class: `build ${bc(i)}${on ? ' is-on' : ''}`, onclick: e => { if (!e.target.closest('button')) selectBuild(i); } },
    h('button', {
      type: 'button', class: 'build-head', 'aria-pressed': String(on), dataset: { fk: `b-${i}` }, onclick: () => selectBuild(i),
    },
    h('span', { class: 'build-no', text: i + 1 }),
    h('span', { class: 'build-title', text: b.title }),
    h('span', { class: 'build-ovr' }, h('span', { class: 'build-ovr-n', text: b.ovr }), ' OVR')),
    h('ol', { class: 'slots', 'aria-label': `Build ${i + 1} training points` },
      b.sliders.map((s, j) => h('li', { class: `slot-n${s.value ? '' : ' is-zero'}${new Set(d.builds.map(x => x.sliders[j]?.value)).size > 1 ? ' is-diff' : ''}`, title: s.label },
        h('span', { class: 'slot-k', 'aria-hidden': 'true', text: SLOT_SHORT[s.key] || s.label.slice(0, 3).toUpperCase() }),
        h('span', { class: 'vh', text: `${s.label} ` }),
        h('span', { class: 'slot-v', text: s.value })))),
    h('p', { class: 'build-meta' },
      chase,
      h('span', { text: `Card ${b.cardOvr} without manager` }),
      h('span', { text: `${b.pointsUsed}/${d.points} points` })),
    note ? h('p', { class: 'build-note', text: note }) : null);
}

function renderStats() {
  const d = S.build;
  const boosted = new Set((d.manager?.boosts || []).map(b => b.stat));
  const th = (text, props) => h('th', { scope: 'col', ...props }, text);
  const table = h('table', { class: 'stat-table' },
    h('caption', { class: 'vh', text: `${d.card.name} stats at level ${d.level}` }),
    h('thead', null, h('tr', null,
      th('Stat'),
      th('Card', { title: 'Card stats, no training' }),
      th(d.manager ? '+Mgr' : 'Lv 1', { title: d.manager ? 'With the manager, no training' : 'No training' }),
      d.builds.map((b, i) => th([h('span', { class: 'vh', text: `${b.title}, build ` }), h('span', { class: 'th-chip', text: i + 1 })],
        { title: b.title, class: `${bc(i)}${i === S.sel ? ' is-sel' : ''}` })))),
    h('tbody', null, d.statRows.map(r => {
      const chase = r.key === S.stat;
      return h('tr', { class: chase ? 'is-chase' : null },
        h('th', { scope: 'row' },
          h('button', { type: 'button', class: 'stat-btn', 'aria-pressed': String(chase), dataset: { fk: `s-${r.key}` }, onclick: () => setStat(r.key) },
            r.label,
            boosted.has(r.key) ? h('span', { class: 'tag-mgr' }, h('span', { 'aria-hidden': 'true', text: '+1' }), h('span', { class: 'vh', text: ' manager boost' })) : null)),
        h('td', { text: r.base }),
        h('td', { text: r.untrained }),
        r.values.map((v, i) => h('td', { class: `${bc(i)}${i === S.sel ? ' is-sel' : ''}`, text: v })));
    })));
  $('#statsWrap').replaceChildren(table);
}

// ---------------------------------------------------------------- album actions
function pickPlayer(id) {
  hideResults();
  setFinder(false);
  $('#findInput').value = '';
  hideHomeResults();
  $('#homeInput').value = '';
  Object.assign(S, { playerId: String(id), level: null, pos: null, sel: 0, morePos: false, ratings: null });
  if (document.body.dataset.view !== 'album') showView('album');
  build({ newPlayer: true });
}

function setTactic(key) {
  if (key === S.tactic) return;
  S.tactic = key;
  keepFocus(renderManager);
  writeHash();
  if (S.build) build();
}

function setPos(p) {
  if (p === S.pos) return;
  S.pos = p;
  S.ratings = null;
  build();
}

function setStat(key) {
  if (key === S.stat) return;
  S.stat = key;
  S.ratings = null;
  build();
}

function setFinder(open) {
  document.body.classList.toggle('finder-open', open);
  $('#findToggle').setAttribute('aria-expanded', String(open));
  return open;
}

function selectBuild(i) {
  if (i === S.sel) return;
  S.sel = i;
  writeHash();
  keepFocus(() => {
    updateStickerOvr();
    renderTwin();
    renderBuilds();
    renderDiff();
    renderStats();
  });
}

function setLevel(v) {
  const cap = S.build?.card.levelCap || 1;
  S.level = Math.max(1, Math.min(cap, v));
  $('#level').value = S.level;
  S.ratings = null;
  renderLevel();
  scheduleBuild(150);
}

function useManager(id) {
  const m = mgr(id);
  if (!m || m.missing) return;
  S.managerId = m.id;
  S.tactic = m.bestTactic;
  $('#team').close();
  renderManager();
  if (SQ.open && SQ.draft) {
    SQ.draft.managerId = m.id;
    SQ.draft.tactic = m.bestTactic;
    saveDraft();
    renderSquad();
    evaluate(0);
  }
  writeHash();
  if (document.body.dataset.view === 'home') renderHomeManagers();
  if (S.build) build();
}

// ---------------------------------------------------------------- search
let searchTimer, searchCtrl;
const looksLikeId = v => /\d{6,}/.test(v);

function hideResults() {
  $('#results').hidden = true;
  $('#findInput').setAttribute('aria-expanded', 'false');
}

function resultList(head, items, emptyNote) {
  return [
    h('p', { class: 'results-head', text: head }),
    items.length
      ? h('ul', { class: 'result-list' }, items.map(it => h('li', null,
        h('button', { type: 'button', class: 'result', onclick: () => pickPlayer(it.id) },
          cardPhoto(it.id),
          h('span', { class: 'r-ovr', text: it.ovr ?? '' }),
          h('span', { class: 'r-main' },
            h('span', { class: 'r-name', text: it.name }),
            h('span', { class: 'r-meta', text: [it.position, it.team, it.type].filter(Boolean).join(' · ') || `Card id ${it.id}` })),
          it.cached ? h('span', { class: 'r-tag', text: ENGINE ? 'In library' : 'Built before' }) : null))))
      : emptyNote ? h('p', { class: 'results-empty', text: emptyNote }) : null,
  ].filter(Boolean);
}

function showResults(head, items, emptyNote) {
  const res = $('#results');
  res.replaceChildren(...resultList(head, items, emptyNote));
  res.hidden = false;
  $('#findInput').setAttribute('aria-expanded', 'true');
}

async function searchHits(q, ctrl) {
  return api(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
}
const hitsHead = (hits, q) => (hits.length ? `${hits.length === 24 ? 'Top 24' : hits.length} card${hits.length === 1 ? '' : 's'} for “${q}”` : `No cards for “${q}”`);
const SEARCH_EMPTY = 'Try the surname only, or paste the efhub player link.';
const SEARCH_DOWN = ENGINE ? "Couldn't reach efhub's player index. Check your connection, then try again." : "Couldn't reach the Build Album server. Check your connection, then try again.";

async function search(q, pickSingle) {
  searchCtrl?.abort();
  const ctrl = searchCtrl = new AbortController();
  showResults(`Searching for “${q}”…`, [], '');
  try {
    const hits = await searchHits(q, ctrl);
    if (ctrl !== searchCtrl) return;
    if (pickSingle && hits.length === 1) return pickPlayer(hits[0].id);
    showResults(hitsHead(hits, q), hits, SEARCH_EMPTY);
  } catch (e) {
    if (e.name === 'AbortError') return;
    showResults('Search failed', [], SEARCH_DOWN);
  }
}

// Home page search: same results, rendered in the page flow instead of a dropdown.
let homeTimer, homeCtrl;
function showHomeResults(head, items, emptyNote) {
  const res = $('#homeResults');
  res.replaceChildren(...resultList(head, items, emptyNote));
  res.hidden = false;
  $('#homeInput').setAttribute('aria-expanded', 'true');
}
function hideHomeResults() {
  homeCtrl?.abort();
  clearTimeout(homeTimer);
  $('#homeResults').hidden = true;
  $('#homeInput').setAttribute('aria-expanded', 'false');
}
async function homeSearch(q, pickSingle) {
  homeCtrl?.abort();
  const ctrl = homeCtrl = new AbortController();
  showHomeResults(`Searching for “${q}”…`, [], '');
  try {
    const hits = await searchHits(q, ctrl);
    if (ctrl !== homeCtrl) return;
    if (pickSingle && hits.length === 1) return pickPlayer(hits[0].id);
    showHomeResults(hitsHead(hits, q), hits, SEARCH_EMPTY);
  } catch (e) {
    if (e.name === 'AbortError') return;
    showHomeResults('Search failed', [], SEARCH_DOWN);
  }
}

async function showAlbumPicks() {
  try {
    const picks = await api('/api/collection');
    if (!picks.length || $('#findInput').value.trim()) return;
    showResults('Recently built', picks.slice(0, 12).map(p => ({ ...p, cached: false })), '');
  } catch {}
}

// ---------------------------------------------------------------- team pages
function openTeam(view) {
  S.view = view || (S.mine.length ? 'mine' : 'all');
  S.filter = '';
  S.replace = null;
  setSheetMsg('');
  renderTeam();
  const dlg = $('#team');
  if (!dlg.open) dlg.showModal();
}

function setSheetMsg(text, kind = 'info') {
  const m = $('#sheetMsg');
  m.textContent = text;
  m.dataset.kind = kind;
}

function profGrid(m) {
  const best = bestByMult(m);
  return h('ul', { class: 'profs', 'aria-label': 'Team Playstyle proficiency' },
    S.tactics.map(t => h('li', { class: t.key === best ? 'is-best' : null, title: t.label },
      h('span', { class: 'pk', 'aria-hidden': 'true', text: TAC_SHORT[t.key] }),
      h('span', { class: 'vh', text: `${t.label} ` }),
      h('span', { class: 'pv', text: m.skills[t.key] }))));
}

function renderTeam() {
  keepFocus(() => {
    for (const tab of [$('#tabMine'), $('#tabAll')]) {
      const on = tab.dataset.view === S.view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    $('#mgrList').setAttribute('aria-labelledby', S.view === 'mine' ? 'tabMine' : 'tabAll');
    renderCounts();
    renderSheetTools();
    renderMgrList();
  });
}

function renderSheetTools() {
  const tools = $('#sheetTools');
  if (S.view === 'mine') {
    tools.replaceChildren(
      S.build && S.mine.some(m => !m.missing)
        ? h('button', { type: 'button', class: 'btn btn-stick', dataset: { fk: 'rate' }, onclick: e => rateTeam(e.currentTarget) }, `Rate my team for ${S.build.card.name}`)
        : null,
      h('button', { type: 'button', class: 'btn btn-print', dataset: { fk: 'add-custom' }, onclick: () => openCustom() }, 'Add custom manager'));
    return;
  }
  const input = h('input', {
    class: 'field', type: 'search', id: 'mgrFilter', placeholder: 'Filter by name', value: S.filter, spellcheck: 'false', autocomplete: 'off',
    dataset: { fk: 'filter' },
    oninput: e => { S.filter = e.target.value; renderMgrList(); },
  });
  tools.replaceChildren(
    h('label', { class: 'vh', for: 'mgrFilter', text: 'Filter managers by name' }),
    input,
    h('button', { type: 'button', class: 'btn btn-print', dataset: { fk: 'refresh' }, onclick: e => refreshManagers(e.currentTarget) }, 'Refresh from efhub'));
}

function renderMgrList() {
  const ul = $('#mgrList');
  if (S.view === 'mine') {
    if (!S.mine.length) {
      ul.replaceChildren(h('li', { class: 'mgr-empty-row' },
        h('p', { text: 'No managers in your team yet.' }),
        h('button', { type: 'button', class: 'btn btn-stick', onclick: () => { S.view = 'all'; renderTeam(); } }, 'Browse all managers')));
      return;
    }
    ul.replaceChildren(...S.mine.map(mineRow));
    return;
  }
  const q = deaccent(S.filter.trim());
  const list = S.all.filter(m => !q || deaccent(m.name).includes(q));
  ul.replaceChildren(...(list.length
    ? list.map(allRow)
    : [h('li', { class: 'mgr-empty-row' }, h('p', { text: `No manager matches “${S.filter}”. Check the spelling, or refresh from efhub.` }))]));
}

function ratingLine(m) {
  const r = S.ratings;
  if (!r || r.player !== S.playerId) return null;
  const v = r.map[m.id];
  if (!v) return null;
  return h('p', { class: 'mgr-rating' },
    `Max OVR ${v.ovr} · ${v.statLabel} ${v.stat} · in ${tacLabel(v.tactic)}`,
    v.ovr === r.bestOvr ? h('span', { class: 'tag', text: 'Best OVR' }) : null,
    v.stat === r.bestStat ? h('span', { class: 'tag', text: `Best ${v.statLabel}` }) : null);
}

function armRemove(btn, m) {
  if (btn.dataset.armed) return removeManager(m);
  btn.dataset.armed = '1';
  btn.textContent = 'Tap again to remove';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Remove'; } }, 4000);
}

function mineRow(m) {
  const current = m.id === S.managerId;
  return h('li', { class: `mgr-row${current ? ' is-current' : ''}${m.missing ? ' is-missing' : ''}` },
    coach(m, 'sm'),
    h('div', { class: 'mgr-info' },
      h('p', { class: 'mgr-row-name' }, m.name,
        current ? h('span', { class: 'tag', text: 'Current' }) : null,
        m.custom ? h('span', { class: 'tag tag-quiet', text: 'Custom' }) : null),
      m.missing
        ? h('p', { class: 'mgr-note', text: 'efhub no longer lists this version. Swap it for the one you have, or remove it.' })
        : profGrid(m),
      !m.missing && m.boosts?.length ? h('p', { class: 'mgr-boosts', text: `Boosts ${boostText(m)} +1` }) : null,
      ratingLine(m)),
    h('div', { class: 'row-actions' },
      !m.missing ? h('button', { type: 'button', class: 'btn btn-stick', disabled: current, dataset: { fk: `use-${m.id}` }, onclick: () => useManager(m.id) }, current ? 'In use' : 'Use') : null,
      m.custom
        ? h('button', { type: 'button', class: 'btn btn-print', dataset: { fk: `edit-${m.id}` }, onclick: () => openCustom(m) }, 'Edit')
        : h('button', { type: 'button', class: 'btn btn-print', dataset: { fk: `swap-${m.id}` }, onclick: () => startSwap(m) }, 'Swap version'),
      h('button', { type: 'button', class: 'linkish', dataset: { fk: `rm-${m.id}` }, onclick: e => armRemove(e.currentTarget, m) }, 'Remove')));
}

function allRow(m) {
  const inMine = S.mine.some(x => x.id === m.id);
  const other = S.mine.find(x => x.id !== m.id && !x.custom && deaccent(x.name) === deaccent(m.name));
  let action;
  if (S.replace) {
    action = m.id === S.replace.id
      ? h('button', { type: 'button', class: 'btn btn-print', disabled: true }, 'Current version')
      : h('button', { type: 'button', class: 'btn btn-stick', dataset: { fk: `swapin-${m.id}` }, onclick: () => collect(m, S.replace) }, 'Swap in');
  } else {
    action = h('button', { type: 'button', class: 'btn btn-stick', disabled: inMine, dataset: { fk: `col-${m.id}` }, onclick: () => collect(m) }, inMine ? 'In your team' : 'Collect');
  }
  return h('li', { class: `mgr-row${inMine ? ' is-mine' : ''}` },
    coach(m, 'sm'),
    h('div', { class: 'mgr-info' },
      h('p', { class: 'mgr-row-name' }, m.name, inMine ? h('span', { class: 'tag tag-quiet', text: 'Collected' }) : null),
      profGrid(m),
      m.boosts?.length ? h('p', { class: 'mgr-boosts', text: `Boosts ${boostText(m)} +1` }) : null,
      !inMine && other && !S.replace ? h('p', { class: 'mgr-note', text: 'You have another version of this manager.' }) : null),
    h('div', { class: 'row-actions' }, action));
}

function startSwap(m) {
  S.replace = m;
  S.view = 'all';
  S.filter = m.name.split(/\s+/).pop();
  renderTeam();
  setSheetMsg(`Pick the version of ${m.name} you own. Versions differ in proficiency and boosted skills.`);
  $('#mgrFilter')?.focus();
}

async function collect(m, replace) {
  setSheetMsg(replace ? `Swapping ${m.name}…` : `Adding ${m.name}…`);
  try {
    const d = await api('/api/my-managers', { method: 'POST', body: { id: m.id, replace: replace?.id } });
    S.mine = d.mine;
    S.ratings = null;
    if (replace) {
      S.replace = null;
      S.view = 'mine';
      if (S.managerId === replace.id) {
        S.managerId = m.id;
        S.tactic = mgr(m.id)?.bestTactic || S.tactic;
        renderManager();
        writeHash();
        if (S.build) build();
      }
      setSheetMsg(`Swapped in this version of ${m.name}.`, 'ok');
    } else {
      setSheetMsg(`${m.name} is in your team.`, 'ok');
      if (!S.managerId) { S.managerId = m.id; S.tactic = mgr(m.id)?.bestTactic; renderManager(); writeHash(); if (S.build) build(); }
    }
    renderTeam();
  } catch (e) {
    setSheetMsg(e.message, 'error');
  }
}

async function removeManager(m) {
  setSheetMsg(`Removing ${m.name}…`);
  try {
    const d = await api(`/api/my-managers?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    S.mine = d.mine;
    if (S.managerId === m.id) {
      S.managerId = firstUsable()?.id || null;
      S.tactic = mgr(S.managerId)?.bestTactic || S.tactic;
      renderManager();
      writeHash();
      if (S.build) build();
    }
    setSheetMsg(`Removed ${m.name}.`, 'ok');
    renderTeam();
    $('#tabMine').focus();
  } catch (e) {
    setSheetMsg(e.message, 'error');
  }
}

async function refreshManagers(btn) {
  btn.disabled = true;
  setSheetMsg(ENGINE ? 'Checking efhub for managers…' : 'Checking efhub for managers… efhub asks for 5 s between requests.');
  try {
    const r = await api('/api/managers/refresh', { method: 'POST' });
    await loadManagers();
    setSheetMsg(`efhub lists ${r.count} managers.`, 'ok');
    renderTeam();
    renderManager();
  } catch (e) {
    setSheetMsg(e.message, 'error');
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
}

async function rateTeam(btn) {
  const team = S.mine.filter(m => !m.missing);
  const name = S.build.card.name;
  btn.disabled = true;
  setSheetMsg(`Rating ${team.length} managers for ${name}…`);
  try {
    const rows = await Promise.all(team.map(m => {
      const tactic = bestByMult(m);
      return api('/api/build', {
        method: 'POST',
        body: { id: S.playerId, level: S.level, pos: S.pos, managerId: m.id, tactic, stat: S.stat },
      }).then(d => [m.id, { ovr: d.builds[0].ovr, stat: d.builds[2].stats[d.stat], statLabel: statLabel(d.stat), tactic }]);
    }));
    const map = Object.fromEntries(rows);
    const vals = Object.values(map);
    const bestOvr = Math.max(...vals.map(v => v.ovr));
    const bestStat = Math.max(...vals.map(v => v.stat));
    S.ratings = { player: S.playerId, map, bestOvr, bestStat };
    const top = team.find(m => map[m.id].ovr === bestOvr);
    setSheetMsg(`Best for ${name} at Lv ${S.build.level}: ${top.name}, Max OVR ${bestOvr}. Each manager is rated in their strongest Team Playstyle.`, 'ok');
  } catch (e) {
    setSheetMsg(e.message, 'error');
  } finally {
    renderTeam();
  }
}

// ---------------------------------------------------------------- custom manager
function setupCustomForm() {
  const fs = $('#customSkills');
  for (const t of S.tactics) {
    fs.append(h('label', { class: 'form-row' },
      h('span', { text: t.label }),
      h('input', { class: 'field', type: 'number', name: `sk_${t.key}`, min: '40', max: '99', step: '1', inputmode: 'numeric', required: true, value: '70' })));
  }
  const opts = () => [h('option', { value: '', text: 'None' }), ...S.abilities.map((a, i) => h('option', { value: String(i), text: a.label }))];
  const f = $('#customForm');
  f.elements.boost0.replaceChildren(...opts());
  f.elements.boost1.replaceChildren(...opts());
}

function openCustom(m) {
  const f = $('#customForm');
  f.reset();
  f.dataset.id = m?.id || '';
  for (const el of f.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  $('#customErr').textContent = '';
  $('#customTitle').textContent = m ? `Edit ${m.name}` : 'Custom manager';
  if (m) {
    f.elements.name.value = m.name;
    for (const t of S.tactics) f.elements[`sk_${t.key}`].value = m.skills[t.key];
    f.elements.boost0.value = m.boosts?.[0] ?? '';
    f.elements.boost1.value = m.boosts?.[1] ?? '';
  }
  $('#customDlg').showModal();
  f.elements.name.focus();
}

async function saveCustom(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const err = $('#customErr');
  const fail = (msg, field) => {
    err.textContent = msg;
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  };
  for (const el of f.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  err.textContent = '';
  const name = f.elements.name.value.trim();
  if (!name) return fail('Give the manager a name, then save again.', f.elements.name);
  const skills = {};
  for (const t of S.tactics) {
    const field = f.elements[`sk_${t.key}`];
    const v = Number(field.value);
    if (!Number.isInteger(v) || v < 40 || v > 99) return fail(`${t.label} proficiency must be a whole number from 40 to 99.`, field);
    skills[t.key] = v;
  }
  const boosts = [f.elements.boost0.value, f.elements.boost1.value].filter(v => v !== '').map(Number);
  if (boosts.length === 2 && boosts[0] === boosts[1]) return fail('Pick two different boosted skills, or set one to None.', f.elements.boost1);
  const submit = f.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const d = await api('/api/my-managers', { method: 'POST', body: { custom: true, id: f.dataset.id || undefined, name, skills, boosts } });
    S.mine = d.mine;
    S.ratings = null;
    $('#customDlg').close();
    toast(`Saved ${name} to your team.`, 'ok');
    const editedCurrent = f.dataset.id && f.dataset.id === S.managerId;
    if (!S.managerId || editedCurrent) {
      S.managerId = f.dataset.id || S.mine[S.mine.length - 1].id;
      if (!editedCurrent) S.tactic = mgr(S.managerId)?.bestTactic;
      writeHash();
      if (S.build) build();
    }
    renderManager();
    if ($('#team').open) { S.view = 'mine'; renderTeam(); }
    else renderCounts();
  } catch (e2) {
    fail(e2.message);
  } finally {
    submit.disabled = false;
  }
}

// ---------------------------------------------------------------- squad builder
const DRAFT_KEY = 'efb-squad-draft';
const SQ_BENCH_MAX = 12;
const FIT_LABEL = { main: 'Natural', strong: 'Can play', learned: 'Learned', off: 'Off position' };
const SQ = {
  formations: [], club: [], squads: [], draft: null, result: null, open: false,
  ctrl: null, timer: null, mode: 'club', ctx: null, searchCtrl: null, searchTimer: null,
  placing: new Set(), undo: null, stash: null, anchor: null,
};
const lineupKey = d => JSON.stringify([d.formation, d.slots, d.bench]);

const PARTICLES = new Set(['de', 'da', 'di', 'do', 'dos', 'du', 'van', 'von', 'der', 'den', 'del', 'la', 'le', 'ter']);
// Same rules as customFormation() in server.js: 3–5 lines of 1–5 players, defence first, adding up to 10.
const customCache = new Map();
function customFormation(input) {
  const s = String(input ?? '').trim();
  if (customCache.has(s)) return customCache.get(s);
  const parts = /^\d{3,5}$/.test(s) ? s.split('') : s.replace(/^\D+|\D+$/g, '').split(/\D+/);
  let out = null;
  const lines = parts.map(Number);
  if (parts.length >= 3 && parts.length <= 5 && parts.every(p => /^[1-5]$/.test(p)) && lines.reduce((a, b) => a + b, 0) === 10) {
    const key = lines.join('-');
    out = SQ.formations.find(f => f.key === key) || null;
    if (!out) {
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
        const margin = c >= 4 ? 12 : c === 3 ? (roles.some(r => r in lift) ? 14 : 22) : c === 2 ? 33 : 50;
        roles.forEach((pos, k) => slots.push({ pos, x: c === 1 ? 50 : Math.round(margin + k * (100 - 2 * margin) / (c - 1)), y: y + (lift[pos] || 0) }));
      });
      out = { key, custom: true, slots };
    }
  }
  if (SQ.formations.length) customCache.set(s, out);
  return out;
}
const formationOf = key => SQ.formations.find(f => f.key === key) || customFormation(key) || SQ.formations[0];
const clubCard = id => (id == null ? null : SQ.club.find(p => p.id === String(id)) || null);
const usableMgr = id => { const m = mgr(id); return m && !m.missing ? m : null; };
const an = pos => (/^[AEFHILMNORSX]/.test(pos) ? 'an' : 'a');
const surname = name => {
  const w = String(name || '').trim().split(/\s+/);
  let i = w.length - 1;
  while (i > 0 && PARTICLES.has(w[i - 1].toLowerCase())) i--;
  return w.slice(i).join(' ');
};
const listJoin = arr => {
  const u = [...new Set(arr)];
  return u.length < 2 ? u.join('') : `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
};
const canPlay = (c, pos) => !!c && (c.position === pos || (c.positions || []).some(x => x.pos === pos && x.fit !== 'off'));
const sqBody = () => {
  const d = SQ.draft;
  return { formation: d.formation, tactic: d.tactic, managerId: d.managerId, slots: d.slots, bench: d.bench };
};

function blankDraft(formation) {
  const f = formationOf(formation || SQ.draft?.formation);
  const own = usableMgr(S.managerId);
  const m = own || firstUsable();
  return {
    id: null, name: '', formation: f.key, managerId: m?.id || null,
    tactic: own && S.tactic ? S.tactic : m?.bestTactic || S.tactics[0]?.key,
    slots: Array(f.slots.length).fill(null), bench: [],
  };
}

function normDraft(d) {
  if (!d || typeof d !== 'object') return blankDraft();
  const f = formationOf(d.formation);
  const seen = new Set();
  const keep = id => (id && !seen.has(String(id)) ? (seen.add(String(id)), String(id)) : null);
  const raw = Array.isArray(d.slots) ? d.slots : [];
  const slots = f.slots.map((_, i) => keep(raw[i]));
  const bench = (Array.isArray(d.bench) ? d.bench : []).map(keep).filter(Boolean).slice(0, SQ_BENCH_MAX);
  const valid = S.tactics.some(t => t.key === d.tactic);
  const m = usableMgr(d.managerId);
  const fallback = m || firstUsable();
  return {
    id: d.id ? String(d.id) : null, name: String(d.name || '').slice(0, 40), formation: f.key,
    managerId: fallback?.id || null,
    tactic: m && valid ? d.tactic : fallback?.bestTactic || (valid ? d.tactic : S.tactics[0]?.key),
    slots, bench,
  };
}

function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  SQ.draft = d ? normDraft(d) : blankDraft();
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(SQ.draft)); } catch { /* private browsing: the draft lasts for this visit */ }
}

async function loadSquadData() {
  const [formations, club, squads] = await Promise.all([api('/api/formations'), api('/api/club'), api('/api/squads')]);
  SQ.formations = formations;
  SQ.club = club.players || [];
  SQ.squads = squads.squads || [];
  $('#sqFormation').replaceChildren(...formations.map(f => h('option', { value: f.key, text: f.key })),
    h('option', { value: '__custom', text: 'Type your own…' }));
  loadDraft();
  renderSaved();
  renderClubCount();
}

function renderSaved() {
  const d = SQ.draft;
  if (d?.id && !SQ.squads.some(s => s.id === d.id)) d.id = null;
  $('#sqSaved').replaceChildren(
    h('option', { value: '', text: SQ.squads.length ? 'Unsaved draft' : 'No saved squads yet' }),
    ...SQ.squads.map(s => h('option', { value: s.id, text: s.name })));
  $('#sqSaved').value = d?.id || '';
}

function renderClubCount() {
  $('#clubCount').textContent = String(SQ.club.length);
}

// ---------------------------------------------------------------- home
let homeRecentReq = 0;
async function renderHomeRecent() {
  const box = $('#homeRecent');
  const req = ++homeRecentReq;
  if (!box.childElementCount) box.replaceChildren(h('p', { class: 'home-empty', text: 'Loading your cards…' }));
  let picks;
  try { picks = await api('/api/collection'); } catch {
    if (req === homeRecentReq) box.replaceChildren(h('p', { class: 'home-empty', text: "Couldn't load your recent cards. Check your connection, then reload." }));
    return;
  }
  if (req !== homeRecentReq) return;
  if (!picks.length) {
    box.replaceChildren(h('p', { class: 'home-empty', text: 'Cards you build show up here. Start with a player above.' }));
    return;
  }
  const tiles = picks.slice(0, 12).map(p => h('li', null,
    h('button', { type: 'button', class: 'home-tile', onclick: () => pickPlayer(p.id), 'aria-label': `Build ${p.name}${p.position ? `, ${p.position}` : ''}` },
      cardPhoto(p.id),
      h('span', { class: 'home-tile-name', text: surname(p.name) || p.name }),
      h('span', { class: 'home-tile-meta', text: [p.position, p.type].filter(Boolean).join(' · ') }))));
  box.replaceChildren(h('ul', { class: 'home-tiles' }, tiles));
}

function renderHomeSquad() {
  const box = $('#homeSquad');
  const d = SQ.draft;
  if (!d) {
    box.replaceChildren(h('p', { class: 'home-empty', text: SQ.failed ? "Couldn't load the squad tools. Check your connection, then reload." : 'Loading your squad…' }));
    return;
  }
  const placed = d.slots.filter(Boolean).length;
  const saved = SQ.squads.find(s => s.id === d.id);
  const others = SQ.squads.filter(s => s.id !== d.id).slice(0, 4);
  box.replaceChildren(
    h('div', { class: 'home-squad-now' },
      h('p', { class: 'home-squad-name', text: saved ? saved.name : 'Unsaved draft' }),
      h('p', { class: 'home-squad-meta', text: `${d.formation} · ${placed} of 11 placed` })),
    h('button', { type: 'button', class: 'btn btn-stick home-cta', onclick: () => showView('squad'), text: placed ? 'Open squad' : 'Pick your XI' }),
    others.length
      ? h('div', { class: 'home-sub-list' },
        h('p', { class: 'home-list-head', text: 'Saved squads' }),
        h('ul', { class: 'home-list' }, others.map(s => h('li', null,
          h('button', { type: 'button', class: 'home-row', onclick: () => { showView('squad'); pickSaved(s.id); } },
            h('span', { class: 'home-row-name', text: s.name }),
            h('span', { class: 'home-row-meta', text: s.formation || '' }))))))
      : SQ.squads.length ? null : h('p', { class: 'home-empty', text: 'No saved squads yet.' }));
}

function renderHomeManagers() {
  const box = $('#homeManagers');
  if (!S.mine.length) {
    box.replaceChildren(
      h('p', { class: 'home-empty', text: 'Add the managers you own and every build is tuned to them.' }),
      h('button', { type: 'button', class: 'btn btn-stick home-cta', onclick: () => openTeam('all'), text: 'Add managers' }));
    return;
  }
  box.replaceChildren(
    h('ul', { class: 'home-list' }, S.mine.map(m => {
      const cur = m.id === S.managerId;
      return h('li', null,
        h('button', {
          type: 'button', class: `home-row home-mgr${cur ? ' is-current' : ''}`, 'aria-pressed': String(cur),
          disabled: m.missing || null, onclick: () => useManager(m.id),
        },
          coach(m, 'sm'),
          h('span', { class: 'home-row-name', text: m.name }),
          cur ? h('span', { class: 'tag', text: 'Current' }) : m.missing ? h('span', { class: 'tag tag-quiet', text: 'Not found' }) : null));
    })),
    h('button', { type: 'button', class: 'btn btn-print home-cta', onclick: () => openTeam(), text: 'Manage team' }));
}

function renderHome() {
  renderHomeRecent();
  renderHomeSquad();
  renderHomeManagers();
}

function showView(v) {
  if (v === 'squad' && !SQ.draft) {
    toast("Couldn't load the squad tools. Check your connection, then reload.");
    return;
  }
  if (!['home', 'album', 'squad'].includes(v)) v = 'album';
  const squad = v === 'squad';
  document.body.dataset.view = v;
  $('#home').hidden = v !== 'home';
  $('#album').hidden = v !== 'album';
  $('#squad').hidden = !squad;
  $('#viewHome').setAttribute('aria-pressed', String(v === 'home'));
  $('#viewAlbum').setAttribute('aria-pressed', String(v === 'album'));
  $('#viewSquad').setAttribute('aria-pressed', String(squad));
  const skip = $('.skip');
  skip.href = { home: '#home', album: '#builds', squad: '#squad' }[v];
  skip.textContent = { home: 'Skip to home', album: 'Skip to builds', squad: 'Skip to the squad' }[v];
  SQ.open = squad;
  setFinder(false);
  if (v !== 'home') hideHomeResults();
  writeHash();
  if (squad) { renderSquad(); evaluate(0); }
  else if (v === 'home') renderHome();
  else revealChecked($('#playstyles'));
}

function evaluate(delay = 120) {
  clearTimeout(SQ.timer);
  SQ.timer = setTimeout(runEvaluate, delay);
}

async function runEvaluate() {
  const d = SQ.draft;
  if (!d || !SQ.formations.length) return;
  SQ.ctrl?.abort();
  const ctrl = SQ.ctrl = new AbortController();
  $('#squad').setAttribute('aria-busy', 'true');
  try {
    SQ.result = await api('/api/squad/evaluate', { method: 'POST', body: sqBody(), signal: ctrl.signal });
    renderSquad();
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (/could not be found/i.test(e.message)) {
      const m = firstUsable();
      const next = m && m.id !== d.managerId ? m : null;
      d.managerId = next?.id || null;
      if (next) d.tactic = next.bestTactic;
      saveDraft();
      toast(next ? `That manager has left your team, so ${next.name} takes charge for now.` : 'That manager has left your team. Pick another to rate the eleven.', 'info');
      evaluate(0);
      return;
    }
    toast(e.message, 'error', requestLink(e));
  } finally {
    if (SQ.ctrl === ctrl) { SQ.ctrl = null; $('#squad').removeAttribute('aria-busy'); }
  }
}

function commit() {
  SQ.undo = null;
  if (SQ.anchor && SQ.anchor.out !== lineupKey(SQ.draft)) SQ.anchor = null;
  saveDraft();
  renderSquad();
  evaluate();
}

function renderSquad() {
  const d = SQ.draft;
  if (!d || !SQ.formations.length) return;
  keepFocus(() => {
    renderSquadManager();
    renderPitch();
    renderBench();
    renderSummary();
  });
  renderClubCount();
  $('#squadTitle').textContent = d.name.trim() || 'Squad';
  $('#sqSub').textContent = !SQ.club.length
    ? 'Start with the cards you own. Paste an efhub link or search by name.'
    : "Every rating is that player's best build for the place, under your manager's playstyle.";
  const name = $('#sqName');
  if (document.activeElement !== name) name.value = d.name;
  $('#sqDelete').hidden = !d.id;
  $('#sqSave').textContent = d.id ? 'Save changes' : 'Save squad';
  syncFormationSelect(d.formation);
  $('#sqSaved').value = d.id || '';
}

function syncFormationSelect(key) {
  const sel = $('#sqFormation');
  if (![...sel.options].some(o => o.value === key)) {
    sel.querySelectorAll('option[data-custom]').forEach(o => o.remove());
    sel.insertBefore(h('option', { value: key, text: `${key} (custom)`, dataset: { custom: '1' } }), sel.querySelector('option[value="__custom"]'));
  }
  sel.value = key;
}

function setCustomForm(open) {
  const form = $('#sqCustomForm');
  const input = $('#sqCustomInput');
  form.hidden = !open;
  $('#sqCustomErr').textContent = '';
  input.removeAttribute('aria-invalid');
  if (open) {
    input.value = SQ.draft?.formation || '';
    input.focus();
    input.select();
  }
}

function closeCustomForm() {
  setCustomForm(false);
  if (SQ.draft) syncFormationSelect(SQ.draft.formation);
  $('#sqFormation').focus();
}

function applyCustomForm(e) {
  e.preventDefault();
  const input = $('#sqCustomInput');
  const f = customFormation(input.value);
  if (!f) {
    $('#sqCustomErr').textContent = 'Use 3 to 5 lines that add up to 10 outfield players, like 4-1-2-1-2.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  setCustomForm(false);
  if (SQ.draft && f.key !== SQ.draft.formation) changeFormation(f.key);
  else if (SQ.draft) syncFormationSelect(SQ.draft.formation);
  $('#sqFormation').focus();
}

function renderSquadManager() {
  const d = SQ.draft;
  const m = usableMgr(d.managerId);
  const head = $('#sqMgrHead');
  if (!m) {
    head.replaceChildren(
      h('span', { class: 'coach coach-empty', 'aria-hidden': 'true' }),
      h('div', { class: 'mgr-text' },
        h('p', { class: 'mgr-name', text: 'No manager yet' }),
        h('p', { class: 'mgr-meta', text: S.mine.length ? 'Pick one to rate the eleven with their playstyle.' : 'Collect the managers you own, then pick one.' })),
      h('button', { class: 'btn btn-print', type: 'button', onclick: () => openTeam() }, S.mine.length ? 'Pick manager' : 'Collect managers'));
  } else {
    head.replaceChildren(
      coach(m),
      h('div', { class: 'mgr-text' },
        h('p', { class: 'mgr-name', text: m.name }),
        h('p', { class: 'mgr-meta', text: m.boosts?.length ? `Boosts ${boostText(m)} +1` : 'No boosted skills' })),
      h('button', { class: 'btn btn-print', type: 'button', onclick: () => openTeam('mine') }, 'Change'));
  }

  const byT = new Map((SQ.result?.formation === d.formation ? SQ.result.byTactic || [] : []).map(t => [t.key, t]));
  const active = d.tactic || S.tactics[0]?.key;
  $('#sqStyles').replaceChildren(...S.tactics.map(t => {
    const prof = m?.skills?.[t.key];
    const avg = byT.get(t.key)?.avg;
    return h('button', {
      type: 'button', role: 'radio', class: 'ps', 'aria-checked': String(t.key === d.tactic), tabindex: t.key === active ? '0' : '-1',
      dataset: { tactic: t.key, fk: `sqps-${t.key}` }, onclick: () => setSquadTactic(t.key),
    },
    h('span', { class: 'ps-name', text: t.label }),
    prof != null
      ? h('span', { class: 'ps-prof' },
        h('span', { class: 'ps-n', text: prof }),
        h('span', { class: 'vh', text: ' proficiency, ' }),
        h('span', { class: 'ps-m', text: pct(multOf(prof)) }))
      : null,
    avg != null ? h('span', { class: 'ps-avg' }, h('span', { class: 'vh', text: ', eleven average ' }), h('span', { 'aria-hidden': 'true', text: 'XI ' }), avg.toFixed(1)) : null);
  }));
  revealChecked($('#sqStyles'));
}

function setSquadTactic(key) {
  const d = SQ.draft;
  if (!d || d.tactic === key) return;
  d.tactic = key;
  saveDraft();
  renderSquad();
  evaluate(0);
}

function slotView(i) {
  const d = SQ.draft;
  const id = d.slots[i];
  if (!id) return null;
  const pos = formationOf(d.formation).slots[i].pos;
  const r = SQ.result?.slots?.[i];
  if (r && r.id === id && r.pos === pos) return r;
  const c = clubCard(id);
  return { id, pos, name: c?.name, pending: true, fit: c && !canPlay(c, pos) ? 'off' : null };
}

function renderPitch() {
  const d = SQ.draft;
  const f = formationOf(d.formation);
  $('#pitch').replaceChildren(
    h('div', { class: 'pitch-lines', 'aria-hidden': 'true' },
      h('span', { class: 'pl-half' }), h('span', { class: 'pl-circle' }), h('span', { class: 'pl-box-top' }), h('span', { class: 'pl-box-bot' })),
    ...f.slots.map((slot, i) => {
      const v = slotView(i);
      const style = `left:${slot.x}%;top:${slot.y}%`;
      if (!v) {
        return h('button', {
          type: 'button', class: 'mini is-empty', style, dataset: { fk: `slot-${i}` },
          'aria-label': `Add ${an(slot.pos)} ${slot.pos}`, onclick: () => openClub('slot', { i }),
        }, h('span', { class: 'mini-plus', 'aria-hidden': 'true', text: '+' }), h('span', { class: 'mini-pos', text: slot.pos }));
      }
      const anim = SQ.placing.has(i) && !v.pending;
      if (anim) SQ.placing.delete(i);
      const off = v.fit === 'off';
      const ovr = v.missing ? '–' : v.pending ? '··' : v.ovr;
      const label = v.missing
        ? `${slot.pos}: this card is unavailable. Change player`
        : `${slot.pos}: ${v.name || 'player'}${v.pending ? ', rating loading' : `, ${v.ovr}`}${off ? ', off position' : ''}. Change player`;
      return h('button', {
        type: 'button', class: `mini${off ? ' is-off' : ''}${anim ? ' is-placing' : ''}`, style,
        dataset: { fk: `slot-${i}` }, 'aria-label': label, onclick: () => openClub('slot', { i }),
      },
      h('span', { class: 'mini-top' }, h('span', { class: 'mini-ovr', text: String(ovr) }), h('span', { class: 'mini-pos', text: slot.pos })),
      h('span', { class: 'mini-name', text: v.missing ? 'Unavailable' : surname(v.name) || 'Player' }),
      off ? h('span', { class: 'mini-off', text: 'Off position' }) : null);
    }));
}

function renderBench() {
  const d = SQ.draft;
  const res = SQ.result?.bench || [];
  const items = d.bench.map((id, i) => {
    const r = res.find(b => b.id === id);
    const c = clubCard(id);
    const name = r?.name || c?.name;
    const pos = r?.pos || c?.position || '';
    const ovr = r ? (r.missing ? '–' : r.ovr) : '··';
    return h('li', {}, h('button', {
      type: 'button', class: 'mini mini-bench', dataset: { fk: `bench-${i}` },
      'aria-label': name ? `Bench: ${name}, ${pos}${r && !r.missing ? `, ${r.ovr}` : ''}. Change player` : 'Bench: card unavailable. Change player',
      onclick: () => openClub('bench', { i }),
    },
    h('span', { class: 'mini-top' }, h('span', { class: 'mini-ovr', text: String(ovr) }), h('span', { class: 'mini-pos', text: pos })),
    h('span', { class: 'mini-name', text: name ? surname(name) : 'Unavailable' })));
  });
  if (d.bench.length < SQ_BENCH_MAX) {
    items.push(h('li', {}, h('button', {
      type: 'button', class: 'mini mini-bench is-empty', dataset: { fk: 'bench-add' }, 'aria-label': 'Add a player to the bench',
      onclick: () => openClub('bench', { i: d.bench.length }),
    }, h('span', { class: 'mini-plus', 'aria-hidden': 'true', text: '+' }), h('span', { class: 'mini-pos', text: 'Add' }))));
  }
  $('#bench').replaceChildren(...items);
  $('#benchCount').textContent = `${d.bench.length}/${SQ_BENCH_MAX}`;
}

function renderSummary() {
  const d = SQ.draft;
  const r = SQ.result;
  const filled = d.slots.filter(Boolean).length;
  const m = usableMgr(d.managerId);
  const avg = r && r.formation === d.formation && filled ? r.avg : null;
  const prof = m?.skills?.[d.tactic];
  const meta = filled
    ? `${filled} of ${d.slots.length} places filled · ${m ? `${surname(m.name)}, ` : ''}${tacLabel(d.tactic)}${prof != null ? ` ${pct(multOf(prof))}` : ''}`
    : SQ.club.length ? 'Tap a place on the pitch, or ask for the best eleven.' : 'Add your cards first, then pick a team.';
  $('#sqSummary').replaceChildren(
    h('p', { class: 'sq-avg' },
      h('span', { class: 'sq-avg-n', dataset: avg != null ? null : { empty: 'true' }, text: avg != null ? avg.toFixed(1) : '–' }),
      h('span', { class: 'sq-avg-l', text: 'XI average' })),
    h('p', { class: 'sq-meta', text: meta }),
    ...(SQ.undo ? [h('button', { type: 'button', class: 'linkish sq-undo', dataset: { fk: 'sq-undo' }, onclick: undoSuggest }, 'Undo the suggestion')] : []));
}

function undoSuggest() {
  if (!SQ.undo) return;
  Object.assign(SQ.draft, SQ.undo);
  SQ.undo = null;
  SQ.placing.clear();
  saveDraft();
  renderSquad();
  evaluate(0);
  $('#sqSuggest').focus();
  toast('Back to your previous eleven.', 'info');
}

function tapAgain(btn, armedText, fn) {
  clearTimeout(btn._armT);
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    btn.textContent = btn.dataset.idle;
    fn();
    return;
  }
  btn.dataset.idle = btn.textContent;
  btn.dataset.armed = 'true';
  btn.textContent = armedText;
  btn._armT = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn.dataset.idle; }, 4000);
}

// ---------------------------------------------------------------- club sheet
function setClubMsg(text, kind = '', err = null) {
  const p = $('#clubMsg');
  p.textContent = text;
  if (err?.needsRequest) p.append(' ', h('a', { href: err.requestUrl, target: '_blank', rel: 'noopener' }, 'Request it on GitHub'));
  if (kind) p.dataset.kind = kind; else delete p.dataset.kind;
}

function hideClubResults() {
  const ul = $('#clubResults');
  ul.hidden = true;
  ul.replaceChildren();
}

const currentId = () => {
  const d = SQ.draft;
  if (SQ.mode === 'slot') return d.slots[SQ.ctx.i] || null;
  if (SQ.mode === 'bench') return d.bench[SQ.ctx.i] || null;
  return null;
};

function whereIs(id) {
  const d = SQ.draft;
  const si = d.slots.indexOf(id);
  if (si >= 0) return { kind: 'slot', i: si, pos: formationOf(d.formation).slots[si].pos };
  const bi = d.bench.indexOf(id);
  return bi >= 0 ? { kind: 'bench', i: bi } : null;
}

const whereText = at => (!at ? '' : at.kind === 'slot' ? `On the pitch: ${at.pos}` : 'On the bench');

async function openClub(mode = 'club', ctx = null) {
  if (!SQ.draft) return;
  SQ.mode = mode;
  SQ.ctx = ctx;
  const dlg = $('#clubDlg');
  const pos = mode === 'slot' ? formationOf(SQ.draft.formation).slots[ctx.i].pos : null;
  $('#clubTitle').textContent = mode === 'slot' ? `Choose ${an(pos)} ${pos}` : mode === 'bench' ? 'Bench place' : 'My club';
  $('#clubInput').value = '';
  hideClubResults();
  setClubMsg(SQ.club.length ? '' : "Your club's empty. Paste an efhub link to add your first card.");
  renderPicked();
  $('#clubList').replaceChildren();
  if (!dlg.open) dlg.showModal();
  $('#clubInput').focus();
  await renderClubList();
  const first = $('#clubList .row-actions button');
  if (mode !== 'club' && first && document.activeElement === $('#clubInput') && !$('#clubInput').value) first.focus();
}

function renderPicked() {
  const box = $('#clubPicked');
  const id = currentId();
  if (!id) { box.hidden = true; box.replaceChildren(); return; }
  const c = clubCard(id);
  const r = SQ.mode === 'slot' ? slotView(SQ.ctx.i) : SQ.result?.bench?.find(b => b.id === id);
  const ovr = r && !r.pending && !r.missing ? r.ovr : null;
  box.hidden = false;
  box.replaceChildren(
    cardPhoto(id),
    h('div', { class: 'mgr-info' },
      h('p', { class: 'mgr-row-name', text: c?.name || r?.name || 'Card unavailable' }),
      h('p', { class: 'mgr-note', text: ovr != null ? `In this place now · ${ovr} with their best build` : 'In this place now' })),
    h('div', { class: 'row-actions' },
      c && !c.missing ? h('button', { type: 'button', class: 'btn btn-print', onclick: () => seeBuild(id, r?.pos || c.position) }, 'See build') : null,
      h('button', { type: 'button', class: 'linkish', onclick: takeOff }, SQ.mode === 'slot' ? 'Take off the pitch' : 'Take off the bench')));
}

function takeOff() {
  const d = SQ.draft;
  const onPitch = SQ.mode === 'slot';
  const { i } = SQ.ctx;
  const name = surname(clubCard(onPitch ? d.slots[i] : d.bench[i])?.name) || 'The player';
  if (onPitch) d.slots[i] = null;
  else d.bench.splice(i, 1);
  $('#clubDlg').close();
  commit();
  (document.querySelector(`[data-fk="${onPitch ? `slot-${i}` : 'bench-add'}"]`))?.focus();
  toast(`${name} is off the ${onPitch ? 'pitch' : 'bench'}. The card stays in your club.`, 'info');
}

function ovrBadge(n) {
  return h('span', { class: 'club-ovr' }, n == null ? '–' : String(n), h('span', { class: 'vh', text: ' rated' }));
}

function clubRow(p) {
  if (p.missing) {
    return h('li', { class: 'mgr-row club-row' },
      cardPhoto(p.id),
      h('div', { class: 'mgr-info' },
        h('p', { class: 'mgr-row-name', text: 'Card unavailable' }),
        h('p', { class: 'mgr-note', text: "efhub didn't send this card. Remove it, then add it again." })),
      h('div', { class: 'row-actions' }, removeBtn(p)));
  }
  const alt = (p.positions || []).filter(x => x.fit !== 'off' && x.pos !== p.position).map(x => x.pos);
  const note = [[p.position, ...alt].slice(0, 4).join(' / '), p.type, whereText(whereIs(p.id))].filter(Boolean).join(' · ');
  return h('li', { class: 'mgr-row club-row' },
    cardPhoto(p.id),
    ovrBadge(p.baseOvr),
    h('div', { class: 'mgr-info' },
      h('p', { class: 'mgr-row-name', text: p.name }),
      h('p', { class: 'mgr-note', text: note })),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn btn-print', dataset: { fk: `row-${p.id}` }, onclick: () => seeBuild(p.id, p.position) }, 'See build'),
      removeBtn(p)));
}

function removeBtn(p) {
  return h('button', {
    type: 'button', class: 'linkish', 'aria-label': `Remove ${p.name || 'this card'} from your club`,
    onclick: e => tapAgain(e.currentTarget, 'Tap again to remove', () => removeFromClub(p, e.currentTarget)),
  }, 'Remove');
}

function optionRow(o, pos) {
  const at = whereIs(o.id);
  const twin = !at && o.person && [...SQ.draft.slots, ...SQ.draft.bench].some(id => id && clubCard(id)?.person === o.person);
  const note = [o.type, whereText(at), twin ? 'Swaps out the version in your squad' : ''].filter(Boolean).join(' · ');
  return h('li', { class: `mgr-row club-row opt-row${o.fit === 'off' ? ' is-off' : ''}` },
    cardPhoto(o.id),
    ovrBadge(o.ovr),
    h('div', { class: 'mgr-info' },
      h('p', { class: 'mgr-row-name' }, o.name, ' ', h('span', { class: o.fit === 'off' ? 'tag' : 'tag tag-quiet', text: FIT_LABEL[o.fit] || '' })),
      h('p', { class: 'mgr-note', text: note || `${o.ovr} at ${pos} with their best build` })),
    h('button', {
      type: 'button', class: 'opt-go', dataset: { fk: `row-${o.id}` },
      'aria-label': `${at ? 'Swap in' : 'Put in'} ${o.name} at ${pos}, rated ${o.ovr}`, onclick: () => place(o.id),
    }, at ? 'Swap in' : 'Put here'));
}

async function renderClubList() {
  const list = $('#clubList');
  const d = SQ.draft;
  if (!SQ.club.length) { list.replaceChildren(); return; }
  if (SQ.mode === 'slot') {
    const tok = SQ.ctx;
    const pos = formationOf(d.formation).slots[tok.i].pos;
    list.setAttribute('aria-busy', 'true');
    let opts;
    try {
      opts = await api('/api/squad/slot-options', { method: 'POST', body: { pos, managerId: d.managerId, tactic: d.tactic } });
    } catch (e) {
      setClubMsg(e.message, 'error', e);
      return;
    } finally {
      list.removeAttribute('aria-busy');
    }
    if (SQ.ctx !== tok || !$('#clubDlg').open) return;
    const cur = d.slots[tok.i];
    const fits = opts.filter(o => o.id !== cur && !(o.fit === 'off' && (pos === 'GK') !== (o.position === 'GK')));
    list.replaceChildren(...fits.map(o => optionRow(o, pos)));
    if (!fits.length) setClubMsg(pos === 'GK' ? 'No goalkeeper in your club yet. Add one above.' : `Nobody else in your club can play ${pos}. Add a card above.`);
    return;
  }
  if (SQ.mode === 'bench') {
    const used = new Set([...d.slots, ...d.bench].filter(Boolean));
    const free = SQ.club.filter(p => !p.missing && !used.has(p.id));
    list.replaceChildren(...free.map(p => {
      const twin = p.person && [...used].some(id => clubCard(id)?.person === p.person);
      return h('li', { class: 'mgr-row club-row' },
        cardPhoto(p.id),
        ovrBadge(p.baseOvr),
        h('div', { class: 'mgr-info' },
          h('p', { class: 'mgr-row-name', text: p.name }),
          h('p', { class: 'mgr-note', text: [p.position, p.type, twin ? 'Swaps out the version in your squad' : ''].filter(Boolean).join(' · ') })),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-stick', dataset: { fk: `row-${p.id}` }, 'aria-label': `Put ${p.name} on the bench`, onclick: () => place(p.id) }, 'Put on bench')));
    }));
    if (!free.length) setClubMsg('Everyone in your club already has a place. Add another card above.');
    return;
  }
  list.replaceChildren(...SQ.club.map(clubRow));
}

// eFootball allows one version of a player per squad.
function dropTwins(id) {
  const person = clubCard(id)?.person;
  if (!person) return false;
  const d = SQ.draft;
  let dropped = false;
  const twin = x => x && x !== id && clubCard(x)?.person === person && (dropped = true);
  d.slots = d.slots.map(x => (twin(x) ? null : x));
  d.bench = d.bench.filter(x => !twin(x));
  return dropped;
}

function place(id) {
  const d = SQ.draft;
  const prev = currentId();
  const at = whereIs(id);
  const i = SQ.ctx.i;
  if (SQ.mode === 'slot') {
    if (at?.kind === 'slot') d.slots[at.i] = prev;
    else if (at?.kind === 'bench') { if (prev) d.bench[at.i] = prev; else d.bench.splice(at.i, 1); }
    d.slots[i] = id;
    SQ.placing = new Set([i, ...(at?.kind === 'slot' && prev ? [at.i] : [])]);
  } else {
    if (i < d.bench.length) d.bench[i] = id; else d.bench.push(id);
    d.bench = d.bench.filter(Boolean).slice(0, SQ_BENCH_MAX);
  }
  const dropped = dropTwins(id);
  $('#clubDlg').close();
  commit();
  setTimeout(() => SQ.placing.clear(), 1500);
  if (dropped) toast(`A squad takes one version of each player, so the other ${surname(clubCard(id)?.name)} came off.`, 'info');
}

async function removeFromClub(p, btn) {
  btn.disabled = true;
  try {
    const r = await api(`/api/club?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    SQ.club = r.players || [];
    const d = SQ.draft;
    const had = d.slots.includes(p.id) || d.bench.includes(p.id);
    d.slots = d.slots.map(x => (x === p.id ? null : x));
    d.bench = d.bench.filter(x => x !== p.id);
    setClubMsg(`${p.name || 'That card'} left your club${had ? ' and the squad' : ''}.`, 'ok');
    await renderClubList();
    commit();
    $('#clubInput').focus();
  } catch (e) {
    btn.disabled = false;
    setClubMsg(e.message, 'error', e);
  }
}

async function addToClub(ref, label) {
  const btn = $('#clubAdd');
  const input = $('#clubInput');
  btn.disabled = true;
  hideClubResults();
  setClubMsg(`Fetching ${label || 'the card'}… ${SLOW_NOTE}`);
  try {
    const r = await api('/api/club', { method: 'POST', body: { id: String(ref) } });
    SQ.club = r.players || [];
    input.value = '';
    const name = r.name || r.added?.name || 'The card';
    const id = String(r.added?.id || '');
    setClubMsg(`${name} is in your club.`, 'ok');
    renderClubCount();
    await renderClubList();
    if (SQ.open) renderSquad();
    (id && document.querySelector(`#clubList [data-fk="row-${CSS.escape(id)}"]`) || input).focus();
  } catch (e) {
    setClubMsg(e.message, 'error', e);
    input.focus();
  } finally {
    btn.disabled = false;
  }
}

function onClubInput() {
  const q = $('#clubInput').value.trim();
  clearTimeout(SQ.searchTimer);
  SQ.searchCtrl?.abort();
  if (q.length < 2 || looksLikeId(q)) { hideClubResults(); return; }
  SQ.searchTimer = setTimeout(() => searchClub(q), 220);
}

async function searchClub(q, focusFirst = false) {
  SQ.searchCtrl?.abort();
  const ctrl = SQ.searchCtrl = new AbortController();
  try {
    const rows = await api(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
    if (ctrl !== SQ.searchCtrl) return;
    const ul = $('#clubResults');
    const owned = new Set(SQ.club.map(p => p.id));
    ul.replaceChildren(...(rows.length ? rows.map(r => {
      const has = owned.has(String(r.id));
      return h('li', {}, h('button', { type: 'button', class: 'result', disabled: has, onclick: () => addToClub(r.id, r.name) },
        cardPhoto(r.id),
        h('span', { class: 'r-ovr', text: r.ovr }),
        h('span', { class: 'r-main' },
          h('span', { class: 'r-name', text: r.name }),
          h('span', { class: 'r-meta', text: [r.position, r.team, r.type].filter(Boolean).join(' · ') || `Card id ${r.id}` })),
        has ? h('span', { class: 'r-tag', text: 'In your club' }) : r.cached ? h('span', { class: 'r-tag', text: ENGINE ? 'In library' : 'Quick to add' }) : null));
    }) : [h('li', { class: 'result-none', text: `No cards match “${q}”. Paste the efhub link instead.` })]));
    ul.hidden = false;
    if (focusFirst) ul.querySelector('button:not([disabled])')?.focus();
  } catch (e) {
    if (e.name !== 'AbortError') setClubMsg(e.message, 'error', e);
  }
}

function onClubSubmit(e) {
  e.preventDefault();
  const v = $('#clubInput').value.trim();
  if (!v) {
    setClubMsg('Paste an efhub player link, or type at least two letters of a name.', 'error');
    $('#clubInput').focus();
    return;
  }
  clearTimeout(SQ.searchTimer);
  if (looksLikeId(v)) addToClub(v);
  else if (v.length >= 2) searchClub(v, true);
}

// ---------------------------------------------------------------- squad actions
async function suggestXI() {
  const d = SQ.draft;
  if (!d) return;
  if (!SQ.club.length) {
    await openClub('club');
    setClubMsg('Add a few of your cards first, then ask for the best eleven again.');
    return;
  }
  const btn = $('#sqSuggest');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Picking…';
  clearTimeout(SQ.timer);
  SQ.ctrl?.abort();
  try {
    const r = await api('/api/squad/suggest', { method: 'POST', body: sqBody() });
    const before = { slots: [...d.slots], bench: [...d.bench] };
    const slots = r.ids.slots.map(x => (x ? String(x) : null));
    const changed = slots.map((id, i) => (id && id !== d.slots[i] ? i : -1)).filter(i => i >= 0);
    const same = slots.join() === d.slots.join() && r.ids.bench.join() === d.bench.join();
    d.slots = slots;
    d.bench = r.ids.bench.map(String);
    d.tactic = r.tactic || d.tactic;
    SQ.undo = same ? null : before;
    SQ.result = r;
    SQ.placing = new Set(changed);
    saveDraft();
    renderSquad();
    setTimeout(() => SQ.placing.clear(), 1500);
    const notes = [];
    if (same) notes.push('This is already your best eleven.');
    if (r.empty?.length) notes.push(`Still open: ${listJoin(r.empty)}. Add more cards to fill ${r.empty.length > 1 ? 'them' : 'it'}.`);
    if (r.versionsSkipped) notes.push(`${r.versionsSkipped} extra version${r.versionsSkipped > 1 ? 's' : ''} of the same player stayed out, since a squad takes one of each.`);
    if (notes.length) toast(notes.join(' '), 'info');
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message, 'error', requestLink(e));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function changeFormation(key) {
  const d = SQ.draft;
  const f = formationOf(key);
  if (!d || f.key === d.formation) return;
  // Remap from the lineup the user last set, so trying formations never reshuffles it.
  const base = SQ.anchor || { formation: d.formation, slots: [...d.slots], bench: [...d.bench] };
  if (f.key === base.formation) {
    d.formation = f.key;
    d.slots = [...base.slots];
    d.bench = [...base.bench];
    SQ.anchor = { ...base, out: lineupKey(d) };
    commit();
    return;
  }
  const old = formationOf(base.formation);
  const left = base.slots.map((id, i) => id && { id, ...old.slots[i] }).filter(Boolean);
  const slots = Array(f.slots.length).fill(null);
  // Each pass keeps players as close as possible to where they stood.
  const fill = test => {
    const pairs = [];
    left.forEach(p => f.slots.forEach((s, i) => {
      if (!slots[i] && test(p, s)) pairs.push({ p, i, dist: Math.hypot(p.x - s.x, p.y - s.y) });
    }));
    pairs.sort((a, b) => a.dist - b.dist);
    const placed = new Set();
    for (const { p, i } of pairs) {
      if (slots[i] || placed.has(p)) continue;
      slots[i] = p.id;
      placed.add(p);
    }
    placed.forEach(p => left.splice(left.indexOf(p), 1));
  };
  fill((p, s) => p.pos === s.pos);
  fill((p, s) => canPlay(clubCard(p.id), s.pos));
  fill((p, s) => (s.pos === 'GK') === (p.pos === 'GK'));
  const room = SQ_BENCH_MAX - base.bench.length;
  const moved = left.slice(0, Math.max(0, room)).map(p => p.id);
  d.formation = f.key;
  d.slots = slots;
  d.bench = [...base.bench, ...moved];
  SQ.anchor = { ...base, out: lineupKey(d) };
  commit();
  if (left.length) {
    const names = left.map(p => surname(clubCard(p.id)?.name) || 'A player');
    toast(moved.length === left.length
      ? `${listJoin(names)} moved to the bench. ${f.key} has no place for them.`
      : `${listJoin(names)} came off. ${f.key} has no place for them and the bench is full.`, 'info');
  }
}

function pickSaved(id) {
  const d = SQ.draft;
  if (!id) {
    SQ.draft = SQ.stash ? normDraft(SQ.stash) : blankDraft(d.formation);
    SQ.stash = null;
  } else {
    const s = SQ.squads.find(x => x.id === id);
    if (!s) return;
    if (!d.id) SQ.stash = { ...d, slots: [...d.slots], bench: [...d.bench] };
    SQ.draft = normDraft(s);
  }
  SQ.result = null;
  SQ.placing.clear();
  commit();
}

async function saveSquad(e) {
  e.preventDefault();
  const d = SQ.draft;
  const input = $('#sqName');
  const name = input.value.trim();
  if (!name) {
    toast('Give the squad a name first, like “Weekend League”.');
    input.focus();
    return;
  }
  if (!d.slots.some(Boolean)) {
    toast('Put at least one player on the pitch, then save.');
    return;
  }
  const btn = $('#sqSave');
  btn.disabled = true;
  try {
    d.name = name;
    const r = await api('/api/squads', {
      method: 'POST',
      body: { id: d.id || undefined, name, formation: d.formation, managerId: d.managerId, tactic: d.tactic, slots: d.slots, bench: d.bench },
    });
    SQ.squads = r.squads || [];
    d.id = String(r.saved.id);
    SQ.stash = null;
    saveDraft();
    renderSaved();
    renderSquad();
    toast(`Saved “${name}”.`, 'ok');
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function deleteSquad() {
  const d = SQ.draft;
  if (!d.id) return;
  const name = d.name || 'That squad';
  try {
    const r = await api(`/api/squads?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' });
    SQ.squads = r.squads || [];
    d.id = null;
    saveDraft();
    renderSaved();
    renderSquad();
    $('#sqSaved').focus();
    toast(`Deleted “${name}”. The players stay on the pitch as a draft.`, 'info');
  } catch (e) {
    toast(e.message, 'error', requestLink(e));
  }
}

function newSquad() {
  SQ.draft = blankDraft(SQ.draft.formation);
  SQ.stash = null;
  SQ.result = null;
  SQ.placing.clear();
  commit();
  $('#sqName').focus();
}

function seeBuild(id, pos) {
  const d = SQ.draft;
  const m = usableMgr(d?.managerId);
  Object.assign(S, {
    playerId: String(id), pos: canPlay(clubCard(id), pos) ? pos : null,
    managerId: m ? m.id : S.managerId, tactic: m ? d.tactic : S.tactic,
    level: null, sel: 0, morePos: false, ratings: null,
  });
  if ($('#clubDlg').open) $('#clubDlg').close();
  showView('album');
  renderManager();
  build({ newPlayer: true });
  $('#builds').focus();
}

function wireSquad() {
  document.querySelectorAll('.view-tab').forEach(b => b.addEventListener('click', () => showView(b.dataset.v)));
  $('#sqSuggest').addEventListener('click', suggestXI);
  $('#sqClub').addEventListener('click', () => openClub('club'));
  $('#sqFormation').addEventListener('change', e => {
    if (e.target.value === '__custom') { setCustomForm(true); return; }
    setCustomForm(false);
    changeFormation(e.target.value);
  });
  $('#sqCustomForm').addEventListener('submit', applyCustomForm);
  $('#sqCustomCancel').addEventListener('click', closeCustomForm);
  $('#sqCustomForm').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeCustomForm(); } });
  $('#sqCustomInput').addEventListener('input', e => {
    if (e.target.hasAttribute('aria-invalid')) { e.target.removeAttribute('aria-invalid'); $('#sqCustomErr').textContent = ''; }
  });
  $('#sqSaved').addEventListener('change', e => pickSaved(e.target.value));
  $('#sqSaveForm').addEventListener('submit', saveSquad);
  $('#sqNew').addEventListener('click', e => {
    const d = SQ.draft;
    if (!d) return;
    if (d.slots.some(Boolean) || d.bench.length) tapAgain(e.currentTarget, 'Tap again to clear the pitch', newSquad);
    else newSquad();
  });
  $('#sqDelete').addEventListener('click', e => tapAgain(e.currentTarget, 'Tap again to delete', deleteSquad));
  $('#sqName').addEventListener('input', e => {
    if (!SQ.draft) return;
    SQ.draft.name = e.target.value;
    $('#squadTitle').textContent = e.target.value.trim() || 'Squad';
    saveDraft();
  });
  $('#clubForm').addEventListener('submit', onClubSubmit);
  $('#clubInput').addEventListener('input', onClubInput);
  $('#clubDlg').addEventListener('close', () => { SQ.searchCtrl?.abort(); clearTimeout(SQ.searchTimer); });
  $('#team').addEventListener('close', () => {
    if (SQ.open) renderSquad();
    if (document.body.dataset.view === 'home') { renderHomeManagers(); renderHomeSquad(); }
  });
  $('#sqStyles').addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step || !SQ.draft) return;
    e.preventDefault();
    const keys = S.tactics.map(t => t.key);
    const next = keys[(keys.indexOf(SQ.draft.tactic) + step + keys.length) % keys.length];
    setSquadTactic(next);
    document.querySelector(`#sqStyles .ps[data-tactic="${next}"]`)?.focus();
  });
}

// ---------------------------------------------------------------- wiring
function wire() {
  const input = $('#findInput');
  $('#findForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return input.focus();
    if (looksLikeId(v)) return pickPlayer(v.match(/(\d{6,})/)[1]);
    clearTimeout(searchTimer);
    search(v, true);
  });
  input.addEventListener('input', () => {
    const v = input.value.trim();
    clearTimeout(searchTimer);
    if (!v) { searchCtrl?.abort(); return showAlbumPicks(); }
    if (looksLikeId(v)) {
      showResults('efhub link', [], 'Press Find to fetch this card.');
      return;
    }
    if (v.length < 2) return hideResults();
    searchTimer = setTimeout(() => search(v), 220);
  });
  input.addEventListener('focus', () => { if (!input.value.trim()) showAlbumPicks(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { const first = $('#results .result'); if (first && !$('#results').hidden) { e.preventDefault(); first.focus(); } }
  });
  $('.finder').addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#results').hidden) {
      if (document.body.classList.contains('finder-open') && getComputedStyle($('#findToggle')).display !== 'none') {
        setFinder(false);
        $('#findToggle').focus();
      }
      return;
    }
    const inResults = e.target.closest('#results');
    hideResults();
    if (inResults) input.focus();
  });
  $('#results').addEventListener('keydown', e => {
    const items = [...document.querySelectorAll('#results .result')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i ? items[i - 1] : input).focus(); }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.finder')) hideResults();
  });

  const lv = $('#level');
  lv.addEventListener('input', () => setLevel(Number(lv.value)));
  $('#levelDown').addEventListener('click', () => setLevel((S.level ?? S.build.level) - 1));
  $('#levelUp').addEventListener('click', () => setLevel((S.level ?? S.build.level) + 1));

  $('#playstyles').addEventListener('keydown', e => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const keys = S.tactics.map(t => t.key);
    const cur = Math.max(0, keys.indexOf(document.activeElement?.dataset?.tactic || S.tactic));
    const next = keys[(cur + dir + keys.length) % keys.length];
    setTactic(next);
    document.querySelector(`.ps[data-tactic="${next}"]`)?.focus();
  });

  $('#openTeam').addEventListener('click', () => openTeam());
  WIDE.addEventListener('change', () => { const m = document.querySelector('.st-more'); if (m && WIDE.matches) m.open = true; });
  $('#findToggle').addEventListener('click', () => {
    const open = setFinder(!document.body.classList.contains('finder-open'));
    if (open) $('#findInput').focus();
  });
  for (const tab of [$('#tabMine'), $('#tabAll')]) {
    tab.addEventListener('click', () => { S.view = tab.dataset.view; S.replace = null; S.filter = ''; setSheetMsg(''); renderTeam(); });
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const other = tab.id === 'tabMine' ? $('#tabAll') : $('#tabMine');
      other.focus();
      other.click();
    });
  }

  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) dlg.close();
      else if (e.target === dlg) dlg.close();
    });
  }
  $('#customForm').addEventListener('submit', saveCustom);
  wireHome();
  wireSquad();
}

function wireHome() {
  const input = $('#homeInput');
  const res = $('#homeResults');
  $('#brandHome').addEventListener('click', () => { showView('home'); input.focus(); });
  $('#homeFind').addEventListener('submit', e => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return input.focus();
    if (looksLikeId(v)) return pickPlayer(v.match(/(\d{6,})/)[1]);
    clearTimeout(homeTimer);
    homeSearch(v, true);
  });
  input.addEventListener('input', () => {
    const v = input.value.trim();
    clearTimeout(homeTimer);
    if (looksLikeId(v)) return showHomeResults('efhub link', [], 'Press Find to fetch this card.');
    if (v.length < 2) return hideHomeResults();
    homeTimer = setTimeout(() => homeSearch(v), 220);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { const first = res.querySelector('.result'); if (first && !res.hidden) { e.preventDefault(); first.focus(); } }
  });
  $('#homeFind').addEventListener('keydown', e => {
    if (e.key !== 'Escape' || res.hidden) return;
    const inResults = e.target.closest('#homeResults');
    hideHomeResults();
    if (inResults) input.focus();
  });
  res.addEventListener('keydown', e => {
    const items = [...res.querySelectorAll('.result')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i ? items[i - 1] : input).focus(); }
  });
}

async function boot() {
  wire();
  readHash();
  await importLegacy();
  try {
    await loadManagers();
    setupCustomForm();
  } catch (e) {
    toast(e.message, 'error', requestLink(e));
  }
  if (!mgr(S.managerId) || mgr(S.managerId).missing) S.managerId = firstUsable()?.id || null;
  if (S.managerId && !S.tactics.some(t => t.key === S.tactic)) S.tactic = mgr(S.managerId).bestTactic;
  renderManager();
  const first = S.v === 'home' || (!S.playerId && S.v !== 'album') ? 'home' : 'album';
  if (S.v !== 'squad') showView(first);
  if (S.playerId) build({ newPlayer: true });
  else renderEmpty();
  try { await loadSquadData(); } catch (e) { SQ.failed = true; toast(e.message, 'error', requestLink(e)); }
  if (S.v === 'squad') showView(SQ.draft ? 'squad' : first);
  else if (document.body.dataset.view === 'home') renderHomeSquad();
}

boot();
