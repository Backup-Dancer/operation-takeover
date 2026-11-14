/** Attacker scout drones and the defender observation-camera network.
 *  Map data (CAMS, DRONE_GAPS) stays on the map module so a new layout
 *  can drop in without changing this controller. The main renderer
 *  camera is reused — no extra render targets. */
import * as THREE from 'three';
import { sfx } from './audio.js?v=iv-4.1.2-t3';
import { floorY } from './map.js?v=iv-4.1.2-t3';
import { camLabel, scorePopup } from './banners.js?v=iv-4.1.2-t3';
import { worldMove, applyLook } from './match/axes.js?v=iv-4.1.2-t3';
import { addScore } from './match/stats.js?v=iv-4.1.2-t3';

export const DRONE = {
  radius: 0.11,
  height: 0.14,
  eye: 0.09,
  speed: 3.15,
  hopCooldown: 3,
  hopSpeed: 4.6,
  gravity: 16,
  fov: 102,
  near: 0.045,
  far: 90,
  hp: 2,
  bob: 0.007,
};

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

function makeDroneMesh(accent = 0xc9a24a) {
  const g = new THREE.Group();
  g.name = 'scout-drone';
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, metalness: 0.55, roughness: 0.42 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.3, roughness: 0.7 });
  const lightMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.7, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.20), bodyMat);
  body.position.y = 0.055;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.04), bodyMat);
  bar.position.set(0, 0.04, 0);
  const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 8), wheelMat);
  const w2 = w1.clone();
  w1.rotation.z = Math.PI / 2; w2.rotation.z = Math.PI / 2;
  w1.position.set(-0.14, 0.055, 0); w2.position.set(0.14, 0.055, 0);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), lightMat);
  lamp.position.set(0, 0.08, 0.09);
  lamp.name = 'drone-lamp';
  g.add(body, bar, w1, w2, lamp);
  g.userData.lamp = lamp;
  return g;
}

