/** Public Match API. See docs/MATCH-API.md. */

import { PREP_TIME, ACTION_TIME, PLANT_TIME, DEFUSE_TIME, BOMB_TIME, DEFAULT_BEST_OF } from '../config.js?v=iv-4.1.0';
import { normalizeDifficulty } from '../difficulty.js?v=iv-4.1.0';
import { getOp, listSide } from '../operators.js?v=iv-4.1.0';
import { createBus } from './events.js?v=iv-4.1.0';
import { collectStats, listPawns, ensureStat } from './stats.js?v=iv-4.1.0';

export const MAP_IDS = {
  halcyon: 'halcyon',
  'halcyon-press': 'halcyon',
  'halcyon_press': 'halcyon',
};

export const MODE_IDS = {
  'bomb-rush': 'bomb-rush',
  bomb: 'bomb-rush',
  'fast-warrant': 'bomb-rush',
  'fast_warrant': 'bomb-rush',
};

export function normalizeMatchConfig(cfg = {}, settings = {}) {
  const mode = MODE_IDS[String(cfg.mode || 'bomb-rush').toLowerCase()] || 'bomb-rush';
  const map = MAP_IDS[String(cfg.map || 'halcyon').toLowerCase()] || 'halcyon';
  const side = cfg.side === 'defend' ? 'defend' : 'attack';
  const difficulty = normalizeDifficulty(cfg.difficulty || settings.difficulty || 'regular');
  const bestOf = Number(cfg.bestOf || settings.bestOf || DEFAULT_BEST_OF) || 3;
  const opId = cfg.operator || cfg.atkOp || cfg.defOp || settings.operator?.[side];
  const op = getOp(opId, side);
  const seed = Number.isFinite(cfg.seed) ? (cfg.seed | 0) : ((Math.random() * 0x7fffffff) | 0);
  return {
    mode,
    map,
    side,
    difficulty,
    operator: op.id,
    bestOf,
    sitePair: cfg.sitePair || null,
    loadout: cfg.loadout || null,
    prepTime: num(cfg.prepTime, PREP_TIME),
    actionTime: num(cfg.actionTime, ACTION_TIME),
    plantTime: num(cfg.plantTime, PLANT_TIME),
    defuseTime: num(cfg.defuseTime, DEFUSE_TIME),
    bombTime: num(cfg.bombTime, BOMB_TIME),
    seed,
    godMode: !!cfg.godMode,
    skipOperatorPick: cfg.skipOperatorPick !== false,
    pickTimeout: num(cfg.pickTimeout, 8),
    skipMatchCard: !!cfg.skipMatchCard,
  };
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function attachMatchApi(game) {
  if (game._matchApi) return game._matchApi;
  const bus = createBus();
  game._matchBus = bus;
  game.onMatchEvent = (type, fn) => bus.on(type, fn);
  game.startMatch = (cfg) => startMatch(game, cfg);
  game.emitMatch = (type, payload) => bus.emit(type, payload);
  const api = { startMatch: game.startMatch, onMatchEvent: game.onMatchEvent, emitMatch: game.emitMatch };
  game._matchApi = api;
  return api;
}

export async function startMatch(game, cfg = {}) {
  attachMatchApi(game);
  const config = normalizeMatchConfig(cfg, game.settings || {});
  const handle = new MatchHandle(game, config);
  game.match = handle;
  game._match = handle;
  // Game.start still understands the existing cfg shape; we pass the
  // normalized fields plus legacy aliases.
  await game.start({
    ...config,
    atkOp: config.side === 'attack' ? config.operator : undefined,
    defOp: config.side === 'defend' ? config.operator : undefined,
  });
  return handle;
}

export class MatchHandle {
  constructor(game, config) {
    this.game = game;
    this.config = Object.freeze({ ...config });
    this._bus = game._matchBus;
  }

  on(type, fn) { return this._bus.on(type, fn); }
  off(type, fn) { return this._bus.off(type, fn); }
  once(type, fn) { return this._bus.once(type, fn); }

  getState() {
    const g = this.game;
    const r = g.round || {};
    const p = g.player || {};
    const view = g.inDrone || g.droneSys?.active ? 'drone'
      : (g.inCams || g.droneSys?.camsOn ? 'cam'
        : (!p.alive && !p.downed ? 'spectate' : 'fp'));
    return {
      running: !!g.running,
      ended: !!g.ended,
      paused: !!g.inMenu && !!g.running,
      map: g.cfg?.map || this.config.map,
      mode: g.cfg?.mode || this.config.mode,
      difficulty: g.cfg?.difficulty || this.config.difficulty,
      round: r.n || 0,
      phase: r.phase || null,
      t: r.t ?? 0,
      planted: !!r.planted,
      plantSite: r.plantPos?.site || null,
      side: p.team || this.config.side,
      operator: p.opId || this.config.operator,
      score: { attack: r.scoreAtk || 0, defend: r.scoreDef || 0, need: r.need || 2 },
      player: {
        alive: !!p.alive,
        downed: !!p.downed,
        hp: p.hp ?? 0,
        armor: p.armor ?? 0,
        pos: p.pos ? { x: p.pos.x, y: p.pos.y, z: p.pos.z } : null,
        yaw: p.yaw || 0,
        pitch: p.pitch || 0,
        ads: p.ads || 0,
      },
      view,
    };
  }

  getStats() { return collectStats(this.game); }

  selectOperator(id) {
    const g = this.game;
    const side = g.player?.team || this.config.side;
    const op = getOp(id, side);
    g.cfg = g.cfg || {};
    g.cfg.operator = op.id;
    if (g.settings?.operator) g.settings.operator[side] = op.id;
    this._picked = op.id;
    if (g._awaitingPick) this.confirmPick();
    return op.id;
  }

  confirmPick() {
    if (typeof this.game._resolvePick === 'function') this.game._resolvePick(this._picked || this.game.player?.opId);
  }

  pause() { this.game.inMenu = true; this.game.ui?.show?.('pause'); }
  resume() { this.game.resume?.(); }

  end() { this.game.quit?.(true); }

  setPhase(phase, seconds) {
    if (typeof this.game._setPhase === 'function') this.game._setPhase(phase, seconds);
    else if (this.game.round) {
      this.game.round.phase = phase;
      if (seconds != null) this.game.round.t = seconds;
    }
  }
}

export function lineupPayload(game) {
  const rows = (team) => listPawns(game)
    .filter(p => p.team === team)
    .map(p => {
      const st = ensureStat(p, { player: game.player });
      return { id: st.id, name: st.name, bot: p !== game.player, team, opId: st.opId };
    });
  return { attack: rows('attack'), defend: rows('defend') };
}

export function rosterPayload(game, side) {
  const taken = new Set(listPawns(game).filter(p => p.team === side && p !== game.player).map(p => p.opId));
  return listSide(side).map(o => ({ id: o.id, name: o.name, side: o.side, taken: taken.has(o.id) }));
}

export { collectStats, listPawns };
