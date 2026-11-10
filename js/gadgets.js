import * as THREE from 'three';
import { sfx } from './audio.js?v=iv-4.1.1';
import { createGadgetMesh } from './models.js?v=iv-4.1.1';

/** All placed explosives are remote-detonated. No auto fuse. */
export class Gadgets {
  constructor(game) {
    this.game = game;
    this.charges = []; // placed explosives / remote gadgets
    this.traps = [];
    this.utility = [];
    this.selected = 'all';
    this.nextId = 1;
  }

  reset() {
    for (const c of this.charges) if (c.mesh?.parent) c.mesh.parent.remove(c.mesh);
    this.charges = []; this.traps = []; this.utility = []; this.selected = 'all';
  }

  placeExplosive(kind, pos, nrm, owner, extra = {}) {
    const g = this.game;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(kind === 'hearthlance' ? 0.28 : 0.16, 0.1, 0.2),
      new THREE.MeshStandardMaterial({ color: kind === 'hearthlance' ? 0xb87333 : 0x222226, roughness: 0.5, metalness: 0.6 })
    );
    mesh.position.copy(pos);
    if (nrm) mesh.lookAt(pos.clone().add(nrm));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0x990000, emissiveIntensity: 0.6 }));
    led.position.set(0, 0.06, 0.08);
    mesh.add(led);
    g.world.dynGroup.add(mesh);
    createGadgetMesh(kind).then(authored => {
      if (!authored || !chRef.live) return;
      authored.position.copy(mesh.position);
      authored.quaternion.copy(mesh.quaternion);
      if (mesh.parent) mesh.parent.add(authored);
      mesh.parent?.remove(mesh);
      chRef.mesh = authored;
    }).catch(() => {});
    const ch = {
      id: this.nextId++, kind, pos: pos.clone(), nrm: nrm?.clone() || new THREE.Vector3(0, 0, 1),
      owner, team: owner?.team || g.player.team, mesh, led,
      armed: true, live: true, disabled: false, hp: 30,
      beepT: 0, directional: !!extra.directional, yaw: extra.yaw || 0,
      target: extra.target || null,
    };
    const chRef = ch;
    this.charges.push(ch);
    sfx.plant();
    this._refreshHud();
    return ch;
  }

  canPlace(kind) {
    // world trace from eye
    const g = this.game, p = g.player;
    const origin = g.gfx.camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(g.gfx.camera.quaternion);
    const ray = new THREE.Raycaster(origin, dir, 0.1, 2.4);
    const hits = ray.intersectObjects([g.world.staticGroup, g.world.dynGroup], true);
    if (!hits.length) return null;
    const h = hits[0];
    return { pos: h.point, nrm: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate(), obj: h.object };
  }

  tryPlace(kind) {
    const hit = this.canPlace(kind);
    if (!hit) { this.game.toast('No surface'); return null; }
    if (kind === 'hearthlance') {
      const chnk = hit.obj.userData?.chunk;
      if (chnk && !chnk.reinforced && !this._isReinforcedNear(hit.pos)) {
        // still allow on soft or reinforced
      }
    }
    return this.placeExplosive(kind, hit.pos, hit.nrm, this.game.player);
  }

  _isReinforcedNear(pos) {
    return this.game.world.chunks.some(c => c.reinforced && Math.hypot(c.x - pos.x, c.z - pos.z) < 0.8);
  }

  update(dt) {
    for (const c of this.charges) {
      if (!c.live || c.disabled) continue;
      c.beepT += dt;
      if (c.beepT > 1.0) {
        c.beepT = 0;
        sfx.armBeep();
        if (c.led) c.led.material.emissiveIntensity = 1.4;
      } else if (c.led) {
        c.led.material.emissiveIntensity = 0.4 + Math.sin(c.beepT * 10) * 0.3;
      }
    }
    const any = this.charges.some(c => c.live && c.armed && c.team === this.game.player.team && !c.disabled);
    document.getElementById('tb-detonate')?.classList.toggle('hidden', !any || this.game.inMenu);
    this._refreshHud(false);
  }

  detonate(which = 'selected') {
    const team = this.game.player.team;
    const list = this.charges.filter(c => c.live && c.armed && !c.disabled && c.team === team);
    if (!list.length) return 0;
    let targets;
    if (which === 'all' || this.selected === 'all') targets = list;
    else if (typeof which === 'number') targets = list.filter(c => c.id === which);
    else targets = list.filter(c => c.id === this.selected);
    if (!targets.length) targets = [list[0]];
    let n = 0;
    for (const c of targets) { this._explode(c); n++; }
    this._refreshHud();
    return n;
  }

  _explode(c) {
    if (!c.live) return;
    c.live = false;
    sfx.explode();
    if (c.mesh?.parent) c.mesh.parent.remove(c.mesh);
    const g = this.game;
    const r = c.kind === 'hearthlance' ? 0.7 : (c.kind === 'demo' ? 2.2 : 1.2);
    // damage chunks / hatches / doors / windows / other gadgets
    for (const ch of g.world.chunks) {
      if (Math.hypot(ch.x - c.pos.x, ch.z - c.pos.z) < r + 0.4 && Math.abs((ch.y || 0) - c.pos.y) < 1.6) {
        const amt = c.kind === 'hearthlance' ? (ch.reinforced ? 999 : 200) : 160;
        g.world.damageChunk(ch, amt);
        if (c.kind === 'hearthlance' && ch.reinforced) {
          // punch a vault hole — destroy this and neighbors
          for (const n of g.world.chunks) {
            if (Math.hypot(n.x - ch.x, n.z - ch.z) < 0.9 && Math.abs(n.y - ch.y) < 1.4) g.world.damageChunk(n, 999);
          }
        }
      }
    }
    for (const h of g.world.hatches) {
      if (Math.hypot(h.x - c.pos.x, h.z - c.pos.z) < 1.0 && Math.abs(h.y - c.pos.y) < 0.8) {
        for (const ch of h.cell.chunks) g.world.damageChunk(ch, c.kind === 'hearthlance' ? 999 : 200);
      }
    }
    for (const w of g.world.windows) {
      if (Math.hypot(w.x - c.pos.x, w.z - c.pos.z) < 1.2) g.world.damageWindow(w, 200);
    }
    for (const d of g.world.doors) {
      if (Math.hypot(d.x - c.pos.x, d.z - c.pos.z) < 1.1) { d.state = 'open'; d.target = Math.PI / 2; d.angle = Math.PI / 2; d.barricaded = false; }
    }
    // EMP
    if (c.kind === 'nulldisc') {
      for (const o of this.charges) {
        if (o !== c && o.live && o.pos.distanceTo(c.pos) < 3.2) this.disable(o);
      }
      for (const t of this.traps) {
        if (t.live && t.pos.distanceTo(c.pos) < 3.2) t.live = false, t.disabled = true;
      }
      for (const cam of g.world.secCams) {
        if (Math.hypot(cam.x - c.pos.x, cam.z - c.pos.z) < 3.2) { cam.alive = false; }
      }
    }
    // damage pawns
    for (const b of [g.player, ...g.bots]) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z, (b.pos.y || 0) - c.pos.y);
      if (d < 2.4) {
        const dmg = c.kind === 'nulldisc' ? 0 : (120 * (1 - d / 2.4));
        if (dmg > 0) g.hurt(b, dmg, c.pos, false, { explosive: true });
      }
    }
    this.game.spawnBurst?.(c.pos);
  }

  disable(c) {
    c.disabled = true; c.armed = false;
    if (c.led) { c.led.material.emissive = new THREE.Color(0x333333); c.led.material.emissiveIntensity = 0.1; }
  }

  shootCharge(c, dmg = 20) {
    if (!c.live) return;
    c.hp -= dmg;
    if (c.hp <= 0) {
      c.live = false;
      if (c.mesh?.parent) c.mesh.parent.remove(c.mesh);
      this._refreshHud();
    }
  }

  hitCharges(origin, dir, max = 80) {
    let best = null, bt = max;
    for (const c of this.charges) {
      if (!c.live) continue;
      const to = c.pos.clone().sub(origin);
      const t = to.dot(dir);
      if (t < 0 || t > bt) continue;
      const closest = origin.clone().addScaledVector(dir, t);
      if (closest.distanceTo(c.pos) < 0.25) { best = c; bt = t; }
    }
    return best;
  }

  _refreshHud(force = true) {
    const box = document.getElementById('hud-detonate');
    const list = document.getElementById('det-list');
    if (!box || !list) return;
    const mine = this.charges.filter(c => c.live && c.team === this.game.player.team);
    if (!mine.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (!force && list.childElementCount === mine.length + 1) return;
    list.innerHTML = '';
    const all = document.createElement('button');
    all.textContent = 'DETONATE ALL';
    all.onclick = () => { this.selected = 'all'; this.detonate('all'); };
    list.appendChild(all);
    for (const c of mine) {
      const b = document.createElement('button');
      b.textContent = `#${c.id} ${label(c.kind)}${c.disabled ? ' (dead)' : ''}`;
      b.onclick = () => { this.selected = c.id; this.detonate(c.id); };
      list.appendChild(b);
    }
  }
}

function label(k) {
  return ({ breach: 'Breach', hearthlance: 'Lance', mine: 'Mine', demo: 'Demo', nulldisc: 'Null', needleburst: 'Needle' })[k] || k;
}

export function placeTrap(game, kind, pos, extra = {}) {
  const trap = { kind, pos: pos.clone(), live: true, disabled: false, team: 'defend', ...extra };
  game.gadgets.traps.push(trap);
  return trap;
}