export class DroneSys {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.camsOn = false;
    this.camI = 0;
    this.camYawOff = 0;
    this.camPitchOff = 0;
    this.drones = [];
    this.viewI = 0;
    this.drone = null;       // currently viewed drone (compat with older tests)
    this._savedCam = null;
    this._fx = [];
  }

  /** Build one drone per attacker (player + bots). Safe to call each prep. */
  spawnRound() {
    this.disposeDrones();
    const g = this.game;
    const attackers = [g.player, ...(g.bots || [])].filter(o => o && o.team === 'attack');
    for (let i = 0; i < attackers.length; i++) {
      const owner = attackers[i];
      const yaw = owner.yaw || 0;
      const x = owner.pos.x + Math.sin(yaw) * 0.7;
      const z = owner.pos.z + Math.cos(yaw) * 0.7;
      const y = (g.world.groundAt(x, z, (owner.pos.y || 0) + 1) || 0);
      const d = this._makeDrone(owner, x, y, z, yaw, owner === g.player);
      this.drones.push(d);
      if (owner === g.player) this.drone = d;
    }
    if (!this.drone) this.drone = this.drones[0] || null;
  }

  _makeDrone(owner, x, y, z, yaw, isPlayer) {
    const mesh = makeDroneMesh(isPlayer ? 0xe0c15a : 0x8aa0b8);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.game.gfx.scene.add(mesh);
    return {
      owner, mesh,
      pos: new THREE.Vector3(x, y, z),
      yaw, pitch: -0.12, vy: 0, grounded: true,
      alive: true, hp: DRONE.hp, parked: false,
      hopAt: -99, driving: !isPlayer,
      isPlayer: !!isPlayer, staticUntil: 0,
    };
  }

  disposeDrones() {
    for (const d of this.drones) {
      d.mesh?.parent?.remove(d.mesh);
      d.mesh?.traverse(o => { o.geometry?.dispose?.(); });
    }
    this.drones = [];
    this.drone = null;
    for (const fx of this._fx) fx.mesh?.parent?.remove(fx.mesh);
    this._fx = [];
  }

  dispose() {
    this.exitDrone();
    this.exitCams();
    this.disposeDrones();
  }

  _saveCam() {
    const cam = this.game.gfx.camera;
    if (this._savedCam) return;
    this._savedCam = { fov: cam.fov, near: cam.near, far: cam.far };
  }
  _restoreCam() {
    const cam = this.game.gfx.camera;
    if (!this._savedCam || !cam) return;
    cam.fov = this._savedCam.fov;
    cam.near = this._savedCam.near;
    cam.far = this._savedCam.far;
    cam.updateProjectionMatrix();
    this._savedCam = null;
  }

  enterDrone() {
    const g = this.game;
    if (g.player.team !== 'attack' && !g._forceDrone) return false;
    if (g.jammedAt?.(g.player.pos)) { g.toast('Static — Blindwell nearby'); return false; }
    if (!this.drones.length) this.spawnRound();
    const mine = this.drones.find(d => d.isPlayer) || this.drones[0];
    if (!mine) return false;
    this.drone = mine;
    this.viewI = this.drones.indexOf(mine);
    this._saveCam();
    this.active = true;
    this.camsOn = false;
    document.getElementById('cctv-ov')?.classList.add('hidden');
    document.getElementById('drone-ov')?.classList.remove('hidden');
    this._syncHud();
    this._applyDroneCam(0);
    return true;
  }

  exitDrone() {
    this.active = false;
    document.getElementById('drone-ov')?.classList.add('hidden');
    document.getElementById('drone-ov')?.classList.remove('is-dead');
    if (!this.camsOn) this._restoreCam();
    this._syncHud();
  }

  enterCams() {
    const g = this.game;
    if (g.player.team !== 'defend' && !g._forceCams) return false;
    const cams = this._orderedCams();
    if (!cams.length) return false;
    this._saveCam();
    this.camsOn = true;
    this.active = false;
    this.camI = this._firstLiveIndex(cams);
    this.camYawOff = 0; this.camPitchOff = 0;
    document.getElementById('drone-ov')?.classList.add('hidden');
    document.getElementById('cctv-ov')?.classList.remove('hidden');
    this.applyCam();
    this._syncHud();
    return true;
  }

  exitCams() {
    this.camsOn = false;
    document.getElementById('cctv-ov')?.classList.add('hidden');
    document.getElementById('cctv-ov')?.classList.remove('is-dead');
    for (const c of this.game.world?.secCams || []) this.game.world.setCamWatched(c, false);
    this._hideViewedCam(null);
    if (!this.active) this._restoreCam();
    this._syncHud();
  }

  _firstLiveIndex(cams) {
    const i = cams.findIndex(c => c.alive);
    return i < 0 ? 0 : i;
  }

  /** Cycle cameras. Destroyed cams stay in the list and show static. */
  cycle(dir) {
    const cams = this._orderedCams();
    if (!cams.length) return;
    this.camI = (this.camI + dir + cams.length) % cams.length;
    this.camYawOff = 0; this.camPitchOff = 0;
    this.applyCam();
  }

  cycleDrone(dir) {
    const live = this.drones;
    if (!live.length) return;
    this.viewI = (this.viewI + dir + live.length) % live.length;
    this.drone = live[this.viewI];
    this._syncHud();
    this._applyDroneCam(0);
  }

  _orderedCams() {
    const cams = this.game.world?.secCams || [];
    // Group like a mobile observation tool: basement, ground, upper, then
    // name order within a floor. Exterior cams keep their authored floor.
    const rank = { B: 0, '1': 1, '2': 2 };
    return cams.slice().sort((a, b) => {
      const ra = rank[a.floor] ?? 9, rb = rank[b.floor] ?? 9;
      if (ra !== rb) return ra - rb;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  applyCam() {
    const cams = this._orderedCams();
    const c = cams[this.camI] || cams[0];
    if (!c) return false;
    for (const x of this.game.world.secCams) this.game.world.setCamWatched(x, x === c && c.alive);
    const ov = document.getElementById('cctv-ov');
    const name = document.getElementById('cctv-name');
    if (name) {
      const lab = camLabel(c, this.game.world);
      name.textContent = (c.alive ? '' : 'LOST · ') + lab;
    }
    ov?.classList.toggle('is-dead', !c.alive);
    const cam = this.game.gfx.camera;
    cam.fov = 68; cam.near = 0.05; cam.far = 90; cam.updateProjectionMatrix();
    const yaw = c.yaw + this.camYawOff;
    const pitch = (c.pitch ?? -0.18) + this.camPitchOff;
    const back = 0.16;
    cam.position.set(
      c.x - Math.sin(yaw) * back,
      c.y,
      c.z - Math.cos(yaw) * back,
    );
    cam.lookAt(
      c.x + Math.sin(yaw) * Math.cos(pitch) * 2,
      c.y + Math.sin(pitch) * 2,
      c.z + Math.cos(yaw) * Math.cos(pitch) * 2,
    );
    this._hideViewedCam(c);
    return true;
  }

  /** Don't draw the housing we're looking out of (it filled the near plane). */
  _hideViewedCam(viewed) {
    for (const x of this.game.world?.secCams || []) {
      const hide = !!(viewed && x === viewed);
      if (x.mesh) { x.mesh.visible = !hide; x.mesh.userData.feedHide = hide; }
      if (x.led) { x.led.visible = !hide; x.led.userData.feedHide = hide; }
    }
  }

  camView() { return this.camsOn && this.game.world.secCams.some(c => c.watched || !c.alive); }

  hop(d = this.drone) {
    if (!d || !d.alive) return false;
    const now = this.game.time || 0;
    if (now - (d.hopAt || 0) < DRONE.hopCooldown) return false;
    if (!d.grounded) return false;
    d.hopAt = now;
    d.grounded = false;
    const lookUp = Math.sin(d.pitch);
    const lookFlat = Math.cos(d.pitch);
    d.vy = DRONE.hopSpeed * (0.55 + Math.max(0, lookUp) * 0.8);
    const boost = DRONE.hopSpeed * 0.55 * Math.max(0.35, lookFlat);
    d._hopX = Math.sin(d.yaw) * boost;
    d._hopZ = Math.cos(d.yaw) * boost;
    sfx.droneHop?.() || sfx.step();
    return true;
  }

  hit(d, dmg, who) {
    if (!d || !d.alive) return false;
    const wound = (dmg || 20) >= 40 ? 2 : 1;
    d.hp -= wound;
    sfx.hit();
    this._spark(d.pos);
    if (d.hp <= 0) {
      d.alive = false;
      d.driving = false;
      if (d.mesh) d.mesh.visible = false;
      d.staticUntil = (this.game.time || 0) + 99;
      sfx.break();
      if (this.active && this.drone === d) {
        document.getElementById('drone-ov')?.classList.add('is-dead');
        const lab = document.getElementById('drone-label');
        if (lab) lab.textContent = 'SIGNAL LOST';
        this.game.toast('Scout destroyed');
        if (who === this.game.player) {
        scorePopup(this.game, 'scoutDown');
        addScore(who, 'drone', 25, this.game);
      }
      }
    }
    return true;
  }

  _spark(pos) {
    const g = this.game;
    const geo = new THREE.SphereGeometry(0.03, 5, 4);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffcc66 }));
      m.position.copy(pos); m.position.y += 0.08;
      g.gfx.scene.add(m);
      this._fx.push({
        mesh: m, t: 0.35,
        v: new THREE.Vector3((Math.random() - 0.5) * 2.2, 1.6 + Math.random(), (Math.random() - 0.5) * 2.2),
      });
    }
  }

  update(dt) {
    const g = this.game;
    if (this.active && this.drone) this._driveViewed(dt);
    if (this.camsOn) this._lookCams(dt);
    this._tickFx(dt);
  }

  _driveViewed(dt) {
    const g = this.game, d = this.drone, inp = g.input;
    if (!d.alive) {
      document.getElementById('drone-ov')?.classList.add('is-dead');
      return;
    }
    document.getElementById('drone-ov')?.classList.remove('is-dead');
    // Look (right stick / look zone already writes lookX/lookY).
    const turned = applyLook(d.yaw, d.pitch, inp.lookX, inp.lookY, -1.05, 0.7);
    d.yaw = turned.yaw;
    d.pitch = turned.pitch;
    inp.lookX = inp.lookY = 0;
    if (!d.parked) this._integrate(d, dt, inp.moveX, inp.moveY, true);
    if (g.jammedAt?.(d.pos)) { g.toast('Signal lost'); this.exitDrone(); return; }
    this._applyDroneCam(dt);
    const lab = document.getElementById('drone-label');
    if (lab) {
      const owner = d.isPlayer ? 'YOU' : (d.owner?.op?.name || d.owner?.opId || 'TEAM').toUpperCase();
      lab.textContent = 'POSITION SCOUTS · ' + owner;
    }
  }

  _lookCams(dt) {
    const inp = this.game.input;
    const limY = 0.85, limP = 0.42;
    const turned = applyLook(this.camYawOff, this.camPitchOff, inp.lookX, inp.lookY, -limP, limP);
    this.camYawOff = Math.max(-limY, Math.min(limY, turned.yaw));
    this.camPitchOff = turned.pitch;
    inp.lookX = inp.lookY = 0;
    this.applyCam();
  }

  _applyDroneCam(dt) {
    const d = this.drone, cam = this.game.gfx.camera;
    if (!d || !cam) return;
    cam.fov = DRONE.fov; cam.near = DRONE.near; cam.far = DRONE.far;
    cam.updateProjectionMatrix();
    const moving = d._speed || 0;
    const bob = Math.sin((this.game.time || 0) * 11) * DRONE.bob * Math.min(1, moving / 2);
    const eye = d.pos.y + DRONE.eye + bob;
    cam.position.set(d.pos.x, eye, d.pos.z);
    cam.lookAt(
      d.pos.x + Math.sin(d.yaw) * Math.cos(d.pitch),
      eye + Math.sin(d.pitch),
      d.pos.z + Math.cos(d.yaw) * Math.cos(d.pitch),
    );
    if (d.mesh) {
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.y = d.yaw;
      // Don't draw the hull we're looking out of (it filled the near plane).
      d.mesh.visible = d.alive && !(this.active && this.drone === d);
      const lamp = d.mesh.userData.lamp;
      if (lamp?.material) lamp.material.emissiveIntensity = this.active && this.drone === d ? 1.1 : 0.35;
    }
  }

  _integrate(d, dt, moveX, moveY, playerSteer) {
    const g = this.game;
    const gnd = g.world.groundAt(d.pos.x, d.pos.z, d.pos.y + 1);
    const ceil = g.world.ceilingAt?.(d.pos.x, d.pos.z, d.pos.y) ?? 40;
    const wmv = worldMove(moveX, moveY, d.yaw);
    let vx = 0, vz = 0;
    if (d.grounded) {
      vx = wmv.x * DRONE.speed;
      vz = wmv.z * DRONE.speed;
      d.vy = 0;
      d.pos.y = gnd;
    } else {
      vx = (d._hopX || 0) + wmv.x * DRONE.speed * 0.45;
      vz = (d._hopZ || 0) + wmv.z * DRONE.speed * 0.45;
      d.vy -= DRONE.gravity * dt;
      d.pos.y += d.vy * dt;
      if (d.pos.y <= gnd) { d.pos.y = gnd; d.vy = 0; d.grounded = true; d._hopX = 0; d._hopZ = 0; }
      if (d.pos.y + DRONE.height > ceil) { d.pos.y = ceil - DRONE.height; d.vy = Math.min(0, d.vy); }
    }
    d.pos.x += vx * dt;
    d.pos.z += vz * dt;
    d._speed = Math.hypot(vx, vz);
    g.world.resolve(d.pos, DRONE.radius, DRONE.height);
    // Re-snap to floor when grounded so resolve cannot shove us under the map.
    if (d.grounded) {
      const g2 = g.world.groundAt(d.pos.x, d.pos.z, d.pos.y + 1);
      if (Number.isFinite(g2)) d.pos.y = g2;
    }
    if (d.mesh) { d.mesh.position.copy(d.pos); d.mesh.rotation.y = d.yaw; }
  }

  /** Attacker bots drive their scouts in prep, then park them. */
  updateBots(dt) {
    const g = this.game;
    const prep = g.round?.phase === 'prep';
    for (const d of this.drones) {
      if (!d.alive) { if (d.mesh) d.mesh.visible = false; continue; }
      if (d.isPlayer && this.active && this.drone === d) continue;
      if (d.driving && prep) this._botDrive(d, dt);
      else if (d.mesh) { d.mesh.position.copy(d.pos); d.mesh.rotation.y = d.yaw; }
      if (!prep) d.driving = false;
    }
  }

  _botDrive(d, dt) {
    const g = this.game;
    const site = g.round?.pair?.sites?.[0] && g.world.sites[g.round.pair.sites[0]];
    const tx = site?.plant?.x ?? 0;
    const tz = site?.plant?.z ?? 0;
    const ty = site ? (g.world.groundAt(tx, tz, 8) || 0) : 0;
    // If a wall is in the way, steer toward the nearest drone gap.
    let aimX = tx, aimZ = tz;
    const blocked = g.world.pointInSolid(
      d.pos.x + (tx - d.pos.x) * 0.08,
      d.pos.y + 0.08,
      d.pos.z + (tz - d.pos.z) * 0.08,
      0.05, 0.08,
    );
    if (blocked) {
      const gap = g.world.nearestDroneGap?.(d.pos, { x: tx, z: tz });
      if (gap) { aimX = gap.x; aimZ = gap.z; }
    }
    const dx = aimX - d.pos.x, dz = aimZ - d.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) { d.driving = false; d.parked = true; return; }
    d.yaw = Math.atan2(dx, dz);
    this._integrate(d, dt, 0, 1, false);
    if (d._stuck == null) d._stuck = 0;
    if (d._speed < 0.15) {
      d._stuck += dt;
      if (d._stuck > 0.7) { this.hop(d); d._stuck = 0; }
    } else d._stuck = 0;
  }

  _tickFx(dt) {
    for (let i = this._fx.length - 1; i >= 0; i--) {
      const fx = this._fx[i];
      fx.t -= dt;
      fx.v.y -= 10 * dt;
      fx.mesh.position.addScaledVector(fx.v, dt);
      if (fx.t <= 0) { fx.mesh.parent?.remove(fx.mesh); this._fx.splice(i, 1); }
    }
  }

  _syncHud() {
    const g = this.game;
    const feed = this.active || this.camsOn;
    const touch = document.getElementById('touch');
    touch?.classList.toggle('feed-on', !!feed);
    document.body.classList.toggle('cam-feed', !!this.camsOn);
    document.body.classList.toggle('drone-feed', !!this.active);
    if (this.game.gfx) this.game.gfx.skipPost = !!this.active;
    const team = g.player?.team;
    document.getElementById('tb-drone')?.classList.toggle('hidden', feed || team !== 'attack');
    document.getElementById('tb-cams')?.classList.toggle('hidden', feed || team !== 'defend');
    document.getElementById('tb-hop')?.classList.toggle('hidden', !this.active);
    document.getElementById('tb-scan')?.classList.toggle('hidden', !feed);
    document.getElementById('tb-switch')?.classList.toggle('hidden', !feed);
    document.getElementById('tb-feed-exit')?.classList.toggle('hidden', !feed);
    document.getElementById('tb-cycle-l')?.classList.toggle('hidden', !feed);
    document.getElementById('tb-cycle-r')?.classList.toggle('hidden', !feed);
  }

  list() { return this.drones; }
}
