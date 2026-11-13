import * as THREE from 'three';
import { createOperatorMesh, attachWeaponToHand, tickOperator } from './models.js?v=iv-4.1.2-t3';
import { getOp, listSide } from './operators.js?v=iv-4.1.2-t3';
import { instWeapon, makeLoadout } from './weapons.js?v=iv-4.1.2-t3';
import { isHostile } from './combat.js?v=iv-4.1.2-t3';
import { SPEED } from './config.js?v=iv-4.1.2-t3';
import { difficultyParams } from './difficulty.js?v=iv-4.1.2-t3';
import { canSee, canHear, inBuilding, holdInteriorFor, pickSafeAttackSpawn, surfaceAt, inSpawnYard, isSpawnProtected, actionAge } from './match/vision.js?v=iv-4.1.2-t3';
import { gunfireAt, occludedBetween, footstep } from './audio.js?v=iv-4.1.2-t3';

export function spawnBots(game) {
  const bots = [];
  const sideP = game.player.team;
  const sideE = sideP === 'attack' ? 'defend' : 'attack';
  const used = new Set([game.player.opId]);
  const mk = (side, i) => {
    const roster = listSide(side);
    const op = roster.find(o => !used.has(o.id)) || roster[i % roster.length];
    used.add(op.id);
    const spawn = pickSpawn(game, side, i);
    let pawnId = op.id;
    let n = 2;
    while (pawnId === 'player' || pawnId === game.player?.id || bots.some(x => x.id === pawnId)) {
      pawnId = op.id + '-' + n;
      n += 1;
    }
    const b = {
      id: pawnId, kind: 'operator', team: side, op, opId: op.id, alive: true, hp: difficultyParams(game.cfg?.difficulty).hp,
      armor: op.armor, speed: op.speed,
      pos: new THREE.Vector3(spawn.x, spawn.y, spawn.z),
      yaw: spawn.yaw || 0, pitch: 0, stance: 0, lean: 0, ads: 0,
      vel: new THREE.Vector3(), path: [], pathI: 0, state: 'idle',
      role: assignRole(side, op, i), weapon: instWeapon(op.primaries[0], makeLoadout(op)),
      mesh: new THREE.Group(), pose: () => {}, t: Math.random() * 10,
      aimT: 0, lastShot: 0, mark: null, cover: null, visual: null,
    };
    b.mesh.position.copy(b.pos);
    game.gfx.scene.add(b.mesh);
    bots.push(b);
    b._gen = game._botGen || 0;
    b._ready = createOperatorMesh({
      id: op.id, team: side, seed: i + 3, accent: op.accent,
      quality: game.gfx?.quality || 'med',
    }).then(async vis => {
      if (!vis) return;
      // Abort if this match already quit; otherwise a late load leaks a mesh.
      if (b._dead || b._gen !== (game._botGen || 0) || !(game.bots || []).includes(b)) {
        vis.mesh?.parent?.remove(vis.mesh);
        return;
      }
      if (b.mesh?.parent) b.mesh.parent.remove(b.mesh);
      game.gfx.scene.add(vis.mesh);
      b.mesh = vis.mesh; b.pose = vis.pose; b.visual = vis;
      vis.mesh.position.copy(b.pos);
      vis.mesh.rotation.y = b.yaw || 0;
      vis.pose(b.alive ? 'idle' : 'death', b.t || 0);
      try { await attachWeaponToHand(vis, b.weapon); } catch (e) { console.warn('tp weapon', e); }
    }).catch(e => console.warn('bot mesh', e));
  };
  // 4 teammates + 5 enemies
  for (let i = 0; i < 4; i++) mk(sideP, i);
  for (let i = 0; i < 5; i++) mk(sideE, i + 10);
  return bots;
}

export async function readyBots(bots) {
  await Promise.all((bots || []).map(b => b._ready || Promise.resolve()));
}

