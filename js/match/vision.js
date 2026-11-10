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

/** Seconds defenders must stay inside the building after action starts. */
export function holdInteriorFor(game) {
  const d = game.cfg?.difficulty;
  if (d === 'recruit' || d === 'regular') return 15;
  return 0;
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
    for (const d of defenders) {
      const los = hasLOS(game.world, d.pos.x, (d.pos.y || 0) + 1.45, d.pos.z, s.x, eye, s.z, 10);
      const dist = Math.hypot(d.pos.x - s.x, d.pos.z - s.z);
      if (los && dist < 28) score += 40 + Math.max(0, 28 - dist);
      else score -= 2;
    }
    for (const w of windows) {
      const los = hasLOS(game.world, w.x, (w.y || 1.5) + 0.4, w.z, s.x, eye, s.z, 8);
      const dist = Math.hypot((w.x || 0) - s.x, (w.z || 0) - s.z);
      if (los && dist < 24) score += 25 + Math.max(0, 24 - dist);
    }
    if (s.cover) score -= 8;
    return { s, idx, score };
  });
  scored.sort((a, b) => a.score - b.score || a.idx - b.idx);
  // Rotate among the three safest so seeds spread players out.
  const pick = scored[Math.abs(i) % Math.min(3, scored.length)] || scored[0];
  const jitter = (rng() - 0.5) * 0.6;
  return { x: pick.s.x + jitter, y: pick.s.y || 0, z: pick.s.z, yaw: pick.s.yaw || 0, id: pick.s.id };
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
