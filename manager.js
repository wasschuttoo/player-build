'use strict';
// Manager-aware build optimizer. Pipeline (efhub order): sliders (cap 99) -> manager
// tactic proficiency multiplier (cap 99) -> +1 per manager boost stat -> card boosts.
// Node: require()d by server.js. Browser: loads after efhub_builder.js and exposes globalThis.EFM.
(function (root) {
const isNode = typeof module === 'object' && !!module && !!module.exports && typeof require === 'function';
const B = isNode ? require('./efhub_builder.js') : root.EFB;

const MULT = [.65, .6675, .685, .7025, .72, .7375, .755, .7725, .79, .8075, .825, .8425, .86, .8775, .895, .9125, .93, .9475, .965, .9825, 1, 1, 1.01163, 1.01389, 1.015625, 1.01755, 1.01925, 1.02125, 1.02275, 1.0244, 1.026, 1.02725, 1.029, 1.03, 1.03196, 1.03275, 1.03375, 1.034091, 1.0355, 1.036, 1.0365, 1.036, 1.036, 1.036, 1.036, 1.036, 1.036, 1.036, 1.036, 1.036, 1.036];
const mSkill = p => MULT[Math.min(p >= 50 ? p - 50 : 0, MULT.length - 1)];
const mgrStat = (s, m) => (m === 1 ? s : Math.min(99, s + Math.floor(s * (m - 1))));

const ABILITY_MAP = ['offensiveAwareness', 'ballControl', 'tightPossession', 'dribbling', 'lowPass', 'loftedPass',
  'finishing', 'setPieceTaking', 'curl', 'heading', 'defensiveAwareness', 'defensiveEngagement', 'ballWinning',
  'aggression', 'kickingPower', 'speed', 'acceleration', 'balance', 'physicalContact', 'jump', 'gkAwareness',
  'gkCatching', 'gkClearing', 'gkReflexes', 'gkReach', 'stamina'];

const TACTICS = [
  { key: 'PossessionGame', label: 'Possession Game' },
  { key: 'QuickCounter', label: 'Quick Counter' },
  { key: 'LongBallCounter', label: 'Long Ball Counter' },
  { key: 'OutWide', label: 'Out Wide' },
  { key: 'LongBall', label: 'Long Ball' },
  { key: 'OverLoad', label: 'Overload' },
];

// Heuristic emphasis per team tactic (what the tactic asks of players). Not from efhub.
const TACTIC_WEIGHTS = {
  PossessionGame: { lowPass: 3, ballControl: 3, tightPossession: 2, dribbling: 2, offensiveAwareness: 1, loftedPass: 1, balance: 1, stamina: 1 },
  QuickCounter: { speed: 3, acceleration: 3, offensiveAwareness: 2, finishing: 2, stamina: 2, ballWinning: 1, aggression: 1, defensiveEngagement: 1 },
  LongBallCounter: { speed: 3, acceleration: 2, offensiveAwareness: 2, finishing: 2, loftedPass: 2, physicalContact: 2, kickingPower: 1, defensiveAwareness: 1 },
  OutWide: { speed: 3, loftedPass: 3, acceleration: 2, curl: 2, dribbling: 2, heading: 2, stamina: 1 },
  LongBall: { physicalContact: 3, heading: 3, loftedPass: 3, jump: 2, kickingPower: 1, offensiveAwareness: 1 },
  OverLoad: { ballControl: 2, tightPossession: 2, lowPass: 2, dribbling: 2, offensiveAwareness: 2, balance: 1, physicalContact: 1 },
};

const ALL_STATS = Object.keys(B.STAT_OFFSET);

function normalizeManager(m) {
  if (!m) return null;
  const skills = {};
  for (const t of TACTICS) skills[t.key] = Number(m.skills?.[t.key] ?? m.skills?.[t.key[0].toLowerCase() + t.key.slice(1)] ?? 0) || 0;
  if (!skills.OverLoad && m.skills?.overload) skills.OverLoad = Number(m.skills.overload) || 0;
  const boosts = (m.boosts || []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < ABILITY_MAP.length);
  return { id: m.id ?? null, name: m.name || 'Custom', skills, boosts };
}

function bestTactic(mgr) {
  if (!mgr) return TACTICS[0].key;
  return TACTICS.reduce((a, t) => (mgr.skills[t.key] > mgr.skills[a] ? t.key : a), TACTICS[0].key);
}

function makeContext(card, boosts, opts = {}) {
  const pos = String(opts.pos || card.position || '').toUpperCase();
  if (B.POSITION_COLUMN[pos] === undefined) throw new Error(`Unknown position "${pos}"`);
  const cap = card.levelCap || 1;
  const level = Math.max(1, Math.min(cap, Number(opts.level) || cap));
  const points = B.availablePoints(level);
  const mgr = normalizeManager(opts.manager);
  const tactic = TACTICS.some(t => t.key === opts.tactic) ? opts.tactic : bestTactic(mgr);
  const prof = mgr ? mgr.skills[tactic] : null;
  const m = mgr ? mSkill(prof) : 1;
  const mgrBonus = {};
  if (mgr) for (const id of mgr.boosts) { const k = ABILITY_MAP[id]; mgrBonus[k] = (mgrBonus[k] || 0) + 1; }
  const boostList = B.resolveBoosts(card, boosts);
  const cardBonus = {};
  for (const b of boostList) for (const [k, v] of Object.entries(b.stats || {})) if (v) cardBonus[k] = (cardBonus[k] || 0) + v;
  const isGK = pos === 'GK';
  const sliders = isGK ? B.SLIDERS : B.SLIDERS.slice(0, 7);
  return { card, pos, col: B.POSITION_COLUMN[pos], level, points, mgr, tactic, prof, m, mgrBonus, cardBonus, boostList, isGK, sliders };
}

function finalOf(ctx, k, trained) {
  return mgrStat(Math.min(99, trained), ctx.m) + (ctx.mgrBonus[k] || 0) + (ctx.cardBonus[k] || 0);
}

function finalStats(ctx, sl) {
  const trained = B.applyProgression(ctx.card.baseStats, sl);
  const out = {};
  for (const k of ALL_STATS) out[k] = finalOf(ctx, k, trained[k] ?? 0);
  return out;
}

// Per-stat objective terms (separable).
const r25 = x => (x > 25 ? x - 25 : 0);
function ratingTerm(ctx, k, v) { return (B.WEIGHTS[B.STAT_OFFSET[k] + ctx.col] ?? 0) * r25(v); }

function tacticValueFn(ctx) {
  const col = ctx.col;
  const colMax = Math.max(...ALL_STATS.map(k => B.WEIGHTS[B.STAT_OFFSET[k] + col] ?? 0)) || 1;
  const att = B.lookupStyle(B.ATTACK_STYLE_WEIGHTS, ctx.card.playingStyle);
  const def = B.lookupStyle(B.DEFENSE_STYLE_WEIGHTS, ctx.card.playingStyleDefensive);
  const tw = TACTIC_WEIGHTS[ctx.tactic] || {};
  const aw = att?.weights || {}, dw = def?.weights || {};
  const val = {};
  for (const k of ALL_STATS) {
    const posW = (B.WEIGHTS[B.STAT_OFFSET[k] + col] ?? 0) / colMax;
    const styleW = ((aw[k] || 0) + 0.5 * (dw[k] || 0)) / 3;
    val[k] = 0.4 * posW + 0.3 * styleW + 0.3 * ((tw[k] || 0) / 3);
  }
  return { val, attack: att?.name || null, defense: def?.name || null };
}

// Groups of sliders whose stats overlap (jump is in Aerial Strength and GK 1).
function groups(ctx) {
  const list = ctx.sliders.map(s => [s]);
  const a = list.findIndex(g => g[0].key === 'aerialStrength');
  const g1 = list.findIndex(g => g[0].key === 'gk1');
  if (a >= 0 && g1 >= 0) { list[a] = [list[a][0], list[g1][0]]; list.splice(g1, 1); }
  return list;
}

function groupOptions(ctx, group, termFn, constraint) {
  const base = ctx.card.baseStats;
  const stats = [...new Set(group.flatMap(s => s.stats))];
  const opts = [];
  const combos = group.length === 1
    ? Array.from({ length: B.MAX_SLIDER + 1 }, (_, n) => [n])
    : Array.from({ length: (B.MAX_SLIDER + 1) ** 2 }, (_, i) => [Math.floor(i / (B.MAX_SLIDER + 1)), i % (B.MAX_SLIDER + 1)]);
  for (const ns of combos) {
    const cost = ns.reduce((t, n) => t + B.cumulativeCost(n), 0);
    if (cost > ctx.points) continue;
    let val = 0; const fin = {};
    for (const k of stats) {
      let add = 0;
      group.forEach((s, i) => { if (s.stats.includes(k)) add += ns[i]; });
      fin[k] = finalOf(ctx, k, (base[k] ?? 0) + add);
      val += termFn(k, fin[k]);
    }
    if (constraint && !constraint(fin, ns)) continue;
    opts.push({ ns, cost, val });
  }
  return opts;
}

// Exact multiple-choice knapsack over slider groups.
function solve(ctx, termFn, constraintFor) {
  const P = ctx.points;
  const gs = groups(ctx);
  let dp = new Array(P + 1).fill(0);
  const choice = [];
  for (const g of gs) {
    const opts = groupOptions(ctx, g, termFn, constraintFor?.(g));
    if (!opts.length) return null;
    const nd = new Array(P + 1).fill(-Infinity);
    const pick = new Array(P + 1).fill(-1);
    for (let b = 0; b <= P; b++) {
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        if (o.cost > b || dp[b - o.cost] === -Infinity) continue;
        const v = dp[b - o.cost] + o.val;
        if (v > nd[b] + 1e-12) { nd[b] = v; pick[b] = i; }
      }
    }
    choice.push({ g, opts, pick });
    dp = nd;
  }
  let b = 0;
  for (let i = 1; i <= P; i++) if (dp[i] > dp[b] + 1e-12) b = i;
  const sl = B.zeroSliders();
  for (let gi = choice.length - 1; gi >= 0; gi--) {
    const { g, opts, pick } = choice[gi];
    const o = opts[pick[b]];
    g.forEach((s, i) => { sl[s.key] = o.ns[i]; });
    b -= o.cost;
  }
  return sl;
}

function describe(ctx, sl, extra) {
  const stats = finalStats(ctx, sl);
  const h = ctx.card.height, w = ctx.card.weakFootAccuracy;
  const cardStats = finalStats({ ...ctx, m: 1, mgrBonus: {} }, sl);
  return {
    ...extra,
    sliders: ctx.sliders.map(s => ({ key: s.key, label: s.label, value: sl[s.key] })),
    pointsUsed: B.pointsUsed(sl),
    ovr: B.ovr(stats, ctx.pos, h, w),
    ovrDec: B.ovrDec(stats, ctx.pos, h, w),
    cardOvr: B.ovr(cardStats, ctx.pos, h, w),
    stats,
  };
}

function maxOvr(ctx, tv) {
  return solve(ctx, (k, v) => ratingTerm(ctx, k, v) + 1e-4 * tv.val[k] * v);
}

function tacticBuild(ctx, tv) {
  return solve(ctx, (k, v) => tv.val[k] * v + 1e-9 * ratingTerm(ctx, k, v));
}

function maxStat(ctx, tv, stat) {
  const base = ctx.card.baseStats;
  const owners = ctx.sliders.filter(s => s.stats.includes(stat));
  if (!owners.length) return { sl: maxOvr(ctx, tv), reachable: false, best: finalStats(ctx, B.zeroSliders())[stat] };
  const gs = groups(ctx);
  const g = gs.find(gr => gr.some(s => s.stats.includes(stat)));
  let best = -Infinity;
  for (const o of groupOptions(ctx, g, () => 0)) {
    let add = 0; g.forEach((s, i) => { if (s.stats.includes(stat)) add += o.ns[i]; });
    best = Math.max(best, finalOf(ctx, stat, (base[stat] ?? 0) + add));
  }
  const sl = solve(ctx, (k, v) => ratingTerm(ctx, k, v) + 1e-4 * tv.val[k] * v,
    gr => (gr[0].key === g[0].key ? fin => fin[stat] >= best : null));
  return { sl, reachable: true, best };
}

function buildAll(card, boosts, opts = {}) {
  const ctx = makeContext(card, boosts, opts);
  const tv = tacticValueFn(ctx);
  const stat = ALL_STATS.includes(opts.stat) ? opts.stat : 'finishing';
  const h = card.height, w = card.weakFootAccuracy;

  const oSl = maxOvr(ctx, tv);
  const tSl = tacticBuild(ctx, tv);
  const ms = maxStat(ctx, tv, stat);

  const builds = [
    describe(ctx, oSl, { key: 'ovr', title: 'Max OVR' }),
    describe(ctx, tSl, { key: 'tactic', title: `${TACTICS.find(t => t.key === ctx.tactic).label} build`, weights: { attack: tv.attack, defense: tv.defense, tactic: ctx.tactic } }),
    describe(ctx, ms.sl, { key: 'stat', title: `Max ${B.STAT_LABEL[stat]}`, stat, reachable: ms.reachable }),
  ];

  const untrained = finalStats(ctx, B.zeroSliders());
  const shown = ALL_STATS.filter(k => ctx.isGK || !k.startsWith('gk'));
  const statRows = shown.map(k => ({
    key: k, label: B.STAT_LABEL[k], base: card.baseStats[k] ?? 0, untrained: untrained[k],
    values: builds.map(b => b.stats[k]),
  }));

  return {
    card: {
      id: card.id, name: card.name, team: card.team, league: card.league,
      type: B.CARD_TYPES[card.playerType] || String(card.playerType ?? ''),
      position: card.position, positions: [card.position, ...(card.additionalPositions || []).map(p => p.position)].filter((p, i, a) => p && a.indexOf(p) === i),
      playingStyle: card.playingStyle, playingStyleDefensive: card.playingStyleDefensive,
      height: h, levelCap: card.levelCap, baseOvr: B.ovr(card.baseStats, ctx.pos, h, w),
      cardBoosts: ctx.boostList.map(b => b.name),
    },
    pos: ctx.pos, level: ctx.level, points: ctx.points, stat,
    manager: ctx.mgr && {
      id: ctx.mgr.id, name: ctx.mgr.name, tactic: ctx.tactic, proficiency: ctx.prof, multiplier: ctx.m,
      boosts: ctx.mgr.boosts.map(id => ({ id, stat: ABILITY_MAP[id], label: B.STAT_LABEL[ABILITY_MAP[id]] })),
      skills: ctx.mgr.skills,
    },
    tactic: ctx.tactic,
    builds,
    statRows,
  };
}

// Fast rating for squad slots: Max OVR build at a given position under a manager + playstyle.
function quickOvr(card, boosts, opts = {}) {
  const ctx = makeContext(card, boosts, opts);
  const d = describe(ctx, maxOvr(ctx, tacticValueFn(ctx)), {});
  return { ovr: d.ovr, ovrDec: d.ovrDec, cardOvr: d.cardOvr, pos: ctx.pos, tactic: ctx.tactic, level: ctx.level };
}

const positionsOf = card => [card.position, ...(card.additionalPositions || []).map(p => p.position)].filter((p, i, a) => p && a.indexOf(p) === i);

const api = { MULT, mSkill, mgrStat, ABILITY_MAP, TACTICS, TACTIC_WEIGHTS, normalizeManager, bestTactic, makeContext, finalStats, buildAll, quickOvr, positionsOf };
if (isNode) module.exports = api; else root.EFM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
