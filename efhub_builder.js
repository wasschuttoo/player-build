#!/usr/bin/env node
'use strict';
// eFootball training-point builder. Data and rating logic from efhub.com (efootballhub.net).
// Runs in Node (CLI + server) and in the browser (GitHub Pages build exposes it as globalThis.EFB).
(function (root) {
const isNode = typeof module === 'object' && !!module && !!module.exports && typeof require === 'function';
const fs = isNode ? require('fs') : null;
const path = isNode ? require('path') : null;

const ROOT = isNode ? __dirname : '';
const CACHE = isNode ? path.join(ROOT, 'cache') : '';
const PLAYER_CACHE = isNode ? path.join(CACHE, 'players') : '';
const INDEX_FILE = isNode ? path.join(CACHE, 'player-index.json') : '';
const BOOSTS_FILE = isNode ? path.join(CACHE, 'boosts.json') : '';
const LASTFETCH_FILE = isNode ? path.join(CACHE, '.lastfetch') : '';
const BASE_URL = 'https://efhub.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const CRAWL_DELAY_MS = 5000;
const STALE_MS = 7 * 24 * 3600 * 1000;

// ---------------------------------------------------------------- rating model (ported from efhub)
const POSITION_COLUMN = { GK: 0, CB: 1, LB: 2, RB: 3, DMF: 4, CMF: 5, LMF: 6, RMF: 7, AMF: 8, LWF: 9, RWF: 10, SS: 11, CF: 12 };
const STAT_OFFSET = {
  offensiveAwareness: 13, ballControl: 26, dribbling: 39, tightPossession: 52, lowPass: 65, loftedPass: 78,
  finishing: 91, setPieceTaking: 104, curl: 117, heading: 130, defensiveAwareness: 143, ballWinning: 156,
  aggression: 169, kickingPower: 182, speed: 195, acceleration: 208, physicalContact: 221, balance: 234,
  jump: 247, gkAwareness: 260, gkReach: 273, gkCatching: 286, gkClearing: 299, gkReflexes: 312,
  stamina: 325, defensiveEngagement: 351,
};
const WFA_OFFSET = 338;
const WEIGHTS = [186,136,49,49,61,37,12,12,37,49,49,62,99,0,14,61,61,61,98,98,98,171,159,159,173,210,13,27,86,86,122,171,171,171,196,159,159,210,123,0,14,61,61,37,98,110,122,122,159,159,123,62,0,0,37,37,24,49,73,61,73,86,86,86,37,27,41,61,61,122,208,135,135,196,73,73,99,37,40,68,147,147,122,159,196,196,159,98,98,74,12,0,27,24,24,37,73,86,86,184,159,159,284,358,0,14,24,24,12,12,24,24,12,12,12,12,12,0,14,24,24,12,12,24,24,12,12,12,12,12,0,55,24,24,61,24,12,12,24,24,24,25,62,13,286,147,147,220,86,49,49,24,12,12,0,0,0,191,86,86,122,86,24,24,24,12,12,12,12,0,82,37,37,98,37,12,12,12,12,12,12,12,53,27,24,24,49,73,24,24,73,61,61,99,123,13,136,220,220,61,61,196,196,98,220,220,86,99,40,150,184,184,61,86,159,159,86,159,159,99,123,80,204,98,98,122,49,24,24,24,37,37,37,86,0,0,24,24,12,24,61,61,24,73,73,74,86,133,109,37,37,37,12,12,12,12,24,24,37,62,279,0,0,0,0,0,0,0,0,0,0,0,0,226,0,0,0,0,0,0,0,0,0,0,0,0,226,0,0,0,0,0,0,0,0,0,0,0,0,173,0,0,0,0,0,0,0,0,0,0,0,0,173,0,0,0,0,0,0,0,0,0,0,0,0,0,68,196,196,196,196,147,147,86,49,49,49,37,4,4,4,4,4,4,4,4,4,4,4,4,4,0,14,24,24,24,24,24,24,24,24,24,12,12];

function ratingSum(stats, pos, height, wfa) {
  const col = POSITION_COLUMN[pos];
  if (col === undefined) return null;
  const c = k => WEIGHTS[k + col] ?? 0;
  const r = x => (x > 25 ? x - 25 : 0);
  let sum = c(0) * r(height - 111);
  for (const [k, off] of Object.entries(STAT_OFFSET)) sum += c(off) * r(stats[k] ?? 0);
  sum += c(WFA_OFFSET) * r(Math.floor((59 * wfa) / 3 + 40));
  return sum;
}
function ovr(stats, pos, height, wfa) {
  const s = ratingSum(stats, pos, height, wfa);
  return s === null ? 70 : Math.max(40, Math.floor((s + 500) / 1000));
}
function ovrDec(stats, pos, height, wfa) {
  const s = ratingSum(stats, pos, height, wfa);
  return s === null ? 70 : Math.round(100 * Math.max((s + 500) / 1000, 40)) / 100;
}

const SLIDERS = [
  { key: 'shooting', label: 'Shooting', stats: ['finishing', 'setPieceTaking', 'curl'] },
  { key: 'passing', label: 'Passing', stats: ['lowPass', 'loftedPass'] },
  { key: 'dribbling', label: 'Dribbling', stats: ['ballControl', 'dribbling', 'tightPossession'] },
  { key: 'dexterity', label: 'Dexterity', stats: ['offensiveAwareness', 'acceleration', 'balance'] },
  { key: 'lowerBodyStrength', label: 'Lower Body Strength', stats: ['speed', 'kickingPower', 'stamina'] },
  { key: 'aerialStrength', label: 'Aerial Strength', stats: ['heading', 'jump', 'physicalContact'] },
  { key: 'defending', label: 'Defending', stats: ['defensiveAwareness', 'ballWinning', 'aggression', 'defensiveEngagement'] },
  { key: 'gk1', label: 'GK 1 (Awareness/Jump)', stats: ['gkAwareness', 'jump'] },
  { key: 'gk2', label: 'GK 2 (Clearing/Reach)', stats: ['gkClearing', 'gkReach'] },
  { key: 'gk3', label: 'GK 3 (Catching/Reflexes)', stats: ['gkCatching', 'gkReflexes'] },
];
const MAX_SLIDER = 25;
const levelCost = n => Math.ceil(n / 4);
const cumulativeCost = n => { let t = 0; for (let i = 1; i <= n; i++) t += levelCost(i); return t; };
const availablePoints = level => Math.max(0, (level - 1) * 2);
const zeroSliders = () => Object.fromEntries(SLIDERS.map(s => [s.key, 0]));
const pointsUsed = sl => SLIDERS.reduce((t, s) => t + cumulativeCost(sl[s.key]), 0);

function applyProgression(base, sliders) {
  const r = { ...base };
  for (const s of SLIDERS) {
    const v = sliders[s.key];
    if (v) for (const k of s.stats) r[k] = Math.min(99, (r[k] ?? 0) + v);
  }
  return r;
}

// efhub "max OVR" greedy (ProgressionProvider.computeMaxSliders)
function computeMaxSliders(base, pos, height, wfa, points) {
  const sl = zeroSliders();
  let left = points;
  for (;;) {
    const cur = ovrDec(applyProgression(base, sl), pos, height, wfa);
    let best = null, bestGain = 0;
    for (const s of SLIDERS) {
      if (sl[s.key] >= MAX_SLIDER) continue;
      const cost = levelCost(sl[s.key] + 1);
      if (cost > left) continue;
      sl[s.key]++;
      const gain = (ovrDec(applyProgression(base, sl), pos, height, wfa) - cur) / cost;
      sl[s.key]--;
      if (best === null || gain > bestGain) { best = s; bestGain = gain; }
    }
    if (!best || bestGain <= 0) break;
    left -= levelCost(sl[best.key] + 1);
    sl[best.key]++;
  }
  for (const s of SLIDERS) {
    while (sl[s.key] < MAX_SLIDER && levelCost(sl[s.key] + 1) <= left) { left -= levelCost(sl[s.key] + 1); sl[s.key]++; }
  }
  return sl;
}

// efhub build-page "Max" button (module 4854)
function maxButtonSliders(base, pos, points, limits) {
  const col = POSITION_COLUMN[pos];
  const sliders = zeroSliders();
  if (col === undefined) return sliders;
  const lim = k => limits?.[k] ?? 99;
  const r = { ...base };
  const o = { ...sliders };
  let m = points;
  for (let e = 0; e < SLIDERS.length && m > 0; e++) {
    while (m > 0) {
      const t = SLIDERS.map((s, idx) => {
        if (o[s.key] >= MAX_SLIDER) return { score: 0, idx };
        let a = 0;
        for (const st of s.stats) {
          if (r[st] >= lim(st)) continue;
          if (STAT_OFFSET[st] !== undefined) a += WEIGHTS[STAT_OFFSET[st] + col] ?? 0;
        }
        return a === 0 ? { score: 0, idx } : { score: a / Math.ceil((o[s.key] + 1) / 4), idx };
      });
      t.sort((x, y) => y.score - x.score);
      const a = t[e];
      if (!a || a.score <= 0) break;
      const s = SLIDERS[a.idx];
      const c = Math.ceil((o[s.key] + 1) / 4);
      if (m < c) break;
      o[s.key]++; m -= c;
      for (const st of s.stats) if (r[st] < lim(st)) r[st]++;
    }
  }
  return o;
}

// boosts
function boostMagnitude(b) {
  const n = Number(b.magnitude);
  if (Number.isFinite(n) && n > 0) return n;
  return Math.max(0, ...Object.values(b.stats || {}).map(Number).filter(Number.isFinite));
}
function scaleBoost(b, level) {
  if (!b || level <= 0) return null;
  const y = boostMagnitude(b);
  if (level >= y) return b;
  return { ...b, stats: Object.fromEntries(Object.entries(b.stats).map(([k, v]) => [k, Math.round((v * level) / y)])) };
}
function applyBoost(stats, b) {
  if (!b) return stats;
  const r = { ...stats };
  for (const [k, v] of Object.entries(b.stats || {})) if (v) r[k] = (r[k] ?? 0) + v;
  return r;
}
function resolveBoosts(card, boosts) {
  const out = [];
  if (card.boostId > 1) {
    const b = boosts.left.find(x => x.id === card.boostId);
    if (b) out.push(scaleBoost(b, boostMagnitude(b)));
  }
  if (card.boostId2 > 0) {
    const b = [...boosts.left, ...boosts.right].find(x => x.id === card.boostId2);
    if (b) out.push(scaleBoost(b, boostMagnitude(b)));
  }
  return out.filter(Boolean);
}
function finalStats(base, sliders, boostList) {
  let s = applyProgression(base, sliders);
  for (const b of boostList) s = applyBoost(s, b);
  return s;
}

// ---------------------------------------------------------------- playstyle weighting (heuristic)
const ATTACK_STYLE_WEIGHTS = {
  'Goal Poacher': { offensiveAwareness: 3, finishing: 3, acceleration: 2, speed: 2, ballControl: 1, kickingPower: 1, balance: 1 },
  'Dummy Runner': { offensiveAwareness: 3, ballControl: 2, finishing: 2, acceleration: 2, speed: 1, tightPossession: 1, lowPass: 1 },
  'Fox In The Box': { offensiveAwareness: 3, finishing: 3, heading: 2, physicalContact: 2, ballControl: 1, balance: 1, jump: 1 },
  'Prolific Winger': { dribbling: 3, speed: 3, acceleration: 3, ballControl: 2, finishing: 2, offensiveAwareness: 1, balance: 1, curl: 1 },
  'Classic No. 10': { lowPass: 3, ballControl: 3, tightPossession: 2, loftedPass: 2, dribbling: 2, offensiveAwareness: 1, curl: 1, finishing: 1 },
  'Hole Player': { offensiveAwareness: 3, finishing: 2, lowPass: 2, ballControl: 2, stamina: 2, acceleration: 1, dribbling: 1, tightPossession: 1 },
  'Box To Box': { stamina: 3, ballWinning: 2, lowPass: 2, defensiveAwareness: 2, ballControl: 1, physicalContact: 1, aggression: 1, speed: 1, kickingPower: 1, defensiveEngagement: 1 },
  'Anchor Man': { defensiveAwareness: 3, ballWinning: 3, defensiveEngagement: 2, physicalContact: 2, lowPass: 1, aggression: 1, stamina: 1, heading: 1 },
  'Destroyer': { ballWinning: 3, aggression: 3, defensiveAwareness: 2, defensiveEngagement: 2, physicalContact: 2, stamina: 2 },
  'Extra Frontman': { defensiveAwareness: 2, heading: 2, physicalContact: 2, speed: 2, ballControl: 1, finishing: 1, offensiveAwareness: 1, jump: 1, ballWinning: 1, loftedPass: 1 },
  'Offensive Wingback': { speed: 3, stamina: 3, acceleration: 2, loftedPass: 2, dribbling: 1, curl: 1, defensiveAwareness: 1, ballWinning: 1, lowPass: 1 },
  'Defensive Full-back': { defensiveAwareness: 3, ballWinning: 2, speed: 2, stamina: 2, physicalContact: 1, acceleration: 1, aggression: 1, defensiveEngagement: 1, heading: 1 },
  'Deep-Lying Forward': { lowPass: 3, ballControl: 3, tightPossession: 2, offensiveAwareness: 2, finishing: 2, loftedPass: 1, physicalContact: 1, dribbling: 1 },
  'Creative Playmaker': { dribbling: 3, lowPass: 3, ballControl: 2, tightPossession: 2, acceleration: 2, curl: 1, offensiveAwareness: 1, balance: 1, loftedPass: 1 },
  'Build Up': { lowPass: 3, loftedPass: 3, defensiveAwareness: 2, ballControl: 2, ballWinning: 1, physicalContact: 1, kickingPower: 1, heading: 1 },
  'Offensive Goalkeeper': { gkAwareness: 3, gkReflexes: 3, gkReach: 2, gkCatching: 2, gkClearing: 2, jump: 1, lowPass: 1, loftedPass: 1, speed: 1 },
  'Defensive Goalkeeper': { gkAwareness: 3, gkReflexes: 3, gkCatching: 3, gkReach: 2, gkClearing: 2, jump: 1 },
  'Roaming Flank': { dribbling: 3, acceleration: 3, finishing: 2, ballControl: 2, offensiveAwareness: 2, curl: 2, balance: 1, speed: 1 },
  'Cross Specialist': { loftedPass: 3, curl: 3, speed: 2, acceleration: 1, stamina: 1, ballControl: 1, dribbling: 1, kickingPower: 1 },
  'Orchestrator': { lowPass: 3, loftedPass: 3, ballControl: 2, tightPossession: 2, curl: 1, offensiveAwareness: 1, stamina: 1, balance: 1 },
  'Full-back Finisher': { offensiveAwareness: 3, speed: 2, acceleration: 2, finishing: 2, stamina: 2, dribbling: 1, ballControl: 1, defensiveAwareness: 1 },
  'Target Man': { physicalContact: 3, heading: 3, jump: 2, ballControl: 2, finishing: 2, offensiveAwareness: 1, balance: 1, lowPass: 1 },
};
const DEFENSE_STYLE_WEIGHTS = {
  'Build-up GK': { lowPass: 2, loftedPass: 2, gkClearing: 1, kickingPower: 1 },
  'High Line GK': { speed: 2, acceleration: 2, gkAwareness: 2, gkClearing: 1 },
  'Sweeper GK': { speed: 2, acceleration: 2, gkAwareness: 2, gkClearing: 2 },
  'Press Back': { defensiveAwareness: 2, ballWinning: 2, stamina: 2, aggression: 1, speed: 1, acceleration: 1 },
  'Front Line Pressure': { stamina: 3, aggression: 2, ballWinning: 2, speed: 1, acceleration: 1, defensiveEngagement: 1 },
  'Front Line Poacher': { ballWinning: 3, aggression: 2, acceleration: 2, offensiveAwareness: 1, finishing: 1 },
  'Attack Outlet': { speed: 2, acceleration: 2, offensiveAwareness: 2, stamina: 1, ballControl: 1 },
  'All Action Defender': { stamina: 3, ballWinning: 2, defensiveAwareness: 2, aggression: 2, defensiveEngagement: 1 },
  'Pass Disruptor': { defensiveAwareness: 3, defensiveEngagement: 2, acceleration: 1, ballWinning: 1 },
  'Covering Role': { defensiveAwareness: 3, speed: 2, acceleration: 2, defensiveEngagement: 1 },
  'High Line Master': { defensiveAwareness: 3, speed: 2, acceleration: 1, ballWinning: 1, aggression: 1 },
  'Tough Marker': { ballWinning: 3, physicalContact: 3, aggression: 2, defensiveAwareness: 1, jump: 1, heading: 1 },
  'Deep Defender': { defensiveAwareness: 3, heading: 2, jump: 2, physicalContact: 2, ballWinning: 1 },
};
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const lookupStyle = (table, name) => {
  if (!name) return null;
  const key = Object.keys(table).find(k => norm(k) === norm(name));
  return key ? { name: key, weights: table[key] } : null;
};

function playstyleSliders(base, pos, points, attStyle, defStyle, balance) {
  const col = POSITION_COLUMN[pos] ?? POSITION_COLUMN.CF;
  const colMax = Math.max(...Object.values(STAT_OFFSET).map(o => WEIGHTS[o + col] ?? 0)) || 1;
  const att = attStyle?.weights || {};
  const def = defStyle?.weights || {};
  const value = k => (1 - balance) * ((WEIGHTS[STAT_OFFSET[k] + col] ?? 0) / colMax) + balance * (((att[k] || 0) + 0.5 * (def[k] || 0)) / 3);
  const sl = zeroSliders();
  const r = { ...base };
  let left = points;
  for (;;) {
    let best = null, bestScore = 0;
    for (const s of SLIDERS) {
      if (sl[s.key] >= MAX_SLIDER) continue;
      const cost = levelCost(sl[s.key] + 1);
      if (cost > left) continue;
      let v = 0;
      for (const k of s.stats) {
        if (r[k] >= 99) continue;
        v += value(k) * (r[k] >= 95 ? 0.5 : 1);
      }
      const score = v / cost;
      if (score > bestScore) { best = s; bestScore = score; }
    }
    if (!best) break;
    left -= levelCost(sl[best.key] + 1);
    sl[best.key]++;
    for (const k of best.stats) r[k] = Math.min(99, r[k] + 1);
  }
  return sl;
}

// ---------------------------------------------------------------- data access
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function politeFetch(url) {
  let last = 0;
  try { last = Number(fs.readFileSync(LASTFETCH_FILE, 'utf8')) || 0; } catch {}
  const wait = last + CRAWL_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(LASTFETCH_FILE, String(Date.now()));
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
async function cachedJson(file, url, refresh) {
  let fresh = false;
  try { fresh = Date.now() - fs.statSync(file).mtimeMs < STALE_MS; } catch {}
  if (!fresh || refresh) {
    try {
      const txt = await politeFetch(url);
      JSON.parse(txt);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, txt);
    } catch (e) {
      if (!fs.existsSync(file)) throw e;
      process.stderr.write(`warn: refresh of ${path.basename(file)} failed (${e.message}); using cached copy\n`);
    }
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const loadIndex = refresh => cachedJson(INDEX_FILE, `${BASE_URL}/search/player-index.json`, refresh);
const loadBoosts = refresh => cachedJson(BOOSTS_FILE, `${BASE_URL}/data/boosts.json`, refresh);

function grab(s, i, open = '{', close = '}') {
  let d = 0, ins = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (ins) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') ins = false; continue; }
    if (c === '"') ins = true;
    else if (c === open) d++;
    else if (c === close) { d--; if (d === 0) return s.slice(i, j + 1); }
  }
  return null;
}
const SKILL_NAME_OVERRIDES = {
  crossOverTurn: 'Chop Turn', stepOnSkillControl: 'Sole Control', longRangeDrive: 'Long-range Curler',
  hellTrick: 'Heel Trick', aerialForte: 'Aerial Fort', gkDirectDefending: 'GK Directing Defence', headingSkill: 'Heading',
};
const skillName = k => SKILL_NAME_OVERRIDES[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();

function parsePlayerHtml(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let rsc = '', m;
  while ((m = re.exec(html))) rsc += JSON.parse('"' + m[1] + '"');
  const pi = rsc.indexOf('{"baseStats":{');
  if (pi < 0) throw new Error('Could not find stats on page (layout changed or invalid player id)');
  const parse = s => JSON.parse(s, (k, v) => (v === '$undefined' ? undefined : v));
  const props = parse(grab(rsc, pi));
  const qi = rsc.indexOf('"player":{');
  const player = qi >= 0 ? parse(grab(rsc, qi + 9)) : {};
  const si = rsc.indexOf('playerSkills":[');
  const skills = si >= 0 ? parse(grab(rsc, si + 14, '[', ']')) : [];
  return {
    id: String(player.id ?? ''),
    name: player.name, team: player.team, league: player.league,
    position: props.position || player.position,
    additionalPositions: props.additionalPositions || [],
    playingStyle: props.playingStyle ?? player.playingStyle,
    playingStyleDefensive: props.playingStyleDefensive ?? player.playingStyleDefensive,
    height: props.height ?? player.height,
    weight: player.weight, age: player.age,
    weakFootAccuracy: props.weakFootAccuracy ?? player.weakFootAccuracy ?? 1,
    weakFootUsage: player.weakFootUsage,
    preferredFoot: player.preferredFoot,
    form: player.form, injuryResistance: player.injuryResistance,
    overallRating: player.overallRating,
    playerType: player.playerType,
    boostId: props.initialBoostLeftId ?? player.boostId ?? 0,
    boostId2: props.initialBoostRightId ?? player.boostId2 ?? 0,
    levelCap: player.levelCap ?? props.initialLevelCap ?? 23,
    baseStats: props.baseStats,
    skills: Array.isArray(skills) ? skills.filter(s => typeof s === 'string') : [],
    comSkills: Array.isArray(player.comSkills) ? player.comSkills : [],
  };
}

async function loadCard(id, { refresh, htmlFile } = {}) {
  if (htmlFile) return parsePlayerHtml(fs.readFileSync(htmlFile, 'utf8'));
  const file = path.join(PLAYER_CACHE, `${id}.json`);
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const card = parsePlayerHtml(await politeFetch(`${BASE_URL}/players/${id}`));
  if (!card.id) card.id = String(id);
  fs.mkdirSync(PLAYER_CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(card, null, 1));
  return card;
}

// ---------------------------------------------------------------- reporting
const CARD_TYPES = { 1: 'Standard', 2: 'Featured', 3: 'Trending', 4: 'Legend', 5: 'Epic', 6: 'Highlight', 7: 'Big Time', 8: 'Show Time' };
const STAT_LABEL = {
  offensiveAwareness: 'Off. Awareness', ballControl: 'Ball Control', dribbling: 'Dribbling', tightPossession: 'Tight Possession',
  lowPass: 'Low Pass', loftedPass: 'Lofted Pass', finishing: 'Finishing', heading: 'Heading', setPieceTaking: 'Set Piece',
  curl: 'Curl', speed: 'Speed', acceleration: 'Acceleration', kickingPower: 'Kicking Power', jump: 'Jump',
  physicalContact: 'Phys. Contact', balance: 'Balance', stamina: 'Stamina', defensiveAwareness: 'Def. Awareness',
  ballWinning: 'Ball Winning', aggression: 'Aggression', defensiveEngagement: 'Def. Engagement',
  gkAwareness: 'GK Awareness', gkCatching: 'GK Catching', gkClearing: 'GK Clearing', gkReflexes: 'GK Reflexes', gkReach: 'GK Reach',
};

function evaluate(card, sliders, pos, boostList, points) {
  const trained = applyProgression(card.baseStats, sliders);
  const boosted = finalStats(card.baseStats, sliders, boostList);
  const h = card.height, w = card.weakFootAccuracy;
  return {
    sliders, pointsUsed: pointsUsed(sliders), pointsAvailable: points,
    trainedOvr: ovr(trained, pos, h, w), boostedOvr: ovr(boosted, pos, h, w),
    boostedOvrDec: ovrDec(boosted, pos, h, w), stats: boosted,
  };
}

function buildCard(card, boosts, opts) {
  const pos = (opts.pos || card.position || '').toUpperCase();
  if (POSITION_COLUMN[pos] === undefined) throw new Error(`Unknown position "${pos}"`);
  const level = opts.level ?? card.levelCap ?? 23;
  const points = availablePoints(level);
  const boostList = resolveBoosts(card, boosts);
  const h = card.height, w = card.weakFootAccuracy;
  const base = card.baseStats;

  const mb = maxButtonSliders(base, pos, points);
  const cm = computeMaxSliders(base, pos, h, w, points);
  const mbEval = evaluate(card, mb, pos, boostList, points);
  const cmEval = evaluate(card, cm, pos, boostList, points);
  const maxOvr = cmEval.boostedOvrDec > mbEval.boostedOvrDec ? { ...cmEval, method: 'computeMaxSliders' } : { ...mbEval, method: 'efhub Max button' };

  const att = lookupStyle(ATTACK_STYLE_WEIGHTS, opts.style || card.playingStyle);
  const def = lookupStyle(DEFENSE_STYLE_WEIGHTS, opts.defStyle || card.playingStyleDefensive);
  const balance = opts.balance ?? 0.5;
  const psSliders = playstyleSliders(base, pos, points, att, def, balance);
  const playstyle = { ...evaluate(card, psSliders, pos, boostList, points), attackStyle: att?.name || null, defenseStyle: def?.name || null, balance };

  const positions = [{ position: card.position, familiarity: 'registered' }, ...card.additionalPositions]
    .filter((p, i, a) => a.findIndex(q => q.position === p.position) === i)
    .map(p => ({
      position: p.position, familiarity: p.familiarity,
      baseOvr: ovr(applyBoost(applyBoost(base, boostList[0]), boostList[1]), p.position, h, w),
      maxOvrBuild: ovr(finalStats(base, maxOvr.sliders, boostList), p.position, h, w),
      playstyleBuild: ovr(finalStats(base, psSliders, boostList), p.position, h, w),
    }));

  return {
    card: {
      id: card.id, name: card.name, team: card.team, type: CARD_TYPES[card.playerType] || String(card.playerType ?? '?'),
      position: card.position, evaluatedAt: pos, height: h, weakFootAccuracy: w, weakFootUsage: card.weakFootUsage,
      playingStyle: card.playingStyle, playingStyleDefensive: card.playingStyleDefensive,
      levelCap: card.levelCap, buildLevel: level, points,
      baseOvr: ovr(base, pos, h, w),
      boosts: boostList.map(b => b.name), skills: card.skills.map(skillName), comSkills: card.comSkills,
    },
    maxOvr, playstyle, positions, baseStats: base,
  };
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function printReport(r) {
  const c = r.card;
  const L = [];
  L.push(`${c.name} (${c.team || '?'}) — ${c.type} ${c.position}  [id ${c.id}]`);
  L.push(`Style: ${c.playingStyle || '-'} / ${c.playingStyleDefensive || '-'}   Height ${c.height}cm   WF acc ${c.weakFootAccuracy}`);
  L.push(`Boosts: ${c.boosts.join(', ') || 'none'}`);
  L.push(`Skills: ${c.skills.join(', ') || '-'}`);
  L.push(`Level ${c.buildLevel}/${c.levelCap} → ${c.points} progression points   (evaluated at ${c.evaluatedAt})`);
  if (c.points === 0) L.push('NOTE: this card is already at max level (1/1) — no trainable points.');
  L.push('');
  L.push(`${pad('', 26)}${lpad('MAX OVR', 10)}${lpad('PLAYSTYLE', 12)}`);
  for (const s of SLIDERS) {
    const a = r.maxOvr.sliders[s.key], b = r.playstyle.sliders[s.key];
    if (!a && !b) continue;
    L.push(`${pad(s.label, 26)}${lpad(a, 10)}${lpad(b, 12)}`);
  }
  L.push(`${pad('Points used', 26)}${lpad(`${r.maxOvr.pointsUsed}/${c.points}`, 10)}${lpad(`${r.playstyle.pointsUsed}/${c.points}`, 12)}`);
  L.push(`${pad(`OVR @${c.evaluatedAt} (base ${c.baseOvr})`, 26)}${lpad(r.maxOvr.boostedOvr, 10)}${lpad(r.playstyle.boostedOvr, 12)}`);
  L.push(`${pad('  decimal', 26)}${lpad(r.maxOvr.boostedOvrDec.toFixed(2), 10)}${lpad(r.playstyle.boostedOvrDec.toFixed(2), 12)}`);
  L.push('');
  L.push(`Playstyle mode tuned for: ${r.playstyle.attackStyle || '(no style weights — positional only)'}${r.playstyle.defenseStyle ? ' + ' + r.playstyle.defenseStyle : ''}, balance ${r.playstyle.balance}`);
  L.push(`Max OVR mode chosen from: ${r.maxOvr.method}`);
  L.push('');
  L.push('Key stats (base → max OVR / playstyle, incl. boosts):');
  const changed = Object.keys(STAT_LABEL).filter(k => (r.maxOvr.stats[k] ?? 0) !== (r.baseStats[k] ?? 0) || (r.playstyle.stats[k] ?? 0) !== (r.baseStats[k] ?? 0));
  for (const k of changed) {
    if (/^gk/.test(k) && !/GK/.test(c.position)) continue;
    L.push(`  ${pad(STAT_LABEL[k], 18)}${lpad(r.baseStats[k], 3)} → ${lpad(r.maxOvr.stats[k], 3)} / ${lpad(r.playstyle.stats[k], 3)}`);
  }
  L.push('');
  L.push('Position OVRs (base+boost → max OVR / playstyle):');
  for (const p of r.positions) {
    L.push(`  ${pad(p.position, 4)} ${pad(p.familiarity === 'registered' ? '(main)' : `(fam ${p.familiarity})`, 9)} ${lpad(p.baseOvr, 3)} → ${lpad(p.maxOvrBuild, 3)} / ${lpad(p.playstyleBuild, 3)}`);
  }
  console.log(L.join('\n'));
}

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (['json', 'refresh'].includes(k)) o[k] = true;
    else o[k] = argv[++i];
  }
  return o;
}
const deaccent = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

async function cmdSearch(args) {
  const q = deaccent(args._.slice(1).join(' ')).trim();
  if (!q) throw new Error('usage: search <name>');
  const idx = await loadIndex(args.refresh);
  const terms = q.split(/\s+/);
  const hits = idx.filter(e => { const n = deaccent(e.e); return terms.every(t => n.includes(t)); })
    .sort((a, b) => (b.o || 0) - (a.o || 0))
    .slice(0, Number(args.limit) || 25);
  if (!hits.length) return console.log(args.json ? '[]' : `No cards found for "${q}".`);
  const detailN = Math.min(Number(args.details) || 0, hits.length);
  const details = [];
  for (let i = 0; i < detailN; i++) {
    try { details[i] = await loadCard(String(hits[i].i)); }
    catch (e) { process.stderr.write(`warn: could not load ${hits[i].i}: ${e.message}\n`); }
  }
  const info = (h, i) => {
    const c = details[i];
    return c ? { team: c.team, type: CARD_TYPES[c.playerType] || c.playerType, position: c.position, style: c.playingStyle, baseOvr: ovr(c.baseStats, c.position, c.height, c.weakFootAccuracy), levelCap: c.levelCap } : {};
  };
  if (args.json) return console.log(JSON.stringify(hits.map((h, i) => ({ id: String(h.i), name: h.e, listedOvr: h.o, ...info(h, i), url: `${BASE_URL}/players/${h.i}` })), null, 1));
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i], d = info(h, i);
    const extra = d.type ? `  | ${d.type} ${d.position} (${d.style || '-'}), ${d.team}, base ${d.baseOvr}, Lv cap ${d.levelCap}` : '';
    console.log(`${pad(h.i, 18)} ${lpad(h.o ?? '?', 4)}  ${h.e}${extra}`);
  }
}

async function cmdBuild(args) {
  const raw = args._[1];
  if (!raw && !args.html) throw new Error('usage: build <id|url> [--level N] [--pos POS] [--style "..."] [--def-style "..."] [--balance 0..1] [--json] [--refresh]');
  const id = raw ? (String(raw).match(/(\d{6,})/) || [])[1] : null;
  if (raw && !id) throw new Error(`Could not read a player id from "${raw}" — use "search <name>" first`);
  const [boosts, card] = [await loadBoosts(args.refresh), await loadCard(id, { refresh: args.refresh, htmlFile: args.html })];
  const opts = {
    level: args.level !== undefined ? Number(args.level) : undefined,
    pos: args.pos, style: args.style, defStyle: args['def-style'],
    balance: args.balance !== undefined ? Math.min(1, Math.max(0, Number(args.balance))) : undefined,
  };
  const r = buildCard(card, boosts, opts);
  if (args.json) console.log(JSON.stringify(r, null, 1));
  else printReport(r);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'search') return cmdSearch(args);
  if (cmd === 'build') return cmdBuild(args);
  if (cmd === 'styles') return console.log(`Attacking: ${Object.keys(ATTACK_STYLE_WEIGHTS).join(', ')}\nDefensive: ${Object.keys(DEFENSE_STYLE_WEIGHTS).join(', ')}`);
  console.log(`eFootball builder (data: efhub.com / efootballhub.net)
  node efhub_builder.js search <name> [--limit N] [--details N] [--json]
  node efhub_builder.js build <id|url> [--level N] [--pos POS] [--style "Prolific Winger"] [--def-style "..."] [--balance 0..1] [--json] [--refresh]
  node efhub_builder.js styles`);
}

