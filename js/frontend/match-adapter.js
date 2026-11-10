/**
 * Thin match adapter for the v4 front end.
 *
 * Talks to the published match API (docs/MATCH-API.md, e93c4e2+):
 *   game.startMatch(cfg) returns a MatchHandle
 *   events: matchstart, operatorpick, roundstart, phase, roundend, matchend, stats
 *
 * startMatch cfg (exact): map, mode, difficulty, side, operator, bestOf,
 * sitePair, loadout, prepTime, actionTime, plantTime, defuseTime, bombTime,
 * seed, godMode, skipOperatorPick, pickTimeout, skipMatchCard.
 *
 * roundend: { round, winner, reason, clutch, flawless, score:{attack,defend,need}, stats, highlights }
 * matchend: { winner, score:{attack,defend,need}, stats, mvp (player row), highlights }
 * stats:    { players:[{id,name,opId,team,bot,k,a,d,score,headshots,plants,defuses,downs,revives,points}], mvpId, highlights:[{kind,who,note}] }
 *
 * When startMatch is missing on this worktree, falls back to Game.start()
 * and wraps _endRound / quit so screens stay testable. No in-match edits.
 * Re-check with: git show wip/v4-gameplay:docs/MATCH-API.md
 */
import { mapById, modeById, FIRETEAM_BOTS, RIVAL_BOTS } from './data.js?v=iv-4.1.1';
import { getOp, listSide } from '../operators.js?v=iv-4.1.1';

const CHECK_MS = 15000;
let _apiText = null;
let _apiCheckedAt = 0;
let _wrapped = false;

export async function peekMatchApi() {
  const now = Date.now();
  if (now - _apiCheckedAt < CHECK_MS && _apiText !== null) return _apiText;
  _apiCheckedAt = now;
  try {
    const r = await fetch('docs/MATCH-API.md?t=' + now, { cache: 'no-store' });
    if (r.ok) {
      _apiText = await r.text();
      return _apiText;
    }
  } catch {}
  _apiText = '';
  return '';
}

export function hasPublishedApi() {
  return !!( _apiText && _apiText.length > 40);
}

/** Build the start payload both the stub and the future API understand. */
export function buildStartOpts(sel) {
  const mode = modeById(sel.mode);
  const map = mapById(sel.map);
  return {
    map: map.id,
    mode: mode.id,
    difficulty: sel.difficulty || 'veteran',
    side: sel.side || 'attack',
    operator: sel.operator,
    bestOf: sel.bestOf || mode.bestOf,
    kind: mode.kind,
    practiceKind: sel.practiceKind || null, // 'range' | 'explore'
    sitePair: sel.sitePair,
    loadout: sel.loadout,
    prepTime: sel.prepTime,
    actionTime: sel.actionTime,
    plantTime: sel.plantTime,
    defuseTime: sel.defuseTime,
    bombTime: sel.bombTime,
    seed: sel.seed,
    pickTimeout: sel.pickTimeout,
  };
}

/**
 * Start a match through the current game, or the published API when present.
 * Returns a promise that resolves once the match is running (or immediately
 * if the caller asked for a mocked run).
 */
export async function startMatch(game, sel, hooks = {}) {
  const opts = buildStartOpts(sel);
  const api = await peekMatchApi();
  bindHooks(game, hooks);

  if (hooks.mock) {
    // Screens stay in charge; no world load.
    return { mocked: true, opts };
  }

  if (game.settings) {
    game.settings.side = opts.side;
    game.settings.difficulty = opts.difficulty;
    game.settings.bestOf = opts.kind === 'practice' ? 1 : opts.bestOf;
    if (opts.operator) game.settings.operator[opts.side] = opts.operator;
  }

  const cfg = {
    map: opts.map || 'halcyon',
    mode: opts.kind === 'practice' ? 'bomb-rush' : (opts.mode || 'bomb-rush'),
    difficulty: opts.difficulty,
    side: opts.side,
    operator: opts.operator,
    bestOf: opts.kind === 'practice' ? 1 : opts.bestOf,
    godMode: opts.kind === 'practice' || !!sel.godMode,
    skipMatchCard: sel.skipMatchCard !== false,
    skipOperatorPick: sel.skipOperatorPick !== false,
  };
  // Pass through optional official fields only when the caller set them.
  for (const k of ['sitePair', 'loadout', 'prepTime', 'actionTime', 'plantTime', 'defuseTime', 'bombTime', 'seed', 'pickTimeout']) {
    if (opts[k] != null) cfg[k] = opts[k];
  }

  // Published API (wip/v4-gameplay docs/MATCH-API.md): Game.startMatch + events.
  if (typeof game.startMatch === 'function') {
    const match = await game.startMatch(cfg);
    bindPublishedEvents(game, match, hooks);
    return { mocked: false, opts, via: 'startMatch', match };
  }

  if (api && typeof window.__MatchAPI?.start === 'function') {
    const match = await window.__MatchAPI.start(cfg);
    bindPublishedEvents(game, match, hooks);
    return { mocked: false, opts, via: '__MatchAPI', match };
  }

  // Fallback: current Game.start() on this branch (Halcyon Press bomb).
  await game.start({
    mode: 'bomb',
    side: cfg.side,
    difficulty: cfg.difficulty,
    bestOf: cfg.bestOf,
    map: cfg.map,
    atkOp: cfg.side === 'attack' ? cfg.operator : undefined,
    defOp: cfg.side === 'defend' ? cfg.operator : undefined,
    godMode: cfg.godMode,
  });
  return { mocked: false, opts, via: 'game.start' };
}


