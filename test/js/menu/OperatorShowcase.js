import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createOperatorMesh, attachWeaponToHand, PATHS } from '../models.js?v=iv-4.1.2-t2';
import { getOp } from '../operators.js?v=iv-4.1.2-t2';
import { loreFor } from './lore.js?v=iv-4.1.2-t2';
import { hasPortrait, loadBust, bustUrl } from './portraits.js?v=iv-4.1.2-t2';

/**
 * Hero operator showcase in a dressed hangar / staging bay.
 * Tight thigh-up framing, slight low angle, three-point lighting
 * (warm key, soft fill, cool rim) plus a bay-door shaft. Hangar is
 * rendered soft (shallow-DOF style) behind a sharp operator.
 * Layouts: hero (main), detail (operators tab), wing (missions/shop).
 */
export class OperatorShowcase {
  constructor(menu) {
    this.menu = menu;
    this.gfx = menu.gfx;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10131a);
    this._hangarFog = new THREE.Fog(0x151820, 5, 18);
    this.scene.fog = this._hangarFog;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.12, 40);
    this.camera.position.set(1.15, 0.9, 3.2);
    this.camera.lookAt(0, 1.15, 0);
    this.camera.layers.enable(0);
    this.camera.layers.enable(1);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.yaw = 0;
    this._drag = null;
    this._vis = null;
    this._id = null;
    this._t = 0;
    this._emoteT = 0;
    this._clip = 'idle';
    this._selectIdleUsable = false;
    this._layout = 'hero';
    // Numeric aim weight is `state.aim`. `state.aiming` is a boolean gate
    // that snaps the aim_rifle layer to 1 (muzzle-at-camera, folded arms).
    this._aimW = 0.24;
    this._buildStage();
    this._bindDrag();
  }

  setLayout(kind) {
    const next = kind || 'hero';
    if (this._layout === next && this._vis) return;
    this._layout = next;
    this._frameOperator();
  }

  _buildStage() {
    // Cinematic three-point on the operator only (layer 1).
    const hemi = new THREE.HemisphereLight(0xf0e4d4, 0x243040, 0.22);
    hemi.layers.enable(0);
    hemi.layers.enable(1);
    const key = new THREE.DirectionalLight(0xffd4a0, 2.35);
    key.position.set(-2.2, 3.0, 3.2);
    key.layers.set(1);
    const fill = new THREE.DirectionalLight(0xb8c8dc, 0.55);
    fill.position.set(3.2, 1.4, 2.2);
    fill.layers.set(1);
    this.rim = new THREE.DirectionalLight(0x8eb8ff, 2.15);
    this.rim.position.set(2.2, 2.6, -3.6);
    this.rim.layers.set(1);
    // Dimmer hangar lighting so the character pops (layer 0).
    const hangarHemi = new THREE.HemisphereLight(0xc0c8d0, 0x1a1c22, 0.3);
    hangarHemi.layers.set(0);
    const bayLight = new THREE.DirectionalLight(0xa8c0d8, 0.7);
    bayLight.position.set(1.6, 4.2, -8);
    bayLight.layers.set(0);
    this.scene.add(hemi, key, fill, this.rim, hangarHemi, bayLight);

    const box = (w, h, d, x, y, z, ry = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      return g;
    };
    const plane = (w, h, x, y, z, rx = 0, ry = 0) => {
      const g = new THREE.PlaneGeometry(w, h);
      if (rx) g.rotateX(rx);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      return g;
    };
    const add = (mesh) => {
      mesh.layers.set(0);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this._hangar.add(mesh);
      return mesh;
    };

    this._hangar = new THREE.Group();
    this.scene.add(this._hangar);

    add(new THREE.Mesh(
      new THREE.PlaneGeometry(32, 24),
      new THREE.MeshStandardMaterial({
        color: 0x2a2c32, roughness: 0.94, metalness: 0.06, envMapIntensity: 0.18,
      }),
    )).rotation.x = -Math.PI / 2;

    const shellMat = new THREE.MeshStandardMaterial({
      color: 0x181a20, roughness: 0.94, metalness: 0.08, envMapIntensity: 0.16,
    });
    add(new THREE.Mesh(mergeGeometries([
      plane(32, 8, 0, 3.6, -12),
      plane(24, 8, -14, 3.6, -2, 0, Math.PI / 2),
      plane(24, 8, 16, 3.6, -2, 0, -Math.PI / 2),
      plane(32, 24, 0, 7.2, -2, Math.PI / 2, 0),
    ], false), shellMat));

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x3a3d44, roughness: 0.46, metalness: 0.55, envMapIntensity: 0.28,
    });
    const metals = [];
    for (let i = -3; i <= 3; i++) {
      const z = -1.2 - i * 2.15;
      metals.push(box(28, 0.14, 0.14, 0, 7.05, z));
      metals.push(box(0.1, 1.1, 0.1, -8, 6.45, z));
      metals.push(box(0.1, 1.1, 0.1, 8, 6.45, z));
      metals.push(box(0.12, 7.2, 0.12, -13.7, 3.6, z));
      metals.push(box(0.12, 7.2, 0.12, 15.7, 3.6, z));
    }
    metals.push(box(10.2, 0.18, 0.28, 1.6, 5.5, -11.88));
    metals.push(box(0.18, 5.5, 0.28, -3.4, 2.75, -11.88));
    metals.push(box(0.18, 5.5, 0.28, 6.6, 2.75, -11.88));
    for (let i = 0; i < 4; i++) metals.push(box(0.07, 5.2, 0.07, -2.4 + i * 2.4, 2.7, -11.82));
    // Equipment racks (left mid-ground).
    for (const z of [-2.2, -3.4, -4.6]) {
      metals.push(box(0.08, 2.6, 0.08, -7.4, 1.3, z));
      metals.push(box(0.08, 2.6, 0.08, -8.5, 1.3, z));
      metals.push(box(1.2, 0.05, 0.7, -7.95, 0.7, z));
      metals.push(box(1.2, 0.05, 0.7, -7.95, 1.4, z));
      metals.push(box(1.2, 0.05, 0.7, -7.95, 2.1, z));
    }
    add(new THREE.Mesh(mergeGeometries(metals, false), metalMat));

    const bay = new THREE.Mesh(
      new THREE.PlaneGeometry(9.6, 5.2),
      new THREE.MeshBasicMaterial({ color: 0x6a8096 }),
    );
    bay.position.set(1.6, 2.75, -11.86);
    add(bay);

    // Soft wash + god-ray shafts from the bay door (one merged draw).
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0xc5d6ea, transparent: true, opacity: 0.075,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const shafts = [
      plane(14, 8, 1.6, 2.8, -8.5),
      plane(3.2, 10, 0.4, 2.4, -6.2, 0.55, 0.08),
      plane(2.4, 9, 2.6, 2.2, -6.0, 0.62, -0.1),
      plane(1.8, 8, 1.4, 2.0, -5.0, 0.7, 0.02),
    ];
    add(new THREE.Mesh(mergeGeometries(shafts, false), shaftMat));

    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a28, roughness: 0.4, metalness: 0.5,
      emissive: 0xffe6b0, emissiveIntensity: 1.65, envMapIntensity: 0.15,
    });
    const lamps = [];
    for (const [x, y, z] of [[-3.5, 6.35, 1.2], [3.2, 6.35, 1.0], [-2.8, 6.35, -3.2], [4.0, 6.35, -4.0], [0.2, 6.35, -7.0]]) {
      lamps.push(box(0.9, 0.12, 0.35, x, y, z));
      lamps.push(box(0.04, 0.7, 0.04, x, y + 0.4, z));
    }
    // Lit rack strips.
    for (const z of [-2.2, -3.4, -4.6]) {
      lamps.push(box(1.1, 0.02, 0.04, -7.95, 1.42, z));
      lamps.push(box(1.1, 0.02, 0.04, -7.95, 2.12, z));
    }
    add(new THREE.Mesh(mergeGeometries(lamps, false), lampMat));

    const markMat = new THREE.MeshBasicMaterial({ color: 0xc4a24a, transparent: true, opacity: 0.45 });
    add(new THREE.Mesh(mergeGeometries([
      box(0.08, 0.012, 18, -4.2, 0.01, -4),
      box(0.08, 0.012, 18, 6.5, 0.01, -4),
      box(10, 0.012, 0.08, 1.2, 0.01, 3.2),
    ], false), markMat));

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x4a3f32, roughness: 0.88, metalness: 0.05, envMapIntensity: 0.16,
    });
    // Taller crate stacks so they read in a thigh-up crop.
    add(new THREE.Mesh(mergeGeometries([
      box(1.1, 0.7, 0.9, -4.8, 0.35, -3.4),
      box(0.85, 0.85, 0.85, -4.7, 1.12, -3.5, 0.18),
      box(0.7, 0.55, 0.7, -4.85, 1.82, -3.35, -0.1),
      box(1.3, 0.7, 1.0, 4.8, 0.35, -3.8),
      box(1.0, 0.9, 0.85, 4.7, 1.15, -3.9, 0.2),
      box(0.8, 0.7, 0.7, 4.85, 1.95, -3.75, -0.15),
      box(1.2, 0.6, 0.8, -6.6, 0.3, -7.4),
    ], false), woodMat));

    // Vehicle silhouette, left mid-background.
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1c2026, roughness: 0.7, metalness: 0.25, envMapIntensity: 0.2,
    });
    add(new THREE.Mesh(mergeGeometries([
      box(3.6, 1.15, 1.7, -4.2, 0.85, -6.8, 0.55),
      box(1.35, 0.95, 1.65, -3.15, 1.7, -6.35, 0.55),
      box(3.3, 0.12, 1.85, -4.2, 1.44, -6.8, 0.55),
      box(0.55, 0.55, 0.28, -5.15, 0.3, -7.5, 0.55),
      box(0.55, 0.55, 0.28, -5.15, 0.3, -6.15, 0.55),
      box(0.55, 0.55, 0.28, -3.15, 0.3, -7.45, 0.55),
      box(0.55, 0.55, 0.28, -3.15, 0.3, -6.05, 0.55),
    ], false), bodyMat));

    // Hanging team banner (original mark, no third-party art).
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 2.4),
      new THREE.MeshStandardMaterial({
        map: this._bannerTex(),
        roughness: 0.82, metalness: 0.05, envMapIntensity: 0.15,
      }),
    );
    banner.position.set(-2.15, 2.45, -5.1);
    banner.rotation.y = 0.22;
    add(banner);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.05, 0.05),
      metalMat,
    );
    rail.position.set(-2.15, 3.68, -5.1);
    rail.rotation.y = 0.22;
    add(rail);

    this._ensureEnv();
  }

  _bannerTex() {
    if (this._bannerMap) return this._bannerMap;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#161820';
    g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#c67636';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(36, 0); g.lineTo(18, 512); g.lineTo(0, 512);
    g.fill();
    g.fillStyle = '#4aa3ff';
    g.fillRect(220, 0, 14, 512);
    g.fillStyle = '#e8e0d4';
    g.beginPath();
    g.moveTo(128, 70); g.lineTo(178, 150); g.lineTo(152, 150); g.lineTo(128, 112);
    g.lineTo(104, 150); g.lineTo(78, 150); g.closePath();
    g.fill();
    g.fillStyle = '#c67636';
    g.fillRect(88, 180, 80, 6);
    g.font = '700 28px sans-serif';
    g.fillStyle = '#f3f0ea';
    g.save();
    g.translate(148, 230);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'left';
    g.fillText('TAKEOVER', 0, 0);
    g.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this._bannerMap = tex;
    return tex;
  }

  _ensureEnv() {
    const renderer = this.gfx?.renderer;
    if (this._studioEnv) {
      this.scene.environment = this._studioEnv;
      this.scene.environmentIntensity = 0.4;
      return;
    }
    if (!renderer) {
      if (this.gfx?.env) {
        this.scene.environment = this.gfx.env;
        this.scene.environmentIntensity = 0.4;
      }
      return;
    }
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      this._studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this.scene.environment = this._studioEnv;
      this.scene.environmentIntensity = 0.4;
    } catch (e) {
      console.warn('showcase studio env', e);
      if (this.gfx?.env) {
        this.scene.environment = this.gfx.env;
        this.scene.environmentIntensity = 0.4;
      }
    }
  }

  _bindDrag() {
    const down = (e) => {
      if (this.menu.mode !== 'showcase') return;
      const ev = e.touches ? e.touches[0] : e;
      this._drag = { x: ev.clientX, yaw: this.yaw };
    };
    const move = (e) => {
      if (!this._drag) return;
      const ev = e.touches ? e.touches[0] : e;
      this.yaw = this._drag.yaw + (ev.clientX - this._drag.x) * 0.008;
    };
    const up = () => { this._drag = null; };
    const host = document.getElementById('op-showcase') || document.getElementById('menus');
    host?.addEventListener('pointerdown', down);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    host?.addEventListener('touchstart', down, { passive: true });
    addEventListener('touchmove', move, { passive: true });
    addEventListener('touchend', up);
    this._onClick = (e) => {
      if (e.target?.closest?.('#op-showcase')) this.playEmote();
    };
    host?.addEventListener('click', this._onClick);
  }

  _bustEl() {
    const host = document.getElementById('op-showcase');
    if (!host) return null;
    let el = host.querySelector('img.op-bust');
    if (!el) {
      el = document.createElement('img');
      el.className = 'op-bust';
      el.alt = '';
      el.decoding = 'async';
      host.appendChild(el);
    }
    return el;
  }

  _showBust(id) {
    const el = this._bustEl();
    if (!el) return;
    // Full-canvas hangar layouts must never flash a 2D portrait over the scene.
    if (this._layout === 'hero' || this._layout === 'detail' || this._layout === 'wing') {
      el.classList.remove('show');
      el.hidden = true;
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      return;
    }
    if (!hasPortrait(id)) { el.classList.remove('show'); el.hidden = true; return; }
    el.hidden = false;
    el.classList.remove('ready-3d');
    el.src = bustUrl(id);
    el.classList.add('show');
    loadBust(id);
  }

  _hideBustIfReady() {
    const el = this._bustEl();
    const unique = !!(this._vis?.sourceUrl && this._vis.sourceUrl !== PATHS.reference);
    if (!el || !unique) return;
    el.classList.add('ready-3d');
    el.classList.remove('show');
    el.hidden = true;
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
  }

  _clearPivot() {
    for (const c of [...this.pivot.children]) this.pivot.remove(c);
    this._vis = null;
  }

  async show(id, accent) {
    if (id === this._id && this._vis) {
      this._tint(accent);
      this._hideBustIfReady();
      return;
    }
    // Opening the panel and _renderOps both call show() for the default
    // operator. Two in-flight loads of the same id used to add two meshes;
    // switching away only removed the last, so Forge (and his copper
    // pauldron) stayed behind every later operator.
    if (id === this._id && this._loading) {
      this._tint(accent);
      return;
    }
    const gen = (this._loadGen = (this._loadGen || 0) + 1);
    this._id = id;
    this._loading = true;
    this._showBust(id);
    this._clearPivot();
    const vis = await createOperatorMesh({ id, team: 'menu', accent, quality: 'high', lod: 0, skipCompact: true });
    if (gen !== this._loadGen || this._id !== id) {
      this._loading = this._loadGen !== gen ? this._loading : false;
      return;
    }
    this._loading = false;
    vis.mesh.position.set(0, 0, 0);
    vis.mesh.rotation.set(0, 0, 0);
    this.pivot.add(vis.mesh);
    this._vis = vis;
    this._tagOperatorLayer();
    this._ensureEnv();
    this._applyStudioMaps(vis);
    this._tint(accent);
    await this._readyStance();
    this._tagOperatorLayer();
    this._frameOperator();
    const unique = !!(vis.sourceUrl && vis.sourceUrl !== PATHS.reference);
    const el = this._bustEl();
    if (el) {
      el.classList.toggle('ready-3d', unique);
      if (unique) {
        el.classList.remove('show');
        el.hidden = true;
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
      }
    }
  }

  _applyStudioMaps(vis) {
    const env = this._studioEnv || this.scene.environment;
    vis?.mesh?.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (env) m.envMap = env;
        m.envMapIntensity = 0.4;
        if (m.emissive) m.emissive.set(0x000000);
        m.needsUpdate = true;
      }
    });
  }

  _tint(accent) {
    // A hint of operator colour on the rim only — never the body (that
    // painted a brown cast over the atlas).
    const color = new THREE.Color(accent || '#e8e6e1');
    this.rim.color.set(0xf4f6ff).lerp(color, 0.12);
  }

  /**
   * select_idle mid-frame swings some bones ~180° and reads as a low,
   * elbows-out squat (Forge hips ~0.78m vs bind ~1.00m). Rivet can pass a
   * loose hips/span check but the clip is still not a gun-ready stance.
   * Always use idle/aim + primary + left-hand IK in the select panel.
   */
  _selectIdleLooksNatural(vis) {
    if (!vis?.actions?.select_idle) return false;
    vis.pose('select_idle', 0.25);
    vis.mesh.updateMatrixWorld(true);
    const hips = vis.mesh.getObjectByName('hips');
    const handL = vis.mesh.getObjectByName('hand_L');
    const handR = vis.mesh.getObjectByName('hand_R');
    if (!hips) return false;
    hips.updateWorldMatrix(true, false);
    const hy = hips.matrixWorld.elements[13];
    let span = 0;
    if (handL && handR) {
      handL.updateWorldMatrix(true, false);
      handR.updateWorldMatrix(true, false);
      const lx = handL.matrixWorld.elements[12];
      const rx = handR.matrixWorld.elements[12];
      span = Math.abs(rx - lx);
    }
    // Standing ready should keep hips near a metre with a compact hold.
    return hy >= 0.92 && span > 0.18 && span < 0.42;
  }

  async _readyStance() {
    const vis = this._vis;
    if (!vis) return;
    const op = getOp(this._id);
    const primary = op?.primaries?.[0] || 'carbine';
    try {
      await attachWeaponToHand(vis, { id: primary, optic: 'red' }, { solid: true });
    } catch (e) {
      console.warn('showcase weapon', e);
    }
    // Probe and log, but do not use select_idle: the authored clip is not a
    // natural primary-ready stance on these operators (iv-3.6.1 review).
    this._selectIdleUsable = this._selectIdleLooksNatural(vis);
    this._clip = 'idle';
    if (!this._selectIdleUsable) {
      console.info('showcase: select_idle is not a natural ready stance; using idle + gun + IK');
    } else {
      console.info('showcase: select_idle passed the pose probe but is not a gun-ready stance; using idle + gun + IK');
    }
    // Low-ready: idle lower body + a light aim_rifle layer (`state.aim`,
    // not `state.aiming` — that flag snaps the layer to 1) and left-hand
    // IK on the handguard. If the arm clips the torso, drop to a relaxed
    // hold without IK.
    vis.pose('idle', 0);
    this._aimW = 0.24;
    const st = this._aimState();
    for (let i = 0; i < 12; i++) vis.tick?.(0.05, st);
    if (this._armClipsTorso(vis)) {
      this._aimW = 0.14;
      vis._ikOff = true;
      const relaxed = this._aimState();
      for (let i = 0; i < 8; i++) vis.tick?.(0.05, relaxed);
    }
  }

  _aimState() {
    return {
      moving: false, sprint: false,
      clip: undefined,
      aiming: 0,
      aim: this._aimW,
      pistol: false, hipReady: true,
      dead: false, lean: 0, forceTick: true,
    };
  }

  _armClipsTorso(vis) {
    const hand = vis?.mesh?.getObjectByName('hand_L');
    const chest = vis?.mesh?.getObjectByName('spine2') || vis?.mesh?.getObjectByName('spine1');
    if (!hand || !chest) return false;
    hand.updateWorldMatrix(true, false);
    chest.updateWorldMatrix(true, false);
    const hx = hand.matrixWorld.elements[12];
    const hy = hand.matrixWorld.elements[13];
    const hz = hand.matrixWorld.elements[14];
    const cx = chest.matrixWorld.elements[12];
    const cy = chest.matrixWorld.elements[13];
    const cz = chest.matrixWorld.elements[14];
    const dx = hx - cx, dy = hy - cy, dz = hz - cz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.18;
  }

  _tagOperatorLayer() {
    const root = this._vis?.mesh;
    if (!root) return;
    root.traverse((o) => o.layers.set(1));
    this.pivot.layers.set(1);
  }

  _frameOperator() {
    const vis = this._vis;
    if (!vis?.mesh) return;
    vis.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vis.mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const layout = this._layout || 'hero';
    // Tight hero crop: mid-thigh / just-above-knee up, modest headroom,
    // subject at 60–70% of frame height, slight low angle, center-right.
    // Negative yaw keeps the portrait-side pauldron camera-left.
    let y0, y1, fill, fov, yaw, lookX, camLift, lookLift;
    if (layout === 'hero') {
      y0 = box.min.y + size.y * 0.26;
      y1 = box.max.y + size.y * 0.04;
      fill = 0.66; fov = 30; yaw = -0.48; lookX = -0.58;
      camLift = -0.20; lookLift = 0.06;
    } else if (layout === 'detail') {
      y0 = box.min.y + size.y * 0.24;
      y1 = box.max.y + size.y * 0.04;
      fill = 0.68; fov = 30; yaw = -0.44; lookX = -0.22;
      camLift = -0.16; lookLift = 0.05;
    } else {
      y0 = box.min.y + size.y * 0.20;
      y1 = box.max.y + size.y * 0.04;
      fill = 0.70; fov = 30; yaw = -0.40; lookX = -1.15;
      camLift = -0.12; lookLift = 0.04;
    }
    const height = Math.max(0.8, y1 - y0);
    const midY = (y0 + y1) * 0.5;
    this.camera.fov = fov;
    const dist = (height / fill) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.camera.position.set(Math.sin(yaw) * dist, midY + camLift, Math.cos(yaw) * dist);
    this.camera.near = 0.12;
    this.camera.far = 40;
    this.camera.lookAt(lookX, midY + lookLift, 0);
    this.camera.updateProjectionMatrix();
    this.yaw = 0;
    this.pivot.rotation.y = 0;
  }

  _playIdle() {
    const vis = this._vis;
    if (!vis) return;
    vis.pose(this._clip === 'select_idle' ? 'select_idle' : 'idle', 0);
  }

  playEmote() {
    const vis = this._vis;
    if (!vis) return;
    if (vis.actions?.select_pick) {
      vis.pose('select_pick', 0);
      this._clip = 'select_pick';
      return;
    }
    this._emoteT = 0.7;
  }

  yawBy(d) { this.yaw += d; }

  tick(dt) {
    this._t += dt;
    // No auto-spin: keep the 3/4 presentation until the user drags.
    this.pivot.rotation.y = this.yaw;
    if (this._emoteT > 0) {
      this._emoteT -= dt;
      this.pivot.rotation.x = Math.sin((0.7 - this._emoteT) * 8) * 0.04;
    } else this.pivot.rotation.x = 0;
    const vis = this._vis;
    if (!vis?.tick) return;
    const pick = vis.actions?.select_pick;
    const playingPick = !!(pick && vis._current === pick && pick.isRunning());
    if (!playingPick && this._clip === 'select_pick') this._clip = this._selectIdleUsable ? 'select_idle' : 'idle';
    const clip = playingPick ? 'select_pick' : this._clip;
    vis.tick(dt, {
      moving: false, sprint: false,
      clip: clip === 'idle' ? undefined : clip,
      pose: clip === 'idle' ? undefined : clip,
      aiming: 0,
      aim: (clip === 'select_pick' || clip === 'select_idle') ? 0 : this._aimW,
      pistol: false, hipReady: true,
      dead: false, lean: 0, forceTick: true,
    });
  }

  render(renderer) {
    this._ensureEnv();
    const canvas = renderer.domElement;
    const want = Math.min(2, window.devicePixelRatio || 2);
    if (Math.abs(renderer.getPixelRatio() - want) > 0.01) {
      renderer.setPixelRatio(want);
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    }
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const auto = renderer.autoClear;
    const prevExp = renderer.toneMappingExposure;
    const prevFog = this.scene.fog;
    const prevBg = this.scene.background;
    renderer.toneMappingExposure = 1.22;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);

    const prevAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    this._ensureDOF(renderer, w, h);
    // Soft hangar pass (low-res + a light blur) for a shallow-DOF backdrop.
    this.camera.layers.set(0);
    this.scene.fog = this._hangarFog;
    this.scene.background = this._hangarBg || (this._hangarBg = new THREE.Color(0x10131a));
    renderer.setRenderTarget(this._bgRT);
    renderer.setClearColor(0x10131a, 1);
    renderer.autoClear = true;
    renderer.render(this.scene, this.camera);
    this._blurRT && this._blurPass(renderer);

    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, w, h);
    renderer.autoClear = true;
    renderer.setClearColor(0x10131a, 1);
    renderer.clear();
    this._blitMat.map = this._bgRT.texture;
    renderer.autoClear = false;
    renderer.render(this._blit, this._blitCam);

    // Sharp operator over the blurred hangar. No fog on the subject.
    this.camera.layers.set(1);
    this.scene.fog = null;
    this.scene.background = null;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);

    this.camera.layers.enable(0);
    this.camera.layers.enable(1);
    this.scene.fog = prevFog;
    this.scene.background = prevBg;
    renderer.toneMappingExposure = prevExp;
    renderer.autoClear = auto;
    this._lastInfo = {
      draws: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
    };
    renderer.info.autoReset = prevAutoReset;
  }

  _ensureDOF(renderer, w, h) {
    const bw = Math.max(160, Math.floor(w * 0.3));
    const bh = Math.max(80, Math.floor(h * 0.3));
    if (!this._bgRT || this._bgRT.width !== bw || this._bgRT.height !== bh) {
      this._bgRT?.dispose();
      this._blurRT?.dispose();
      const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
      this._bgRT = new THREE.WebGLRenderTarget(bw, bh, opts);
      this._blurRT = new THREE.WebGLRenderTarget(bw, bh, opts);
    }
    if (this._blit) return;
    const vs = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
    const fs = [
      'varying vec2 vUv;uniform sampler2D tDiffuse;uniform vec2 direction;uniform vec2 resolution;',
      'void main(){vec2 px=direction/resolution;',
      'vec4 c=texture2D(tDiffuse,vUv)*0.227027;',
      'c+=texture2D(tDiffuse,vUv+px)*0.316216;',
      'c+=texture2D(tDiffuse,vUv-px)*0.316216;',
      'c+=texture2D(tDiffuse,vUv+px*2.0)*0.070270;',
      'c+=texture2D(tDiffuse,vUv-px*2.0)*0.070270;',
      'gl_FragColor=c;}',
    ].join('');
    this._blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        direction: { value: new THREE.Vector2(1, 0) },
        resolution: { value: new THREE.Vector2(bw, bh) },
      },
      vertexShader: vs,
      fragmentShader: fs,
      depthTest: false,
      depthWrite: false,
    });
    this._blitMat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    const quad = new THREE.PlaneGeometry(2, 2);
    this._blurQuad = new THREE.Mesh(quad, this._blurMat);
    this._blurScene = new THREE.Scene();
    this._blurScene.add(this._blurQuad);
    this._blit = new THREE.Scene();
    this._blit.add(new THREE.Mesh(quad, this._blitMat));
    this._blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  _blurPass(renderer) {
    const bw = this._bgRT.width, bh = this._bgRT.height;
    this._blurMat.uniforms.resolution.value.set(bw, bh);
    this._blurMat.uniforms.tDiffuse.value = this._bgRT.texture;
    this._blurMat.uniforms.direction.value.set(1.4, 0);
    renderer.setRenderTarget(this._blurRT);
    renderer.render(this._blurScene, this._blitCam);
    this._blurMat.uniforms.tDiffuse.value = this._blurRT.texture;
    this._blurMat.uniforms.direction.value.set(0, 1.4);
    renderer.setRenderTarget(this._bgRT);
    renderer.render(this._blurScene, this._blitCam);
  }

  dispose() {
    this._clearPivot();
    this._studioEnv = null;
    this._bgRT?.dispose();
    this._blurRT?.dispose();
    this._bannerMap?.dispose();
    this._bgRT = this._blurRT = this._bannerMap = null;
  }
}