function assignRole(side, op, i) {
  if (side === 'defend') {
    if (op.role === 'Anchor') return 'anchor';
    if (op.role === 'Roamer') return 'roamer';
    if (op.role === 'Trapper') return 'trapper';
    return i % 2 ? 'flex' : 'anchor';
  }
  if (op.role === 'Hard Breacher') return 'breach';
  if (op.role === 'Intel') return 'drone';
  if (op.role === 'Flash Entry') return 'entry';
  return i % 2 ? 'flex' : 'plant';
}

function pickSpawn(game, side, i) {
  const rng = game._rng || Math.random;
  if (side === 'attack') {
    const s = pickSafeAttackSpawn(game, i, rng);
    return { x: s.x + (i % 3) * 0.55, y: s.y || 0, z: s.z + ((i / 3) | 0) * 0.4, yaw: s.yaw };
  }
  const pair = game.round.pair;
  const sites = pair.sites.map(id => game.world.sites[id]);
  const s = sites[i % sites.length];
  const pl = s.plant;
  const y = game.world.groundAt(pl.x, pl.z, 10);
  // Keep defenders inside the site rooms, not at exterior windows.
  const ox = (i % 2 ? 1.1 : -1.1);
  const oz = 0.6 * ((i % 3) - 1);
  return { x: pl.x + ox, y, z: pl.z + oz, yaw: 0 };
}

export function updateBots(game, dt) {
  const dcfg = difficultyParams(game.cfg.difficulty);
  // shared marks
  for (const b of game.bots) {
    if (!b.alive) {
      if (b.visual) tickOperator(b.visual, dt, { dead: true, speed: 0, stance: 0 });
      else b.pose?.('death', 0);
      continue;
    }
    b.t += dt;
    think(game, b, dt, dcfg);
    move(game, b, dt);
    tryObjective(game, b, dt);
    shoot(game, b, dt, dcfg);
    b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
    b.mesh.rotation.y = b.yaw;
    const spd = b.vel.length();
    const firing = (game.time - (b.lastShot || 0)) < 0.28 && b.alive;
    const aiming = firing || b.aimT > 0.05;
    if (b.visual) {
      const cam = game.player?.pos || game.camera?.position;
      const camDist = cam ? Math.hypot((b.pos.x - cam.x), (b.pos.z - cam.z)) : 0;
      tickOperator(b.visual, dt, {
        speed: spd, stance: b.stance || 0, aiming, lean: b.lean || 0,
        pistol: b.weapon?.class === 'pistol', dead: false,
        reloading: !!b._reloading,
        camDist, offscreen: !!(b.mesh && !b.mesh.visible),
      });
    } else {
      let pose = 'idle';
      if (b.stance >= 1.5) pose = 'prone';
      else if (firing) pose = 'aim';
      else if (b.stance >= 0.8) pose = 'crouch';
      else if (spd > 3.2) pose = 'run';
      else if (spd > 0.25) pose = 'walk';
      b.pose?.(pose, b.t);
    }
  }
}

