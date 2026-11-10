import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createOperatorMesh, attachWeaponToHand } from '../models.js?v=iv-3.6.1';
import { OperatorShowcase } from './OperatorShowcase.js?v=iv-3.6.1';

const RED = 0xff2a2a;
const BLUE = 0x2a6bff;

/**
 * Night street menu background for Halcyon Press: wet asphalt, two
 * faction vehicles, red/blue light-bar sweeps, a few body loops.
 * Procedural (reuses in-game KTX2 materials) so it fits the 25MB cap.
 * Pauses on hidden tab and while a match is running.
 */
export class MenuScene {
  constructor(game) {
    this.game = game;
    this.gfx = game.gfx;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2230);
    this.scene.fog = new THREE.Fog(0x243044, 22, 48);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.2, 80);
    this.mode = 'street'; // street | showcase | dim
    this._paused = false;
    this._t = 0;
    this._frame = 0;
    this._bodies = [];
    this._quality = (this.gfx.quality === 'high' || this.gfx.quality === 'ultra') ? 'high'
      : (this.gfx.quality === 'low' ? 'low' : 'med');
    this.showcase = new OperatorShowcase(this);
    this._onVis = () => { this._paused = document.hidden; };
    document.addEventListener('visibilitychange', this._onVis);
    this._build();
    this._spawnBodies();
  }

  setMode(mode) {
    const next = mode || 'street';
    const prev = this.mode;
    this.mode = next;
    const r = this.gfx?.renderer;
    if (!r) return;
    if (next === 'showcase') {
      this._prevDpr = this.gfx.dpr;
      const want = Math.min(2, window.devicePixelRatio || 2);
      this.gfx.dpr = want;
      r.setPixelRatio(want);
      this.gfx.resize?.();
      r.setPixelRatio(want);
      r.setSize(r.domElement.clientWidth, r.domElement.clientHeight, false);
    } else if (prev === 'showcase') {
      const cap = this._prevDpr != null ? this._prevDpr : (this.gfx._cfg?.().dpr || 1);
      this.gfx.dpr = cap;
      this.gfx.resize?.();
      this._prevDpr = null;
    }
  }

  pause() { this._paused = true; }
  resume() { this._paused = document.hidden; }

  _mat(name, tint, opts = {}) {
    try {
      if (this.gfx?.mat) return this.gfx.mat(name, { tint, ...opts });
    } catch {}
    return new THREE.MeshStandardMaterial({ color: tint || 0x888888, roughness: 0.9, metalness: 0.05 });
  }

  _box(w, h, d, mat, x, y, z, rotY = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = false;
    m.receiveShadow = false;
    this.scene.add(m);
    return m;
  }

  _build() {
    if (this.gfx?.env) {
      this.scene.environment = this.gfx.env;
      this.scene.environmentIntensity = 0.85;
    }
    const hemi = new THREE.HemisphereLight(0xc8d4e8, 0x1a140c, 1.15);
    const moon = new THREE.DirectionalLight(0xe8eef8, 1.35);
    moon.position.set(-8, 14, 6);
    const street = new THREE.SpotLight(0xffe2b8, 3.2, 28, 0.7, 0.45, 1.1);
    street.position.set(0.4, 7.2, 4.5);
    street.target.position.set(0.2, 0, -6);
    this.scene.add(hemi, moon, street, street.target);
    this._hemi = hemi;
    this._moon = moon;

    const asphalt = this._wetAsphalt();
    const brick = this._mat('brick', 0x8a5a48);
    const plaster = this._mat('plaster', 0xc8bba8);
    const wood = this._mat('wood', 0x5a3e2a) || this._mat('plaster', 0x5a3e2a);
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.45, metalness: 0.75 });

    // Wet street
    this._box(28, 0.08, 22, asphalt, 0, -0.04, 2);
    // Sidewalk
    this._box(28, 0.1, 3.2, this._mat('concrete', 0x5a5c60) || plaster, 0, 0.05, -5.2);

    // Facade: two floors + basement lip
    this._box(16, 7.2, 1.2, brick, 0, 3.6, -7.4);
    this._box(16, 0.35, 2.2, metal, 0, 0.15, -6.6); // loading lip
    this._box(16.4, 0.35, 1.4, brick, 0, 7.3, -7.4); // cornice
    // Windows (emissive warm interiors, slightly)
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x2a1c0c, emissive: 0xffcc88, emissiveIntensity: 0.85, roughness: 0.28, metalness: 0.08,
    });
    // Keep a brick gap in the centre of the upper floor so the wordmark
    // sits on masonry, not on bright window panes.
    const winPos = [[-6.1, 5.25], [5.7, 5.25], [-5.2, 2.35], [5.3, 2.35], [-2.6, 2.35]];
    for (const [x, y] of winPos) this._box(1.25, 1.45, 0.12, winMat, x, y, -6.78);
    // Door
    this._box(1.5, 2.4, 0.16, wood, -1.5, 1.25, -6.78);
    // Building sign on the left, out of the subtitle's way.
    this._box(2.6, 0.5, 0.08, metal, -5.4, 3.95, -6.72);

    // Alley right
    this._box(4, 6.5, 8, plaster, 10.2, 3.2, -5.5);

    // Ashline armoured van (left) and Holdfast sedan (right)
    this._armouredVan(-3.15, 0, 2.05, 0.55, 0x2a2e33, 0xc67636);
    this._sedan(3.55, 0, 2.2, -0.85, 0x1e2420, 0x6a8f4a);

    // Light bars sit on the van roof and the lower sedan roof.
    this.barAsh = this._lightBar(-3.15, 2.22, 2.05, 0.55);
    this.barHold = this._lightBar(3.55, 1.46, 2.2, -0.85);
    this.barHold.red.intensity *= 0.85;
    this.barHold.blue.intensity *= 0.85;
    // Soft alternating wash on the brick so the colors read behind the menu.
    this._washRed = new THREE.PointLight(RED, 4.5, 16, 1.1);
    this._washBlue = new THREE.PointLight(BLUE, 4.5, 16, 1.1);
    this._washRed.position.set(-2.6, 2.3, -2.4);
    this._washBlue.position.set(2.8, 2.3, -2.4);
    this.scene.add(this._washRed, this._washBlue);

    // Rain streaks (med/high)
    if (this._quality !== 'low') this._buildRain();

    // Camera home: across the street. Look a touch down so the title
    // lands on the brick band between window rows.
    this._camHome = new THREE.Vector3(0.2, 1.22, 6.9);
    this._camLook = new THREE.Vector3(-0.1, 1.05, -5.8);
    this.camera.position.copy(this._camHome);
    this.camera.lookAt(this._camLook);
  }

  _wetAsphalt() {
    const base = this._mat('asphalt', 0x3a3e44) || new THREE.MeshStandardMaterial({ color: 0x3a3e44 });
    const mat = base.clone();
    mat.color.setHex(0x3a3e44);
    mat.roughness = 0.18;
    mat.metalness = 0.42;
    mat.envMapIntensity = 1.4;
    return mat;
  }

  _mergeParts(parts, mat) {
    const geos = [];
    const euler = new THREE.Euler();
    const mat4 = new THREE.Matrix4();
    for (const p of parts) {
      const geo = p.geo.clone();
      euler.set(p.rx || 0, p.ry || 0, p.rz || 0);
      mat4.makeRotationFromEuler(euler);
      mat4.setPosition(p.x || 0, p.y || 0, p.z || 0);
      if (p.sx || p.sy || p.sz) {
        const s = new THREE.Matrix4().makeScale(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
        mat4.multiply(s);
      }
      geo.applyMatrix4(mat4);
      geos.push(geo);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    return new THREE.Mesh(merged, mat);
  }

  _wheels(g, spots, tireMat, rimMat, radius = 0.32, width = 0.2) {
    const tire = new THREE.CylinderGeometry(radius, radius, width, 14);
    const rim = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.03, 14);
    tire.rotateZ(Math.PI / 2);
    rim.rotateZ(Math.PI / 2);
    const tireParts = [], rimParts = [];
    for (const [wx, wz] of spots) {
      tireParts.push({ geo: tire, x: wx, y: radius, z: wz });
      rimParts.push({ geo: rim, x: wx, y: radius, z: wz });
    }
    g.add(this._mergeParts(tireParts, tireMat));
    g.add(this._mergeParts(rimParts, rimMat));
    tire.dispose();
    rim.dispose();
  }

  _headlights(g, spots, beamZ = 7) {
    const lightM = new THREE.MeshBasicMaterial({ color: 0xfff1c8, toneMapped: false });
    const lampGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.07, 10);
    lampGeo.rotateX(Math.PI / 2);
    const parts = spots.map(([x, y, z]) => ({ geo: lampGeo, x, y, z }));
    g.add(this._mergeParts(parts, lightM));
    lampGeo.dispose();
    for (const [sx, sy, sz] of spots) {
      const beam = new THREE.SpotLight(0xfff1c8, 2.6, 14, 0.4, 0.5, 1.3);
      beam.position.set(sx, sy, sz + 0.05);
      beam.target.position.set(sx, 0.2, beamZ);
      g.add(beam, beam.target);
    }
  }

  _armouredVan(x, y, z, yaw, bodyCol, accent) {
    const body = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.58, metalness: 0.32 });
    const trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.58 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.72, metalness: 0.22 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x151a20, emissive: 0x8899aa, emissiveIntensity: 0.28, roughness: 0.22, metalness: 0.25,
    });
    const g = new THREE.Group();
    g.name = 'van-ashline';
    const cargo = new THREE.BoxGeometry(2.18, 1.62, 3.2);
    const cabin = new THREE.BoxGeometry(2.08, 1.02, 1.28);
    const chassis = new THREE.BoxGeometry(2.0, 0.16, 4.15);
    const bumper = new THREE.BoxGeometry(2.16, 0.22, 0.22);
    const arch = new THREE.CylinderGeometry(0.38, 0.38, 0.18, 10, 1, false, 0, Math.PI);
    const strip = new THREE.BoxGeometry(2.22, 0.08, 3.05);
    const mount = new THREE.BoxGeometry(0.55, 0.07, 1.15);
    const bar = new THREE.BoxGeometry(0.05, 0.36, 0.05);
    g.add(this._mergeParts([
      { geo: cargo, y: 1.29, z: -0.42 },
      { geo: cabin, y: 0.99, z: 1.62 },
      { geo: chassis, y: 0.48 },
      { geo: bumper, y: 0.46, z: 2.28 },
      { geo: bumper, y: 0.46, z: -2.05 },
      { geo: arch, x: -0.98, y: 0.34, z: 1.2, rz: Math.PI / 2, rx: Math.PI },
      { geo: arch, x: 0.98, y: 0.34, z: 1.2, rz: -Math.PI / 2, rx: Math.PI },
      { geo: arch, x: -0.98, y: 0.34, z: -1.35, rz: Math.PI / 2, rx: Math.PI },
      { geo: arch, x: 0.98, y: 0.34, z: -1.35, rz: -Math.PI / 2, rx: Math.PI },
    ], body));
    g.add(this._mergeParts([
      { geo: strip, y: 1.42, z: -0.42 },
      { geo: mount, y: 2.14, z: -0.35 },
    ], trim));
    g.add(this._mergeParts([
      { geo: bar, x: -0.7, y: 0.62, z: 2.38 },
      { geo: bar, x: 0.7, y: 0.62, z: 2.38 },
      { geo: new THREE.BoxGeometry(1.5, 0.04, 0.04), y: 0.82, z: 2.38 },
    ], steel));
    const shield = new THREE.BoxGeometry(1.9, 0.58, 0.05);
    g.add(this._mergeParts([
      { geo: shield, y: 1.48, z: 2.18, rx: -0.48 },
      { geo: new THREE.BoxGeometry(0.7, 0.38, 0.04), x: -1.06, y: 1.35, z: 1.55 },
      { geo: new THREE.BoxGeometry(0.7, 0.38, 0.04), x: 1.06, y: 1.35, z: 1.55 },
    ], glass));
    this._wheels(g, [[-0.98, 1.2], [0.98, 1.2], [-0.98, -1.35], [0.98, -1.35]], dark, steel, 0.33, 0.22);
    this._headlights(g, [[-0.62, 0.78, 2.32], [0.62, 0.78, 2.32]], 8);
    // Ajar side door
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.15, 1.05), body);
    door.position.set(1.16, 1.05, 0.15);
    door.rotation.y = 0.65;
    g.add(door);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.scene.add(g);
    cargo.dispose(); cabin.dispose(); chassis.dispose(); bumper.dispose();
    arch.dispose(); strip.dispose(); mount.dispose(); bar.dispose(); shield.dispose();
    return g;
  }

  _sedan(x, y, z, yaw, bodyCol, accent) {
    const body = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.42, metalness: 0.38 });
    const trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.72, metalness: 0.22 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 0.35, metalness: 0.75 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x151a20, emissive: 0x8899aa, emissiveIntensity: 0.22, roughness: 0.18, metalness: 0.3,
    });
    const g = new THREE.Group();
    g.name = 'sedan-holdfast';
    const hull = new THREE.SphereGeometry(1, 16, 12);
    const cabin = new THREE.SphereGeometry(1, 14, 10);
    const bumper = new THREE.BoxGeometry(1.55, 0.16, 0.18);
    // SphereGeometry radius is 1, so these scales are half-extents.
    g.add(this._mergeParts([
      { geo: hull, y: 0.68, sx: 0.86, sy: 0.38, sz: 2.12 },
      { geo: cabin, y: 1.04, z: 0.08, sx: 0.72, sy: 0.46, sz: 1.02 },
    ], body));
    g.add(this._mergeParts([
      { geo: new THREE.BoxGeometry(1.7, 0.04, 3.9), y: 0.7 },
    ], trim));
    g.add(this._mergeParts([
      { geo: new THREE.BoxGeometry(1.28, 0.36, 0.04), y: 1.18, z: 1.12, rx: -0.35 },
      { geo: new THREE.BoxGeometry(1.2, 0.32, 0.04), y: 1.16, z: -0.92, rx: 0.28 },
      { geo: new THREE.BoxGeometry(0.04, 0.3, 0.9), x: -0.7, y: 1.14, z: 0.1 },
      { geo: new THREE.BoxGeometry(0.04, 0.3, 0.9), x: 0.7, y: 1.14, z: 0.1 },
    ], glass));
    g.add(this._mergeParts([
      { geo: bumper, y: 0.42, z: 2.08 },
      { geo: bumper, y: 0.42, z: -2.08 },
    ], steel));
    this._wheels(g, [[-0.86, 1.25], [0.86, 1.25], [-0.86, -1.3], [0.86, -1.3]], dark, steel, 0.31, 0.18);
    this._headlights(g, [[-0.5, 0.62, 2.12], [0.5, 0.62, 2.12]], 8);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.scene.add(g);
    hull.dispose(); cabin.dispose(); bumper.dispose();
    return g;
  }

  _glowSprite(color) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    const hex = '#' + color.toString(16).padStart(6, '0');
    grd.addColorStop(0, hex);
    grd.addColorStop(0.25, hex);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({
      map: tex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, opacity: 0.9,
    });
    const s = new THREE.Sprite(mat);
    s.scale.set(3.6, 2.2, 1);
    return s;
  }

  _lightBar(x, y, z, yaw) {
    const redM = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.95, toneMapped: false });
    const blueM = new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.95, toneMapped: false });
    const bar = new THREE.Group();
    const redQ = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.62), redM);
    redQ.position.x = -0.3;
    const blueQ = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.62), blueM);
    blueQ.position.x = 0.3;
    const redGlow = this._glowSprite(RED);
    redGlow.position.set(-0.3, 0.08, 0);
    const blueGlow = this._glowSprite(BLUE);
    blueGlow.position.set(0.3, 0.08, 0);
    bar.add(redQ, blueQ, redGlow, blueGlow);
    bar.position.set(x, y, z);
    bar.rotation.y = yaw;
    this.scene.add(bar);
    const red = new THREE.SpotLight(RED, 18, 24, 0.85, 0.35, 0.9);
    const blue = new THREE.SpotLight(BLUE, 18, 24, 0.85, 0.35, 0.9);
    const redPt = new THREE.PointLight(RED, 6, 10, 1.2);
    const bluePt = new THREE.PointLight(BLUE, 6, 10, 1.2);
    red.position.copy(bar.position);
    blue.position.copy(bar.position);
    redPt.position.copy(bar.position);
    bluePt.position.copy(bar.position);
    red.target.position.set(x, 0.15, z - 5);
    blue.target.position.set(x, 0.15, z - 5);
    this.scene.add(red, red.target, blue, blue.target, redPt, bluePt);
    return { bar, red, blue, redPt, bluePt, redQ, blueQ, redGlow, blueGlow, yaw0: yaw, phase: Math.random() * Math.PI };
  }

  _buildRain() {
    const n = this._quality === 'high' ? 280 : 140;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 1] = Math.random() * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0x9aa8bc, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false });
    this.rain = new THREE.Points(g, m);
    this.scene.add(this.rain);
  }

  async _spawnBodies() {
    const n = this._quality === 'high' ? 4 : this._quality === 'low' ? 2 : 3;
    const spots = [
      { id: 'rivet', team: 'defend', accent: '#9aa4b2', pos: [-2.05, 0, 3.85], yaw: 0.45, kind: 'stack' },
      { id: 'briar', team: 'defend', accent: '#6a8f4a', pos: [1.95, 0, 3.7], yaw: -0.4, kind: 'cover' },
      { id: 'forge', team: 'attack', accent: '#c67636', pos: [3.05, 0, 4.35], yaw: -1.2, kind: 'cover' },
      { id: 'quill', team: 'attack', accent: '#e8c696', pos: [3.6, 4.6, -6.55], yaw: 0, kind: 'rappel' },
    ].slice(0, n);
    for (const s of spots) {
      try {
        const vis = await createOperatorMesh({ id: s.id, team: s.team, accent: s.accent, quality: 'med', lod: 1 });
        vis.mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
        vis.mesh.rotation.y = s.yaw;
        vis.mesh.scale.setScalar(1.1);
        this.scene.add(vis.mesh);
        if (s.kind === 'rappel') {
          const cable = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.015, 5.2, 4),
            new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.7 }),
          );
          cable.position.set(s.pos[0], s.pos[1] + 2.4, s.pos[2] + 0.1);
          this.scene.add(cable);
          vis._cable = cable;
        }
        this._bodies.push({ vis, kind: s.kind, phase: Math.random() * Math.PI * 2, pos: s.pos });
        try {
          const crouched = s.kind === 'cover';
          vis.pose(s.kind === 'rappel' ? 'idle' : (crouched ? 'crouch' : 'aim'), 0);
          vis.tick?.(0, { speed: 0, stance: crouched ? 1 : 0, aiming: 1, pistol: false, dead: false, lean: 0 });
        } catch {}
        try {
          await attachWeaponToHand(vis, { id: s.id === 'quill' ? 'mp5' : 'carbine', optic: 'red' });
        } catch {}
      } catch (e) { console.warn('menu body', s.id, e); }
    }
  }

  _updateLights() {
    const t = this._t;
    for (const [i, b] of [this.barAsh, this.barHold].entries()) {
      if (!b) continue;
      const period = 0.7 + i * 0.25;
      const sweep = Math.sin(t * (Math.PI * 2) / period + b.phase);
      const yaw = b.yaw0 + sweep * (35 * Math.PI / 180);
      b.bar.rotation.y = yaw;
      const strobe = (Math.sin(t * 18 + b.phase) > 0.15) ? 1 : 0.45;
      const redOn = sweep > 0;
      const aRed = (redOn ? 0.7 + 0.3 * Math.abs(sweep) : 0.06) * strobe;
      const aBlue = (redOn ? 0.06 : 0.7 + 0.3 * Math.abs(sweep)) * strobe;
      b.red.intensity = aRed * 22;
      b.blue.intensity = aBlue * 22;
      if (b.redPt) b.redPt.intensity = aRed * 8;
      if (b.bluePt) b.bluePt.intensity = aBlue * 8;
      b.redQ.material.opacity = Math.min(1, aRed + 0.15);
      b.blueQ.material.opacity = Math.min(1, aBlue + 0.15);
      if (b.redGlow) b.redGlow.material.opacity = aRed * 0.95;
      if (b.blueGlow) b.blueGlow.material.opacity = aBlue * 0.95;
      if (i === 0 && this._washRed) this._washRed.intensity = 2.2 + aRed * 6;
      if (i === 1 && this._washBlue) this._washBlue.intensity = 2.2 + aBlue * 6;
      const dir = new THREE.Vector3(0, -0.2, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      b.red.target.position.copy(b.bar.position).add(dir.clone().multiplyScalar(8));
      b.blue.target.position.copy(b.bar.position).add(dir.multiplyScalar(8));
    }
  }

  _updateDolly() {
    const u = (Math.sin(this._t * Math.PI * 2 / 7.2) * 0.5 + 0.5);
    const lat = (u * 2 - 1) * 1.15;
    this.camera.position.set(this._camHome.x + lat, this._camHome.y, this._camHome.z);
    const look = this._camLook.clone();
    look.x += lat * 0.2;
    this.camera.lookAt(look);
    const yawKick = (u * 2 - 1) * (2 * Math.PI / 180);
    this.camera.rotateY(yawKick);
  }

  _updateBodies(dt) {
    for (const b of this._bodies) {
      b.vis.tick?.(dt, { moving: false, sprint: false, pose: 'idle', aiming: 1, speed: 0, stance: 0, dead: false, lean: 0 });
      const s = Math.sin(this._t * 1.3 + b.phase) * 0.02;
      if (b.kind === 'stack') b.vis.mesh.rotation.y += s * 0.15;
      if (b.kind === 'rappel') {
        b.vis.mesh.position.y = b.pos[1] + Math.sin(this._t * 0.7 + b.phase) * 0.45;
        if (b.vis._cable) b.vis._cable.position.y = b.vis.mesh.position.y + 2.4;
      }
      if (b.kind === 'cover') b.vis.mesh.rotation.y = -1.1 + s;
    }
    if (this.rain) {
      const pos = this.rain.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 7;
        if (y < 0) y = 9.5;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
  }

  tick(dt) {
    if (this._paused || document.hidden) return;
    this._frame++;
    const slow = this.mode === 'dim';
    if (slow && (this._frame & 1)) return;
    this._t += dt;
    if (this.mode === 'showcase') {
      this.showcase.tick(dt);
    } else {
      this._updateLights();
      this._updateDolly();
      this._updateBodies(dt);
    }
    this.render();
  }

  render() {
    const r = this.gfx.renderer;
    if (!r) return;
    const canvas = r.domElement;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.mode === 'showcase') {
      r.setClearColor(0x07080c, 1);
      r.clear();
      this.showcase.render(r);
    } else {
      r.setScissorTest(false);
      r.setViewport(0, 0, canvas.width, canvas.height);
      const prevExp = r.toneMappingExposure;
      r.toneMappingExposure = 1.28;
      r.setClearColor(0x1a2230, 1);
      r.autoClear = true;
      r.render(this.scene, this.camera);
      r.toneMappingExposure = prevExp;
    }
  }

  info() {
    return this.gfx.info();
  }

  dispose() {
    document.removeEventListener('visibilitychange', this._onVis);
    this.showcase?.dispose();
    this._paused = true;
    for (const b of this._bodies) {
      if (b.vis?.mesh?.parent) b.vis.mesh.parent.remove(b.vis.mesh);
    }
    this._bodies = [];
  }
}