function bindPublishedEvents(game, match, hooks) {
  const emitEnd = (e) => {
    try { hooks.onMatchEnd?.(snapshotFromApi(e, game)); } catch (err) { console.warn('onMatchEnd', err); }
  };
  const emitRound = (e) => {
    try { hooks.onRoundEnd?.(roundFromApi(e, game)); } catch (err) { console.warn('onRoundEnd', err); }
  };
  const emitStats = (e) => {
    try { hooks.onStats?.(e); } catch (err) { console.warn('onStats', err); }
  };
  match?.on?.('roundend', emitRound);
  match?.on?.('matchend', emitEnd);
  match?.on?.('stats', emitStats);
  if (typeof game.onMatchEvent === 'function') {
    game.onMatchEvent('roundend', emitRound);
    game.onMatchEvent('matchend', emitEnd);
    game.onMatchEvent('stats', emitStats);
  }
}

/** Official roundend payload plus a UI-friendly alias of the same numbers. */
export function roundFromApi(e, game) {
  const score = e?.score || {};
  return {
    round: e?.round ?? game?.round?.n ?? 0,
    winner: e?.winner,
    reason: e?.reason,
    clutch: !!e?.clutch,
    flawless: !!e?.flawless,
    score: {
      attack: score.attack ?? 0,
      defend: score.defend ?? 0,
      need: score.need ?? game?.round?.need ?? 2,
    },
    stats: e?.stats || null,
    highlights: e?.highlights || e?.stats?.highlights || [],
    why: e?.reason,
    scoreAtk: score.attack ?? 0,
    scoreDef: score.defend ?? 0,
    n: e?.round ?? game?.round?.n ?? 0,
  };
}

export function snapshotFromApi(e, game) {
  if ((!e?.stats?.players || !e.stats.players.length) && game?._matchEndSnapshot) {
    e = game._matchEndSnapshot;
  }
  const officialStats = e?.stats || {};
  const players = officialStats.players || e?.players || [];
  const mvpRow = (e?.mvp && typeof e.mvp === 'object' && e.mvp.id)
    ? e.mvp
    : players.find(p => p.id === (officialStats.mvpId || e?.mvpId)) || null;
  const highlights = e?.highlights || officialStats.highlights || [];
  const rows = players.map(p => normalizePlayer(p, game));
  const side = e?.side || game?.player?.team || 'attack';
  const you = rows.find(r => r.you) || rows[0];
  const winner = e?.winner;
  const scoreAtk = e?.score?.attack ?? game?.round?.scoreAtk ?? 0;
  const scoreDef = e?.score?.defend ?? game?.round?.scoreDef ?? 0;
  const need = e?.score?.need ?? game?.round?.need ?? 2;
  const mvpId = mvpRow?.id || officialStats.mvpId || e?.mvpId;
  return {
    // Official matchend fields (drop-in with docs/MATCH-API.md).
    winner,
    score: { attack: scoreAtk, defend: scoreDef, need },
    stats: {
      players: players.map(p => officialPlayer(p)),
      mvpId,
      highlights,
    },
    mvp: mvpRow ? officialPlayer(mvpRow) : null,
    highlights,
    // UI convenience (derived from the official payload).
    won: winner === side,
    scoreAtk, scoreDef, need,
    map: e?.map || game?.cfg?.map || 'halcyon',
    mode: e?.mode || game?.cfg?.mode || 'bomb-rush',
    side, rows,
    mvpId,
    player: you,
    elims: you?.k || 0,
    assists: you?.a || 0,
    deaths: you?.d || 0,
    headshots: you?.headshots || you?.hs || 0,
    roundsWon: side === 'attack' ? scoreAtk : scoreDef,
    roundsPlayed: scoreAtk + scoreDef,
    isMvp: !!(you && mvpId === you.id),
  };
}