function think(game, b, dt, dcfg) {
  // utility scores
  const scores = {};
  const enemy = closestEnemy(game, b);
  const site = nearestSite(game, b);
  const planted = game.round.planted;
  scores.hold = b.role === 'anchor' ? 0.7 : 0.3;
  scores.peek = enemy && dist(b, enemy) < 22 ? 0.5 + dcfg.peek * 0.3 * (dcfg.aggro || 1) : 0.1;
  scores.rotate = (b.role === 'roamer' || b.role === 'flex' ? 0.45 : 0.15) + (dcfg.flank || 0) * 0.25;
  scores.plant = (b.team === 'attack' && (b.role === 'plant' || b.role === 'flex') && game.round.phase === 'action' && !planted) ? 0.65 : 0;
  scores.defuse = (b.team === 'defend' && planted) ? 0.9 : 0;
  scores.chase = enemy && enemy._lastSeen > game.time - 4 ? 0.25 + (dcfg.aggro || 0.5) * 0.4 : 0.05;
  scores.breach = (b.team === 'attack' && b.role === 'breach' && game.round.phase === 'action') ? 0.5 : 0;
  scores.cam = (b.team === 'defend' && game.round.phase === 'prep') ? 0.4 : 0;
  scores.reinforce = (b.team === 'defend' && game.round.phase === 'prep') ? 0.8 : 0;
  let best = 'hold', bs = -1;
  for (const [k, v] of Object.entries(scores)) if (v > bs) { bs = v; best = k; }
  b.action = best;

  if (game.round.phase === 'prep') {
    if (b.team === 'defend' && best === 'reinforce') doReinforce(game, b);
    if (b.team === 'attack' && b.role === 'drone') b.state = 'drone';
    // walk toward site / entry
    if (b.team === 'defend' && !b.path.length) goTo(game, b, site.plant.x, site.y ?? 0, site.plant.z);
    if (b.team === 'attack' && !b.path.length) {
      const entry = game.world.doors.find(d => d.exterior) || game.world.windows[0];
      if (entry) goTo(game, b, entry.x + (entry.nx || 0) * 2, 0, entry.z + (entry.nz || 0) * 2);
    }
    return;
  }

  const hold = holdInteriorFor(game);
  const age = actionAge(game);
  const stayIn = b.team === 'defend' && hold > 0 && age >= 0 && age < hold;
  if (stayIn && !inBuilding(game.world, b.pos) && site) {
    goTo(game, b, site.plant.x, site.y ?? 0, site.plant.z);
    b.action = 'hold';
    return;
  }
  if (stayIn && (best === 'chase' || best === 'peek' || best === 'rotate')) {
    // No spawn peeks: hold the site, don't walk to an exterior window.
    best = 'hold';
    b.action = 'hold';
  }

  if (best === 'plant' && site) goTo(game, b, site.plant.x, site.y ?? 0, site.plant.z);
  else if (best === 'defuse' && game.round.plantPos) goTo(game, b, game.round.plantPos.x, game.round.plantPos.y, game.round.plantPos.z);
  else if (best === 'chase' && enemy && !(stayIn && !inBuilding(game.world, enemy.pos))) goTo(game, b, enemy.pos.x, enemy.pos.y, enemy.pos.z);
  else if (best === 'breach') {
    const ch = game.world.chunks.find(c => !c.destroyed && !c.reinforced && Math.hypot(c.x - b.pos.x, c.z - b.pos.z) < 16) || game.world.chunks.find(c => !c.destroyed);
    if (ch) goTo(game, b, ch.x, ch.y, ch.z);
  } else if (b.role === 'entry' && !enemy) {
    const w = game.world.windows?.[0];
    if (w) goTo(game, b, w.x - (w.nx || 0) * 1.3, floorYSafe(game, w), w.z - (w.nz || 0) * 1.3);
  } else if (best === 'hold' && site) goTo(game, b, site.plant.x + 1.4, site.y ?? 0, site.plant.z + 1.2);
  else if (best === 'rotate' && site) {
    const other = game.round.pair.sites.map(id => game.world.sites[id]).find(s => s !== site) || site;
    goTo(game, b, other.plant.x, other.y ?? 0, other.plant.z);
  }

  // remote detonate when clear
  const mine = game.gadgets.charges.filter(c => c.live && c.owner === b && c.armed && !c.disabled);
  if (mine.length) {
    const clear = !game.bots.some(o => o.team === b.team && o.alive && o !== b && Math.hypot(o.pos.x - mine[0].pos.x, o.pos.z - mine[0].pos.z) < 2.2)
      && Math.hypot(b.pos.x - mine[0].pos.x, b.pos.z - mine[0].pos.z) > 2.0;
    if (clear) for (const c of mine) game.gadgets._explode(c);
  }
}

function doReinforce(game, b) {
  const ch = game.world.chunks.find(c => !c.reinforced && !c.destroyed && Math.hypot(c.x - b.pos.x, c.z - b.pos.z) < 8);
  if (ch) { game.world.reinforceChunk(ch); }
}

function goTo(game, b, x, y, z) {
  if (b._cd && game.time < b._cd) return;
  b._cd = game.time + 0.8;
  b.path = game.nav?.path(b.pos.x, b.pos.y, b.pos.z, x, y, z) || [];
  b.pathI = 0;
}

