/** LOS, vision cones, hearing and spawn-safety helpers for v4 bots. */

export function inBuilding(world, pos) {
  const b = world?.bounds?.building;
  if (!b || !pos) return false;
  return pos.x >= b.x0 && pos.x <= b.x1 && pos.z >= b.z0 && pos.z <= b.z1;
}

export function hasLOS(world, ax, ay, az, bx, by, bz, steps = 8, rad = 0.05) {
  if (!world?.pointInSolid) return true;
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    if (world.pointInSolid(x, y, z, rad, rad * 2)) return false;
  }
  return true;
}

/** Horizontal FOV cone. fov is full width in radians. */
export function inCone(yaw, ox, oz, tx, tz, fov) {
  const dx = tx - ox, dz = tz - oz;
  if (dx * dx + dz * dz < 1e-8) return true;
  const want = Math.atan2(dx, dz);
  let d = want - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= (fov || 1.1) * 0.5;
}

export function canSee(game, viewer, target, dcfg) {
  if (!viewer?.pos || !target?.pos) return false;
  if (target.alive === false && !target.downed) return false;
  const range = (dcfg && dcfg.spot) || 20;
  const dx = target.pos.x - viewer.pos.x;
  const dy = (target.pos.y || 0) - (viewer.pos.y || 0);
  const dz = target.pos.z - viewer.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > range) return false;
  const fov = dcfg?.fov ?? 1.15;
  if (!inCone(viewer.yaw || 0, viewer.pos.x, viewer.pos.z, target.pos.x, target.pos.z, fov)) return false;
  const eyeA = (viewer.pos.y || 0) + 1.45;
  const eyeB = (target.pos.y || 0) + (target.downed ? 0.4 : 1.4);
  return hasLOS(game.world, viewer.pos.x, eyeA, viewer.pos.z, target.pos.x, eyeB, target.pos.z);
}

export function canHear(game, viewer, target, dcfg) {
  if (!viewer?.pos || !target?.pos) return false;
  const range = (dcfg && dcfg.hear) || 10;
  const dist = Math.hypot(target.pos.x - viewer.pos.x, target.pos.z - viewer.pos.z);
  if (dist > range) return false;
  const moving = (target.vel && target.vel.length && target.vel.length() > 1.0) || target.sprint;
  const firing = (game.time - (target.lastShot || target._lastShot || 0)) < 0.4;
  return !!(moving || firing);
}

/** Seconds of invulnerability for attackers after ACTION starts. */
export const SPAWN_PROTECT_SEC = 4;

/** Defenders may not leave the building or fire at spawn yards for at least this long. */
export const NO_SPAWN_PEEK_SEC = 12;

/** Seconds since ACTION began, or -1 if action has not started. */
export function actionAge(game) {
  if (!game || game.round?.phase !== 'action') return -1;
  const at = game.round?.actionAt;
  if (at == null || !Number.isFinite(at)) return -1;
  return (game.time || 0) - at;
}

export function isSpawnProtected(game, pawn) {
  if (!pawn || pawn.team !== 'attack') return false;
  if (pawn.spawnProtectUntil != null && (game.time || 0) < pawn.spawnProtectUntil) return true;
  const age = actionAge(game);
  return age >= 0 && age < SPAWN_PROTECT_SEC;
}

/** Seconds defenders must stay inside the building after action starts.
 *  Recruit / Regular stay at 15s; every difficulty is floored at
 *  NO_SPAWN_PEEK_SEC so Veteran/Elite cannot peek yards at t=0. */
export function holdInteriorFor(game) {
  const d = String(game?.cfg?.difficulty || '').toLowerCase();
  const listed = (d === 'recruit' || d === 'regular') ? 15 : 0;
  return Math.max(listed, NO_SPAWN_PEEK_SEC);
}