function officialPlayer(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: (p.name || p.opId || 'OP').toString(),
    opId: p.opId,
    team: p.team,
    bot: p.bot !== false && p.bot !== undefined ? !!p.bot : !(p.id === 'player' || p.you),
    k: p.k || 0,
    a: p.a || 0,
    d: p.d || 0,
    score: p.score || 0,
    headshots: p.headshots || p.hs || 0,
    plants: p.plants || 0,
    defuses: p.defuses || 0,
    downs: p.downs || 0,
    revives: p.revives || 0,
    points: p.points || p.score || 0,
  };
}

function normalizePlayer(p, game) {
  const o = officialPlayer(p);
  const you = p.you === true || p.bot === false || p.id === 'player' || p.id === 'you'
    || !!(game?.player && p.opId === game.player.opId && !p.bot && (p.id === game.player.id || p.id === 'player' || p.id?.startsWith?.('you')));
  return {
    ...o,
    name: o.name.toUpperCase(),
    opName: p.opName || o.opId,
    you,
    hs: o.headshots,
    callsign: p.callsign || o.name.toUpperCase(),
  };
}

export function bindHooks(game, hooks = {}) {
  if (!game || _wrapped) {
    game && (game.__feHooks = hooks);
    return;
  }
  _wrapped = true;
  game.__feHooks = hooks;

  const endRound = game._endRound?.bind(game);
  if (endRound) {
    game._endRound = (winner, why) => {
      endRound(winner, why);
      const h = game.__feHooks || {};
      try { h.onRoundEnd?.(roundSnapshot(game, winner, why)); } catch (e) { console.warn('onRoundEnd', e); }
      if (game.ended) {
        try { h.onMatchEnd?.(matchSnapshot(game)); } catch (e) { console.warn('onMatchEnd', e); }
      }
    };
  }

  const quit = game.quit?.bind(game);
  if (quit) {
    game.quit = (showMenu = true) => {
      quit(false);
      const h = game.__feHooks || {};
      try { h.onQuit?.(showMenu); } catch (e) { console.warn('onQuit', e); }
    };
  }
}

export function roundSnapshot(game, winner, why) {
  return {
    winner, why,
    scoreAtk: game.round?.scoreAtk ?? 0,
    scoreDef: game.round?.scoreDef ?? 0,
    n: game.round?.n ?? 0,
  };
}

export function isCompleteSnapshot(r) {
  if (!r) return false;
  const rows = r.rows || r.stats?.players || [];
  const atk = rows.filter(x => x.team === 'attack').length;
  const def = rows.filter(x => x.team === 'defend').length;
  return atk >= 5 && def >= 5;
}

function rowCount(r) {
  return (r?.rows || r?.stats?.players || []).length;
}
function scoreSum(r) {
  return (r?.rows || r?.stats?.players || []).reduce((s, p) => s + (p.score || 0) + (p.k || 0), 0);
}

export function richerSnapshot(a, b) {
  if (!a) return b;
  if (!b) return a;
  const completeA = isCompleteSnapshot(a);
  const completeB = isCompleteSnapshot(b);
  if (completeA && !completeB) return a;
  if (completeB && !completeA) return b;
  if (rowCount(a) !== rowCount(b)) return rowCount(a) > rowCount(b) ? a : b;
  return scoreSum(a) >= scoreSum(b) ? a : b;
}

export function isStrictlyRicher(a, b) {
  if (!a || !b) return !!a && !b;
  return rowCount(a) > rowCount(b) || (rowCount(a) === rowCount(b) && scoreSum(a) > scoreSum(b));
}

export function matchSnapshot(game) {
  if (game?._matchEndSnapshot) return snapshotFromApi(game._matchEndSnapshot, game);
  const rows = collectRows(game);
  const player = rows.find(r => r.you) || rows[0];
  const won = game.round?.winner === (game.player?.team || 'attack');
  const mvpId = pickMvp(rows);
  const scoreAtk = game.round?.scoreAtk ?? 0;
  const scoreDef = game.round?.scoreDef ?? 0;
  const need = game.round?.need ?? 2;
  const highlights = [];
  const officialRows = rows.map(officialPlayer);
  return {
    winner: game.round?.winner,
    score: { attack: scoreAtk, defend: scoreDef, need },
    stats: { players: officialRows, mvpId, highlights },
    mvp: officialRows.find(r => r.id === mvpId) || null,
    highlights,
    won,
    scoreAtk, scoreDef, need,
    map: game.cfg?.map || 'halcyon',
    mode: game.cfg?.bestOf === 5 ? 'ranked' : 'bomb-rush',
    side: game.player?.team || 'attack',
    rows,
    mvpId,
    player,
    elims: player?.k || 0,
    assists: player?.a || 0,
    deaths: player?.d || 0,
    headshots: player?.hs || 0,
    roundsWon: game.player?.team === 'attack' ? scoreAtk : scoreDef,
    roundsPlayed: scoreAtk + scoreDef,
    isMvp: !!(mvpId && player && mvpId === player.id),
  };
}