if (isNode && require.main === module) {
  // Corporate TLS proxies re-sign certificates with a CA that only lives in the OS store.
  const needsSystemCa = !process.execArgv.includes('--use-system-ca') && !process.env.EFHUB_CHILD
    && process.allowedNodeEnvironmentFlags.has('--use-system-ca');
  if (needsSystemCa) {
    const r = require('child_process').spawnSync(process.execPath, ['--use-system-ca', __filename, ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, EFHUB_CHILD: '1' } });
    process.exit(r.status ?? 1);
  }
  main().catch(e => { console.error('error: ' + (e.cause?.code ? `${e.message} (${e.cause.code})` : e.message)); process.exit(1); });
}
const api = {
  ovr, ovrDec, applyProgression, computeMaxSliders, maxButtonSliders, playstyleSliders, parsePlayerHtml, buildCard, availablePoints,
  SLIDERS, MAX_SLIDER, levelCost, cumulativeCost, pointsUsed, zeroSliders, resolveBoosts, applyBoost, finalStats,
  loadBoosts, loadCard, loadIndex, politeFetch, cachedJson, grab, skillName, deaccent,
  STAT_LABEL, CARD_TYPES, ATTACK_STYLE_WEIGHTS, DEFENSE_STYLE_WEIGHTS, lookupStyle, POSITION_COLUMN, STAT_OFFSET, WEIGHTS,
  BASE_URL, CACHE, UA,
};
if (isNode) module.exports = api; else root.EFB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