/** True when a pawn is still on an attacker approach / spawn yard. */
export function inSpawnYard(game, pawn) {
  const list = game?.world?.spawns?.attack || [];
  if (!pawn?.pos) return false;
  if (list.some(s => Math.hypot(pawn.pos.x - s.x, pawn.pos.z - s.z) < 8.5)) return true;
  if (inBuilding(game.world, pawn.pos)) return false;
  const b = game.world?.bounds?.building;
  if (!b) return false;
  const mx = pawn.pos.x < b.x0 ? b.x0 - pawn.pos.x : (pawn.pos.x > b.x1 ? pawn.pos.x - b.x1 : 0);
  const mz = pawn.pos.z < b.z0 ? b.z0 - pawn.pos.z : (pawn.pos.z > b.z1 ? pawn.pos.z - b.z1 : 0);
  return Math.hypot(mx, mz) > 3.0;
}

function pushAwayFromBuilding(world, s, dist = 3.2) {
  const b = world?.bounds?.building;
  if (!b || !s) return s;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const dx = (s.x || 0) - cx, dz = (s.z || 0) - cz;
  const len = Math.hypot(dx, dz) || 1;
  let x = s.x + (dx / len) * dist, z = s.z + (dz / len) * dist;
  // Never push a spawn past the out-of-bounds warning line: the player
  // would start ACTION under "Return to the operation area".
  const warn = world?.bounds?.warn;
  if (warn) {
    const m = 1.0;
    x = Math.min(warn.x1 - m, Math.max(warn.x0 + m, x));
    z = Math.min(warn.z1 - m, Math.max(warn.z0 + m, z));
  }
  if (world?.pointInSolid?.(x, (s.y || 0) + 0.2, z, 0.22, 1.3)) return s;
  return { ...s, x, z };
}

/** Pick an attacker spawn that has no LOS from defender positions or
 *  south-facing exterior windows into the spawn volume. */
export function pickSafeAttackSpawn(game, i = 0, rng = Math.random) {
  const list = game.world?.spawns?.attack || [];
  if (!list.length) return { x: 0, y: 0, z: -18.5, yaw: 0 };
  const defenders = [game.player, ...(game.bots || [])].filter(p => p && p.team === 'defend' && p.pos);
  const windows = (game.world.windows || []).filter(w => w.exterior || Math.abs(w.z + 9) < 3 || Math.abs(w.x) > 9);
  const scored = list.map((s, idx) => {
    let score = 0;
    const eye = 1.5;
    let defenderLos = false, windowLos = false;
    for (const d of defenders) {
      const los = hasLOS(game.world, d.pos.x, (d.pos.y || 0) + 1.45, d.pos.z, s.x, eye, s.z, 10);
      const dist = Math.hypot(d.pos.x - s.x, d.pos.z - s.z);
      if (los && dist < 28) { score += 40 + Math.max(0, 28 - dist); defenderLos = true; }
      else score -= 2;
    }
    for (const w of windows) {
      const los = hasLOS(game.world, w.x, (w.y || 1.5) + 0.4, w.z, s.x, eye, s.z, 8);
      const dist = Math.hypot((w.x || 0) - s.x, (w.z || 0) - s.z);
      if (los && dist < 24) { score += 25 + Math.max(0, 24 - dist); windowLos = true; }
    }
    if (s.cover) score -= 8;
    return { s, idx, score, defenderLos, windowLos };
  });
  const safe = scored.filter(r => !r.defenderLos);
  const pool = safe.length ? safe : scored;
  pool.sort((a, b) => a.score - b.score || a.idx - b.idx);
  // Rotate among the three safest so seeds spread players out.
  const pick = pool[Math.abs(i) % Math.min(3, pool.length)] || pool[0];
  let chosen = pick.s;
  // If every spawn still has window or defender LOS, push it further off the wall.
  if (pick.defenderLos || pick.windowLos) chosen = pushAwayFromBuilding(game.world, chosen, 3.2);
  const jitter = (rng() - 0.5) * 0.6;
  return { x: chosen.x + jitter, y: chosen.y || 0, z: chosen.z, yaw: chosen.yaw || 0, id: chosen.id, safe: !pick.defenderLos };
}

export function surfaceAt(world, pos) {
  if (!world || !pos) return 'dirt';
  if (inBuilding(world, pos)) {
    const y = pos.y || 0;
    if (y < 0.2) return 'concrete';
    if (y < 3.4) return 'concrete';
    return 'wood';
  }
  return 'dirt';
}