function collectRows(game) {
  const list = [game.player, ...(game.bots || [])].filter(Boolean);
  return list.map(r => {
    const opId = r.opId || r.op?.id || (r === game.player ? 'you' : 'bot');
    const k = r.kills || 0, a = r.assists || 0, d = r.deaths || 0;
    const score = k * 100 + a * 25;
    return {
      id: r.id || opId,
      name: (r.op?.name || r.opId || 'OP').toString().toUpperCase(),
      opId,
      opName: r.op?.name || r.opId,
      team: r.team,
      bot: r !== game.player,
      you: r === game.player,
      k, a, d, score,
      headshots: r.headshots || 0,
      plants: r.plants || 0,
      defuses: r.defuses || 0,
      downs: r.downs || 0,
      revives: r.revives || 0,
      points: score,
      hs: r.headshots || 0,
    };
  });
}

function pickMvp(rows) {
  let best = null;
  for (const r of rows) {
    if (!best || r.score > best.score) best = r;
  }
  return best?.id || null;
}

/** Build a complete fake match result so post-match screens can be tested. */
export function mockMatchResult(sel) {
  const side = sel.side || 'attack';
  const opp = side === 'attack' ? 'defend' : 'attack';
  const mode = modeById(sel.mode);
  const need = Math.ceil((mode.bestOf || 3) / 2);
  const ourScore = need;
  const theirScore = Math.max(0, need - 1);
  const won = sel.forceWin !== false;
  const myOp = getOp(sel.operator, side) || listSide(side)[0];
  const ourOps = listSide(side);
  const theirOps = listSide(opp);

  const us = [
    row(myOp, side, true, { k: 8, a: 2, d: 3, hs: 3, score: 950, callsign: sel.callsign || 'WARRANT' }),
    ...FIRETEAM_BOTS.map((b, i) => row(ourOps[i % ourOps.length], side, false, {
      k: 6 - i, a: 1 + (i % 2), d: 2 + (i % 3), score: 720 - i * 80, callsign: b.callsign,
    })),
  ];
  const them = RIVAL_BOTS.map((b, i) => row(theirOps[i % theirOps.length], opp, false, {
    k: 5 - (i % 4), a: i % 3, d: 3 + (i % 2), score: 640 - i * 70, callsign: b.callsign,
  }));
  const rows = [...us, ...them];
  const mvp = us[0];
  const scoreAtk = side === 'attack' ? (won ? ourScore : theirScore) : (won ? theirScore : ourScore);
  const scoreDef = side === 'defend' ? (won ? ourScore : theirScore) : (won ? theirScore : ourScore);
  const highlights = [
    { kind: 'ace', who: mvp.name, note: 'Eight confirmed downs' },
    { kind: 'plant', who: mvp.name, note: 'Charge set on site' },
  ];
  const officialRows = rows.map(officialPlayer);
  return {
    winner: won ? side : opp,
    score: { attack: scoreAtk, defend: scoreDef, need },
    stats: { players: officialRows, mvpId: mvp.id, highlights },
    mvp: officialPlayer(mvp),
    highlights,
    won,
    scoreAtk, scoreDef, need,
    map: sel.map || 'halcyon',
    mode: mode.id,
    side,
    rows,
    mvpId: mvp.id,
    player: us[0],
    elims: us[0].k,
    assists: us[0].a,
    deaths: us[0].d,
    headshots: us[0].hs,
    roundsWon: won ? ourScore : theirScore,
    roundsPlayed: ourScore + theirScore,
    isMvp: true,
    mocked: true,
  };
}

function row(op, team, you, extra) {
  const k = extra.k || 0, a = extra.a || 0, d = extra.d || 0;
  const score = extra.score || 0;
  return {
    id: (you ? 'you-' : '') + (op?.id || extra.callsign || 'op'),
    opId: op?.id,
    name: extra.callsign || op?.name || 'OP',
    opName: op?.name || 'OP',
    team, you,
    bot: !you,
    k, a, d, score,
    headshots: extra.hs || 0,
    plants: extra.plants || (you ? 1 : 0),
    defuses: extra.defuses || 0,
    downs: extra.downs || k,
    revives: extra.revives || 0,
    points: extra.points || score,
    hs: extra.hs || 0,
    callsign: extra.callsign,
  };
}
