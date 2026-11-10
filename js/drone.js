import * as THREE from 'three';

export class DroneSys {
  constructor(game) { this.game = game; this.active = false; this.camsOn = false; this.camI = 0; this.drone = null; }
  enterDrone() {
    const g = this.game;
    if (g.player.team !== 'attack' && !g._forceDrone) return false;
    if (g.jammedAt?.(g.player.pos)) { g.toast('Static — Blindwell nearby'); return false; }
    if (!this.drone) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.22), new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.6, roughness: 0.4 }));
      g.gfx.scene.add(m);
      this.drone = { mesh: m, pos: g.player.pos.clone().add(new THREE.Vector3(0, 0.2, 0.6)), yaw: g.player.yaw, pitch: -0.15, vy: 0 };
    }
    this.active = true;
    document.getElementById('drone-ov')?.classList.remove('hidden');
    return true;
  }
  exitDrone() {
    this.active = false;
    document.getElementById('drone-ov')?.classList.add('hidden');
  }
  update(dt) {
    const g = this.game;
    if (this.active && this.drone) {
      const inp = g.input, d = this.drone;
      const spd = 3.2;
      const sy = Math.sin(d.yaw), cy = Math.cos(d.yaw);
      d.pos.x += (sy * inp.moveY + cy * inp.moveX) * spd * dt;
      d.pos.z += (cy * inp.moveY - sy * inp.moveX) * spd * dt;
      d.yaw += inp.lookX; d.pitch = Math.max(-1, Math.min(0.6, d.pitch - inp.lookY));
      inp.lookX = inp.lookY = 0;
      // under doors: stay low
      const gnd = g.world.groundAt(d.pos.x, d.pos.z, d.pos.y + 1);
      d.pos.y = Math.max(gnd + 0.12, Math.min(gnd + 0.35, d.pos.y));
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.y = d.yaw;
      const cam = g.gfx.camera;
      cam.position.set(d.pos.x, d.pos.y + 0.08, d.pos.z);
      cam.lookAt(d.pos.x + Math.sin(d.yaw) * Math.cos(d.pitch), d.pos.y + Math.sin(d.pitch), d.pos.z + Math.cos(d.yaw) * Math.cos(d.pitch));
      if (g.jammedAt?.(d.pos)) { g.toast('Signal lost'); this.exitDrone(); }
    }
    if (this.camsOn) this.applyCam();
  }
  enterCams() {
    const g = this.game;
    if (g.player.team !== 'defend' && !g._forceCams) return false;
    const cams = g.world.secCams.filter(c => c.alive);
    if (!cams.length) return false;
    this.camsOn = true; this.camI = 0;
    document.getElementById('cctv-ov')?.classList.remove('hidden');
    this.applyCam();
    return true;
  }
  exitCams() {
    this.camsOn = false;
    document.getElementById('cctv-ov')?.classList.add('hidden');
    for (const c of this.game.world.secCams) this.game.world.setCamWatched(c, false);
  }
  cycle(dir) {
    const cams = this.game.world.secCams.filter(c => c.alive);
    if (!cams.length) return;
    this.camI = (this.camI + dir + cams.length) % cams.length;
    this.applyCam();
  }
  applyCam() {
    const cams = this.game.world.secCams.filter(c => c.alive);
    const c = cams[this.camI] || cams[0];
    if (!c) return false;
    for (const x of this.game.world.secCams) this.game.world.setCamWatched(x, x === c);
    const cam = this.game.gfx.camera;
    cam.position.set(c.x, c.y, c.z);
    cam.lookAt(c.x + Math.sin(c.yaw) * 2, c.y - 0.2, c.z + Math.cos(c.yaw) * 2);
    const name = document.getElementById('cctv-name');
    if (name) name.textContent = c.name;
    return true;
  }
  camView() { return this.camsOn && this.game.world.secCams.some(c => c.watched); }
}