function move(game, b, dt) {
  if (!b.path || b.pathI >= b.path.length) { b.vel.set(0, 0, 0); return; }
  const n = b.path[b.pathI];
  const dx = n.x - b.pos.x, dz = n.z - b.pos.z;
  const dist2 = Math.hypot(dx, dz);
  if (dist2 < 0.35) { b.pathI++; b.pos.y = n.y; return; }
  const spd = (SPEED.walk[Math.max(0, 3 - b.speed)] || 3.4);
  const vx = (dx / dist2) * spd, vz = (dz / dist2) * spd;
  b.pos.x += vx * dt;
  b.pos.z += vz * dt;
  b.yaw = Math.atan2(dx, dz);
  b.vel.set(vx, 0, vz);
  const gnd = game.world.groundAt(b.pos.x, b.pos.z, b.pos.y + 0.8);
  b.pos.y = gnd;
  game.world.resolve(b.pos, 0.3, 1.7);
  const listener = game.player?.pos;
  if (listener) {
    const d = Math.hypot(b.pos.x - listener.x, b.pos.z - listener.z);
    if (d < 16) {
      b._stepAcc = (b._stepAcc || 0) + dt * 1.7;
      if (b._stepAcc >= 1) {
        b._stepAcc = 0;
        footstep(surfaceAt(game.world, b.pos), Math.max(0.015, 0.07 / (1 + d * 0.35)));
      }
    }
  }
}

function shoot(game, b, dt, dcfg) {
  if (b.downed) { b.aimT = 0; return; }
  // Defenders (and anyone who can see one) shoot scouts, including in prep.
  const drone = visibleDrone(game, b, dcfg);
  const enemy = game.round?.phase === 'prep' ? null : visibleEnemy(game, b, dcfg);
  const target = drone || enemy;
  if (!target) { b.aimT = Math.max(0, b.aimT - dt * 0.5); b._sawAt = 0; return; }
  const tp = target.pos;
  const dx = tp.x - b.pos.x, dz = tp.z - b.pos.z;
  const want = Math.atan2(dx, dz);
  const turn = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
  const track = Math.min(1, (dcfg.track || 0.6) * 8 * dt);
  b.yaw += turn * track;
  b.aimT += dt;
  // Reaction delay starts from first sight, not from spawn.
  if (!b._sawAt) b._sawAt = game.time;
  if ((game.time - b._sawAt) < dcfg.react) return;
  if (isSpawnProtected(game, target)) return;
  const hold = holdInteriorFor(game);
  const age = actionAge(game);
  if (b.team === 'defend' && target.team === 'attack') {
    if (age >= 0 && age < hold && !inBuilding(game.world, target.pos)) return;
    if (age >= 0 && age < hold && inSpawnYard(game, target)) return;
  }
  const now = game.time;
  const interval = 60 / ((b.weapon?.rpm || 600) * 0.7);
  if (now - b.lastShot < interval) return;
  b.lastShot = now;
  if (!b.weapon || b.weapon.clip <= 0) { if (b.weapon) b.weapon.clip = b.weapon.mag; return; }
  b.weapon.clip--;
  const first = !b._hasFired;
  b._hasFired = true;
  const err = (first ? (dcfg.firstSpread || dcfg.acc) : dcfg.acc) + (dcfg.trackErr || 0) * 0.5;
  const aimY = drone ? (tp.y + 0.06) : (tp.y + (target.downed ? 0.4 : 1.4));
  const origin = new THREE.Vector3(b.pos.x, b.pos.y + 1.45, b.pos.z);
  const dir = new THREE.Vector3(tp.x - origin.x, aimY - origin.y, tp.z - origin.z).normalize();
  dir.x += (Math.random() * 2 - 1) * err;
  dir.y += (Math.random() * 2 - 1) * err;
  dir.normalize();
  const listener = game.camera?.position || game.player?.pos;
  const dist = listener ? Math.hypot(origin.x - listener.x, origin.z - listener.z) : 8;
  const occ = listener ? occludedBetween(game.world, origin.x, origin.y, origin.z, listener.x, listener.y || 1.5, listener.z) : false;
  gunfireAt(dist, occ, b.weapon?.class === 'shotgun');
  const { traceShot } = game._combat;
  traceShot(game, origin, dir, b.weapon, b);
}

