/** Per-pawn K/A/D/score, MVP and short highlights. */

export const POINTS = {
  elim: 100,
  headshot: 400,
  down: 110,
  assist: 50,
  plant: 150,
  defuse: 150,
  drone: 25,
  scan: 25,
  reinforce: 10,
  barricade: 10,
  roundWin: 200,
  clutch: 250,
};

const EMPTY_POINTS = () => ({
  elim: 0, headshot: 0, down: 0, assist: 0, plant: 0, defuse: 0,
  drone: 0, scan: 0, reinforce: 0, barricade: 0, roundWin: 0, clutch: 0,
});

export function ensureStat(pawn, extra = {}) {
  if (!pawn) return null;
  if (!pawn.stat) {
    pawn.stat = {
      id: pawn === extra.player ? (pawn.id || 'player') : (pawn.id || pawn.opId || 'bot'),
      name: pawn.op?.name || pawn.name || pawn.opId || 'Operator',
      opId: pawn.opId || pawn.op?.id || null,
      team: pawn.team,
      bot: pawn !== extra.player && pawn.kind !== 'player',
      k: pawn.kills || 0,
      a: pawn.assists || 0,
      d: pawn.deaths || 0,
      score: pawn.score || 0,
      headshots: 0, plants: 0, defuses: 0, downs: 0, revives: 0,
      points: EMPTY_POINTS(),
    };
  }
  pawn.stat.team = pawn.team;
  pawn.stat.name = pawn.op?.name || pawn.stat.name;
  pawn.stat.opId = pawn.opId || pawn.op?.id || pawn.stat.opId;
  return pawn.stat;
}

export function resetRoundCombat(pawn) {
  if (!pawn) return;
  pawn._revivedThisRound = false;
  pawn.downed = false;
  pawn.bleedAt = 0;
  pawn._assistBy = null;
}

export function addScore(pawn, kind, amount, game) {
  const st = ensureStat(pawn, { player: game?.player });
  if (!st) return 0;
  const n = amount ?? POINTS[kind] ?? 0;
  st.score = (st.score || 0) + n;
  if (st.points && kind in st.points) st.points[kind] += n;
  pawn.score = st.score;
  if (game) emitStats(game);
  return n;
}

export function recordKill(game, victim, killer, info = {}) {
  if (!victim) return;
  const vst = ensureStat(victim, { player: game.player });
  vst.d += 1;
  victim.deaths = vst.d;
  if (killer && killer !== victim) {
    const kst = ensureStat(killer, { player: game.player });
    kst.k += 1;
    killer.kills = kst.k;
    if (info.head) {
      kst.headshots += 1;
      addScore(killer, 'headshot', POINTS.headshot, null);
    } else {
      addScore(killer, 'elim', POINTS.elim, null);
    }
  }
  const assistFrom = victim._assistBy;
  if (assistFrom && assistFrom !== killer) {
    const ast = ensureStat(assistFrom, { player: game.player });
    ast.a += 1;
    assistFrom.assists = ast.a;
    addScore(assistFrom, 'assist', POINTS.assist, null);
  }
  victim._assistBy = null;
  if (info.highlights !== false) maybeHighlight(game, 'elim', killer, { head: !!info.head, victim });
  emitStats(game);
}

export function recordDown(game, victim, killer) {
  if (killer) {
    const kst = ensureStat(killer, { player: game.player });
    kst.downs += 1;
    addScore(killer, 'down', POINTS.down, null);
  }
  emitStats(game);
}

export function recordRevive(game, who, by) {
  const st = ensureStat(who, { player: game.player });
  st.revives += 1;
  if (by) ensureStat(by, { player: game.player });
  emitStats(game);
}

export function recordObjective(game, who, kind) {
  const st = ensureStat(who, { player: game.player });
  if (kind === 'plant') st.plants += 1;
  if (kind === 'defuse') st.defuses += 1;
  addScore(who, kind, POINTS[kind], game);
  maybeHighlight(game, kind, who);
}

