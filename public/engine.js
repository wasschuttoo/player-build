'use strict';
// Build Album in-browser engine: the same /api/* maths as server.js, run on the page so the app can live on
// GitHub Pages with no server. efhub's managers, boosts and player index allow cross-origin reads, so they're
// fetched straight from efhub. Player pages don't, so cards come from data/cards/ in this repo, which a 6-hourly
// GitHub Action ("Prefetch cards") backfills with every efhub card, highest OVR first.
(function () {
  const meta = document.querySelector('meta[name="ba-mode"]');
  if (meta && meta.content === 'server') return;
  const B = window.EFB, M = window.EFM;
  if (!B || !M) return;

  const STALE_MS = 7 * 24 * 3600 * 1000;
  const CLUB_MAX = 200;
  const BENCH_MAX = 12;
  const OFF_PENALTY = 8;

  class UserError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
  const notInLibrary = id => Object.assign(
    new UserError("This card's full stats are still loading — Build Album is adding every efhub card, popular types first. You can still add it to your club now.", 404),
    { notInLibrary: true, id: String(id) });

  // ---------------------------------------------------------------- timeouts (a stuck request must never hang the page)
  const NET_MS = 15000, CACHE_MS = 3000;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms))]);
  async function timedFetch(url, opts = {}) {
    if (typeof AbortController !== 'function') return withTimeout(fetch(url, opts), NET_MS);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), NET_MS);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); } catch (e) {
      throw ctrl.signal.aborted ? new Error('timed out') : e;
    } finally { clearTimeout(t); }
  }

  // ---------------------------------------------------------------- efhub JSON (CORS-enabled)
  const mem = new Map();
  async function efhubJson(file, refresh) {
    const url = `${B.BASE_URL}${file}`;
    if (!refresh && mem.has(url)) return mem.get(url);
    let cache = null, stale = null;
    try { cache = await withTimeout(caches.open('ba-efhub'), CACHE_MS); } catch {}
    if (cache && !refresh) {
      try {
        const hit = await withTimeout(cache.match(url), CACHE_MS);
        if (hit) {
          const at = Number(hit.headers.get('x-ba-at')) || 0;
          const data = await hit.json();
          if (Date.now() - at < STALE_MS) { mem.set(url, data); return data; }
          stale = data;
        }
      } catch {}
    }
    try {
      const res = await timedFetch(url, { cache: refresh ? 'reload' : 'default' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await withTimeout(res.text(), NET_MS);
      const data = JSON.parse(txt);
      mem.set(url, data);
      if (cache) cache.put(url, new Response(txt, { headers: { 'Content-Type': 'application/json', 'x-ba-at': String(Date.now()) } })).catch(() => {});
      return data;
    } catch (e) {
      if (stale) { mem.set(url, stale); return stale; }
      if (!refresh && cache) {
        try { const hit = await withTimeout(cache.match(url), CACHE_MS); if (hit) { const d = await hit.json(); mem.set(url, d); return d; } } catch {}
      }
      throw new UserError(`Could not reach efhub (${e.message}). Check your connection, then try again.`, 502);
    }
  }
  const loadManagers = refresh => efhubJson('/data/managers.json', refresh);
  const loadIndex = () => efhubJson('/search/player-index.json');
  const loadBoosts = () => efhubJson('/data/boosts.json');
  // Name and OVR from efhub's index for cards the library hasn't loaded yet ("waiting" players).
  let indexById = null;
  async function indexEntries() {
    if (!indexById) indexById = loadIndex().then(list => new Map(list.map(e => [String(e.i), e]))).catch(() => { indexById = null; return new Map(); });
    return indexById;
  }
  async function markWaiting(list) {
    if (!list.some(p => p && p.missing)) return list;
    const idx = await indexEntries();
    for (const p of list) {
      const e = p && p.missing && idx.get(String(p.id));
      if (e) Object.assign(p, { waiting: true, name: e.e, ovr: e.o, baseOvr: e.o });
    }
    return list;
  }

  // ---------------------------------------------------------------- card library (data/cards/ in the repo)
  const base = () => document.baseURI;
  const libCards = new Map();
  let libIndex = null;
  async function loadLibIndex() {
    if (!libIndex) {
      libIndex = timedFetch(new URL('data/cards/index.json', base()), { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : []))
        .then(list => new Map((Array.isArray(list) ? list : []).map(e => [String(e.id), e])))
        .catch(() => { libIndex = null; return new Map(); });
    }
    return libIndex;
  }
  async function libCard(id, refresh) {
    if (!refresh && libCards.has(id)) return libCards.get(id);
    let res;
    try { res = await timedFetch(new URL(`data/cards/${id}.json`, base()), { cache: refresh ? 'reload' : 'no-cache' }); } catch {
      throw new UserError("Couldn't reach Build Album's card library. Check your connection, then try again.", 503);
    }
    if (!res.ok) return null;
    try {
      const c = await withTimeout(res.json(), NET_MS);
      if (!c || !c.baseStats || B.POSITION_COLUMN[c.position] === undefined) return null;
      c.id = String(id);
      libCards.set(id, c);
      return c;
    } catch { return null; }
  }

  // ---------------------------------------------------------------- helpers (ported from server.js)
  function publicManager(m, extra = {}) {
    const n = M.normalizeManager(m);
    return { id: String(m.id), name: n.name, skills: n.skills, boosts: n.boosts, bestTactic: M.bestTactic(n), ...extra };
  }

  function findPlayerId(raw) {
    const m = String(raw ?? '').match(/(\d{6,})/);
    return m ? m[1] : null;
  }
  const cleanIds = (list, max) => (Array.isArray(list) ? list : []).slice(0, max).map(v => (v ? findPlayerId(v) : null));

  // Lookup order: cards the browser sent inline, then the repo library. Inline cards serve only that request.
  const cachedCard = (ctx, id) => ctx.cards.get(String(id)) || libCards.get(String(id)) || null;
  const sentInline = (ctx, id) => ctx.cards.has(String(id));

  async function getCard(ctx, id, refresh) {
    if (refresh) ovrMemo.clear();
    else if (sentInline(ctx, id)) return cachedCard(ctx, id);
    const c = await libCard(String(id), !!refresh);
    if (!c) throw notInLibrary(id);
    return c;
  }

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
  const personOf = c => B.deaccent(c.name || '').trim();
  const baseOvrOf = c => c.overallRating || B.ovr(c.baseStats, c.position, c.height, c.weakFootAccuracy);

  // ---------------------------------------------------------------- playstyle ↔ role compatibility
  // 3 = the role the style was made for, 2 = a good fit, 1 = workable. Anything unlisted is out of role.
  const normStyle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ROLE_GROUP = { GK: 'GK', CB: 'CB', LB: 'FB', RB: 'FB', DMF: 'DM', CMF: 'CM', AMF: 'AM', LMF: 'WM', RMF: 'WM', LWF: 'W', RWF: 'W', SS: 'SS', CF: 'CF' };
  const ATT_FIT = {
    GK: { offensivegoalkeeper: 3, defensivegoalkeeper: 3 },
    CB: { buildup: 3, destroyer: 3, extrafrontman: 2, anchorman: 1 },
    FB: { offensivewingback: 3, defensivefullback: 3, fullbackfinisher: 3, crossspecialist: 1 },
    DM: { anchorman: 3, destroyer: 3, orchestrator: 3, boxtobox: 2, buildup: 2, holeplayer: 1 },
    CM: { boxtobox: 3, orchestrator: 3, holeplayer: 3, creativeplaymaker: 2, destroyer: 2, anchorman: 1, classicno10: 1 },
    AM: { creativeplaymaker: 3, holeplayer: 3, classicno10: 3, deeplyingforward: 2, boxtobox: 1, orchestrator: 1, prolificwinger: 1 },
    WM: { creativeplaymaker: 3, crossspecialist: 3, roamingflank: 2, prolificwinger: 2, boxtobox: 2, offensivewingback: 1 },
    W: { prolificwinger: 3, roamingflank: 3, creativeplaymaker: 2, crossspecialist: 2, goalpoacher: 1 },
    SS: { deeplyingforward: 3, holeplayer: 3, classicno10: 3, goalpoacher: 2, creativeplaymaker: 2, dummyrunner: 2, foxinthebox: 1 },
    CF: { goalpoacher: 3, foxinthebox: 3, targetman: 3, deeplyingforward: 2, dummyrunner: 2, classicno10: 1, holeplayer: 1 },
  };
  const DEF_FIT = {
    GK: { buildupgk: 3, highlinegk: 3, sweepergk: 3, offensivegoalkeeper: 3, defensivegoalkeeper: 3 },
    CB: { deepdefender: 3, coveringrole: 3, highlinemaster: 3, toughmarker: 3, allactiondefender: 2, passdisruptor: 1 },
    FB: { highlinemaster: 3, pressback: 3, coveringrole: 2, toughmarker: 2, allactiondefender: 2, deepdefender: 2 },
    DM: { passdisruptor: 3, coveringrole: 3, allactiondefender: 3, toughmarker: 2, deepdefender: 2, pressback: 2 },
    CM: { passdisruptor: 3, allactiondefender: 3, pressback: 3, coveringrole: 2, toughmarker: 1 },
    AM: { pressback: 3, frontlinepressure: 3, passdisruptor: 2, attackoutlet: 1 },
    WM: { pressback: 3, frontlinepressure: 2, allactiondefender: 2, attackoutlet: 2, passdisruptor: 1 },
    W: { attackoutlet: 3, frontlinepressure: 3, pressback: 2, frontlinepoacher: 2 },
    SS: { frontlinepressure: 3, attackoutlet: 3, frontlinepoacher: 3, pressback: 2 },
    CF: { frontlinepoacher: 3, frontlinepressure: 3, attackoutlet: 3 },
  };
  const TACTIC_TILT = {
    QuickCounter: ['goalpoacher', 'prolificwinger', 'destroyer', 'boxtobox', 'dummyrunner'],
    PossessionGame: ['orchestrator', 'holeplayer', 'buildup', 'creativeplaymaker', 'classicno10'],
    LongBallCounter: ['targetman', 'goalpoacher', 'anchorman', 'destroyer'],
    OutWide: ['crossspecialist', 'roamingflank', 'offensivewingback', 'targetman', 'prolificwinger'],
    LongBall: ['targetman', 'foxinthebox', 'buildup', 'crossspecialist'],
    OverLoad: ['holeplayer', 'creativeplaymaker', 'boxtobox', 'roamingflank', 'extrafrontman'],
  };
  const tacticLabel = key => (M.TACTICS.find(t => t.key === key) || {}).label || key;
  const COMPAT_WORD = { ideal: 'is made for', good: 'suits', ok: 'can cover', poor: "isn't built for" };

  function compatOf(card, pos, tactic, phase) {
    const group = ROLE_GROUP[pos] || 'CM';
    const att = card.playingStyle, def = card.playingStyleDefensive;
    const a = att ? ATT_FIT[group][normStyle(att)] || 0 : null;
    const d = def ? DEF_FIT[group][normStyle(def)] || 0 : null;
    const tilt = phase !== 'def' && att && (TACTIC_TILT[tactic] || []).includes(normStyle(att));
    let score, style;
    if (phase === 'def') {
      if (d !== null) { score = d + (a || 0) * 0.25; style = def; } else if (a !== null) { score = a * 0.8; style = att; } else score = null;
    } else if (a !== null) {
      score = a + (tilt ? 0.5 : 0) + (d ? d * 0.15 : 0); style = att;
    } else score = null;
    if (score === null) return { score: null, label: 'unknown', bonus: 0, style: null, why: 'No playing style on this card.' };
    const label = score >= 3 ? 'ideal' : score >= 2 ? 'good' : score >= 1 ? 'ok' : 'poor';
    let why = `${style} ${COMPAT_WORD[label]} ${pos}${phase === 'def' ? ' when defending' : ''}.`;
    if (tilt) why += ` Thrives in ${tacticLabel(tactic)}.`;
    const bonus = Math.max(-1, Math.min(2, score * 0.8 - 1));
    return { score: Math.round(score * 10) / 10, label, bonus: Math.round(bonus * 100) / 100, style, why };
  }

  // Team-level read on the XI: does it have a creator, a finisher, a shield — and which pairings click?
  function squadNotes(slots) {
    const xi = slots.filter(s => s && !s.missing);
    if (xi.length < 6) return [];
    const notes = [];
    const at = groups => xi.filter(s => groups.includes(ROLE_GROUP[s.pos]));
    const styled = (list, styles) => list.filter(s => styles.includes(normStyle(s.playingStyle)));
    const short = s => String(s.name || '').split(' ').pop();
    const front = at(['CF', 'SS', 'W', 'AM']), mid = at(['DM', 'CM', 'AM', 'WM']), back = at(['CB', 'FB']);
    const creators = styled([...mid, ...front], ['creativeplaymaker', 'orchestrator', 'classicno10', 'holeplayer']);
    const finishers = styled(front, ['goalpoacher', 'foxinthebox', 'targetman', 'prolificwinger', 'deeplyingforward', 'dummyrunner']);
    const shields = [...styled(mid, ['anchorman', 'destroyer']), ...mid.filter(s => ['passdisruptor', 'coveringrole'].includes(normStyle(s.playingStyleDefensive)))];
    const targetMen = styled(front, ['targetman']);
    const poachers = styled(front, ['goalpoacher', 'foxinthebox']);
    const engines = styled(mid, ['boxtobox']), anchors = styled(mid, ['anchorman', 'orchestrator', 'destroyer']);
    if (targetMen.length && poachers.length) notes.push({ tone: 'good', text: `${short(targetMen[0])} holds it up for ${short(poachers[0])} — a classic strike partnership.` });
    if (engines.length && anchors.length) notes.push({ tone: 'good', text: `${short(anchors[0])} sits, ${short(engines[0])} runs — a balanced midfield.` });
    if (!creators.length) notes.push({ tone: 'warn', text: 'Nobody to unlock a defence. An Orchestrator, Creative Playmaker or Classic No. 10 adds the final pass.' });
    if (!finishers.length && front.length) notes.push({ tone: 'warn', text: 'No natural finisher up front. A Goal Poacher or Fox In The Box converts more chances.' });
    if (!shields.length && mid.length >= 2) notes.push({ tone: 'warn', text: 'No midfield shield. An Anchor Man or Destroyer protects the back line.' });
    if (styled(back, ['offensivewingback', 'fullbackfinisher', 'extrafrontman']).length >= 3) notes.push({ tone: 'warn', text: 'Three or more defenders bomb forward, leaving space behind on the counter.' });
    if (targetMen.length >= 2) notes.push({ tone: 'warn', text: 'Two Target Men want the same aerial ball.' });
    if (styled(mid, ['orchestrator']).length >= 2) notes.push({ tone: 'warn', text: 'Two Orchestrators crowd the same space.' });
    const poor = xi.filter(s => s.compat && s.compat.label === 'poor');
    if (poor.length) notes.push({ tone: 'warn', text: `Out of role: ${poor.slice(0, 3).map(s => `${short(s)} (${s.playingStyle}) at ${s.pos}`).join(', ')}${poor.length > 3 ? '…' : ''}.` });
    return notes.slice(0, 5);
  }
  function chemistryOf(slots) {
    const known = slots.filter(s => s && !s.missing && s.compat && s.compat.score !== null);
    if (!known.length) return null;
    return Math.round(known.reduce((a, s) => a + Math.min(3, Math.max(0, s.compat.score)) / 3, 0) / known.length * 100);
  }

  function fitOf(card, pos) {
    if (card.position === pos) return 'main';
    const a = (card.additionalPositions || []).find(p => p.position === pos);
    if (!a) return 'off';
    return a.familiarity >= 2 ? 'strong' : 'learned';
  }

  function clubSummary(ctx, id, added) {
    const c = cachedCard(ctx, id);
    if (!c) return { id: String(id), missing: true, added };
    return {
      id: String(c.id || id), name: c.name, team: c.team, position: c.position,
      positions: [{ pos: c.position, fit: 'main' }, ...(c.additionalPositions || []).map(p => ({ pos: p.position, fit: p.familiarity >= 2 ? 'strong' : 'learned' }))],
      type: B.CARD_TYPES[c.playerType] || '', levelCap: c.levelCap, playingStyle: c.playingStyle,
      playingStyleDefensive: c.playingStyleDefensive || null,
      baseOvr: baseOvrOf(c), person: personOf(c), added,
    };
  }
  // Pull library cards a request needs up front so the maths below can stay synchronous (misses stay missing).
  async function ensureCards(ctx, ids) {
    const todo = [...new Set(ids.filter(Boolean).map(String))].filter(id => !sentInline(ctx, id) && !libCards.has(id));
    await Promise.all(todo.map(id => libCard(id, false).catch(() => null)));
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

  // Current meta shapes per team playstyle, each with the shape it drops into when defending (fluid formation).
  const META = {
    QuickCounter: [
      { att: '4-2-1-3', def: '4-4-2', why: 'Two DMFs screen, three forwards break the instant the ball turns over.' },
      { att: '4-3-3', def: '4-5-1', why: 'Wingers stay high for the counter while three CMFs press the middle.' },
    ],
    PossessionGame: [
      { att: '4-3-3', def: '4-1-4-1', why: 'Triangles everywhere — an anchor, two 8s and wide forwards to stretch the box.' },
      { att: '4-2-3-1', def: '4-4-2', why: 'Double pivot keeps the ball safe; the AMF threads it to a lone striker.' },
      { att: '3-2-4-1', def: '5-2-1-2', why: 'Five across the attacking line overloads the half-spaces.' },
    ],
    LongBallCounter: [
      { att: '4-4-2', def: '4-4-2', why: 'Two compact banks of four, then a quick ball to the strike pair.' },
      { att: '5-2-1-2', def: '5-3-2', why: 'Five at the back absorbs pressure; a target man and runner go long.' },
    ],
    OutWide: [
      { att: '4-1-4-1', def: '4-5-1', why: 'Wide midfielders hug the line and cross early for a target striker.' },
      { att: '4-2-3-1', def: '4-4-2', why: 'Overlapping full-backs plus wide MFs double up on each flank.' },
    ],
    LongBall: [
      { att: '4-4-2', def: '4-4-2', why: 'A big target man wins the first ball, his partner feeds on the knockdown.' },
      { att: '4-3-1-2', def: '4-4-2', why: 'Diamond midfield wins second balls behind two forwards.' },
    ],
    OverLoad: [
      { att: '3-2-4-1', def: '5-2-1-2', why: 'Crowd one side with four attackers, then switch to the free flank.' },
      { att: '4-2-1-3', def: '4-2-3-1', why: 'Front four rotate freely around the AMF to overload a zone.' },
    ],
  };

  const ovrMemo = new Map();
  function slotOvr(ctx, card, boosts, pos, manager, tactic) {
    const memo = inlineCards.has(card) ? ctx.memo : ovrMemo;
    const key = `${card.id}|${pos}|${tactic || ''}|${manager ? JSON.stringify(M.normalizeManager(manager)) : '-'}`;
    let v = memo.get(key);
    if (!v) {
      v = M.quickOvr(card, boosts, { pos, manager, tactic });
      if (memo.size > 20000) memo.clear();
      memo.set(key, v);
    }
    return v;
  }

  // OVR still leads, but a playing style that suits the slot is worth up to ~2 OVR (and a clash costs 1).
  function slotScore(ctx, card, boosts, pos, manager, tactic, phase = 'att') {
    const fit = fitOf(card, pos);
    if ((pos === 'GK') !== M.positionsOf(card).includes('GK') && fit === 'off') return null;
    const r = slotOvr(ctx, card, boosts, pos, manager, tactic);
    const bonus = { main: 0.6, strong: 0.4, learned: 0, off: -OFF_PENALTY }[fit];
    return r.ovrDec + bonus + compatOf(card, pos, tactic, phase).bonus;
  }

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
    return {
      id: String(card.id), name: card.name, team: card.team, type: B.CARD_TYPES[card.playerType] || '',
      playingStyle: card.playingStyle, playingStyleDefensive: card.playingStyleDefensive || null,
      skills: (card.skills || []).map(B.skillName), comSkills: (card.comSkills || []).map(B.skillName),
      position: card.position, person: personOf(card), ...extra,
    };
  }

  // The playstyle-weighted build for this exact slot (position + playing style + team tactic).
  const buildMemo = new Map();
  function roleBuild(ctx, card, boosts, pos, manager, tactic) {
    const memo = inlineCards.has(card) ? ctx.memo : buildMemo;
    const key = `b|${card.id}|${pos}|${tactic || ''}|${manager ? JSON.stringify(M.normalizeManager(manager)) : '-'}`;
    if (memo.has(key)) return memo.get(key);
    let v = null;
    try {
      const b = M.buildAll(card, boosts, { pos, manager, tactic }).builds[1];
      v = { title: b.title, ovr: b.ovr, pointsUsed: b.pointsUsed, sliders: b.sliders.filter(s => s.value > 0).map(s => ({ key: s.key, label: s.label, value: s.value })) };
    } catch { v = null; }
    if (memo.size > 5000) memo.clear();
    memo.set(key, v);
    return v;
  }

  // Re-seat the same XI into the defensive shape: each player takes the def slot that suits them best.
  function defensiveShape(ctx, boosts, xiCards, defForm, manager, tactic, manual) {
    const S = defForm.slots.length;
    let assign;
    const manualIds = Array.isArray(manual) ? manual.slice(0, S).map(x => (x ? String(x) : null)) : null;
    const xiIds = xiCards.map(c => String(c.id));
    if (manualIds && manualIds.filter(Boolean).length && manualIds.every(id => !id || xiIds.includes(id))) {
      assign = xiCards.map(c => manualIds.indexOf(String(c.id)));
      const free = defForm.slots.map((_, i) => i).filter(i => !assign.includes(i));
      assign = assign.map(c => (c >= 0 ? c : free.shift() ?? -1));
    } else {
      const n = Math.max(xiCards.length, S);
      const cost = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => {
        if (r >= xiCards.length || c >= S) return 0;
        const sc = slotScore(ctx, xiCards[r], boosts, defForm.slots[c].pos, manager, tactic, 'def');
        return sc === null ? 1e6 : -sc;
      }));
      assign = hungarian(cost).slice(0, xiCards.length);
    }
    const slots = new Array(S).fill(null);
    xiCards.forEach((card, r) => {
      const c = assign[r];
      if (c < 0 || c >= S) return;
      const pos = defForm.slots[c].pos;
      const o = slotOvr(ctx, card, boosts, pos, manager, tactic);
      slots[c] = playerOut(card, { pos, ovr: o.ovr, cardOvr: o.cardOvr, fit: fitOf(card, pos), compat: compatOf(card, pos, tactic, 'def') });
    });
    const filled = slots.filter(Boolean);
    const avg = filled.length ? Math.round(filled.reduce((a, s) => a + slotOvr(ctx, cachedCard(ctx, s.id), boosts, s.pos, manager, tactic).ovrDec, 0) / filled.length * 10) / 10 : null;
    return { formation: defForm.key, slots, avg, chemistry: chemistryOf(slots), ids: slots.map(s => (s ? s.id : null)) };
  }

  async function evaluateSquad(ctx, body, manager) {
    const form = formationOf(body.formation);
    const boosts = await loadBoosts();
    const tactic = M.TACTICS.some(t => t.key === body.tactic) ? body.tactic : M.bestTactic(M.normalizeManager(manager));
    const ids = form.slots.map((_, i) => (body.slots || [])[i] || null);
    const rate = (card, pos, t) => slotOvr(ctx, card, boosts, pos, manager, t);
    const slots = ids.map((id, i) => {
      if (!id) return null;
      const card = cachedCard(ctx, id);
      const pos = form.slots[i].pos;
      if (!card) return { id: String(id), missing: true, pos };
      const r = rate(card, pos, tactic);
      return playerOut(card, { pos, ovr: r.ovr, cardOvr: r.cardOvr, fit: fitOf(card, pos), levelCap: card.levelCap, compat: compatOf(card, pos, tactic, 'att'), build: roleBuild(ctx, card, boosts, pos, manager, tactic) });
    });
    const bench = (body.bench || []).slice(0, BENCH_MAX).map(id => {
      const card = cachedCard(ctx, id);
      if (!card) return { id: String(id), missing: true };
      const r = rate(card, card.position, tactic);
      return playerOut(card, { pos: card.position, ovr: r.ovr, cardOvr: r.cardOvr, fit: 'main', compat: compatOf(card, card.position, tactic, 'att') });
    });
    const filled = slots.filter(s => s && !s.missing);
    const avgFor = t => {
      if (!filled.length) return null;
      const sum = filled.reduce((a, s) => a + rate(cachedCard(ctx, s.id), s.pos, t).ovrDec, 0);
      return Math.round((sum / filled.length) * 10) / 10;
    };
    const mgr = manager ? M.normalizeManager(manager) : null;
    const out = {
      formation: form.key, tactic, slots, bench, filled: filled.length,
      avg: avgFor(tactic),
      chemistry: chemistryOf(slots),
      notes: squadNotes(slots),
      byTactic: M.TACTICS.map(t => ({ key: t.key, avg: avgFor(t.key), proficiency: mgr ? mgr.skills[t.key] : null })),
      manager: mgr && { id: String(mgr.id ?? ''), name: mgr.name, proficiency: mgr.skills[tactic], multiplier: M.mSkill(mgr.skills[tactic]) },
    };
    if (body.fluid && body.defFormation) {
      const defForm = formationOf(body.defFormation);
      const xiCards = filled.map(s => cachedCard(ctx, s.id)).filter(Boolean);
      out.fluid = true;
      out.def = defensiveShape(ctx, boosts, xiCards, defForm, manager, tactic, body.defSlots);
    }
    return out;
  }

  async function suggestSquad(ctx, body, manager) {
    const form = formationOf(body.formation);
    const boosts = await loadBoosts();
    const tactic = M.TACTICS.some(t => t.key === body.tactic) ? body.tactic : M.bestTactic(M.normalizeManager(manager));
    const cards = cleanIds(body.club, CLUB_MAX).filter(Boolean).map(id => cachedCard(ctx, id)).filter(Boolean);
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
          const sc = slotScore(ctx, card, boosts, slot.pos, manager, tactic);
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
      const ranked = versions.map(card => ({ card, ovr: slotOvr(ctx, card, boosts, card.position, manager, tactic).ovrDec })).sort((a, b) => b.ovr - a.ovr);
      return ranked[0];
    }).sort((a, b) => b.ovr - a.ovr);
    const benchGk = rest.find(x => x.card.position === 'GK');
    const benchPick = [...(benchGk ? [benchGk] : []), ...rest.filter(x => x !== benchGk)].slice(0, BENCH_MAX);
    const out = await evaluateSquad(ctx, { ...body, formation: form.key, tactic, slots, bench: benchPick.map(x => String(x.card.id)), defSlots: null }, manager);
    const empty = form.slots.map((s, i) => (slots[i] ? null : s.pos)).filter(Boolean);
    out.ids = { slots, bench: benchPick.map(x => String(x.card.id)) };
    out.empty = empty;
    out.versionsSkipped = cards.length - P;
    return out;
  }

  // ---------------------------------------------------------------- API (same routes and shapes as server.js)
  const api = {
    async 'GET /api/search'(ctx, q) {
      const term = B.deaccent(q.get('q') || '').trim();
      if (!term) return [];
      const id = findPlayerId(term);
      const [idx, lib] = await Promise.all([loadIndex(), loadLibIndex()]);
      const words = term.split(/\s+/);
      const hits = id
        ? idx.filter(e => String(e.i) === id)
        : idx.filter(e => { const n = B.deaccent(e.e); return words.every(w => n.includes(w)); });
      return hits.sort((a, b) => (b.o || 0) - (a.o || 0)).slice(0, 24).map(e => {
        const key = String(e.i);
        const known = lib.get(key) || libCards.get(key);
        const out = { id: key, name: e.e, ovr: e.o, cached: !!known };
        if (known) Object.assign(out, { team: known.team, position: known.position, type: known.type ?? B.CARD_TYPES[known.playerType] });
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

    async 'POST /api/build'(ctx, q, body) {
      const id = findPlayerId(body.id);
      if (!id) throw new UserError('Paste an efhub player link (efhub.com/players/…) or search by name.');
      const card = await getCard(ctx, id, body.refresh);
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

    async 'POST /api/card-summary'(ctx, q, body) {
      const id = findPlayerId(body.id);
      if (!id) throw new UserError('Paste an efhub player link (efhub.com/players/…) or search by name.');
      let card;
      try { card = await getCard(ctx, id, false); } catch (e) {
        if (!e.notInLibrary) throw e;
        const entry = (await indexEntries()).get(id);
        if (!entry) throw e;
        return { id, missing: true, waiting: true, name: entry.e, ovr: entry.o, baseOvr: entry.o };
      }
      return { ...clubSummary(ctx, id), name: card.name, card };
    },

    async 'POST /api/club/summaries'(ctx, q, body) {
      const ids = [...new Set(cleanIds(body.ids, CLUB_MAX).filter(Boolean))];
      await ensureCards(ctx, ids);
      const cards = {};
      for (const id of ids) { if (!sentInline(ctx, id)) { const c = libCards.get(id); if (c) cards[id] = c; } }
      return { players: await markWaiting(ids.map(id => clubSummary(ctx, id))), cards };
    },

    async 'GET /api/legacy-import'() { return {}; },

    async 'POST /api/squad/evaluate'(ctx, q, body) {
      await ensureCards(ctx, [...cleanIds(body.slots, 11), ...cleanIds(body.bench, BENCH_MAX)]);
      const out = await evaluateSquad(ctx, body, await resolveManager(body));
      await markWaiting([...out.slots, ...out.bench]);
      return out;
    },

    async 'POST /api/squad/suggest'(ctx, q, body) {
      const ids = cleanIds(body.club, CLUB_MAX).filter(Boolean);
      if (!ids.length) throw new UserError('Your club is empty. Add a few cards first, then ask for a suggestion.');
      await ensureCards(ctx, ids);
      return suggestSquad(ctx, body, await resolveManager(body));
    },

    async 'POST /api/squad/slot-options'(ctx, q, body) {
      const manager = await resolveManager(body);
      const pos = String(body.pos || '').toUpperCase();
      if (B.POSITION_COLUMN[pos] === undefined) throw new UserError(`Unknown position "${pos}".`);
      const ids = cleanIds(body.club, CLUB_MAX).filter(Boolean);
      await ensureCards(ctx, ids);
      const boosts = await loadBoosts();
      const tactic = M.TACTICS.some(t => t.key === body.tactic) ? body.tactic : M.bestTactic(M.normalizeManager(manager));
      return ids.map(id => cachedCard(ctx, id)).filter(Boolean).map(card => {
        const fit = fitOf(card, pos);
        const r = slotOvr(ctx, card, boosts, pos, manager, tactic);
        return playerOut(card, { pos, ovr: r.ovr, cardOvr: r.cardOvr, fit, levelCap: card.levelCap, compat: compatOf(card, pos, tactic, 'att') });
      }).sort((a, b) => (a.fit === 'off') - (b.fit === 'off') || (b.ovr + b.compat.bonus) - (a.ovr + a.compat.bonus));
    },

    // Meta shapes for the manager's best tactics, ranked on the user's own club when there is one.
    async 'POST /api/squad/meta'(ctx, q, body) {
      const manager = await resolveManager(body);
      const mgr = manager ? M.normalizeManager(manager) : null;
      const tactics = M.TACTICS.map(t => ({ key: t.key, prof: mgr ? mgr.skills[t.key] : null }))
        .sort((a, b) => (b.prof ?? 0) - (a.prof ?? 0)).slice(0, mgr ? 3 : M.TACTICS.length);
      const ids = cleanIds(body.club, CLUB_MAX).filter(Boolean);
      if (ids.length >= 11) await ensureCards(ctx, ids);
      const rankable = ids.filter(id => cachedCard(ctx, id)).length >= 11;
      const picks = [];
      for (const t of tactics) {
        for (const m of META[t.key] || []) {
          const item = { formation: m.att, defFormation: m.def, tactic: t.key, tacticLabel: tacticLabel(t.key), proficiency: t.prof, reason: m.why, avg: null, chemistry: null };
          if (rankable) {
            const s = await suggestSquad(ctx, { club: ids, formation: m.att, tactic: t.key }, manager);
            Object.assign(item, { avg: s.avg, chemistry: s.chemistry });
          }
          picks.push(item);
        }
      }
      const score = p => (p.proficiency ?? 0) * 0.15 + (p.avg ?? 0) + (p.chemistry ?? 0) * 0.03;
      return { ranked: rankable, picks: picks.sort((a, b) => score(b) - score(a)).slice(0, 6) };
    },
  };

  // Bodies are cloned so inline cards get their own objects, like JSON over the wire.
  async function handle(method, pathname, searchParams, body) {
    const route = `${method} ${pathname}`;
    const fn = api[route];
    if (!fn) throw new UserError('Unknown API route.', 404);
    const b = body ? JSON.parse(JSON.stringify(body)) : {};
    const ctx = { cards: readInlineCards(b), memo: new Map() };
    try {
      return JSON.parse(JSON.stringify(await fn(ctx, searchParams, b)));
    } catch (e) {
      if (e instanceof UserError) throw e;
      throw new UserError(`Something went wrong (${e.message}). Try again in a moment.`, 500);
    }
  }

  window.BA_ENGINE = { handle };
})();