function visibleDrone(game, b, dcfg) {
  const list = game.droneSys?.drones || [];
  if (!list.length) return null;
  const range = ((dcfg && dcfg.spot) || 24) * 0.85;
  let best = null, bd = range;
  for (const d of list) {
    if (!d.alive || !d.pos) continue;
    if (d.owner?.team === b.team) continue;
    const dist = Math.hypot(d.pos.x - b.pos.x, d.pos.z - b.pos.z, (d.pos.y || 0) - (b.pos.y || 0));
    if (dist > bd) continue;
    const steps = 5;
    let blocked = false;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = b.pos.x + (d.pos.x - b.pos.x) * t;
      const z = b.pos.z + (d.pos.z - b.pos.z) * t;
      const y = b.pos.y + 1.2 + (d.pos.y - (b.pos.y + 1.2)) * t;
      if (game.world.pointInSolid(x, y, z, 0.04, 0.08)) { blocked = true; break; }
    }
    if (!blocked) { bd = dist; best = d; }
  }
  return best;
}

function closestEnemy(game, b) {
  let best = null, bd = 1e9;
  const list = [game.player, ...game.bots].filter(o => o.alive && o.team !== b.team);
  for (const o of list) {
    const d = dist(b, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
function visibleEnemy(game, b, dcfg) {
  let best = null, bd = 1e9;
  const list = [game.player, ...game.bots].filter(o => (o.alive || o.downed) && o.team !== b.team);
  for (const o of list) {
    if (!canSee(game, b, o, dcfg)) continue;
    const d = dist(b, o);
    if (d < bd) { bd = d; best = o; }
  }
  if (best) { best._lastSeen = game.time; return best; }
  const e = closestEnemy(game, b);
  if (e && canHear(game, b, e, dcfg)) {
    e._lastHeard = game.time;
  }
  return null;
}
function nearestSite(game, b) {
  const sites = game.round.pair.sites.map(id => game.world.sites[id]);
  let best = sites[0], bd = 1e9;
  for (const s of sites) {
    const y = game.world.groundAt(s.plant.x, s.plant.z, 8);
    s.y = y;
    const d = Math.hypot(s.plant.x - b.pos.x, s.plant.z - b.pos.z);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function dist(a, b) { return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z, (a.pos.y || 0) - (b.pos.y || 0)); }

function floorYSafe(game, w) {
  return game.world.groundAt(w.x, w.z, (w.y || 2) + 1);
}


function tryObjective(game, b, dt) {
  const r = game.round;
  if (!r || r.phase !== 'action' || b.downed || !b.alive) return;
  const plantT = game.cfg?.plantTime || 7;
  const defuseT = game.cfg?.defuseTime || 7;
  if (b.team === 'attack' && !r.planted && (b.action === 'plant' || b.action === 'flex')) {
    const site = nearestSite(game, b);
    if (site && Math.hypot(b.pos.x - site.plant.x, b.pos.z - site.plant.z) < 1.5) {
      r.plantProgress = (r.plantProgress || 0) + dt;
      if (r.plantProgress >= plantT) {
        r.planted = true;
        r.plantPos = { x: site.plant.x, y: b.pos.y, z: site.plant.z, site: site.id };
        r.t = game.cfg?.bombTime || 45;
        r.plantProgress = 0;
        try { game.emitMatch?.('phase', game._phasePayload?.()); } catch {}
      }
    }
  }
  if (b.team === 'defend' && r.planted && r.plantPos) {
    if (Math.hypot(b.pos.x - r.plantPos.x, b.pos.z - r.plantPos.z) < 1.5) {
      r.defuseProgress = (r.defuseProgress || 0) + dt;
      if (r.defuseProgress >= defuseT) game._endRound('defend', 'defuse');
    }
  }
}

export function botDifficulty(id) { return difficultyParams(id); }