export function awardRoundWin(game, winner, clutch) {
  const pawns = listPawns(game).filter(p => p.team === winner);
  for (const p of pawns) {
    addScore(p, 'roundWin', POINTS.roundWin, null);
    if (clutch && p === game.player) addScore(p, 'clutch', POINTS.clutch, null);
  }
  if (clutch) maybeHighlight(game, 'clutch', game.player);
  const alive = pawns.filter(p => p.alive && !p.downed);
  if (alive.length && pawns.length >= 5 && alive.length === 1 && (alive[0].stat?.k || 0) >= 5) {
    maybeHighlight(game, 'ace', alive[0]);
  }
  emitStats(game);
}

export function listPawns(game) {
  return [game.player, ...(game.bots || [])].filter(Boolean);
}

export function cloneJson(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/** Immutable copy of a stats payload (players, mvpId, highlights). */
export function cloneStats(stats) {
  const players = (stats?.players || []).map(p => ({
    ...p,
    points: p.points && typeof p.points === 'object' && !Array.isArray(p.points)
      ? { ...p.points }
      : p.points,
  }));
  return {
    players,
    mvpId: stats?.mvpId ?? players[0]?.id ?? players[0]?.opId ?? null,
    highlights: (stats?.highlights || []).map(h => ({ ...h })),
  };
}

/**
 * Freeze the official matchend payload while all 10 operators are still
 * in the world. This is the single source for highlights, scoreboard and MVP
 * after the front end tears the session down (quit clears bots).
 */
export function freezeMatchEnd(game, extra = {}) {
  const stats = cloneStats(extra.stats || collectStats(game));
  stats.players.sort((a, b) => b.score - a.score || b.k - a.k || ((b.plants || 0) + (b.defuses || 0)) - ((a.plants || 0) + (a.defuses || 0)));
  stats.mvpId = stats.players[0]?.id || stats.players[0]?.opId || null;
  const mvp = stats.players.find(p => p.id === stats.mvpId) || stats.players[0] || null;
  const score = extra.score || {
    attack: game.round?.scoreAtk ?? 0,
    defend: game.round?.scoreDef ?? 0,
    need: game.round?.need ?? 2,
  };
  const snap = {
    winner: extra.winner ?? game.round?.winner,
    score: { attack: score.attack ?? 0, defend: score.defend ?? 0, need: score.need ?? 2 },
    stats,
    mvp: mvp ? { ...mvp, points: mvp.points && typeof mvp.points === 'object' ? { ...mvp.points } : mvp.points } : null,
    highlights: stats.highlights,
    side: extra.side || game.player?.team || 'attack',
    map: extra.map || game.cfg?.map || 'halcyon',
    mode: extra.mode || game.cfg?.mode || 'bomb-rush',
  };
  game._matchEndSnapshot = snap;
  return cloneJson(snap);
}

export function collectStats(game) {
  // After teardown, bots are gone — serve the frozen matchend snapshot.
  const frozen = game?._matchEndSnapshot?.stats;
  if (frozen && (game.ended || !game.bots || game.bots.length === 0)) {
    return cloneStats(frozen);
  }
  const players = listPawns(game).map(p => {
    const st = ensureStat(p, { player: game.player });
    return { ...st, points: { ...st.points }, bot: p !== game.player };
  });
  players.sort((a, b) => b.score - a.score || b.k - a.k || (b.plants + b.defuses) - (a.plants + a.defuses));
  const mvpId = players[0]?.id || players[0]?.opId || null;
  const highlights = [...(game._highlights || [])];
  return { players, mvpId, highlights };
}

export function maybeHighlight(game, kind, who, extra = {}) {
  if (!game) return;
  game._highlights = game._highlights || [];
  const row = {
    kind,
    who: who ? (who.op?.name || who.opId || 'Operator') : null,
    opId: who?.opId || who?.op?.id || null,
    note: extra.note || (kind === 'headshot' || extra.head ? 'Headshot' : kind),
  };
  game._highlights.push(row);
  if (game._highlights.length > 8) game._highlights.shift();
}

export function emitStats(game) {
  if (!game?._matchBus) return;
  game._matchBus.emit('stats', collectStats(game));
}

export function resetMatchStats(game) {
  game._highlights = [];
  for (const p of listPawns(game)) {
    p.kills = 0; p.deaths = 0; p.assists = 0; p.score = 0;
    p.stat = null;
    ensureStat(p, { player: game.player });
    resetRoundCombat(p);
  }
}
