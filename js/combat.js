import * as THREE from 'three';
import { AIM_ASSIST, CANCEL_READY, SPRINT_OUT_FIRE } from './config.js?v=iv-3.7.1';
import { sfx } from './audio.js?v=iv-3.7.1';

export function isHostile(game, t) {
  if (!t) return false;
  if (t === game.player) return false;
  if (t.kind === 'hostage' || t.kind === 'civilian') return false;
  if (t.compliant) return false;
  if (t.team && t.team === game.player.team) return false;
  if (t.side && t.side === game.player.team) return false;
  if (t.alive === false) return false;
  // teammates
  if (game.bots?.includes(t) && t.team === game.player.team) return false;
  return t.team && t.team !== game.player.team;
}

export function aimAssistTarget(game) {
  const level = game.settings.aimAssist || 'low';
  const str = AIM_ASSIST[level] || 0;
  if (!str) return null;
  const cam = game.gfx.camera;
  const origin = cam.position;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  let best = null, bs = 0.22;
  for (const b of game.bots) {
    if (!isHostile(game, b) || !b.alive) continue;
    const to = new THREE.Vector3(b.pos.x, b.pos.y + 1.4, b.pos.z).sub(origin);
    const dist = to.length();
    if (dist > 42 || dist < 0.4) continue;
    to.normalize();
    const dot = to.dot(dir);
    const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
    if (ang < bs) { bs = ang; best = { bot: b, ang, dist, str }; }
  }
  return best;
}

