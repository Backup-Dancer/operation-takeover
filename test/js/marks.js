/** Team-visible ping / scan marks. Gadgets can push the same records later. */
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

export const MARK_TTL = { ping: 6.5, scan: 7.5 };

export function resetMarks(game) {
  game.marks = game.marks || [];
  game.marks.length = 0;
  const box = document.getElementById('hud-marks');
  if (box) box.innerHTML = '';
}

export function addMark(game, opts) {
  if (!game.marks) game.marks = [];
  const mark = {
    id: 'm' + (game._markSeq = (game._markSeq || 0) + 1),
    kind: opts.kind || 'ping',           // ping (manual) | scan (targeted)
    team: opts.team,
    pos: opts.pos.clone ? opts.pos.clone() : new THREE.Vector3(opts.pos.x, opts.pos.y, opts.pos.z),
    target: opts.target || null,
    who: opts.who || null,
    until: (game.time || 0) + (opts.ttl || MARK_TTL[opts.kind || 'ping'] || 6),
  };
  game.marks.push(mark);
  if (mark.kind === 'scan' && mark.target && mark.target === game.player) {
    game.toast('You were marked');
  }
  return mark;
}

export function updateMarks(game) {
  const now = game.time || 0;
  const list = game.marks || (game.marks = []);
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.target?.alive && m.target.pos) {
      m.pos.set(m.target.pos.x, m.target.pos.y + 0.05, m.target.pos.z);
    }
    if (now >= m.until) list.splice(i, 1);
  }
  projectMarks(game);
}

export function projectMarks(game) {
  const box = document.getElementById('hud-marks');
  const cam = game.gfx?.camera;
  if (!box || !cam) return;
  const team = game.player?.team;
  const shown = (game.marks || []).filter(m => !m.team || m.team === team);
  while (box.childElementCount < shown.length) {
    const el = document.createElement('div');
    el.className = 'mark-pin';
    box.appendChild(el);
  }
  while (box.childElementCount > shown.length) box.lastChild.remove();
  const w = box.clientWidth || window.innerWidth;
  const h = box.clientHeight || window.innerHeight;
  shown.forEach((m, i) => {
    const el = box.children[i];
    el.className = 'mark-pin ' + (m.kind === 'scan' ? 'scan' : 'ping');
    _v.copy(m.pos);
    _v.y += m.kind === 'scan' ? 0.15 : 0.4;
    _v.project(cam);
    const behind = _v.z > 1;
    if (behind) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = ((_v.x * 0.5 + 0.5) * w) + 'px';
    el.style.top = ((-_v.y * 0.5 + 0.5) * h) + 'px';
  });
}

/** Ray from the current feed / view camera. Returns a world point and an
 *  enemy under the reticle, if any. */
export function aimPing(game, maxDist = 42) {
  const cam = game.gfx?.camera;
  if (!cam) return { pos: game.player.pos.clone(), target: null };
  const origin = cam.position.clone();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  let target = null, best = 0.92, bestT = maxDist;
  const list = [game.player, ...(game.bots || [])];
  for (const o of list) {
    if (!o?.alive || o.team === game.player.team) continue;
    const to = _p.set(o.pos.x, o.pos.y + 1.1, o.pos.z).sub(origin);
    const dist = to.length();
    if (dist < 0.4 || dist > maxDist) continue;
    to.normalize();
    const dot = to.dot(dir);
    if (dot > best) { best = dot; target = o; bestT = dist; }
  }
  const pos = target
    ? new THREE.Vector3(target.pos.x, target.pos.y, target.pos.z)
    : origin.clone().addScaledVector(dir, Math.min(bestT, 18));
  // If we have a world hit closer than the default, prefer it for a manual ping.
  if (!target && game.world) {
    const ray = new THREE.Raycaster(origin, dir, 0.05, maxDist);
    const hits = ray.intersectObjects([game.world.staticGroup, game.world.dynGroup], true);
    if (hits[0]) pos.copy(hits[0].point);
  }
  return { pos, target };
}


/** If an enemy is in the current feed view, mark them for the team. */
export function autoScan(game, source = 'scout') {
  if (!(game.inDrone || game.inCams || game.droneSys?.active || game.droneSys?.camsOn)) return null;
  const cam = game.gfx?.camera;
  if (!cam) return null;
  const origin = cam.position;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const list = [game.player, ...(game.bots || [])];
  let hit = null, best = 0.78;
  for (const o of list) {
    if (!o?.alive || o.team === game.player.team) continue;
    const to = new THREE.Vector3(o.pos.x, o.pos.y + 1.1, o.pos.z).sub(origin);
    const dist = to.length();
    if (dist < 0.5 || dist > 32) continue;
    to.normalize();
    const dot = to.dot(dir);
    if (dot < best) continue;
    // Must actually see them (a wall blocks an auto-scan).
    if (game.world?.lineOfSight) {
      const a = origin.clone();
      const b = new THREE.Vector3(o.pos.x, o.pos.y + 1.1, o.pos.z);
      if (!game.world.lineOfSight(a, b)) continue;
    }
    best = dot; hit = o;
  }
  if (!hit) return null;
  const already = (game.marks || []).some(m => m.target === hit && m.kind === 'scan' && (game.time || 0) < m.until - 1);
  if (already) return hit;
  addMark(game, {
    kind: 'scan', team: game.player.team, pos: hit.pos, target: hit, who: game.player,
  });
  return hit;
}