export function applyAimAssist(game, dt) {
  const t = aimAssistTarget(game);
  if (!t) return;
  // weak pull — Low is slight
  const p = game.player;
  const cam = game.gfx.camera;
  const origin = cam.position;
  const want = new THREE.Vector3(t.bot.pos.x, t.bot.pos.y + 1.4, t.bot.pos.z).sub(origin);
  const yaw = Math.atan2(want.x, want.z);
  const pitch = Math.asin(clamp(want.y / want.length(), -1, 1));
  const k = t.str * 6 * dt;
  p.yaw += (yaw - p.yaw) * k * 0.15;
  p.pitch += (pitch - p.pitch) * k * 0.12;
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function cancelReload(game) {
  const w = game.weapon;
  if (!w || !w.reloading) return;
  w.reloading = false;
  w.reloadAt = 0;
  w.readyAt = (game.time || 0) + (CANCEL_READY || 0.2);
}

export function cancelGadget(game) {
  if (game._gadgetBusy) {
    game._gadgetBusy = false;
    game._gadgetReadyAt = (game.time || 0) + (CANCEL_READY || 0.2);
  }
}

/** Interrupt gadget/reload and return whether the player may fire now. */
export function cancelToReady(game) {
  cancelReload(game);
  cancelGadget(game);
  const now = game.time || 0;
  if (game.weapon?.readyAt && now < game.weapon.readyAt) return false;
  if (game._gadgetReadyAt && now < game._gadgetReadyAt) return false;
  if (game.player?._sprintOutFireUntil && now < game.player._sprintOutFireUntil) return false;
  return true;
}

export function fireWeapon(game) {
  const p = game.player, wpn = game.weapon;
  if (p.sprint) {
    p.sprint = false; p.sprintLock = false;
    p._sprintOutFireUntil = (game.time || 0) + (SPRINT_OUT_FIRE || 0.18);
  }
  if (!cancelToReady(game)) return;
  if (!wpn || wpn.clip <= 0) { if (wpn && wpn.clip <= 0) game.input.events.add('reload'); return; }
  const now = game.time;
  const interval = 60 / (wpn.rpm || 600);
  if (now < (wpn.nextShot || 0)) return;
  wpn.nextShot = now + interval;
  wpn.clip--;
  game.vmKick = (game.vmKick || 0) + 1;
  sfx.fire(wpn.class === 'shotgun');
  const pellets = wpn.pellets || 1;
  const ads = p.ads;
  const spread = (lerp(wpn.spread, wpn.adsSpread, ads) * (p.stance >= 1.8 ? 0.6 : p.stance >= 0.8 ? 0.8 : 1)) * 0.01745;
  const cam = game.gfx.camera;
  const origin = cam.position.clone();
  const base = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  // recoil
  p.pitch += (wpn.recoil?.[0] || 0.2) * 0.015;
  p.yaw += ((Math.random() * 2 - 1) * (wpn.recoil?.[1] || 0.08)) * 0.02;
  game._shotgunSplashDone = false;
  for (let i = 0; i < pellets; i++) {
    const dir = base.clone();
    dir.x += (Math.random() * 2 - 1) * spread;
    dir.y += (Math.random() * 2 - 1) * spread;
    dir.z += (Math.random() * 2 - 1) * spread;
    dir.normalize();
    traceShot(game, origin, dir, wpn, p);
  }
  game.updateAmmo?.();
}

function lerp(a, b, t) { return a + (b - a) * t; }

export function traceShot(game, origin, dir, wpn, who) {
  // charges first
  const ch = game.gadgets.hitCharges(origin, dir, 80);
  if (ch) { game.gadgets.shootCharge(ch, wpn.dmg || 20); return; }
  // scout drones (shootable in prep and action)
  const drones = game.droneSys?.drones || [];
  for (const d of drones) {
    if (!d.alive || !d.pos) continue;
    const t = _closest(origin, dir, new THREE.Vector3(d.pos.x, d.pos.y + 0.06, d.pos.z), 80, 0.16);
    if (t != null) { game.droneSys.hit(d, wpn.dmg || 20, who); return; }
  }
  // cams
  for (const cam of game.world.secCams) {
    if (!cam.alive) continue;
    const t = _closest(origin, dir, new THREE.Vector3(cam.x, cam.y, cam.z), 80, 0.18);
    if (t != null) {
      cam.alive = false;
      if (cam.led) {
        cam.led.material.emissive = new THREE.Color(0x000000);
        cam.led.material.emissiveIntensity = 0;
      }
      game.toast?.('Camera destroyed');
      return;
    }
  }
  // gadgets traps etc skipped
  // Operators cannot eliminate each other during prep.
  if (game.round?.phase === 'prep') return;
  // pawns
  let best = null, bt = 80;
  const pawns = [game.player, ...game.bots].filter(b => b !== who && b.alive);
  for (const b of pawns) {
    const head = new THREE.Vector3(b.pos.x, b.pos.y + 1.65, b.pos.z);
    const torso = new THREE.Vector3(b.pos.x, b.pos.y + 1.15, b.pos.z);
    const th = _closest(origin, dir, head, bt, 0.16);
    if (th != null) { best = { b, head: true, t: th }; bt = th; continue; }
    const tt = _closest(origin, dir, torso, bt, 0.28);
    if (tt != null) { best = { b, head: false, t: tt }; bt = tt; }
  }
  if (best) {
    const dmg = (wpn.dmg || 30) * (best.head ? (wpn.head || 2.3) : 1);
    game.hurt(best.b, dmg, origin, best.head, { who });
    sfx[best.head ? 'head' : 'hit']();
    return;
  }
  // world
  const ray = new THREE.Raycaster(origin, dir, 0.05, 80);
  const hits = ray.intersectObjects([game.world.staticGroup, game.world.dynGroup], true);
  const winHit = game.world.hitWindowOnRay?.(origin, dir, hits[0]?.distance ?? 80);
  if (winHit && (!hits[0] || game.world.rayHitsWindow(origin, dir, hits[0].distance, winHit) != null)) {
    game.world.damageWindow(winHit, wpn.dmg || 30);
    return;
  }
  if (hits[0]) {
    const o = hits[0].object;
    if (o.userData.chunk) {
      const ch = o.userData.chunk;
      game.world.damageChunk(ch, wpn.dmg || 30);
      if ((wpn.class === 'shotgun' || (wpn.pellets || 1) > 3) && !game._shotgunSplashDone) {
        game._shotgunSplashDone = true;
        game.world.damageNeighbors(ch, (wpn.dmg || 18) * 2.5);
      }
    }
    if (o.userData.window) game.world.damageWindow(o.userData.window, wpn.dmg || 30);
    if (o.userData.hatch?.cell) {
      for (const ch of o.userData.hatch.cell.chunks) game.world.damageChunk(ch, wpn.dmg || 30);
    }
    game.spawnDecal?.(hits[0].point, hits[0].face?.normal);
  }
}

export function melee(game) {
  const p = game.player, cam = game.gfx?.camera;
  if (!p?.alive || !cam) return false;
  if (p._meleeUntil && game.time < p._meleeUntil) return false;
  p._meleeUntil = (game.time || 0) + 0.45;
  sfx.break();
  const origin = cam.position.clone();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const ray = new THREE.Raycaster(origin, dir, 0.02, 1.85);
  const hits = ray.intersectObjects([game.world.staticGroup, game.world.dynGroup], true);
  let hit = false;
  const winHit2 = game.world.hitWindowOnRay?.(origin, dir, 1.85);
  if (winHit2) {
    if (winHit2.state === 'barricaded') game.world.peekBarricade(winHit2, origin.y + dir.y * 0.9);
    else game.world.damageWindow(winHit2, 90);
    hit = true;
  }
  if (hits[0]) {
    const o = hits[0].object;
    if (o.userData.chunk) { game.world.damageChunk(o.userData.chunk, 90); hit = true; }
    if (o.userData.window) { game.world.damageWindow(o.userData.window, 90); hit = true; }
    if (o.userData.hatch?.cell) {
      for (const ch of o.userData.hatch.cell.chunks) game.world.damageChunk(ch, 90);
      hit = true;
    }
    game.spawnDecal?.(hits[0].point, hits[0].face?.normal);
  }
  const reach = origin.clone().addScaledVector(dir, 1.4);
  for (const b of (game.bots || [])) {
    if (!b.alive || b === p) continue;
    const torso = new THREE.Vector3(b.pos.x, b.pos.y + 1.1, b.pos.z);
    if (torso.distanceTo(reach) < 0.7 || torso.distanceTo(origin) < 1.6) {
      game.hurt(b, 55, origin, false, { who: p, melee: true });
      sfx.hit();
      hit = true;
    }
  }
  return hit;
}

function _closest(origin, dir, point, max, rad) {
  const to = point.clone().sub(origin);
  const t = to.dot(dir);
  if (t < 0 || t > max) return null;
  const c = origin.clone().addScaledVector(dir, t);
  if (c.distanceTo(point) <= rad) return t;
  return null;
}

export function beginReload(game) {
  const w = game.weapon;
  if (!w || w.clip === w.mag || w.reserve <= 0 || w.reloading) return;
  w.reloading = true;
  w.reloadAt = game.time + (w.reload || 2.2);
  if (game.player) game.player.adsToggle = false;
  if (game.input) game.input.ads = false;
  sfx.reload();
}
export function finishReload(game) {
  const w = game.weapon;
  if (!w || !w.reloading) return;
  if (game.time < w.reloadAt) return;
  w.reloading = false;
  const need = w.mag - w.clip;
  const take = Math.min(need, w.reserve);
  w.clip += take; w.reserve -= take;
  game.updateAmmo?.();
}
