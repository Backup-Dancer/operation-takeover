import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createOperatorMesh, attachWeaponToHand, PATHS } from '../models.js?v=iv-3.6.3';
import { getOp } from '../operators.js?v=iv-3.6.3';
import { loreFor } from './lore.js?v=iv-3.6.3';
import { hasPortrait, loadBust, bustUrl } from './portraits.js?v=iv-3.6.3';

/**
 * Siege-style 3D operator turntable, scissored into #op-showcase.
 * Studio three-point + RoomEnvironment IBL; low-ready + solid TP primary
 * + left-hand IK on the handguard (select_idle is a squat, not used here).
 */
export class OperatorShowcase {
  constructor(menu) {
    this.menu = menu;
    this.gfx = menu.gfx;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14161c);
    this.scene.fog = null;
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.08, 24);
    this.camera.position.set(1.15, 1.15, 2.85);
    this.camera.lookAt(0, 1.1, 0);
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
    this._buildStage();
    this._bindDrag();
  }

  _buildStage() {
    const hemi = new THREE.HemisphereLight(0xe8eaef, 0x2a2c32, 0.42);
    const key = new THREE.DirectionalLight(0xf4f1ea, 2.15);
    key.position.set(-2.6, 3.4, 3.5);
    const fill = new THREE.DirectionalLight(0xdde3ee, 1.05);
    fill.position.set(3.0, 1.7, 2.4);
    this.rim = new THREE.DirectionalLight(0xf4f6ff, 1.75);
    this.rim.position.set(1.8, 2.9, -3.4);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48),
      new THREE.MeshStandardMaterial({
        color: 0x1a1c22, roughness: 0.92, metalness: 0.04, envMapIntensity: 0.25,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = false;
    this.scene.add(hemi, key, fill, this.rim, floor);
    this._ensureEnv();
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
    this._ensureEnv();
    this._applyStudioMaps(vis);
    this._tint(accent);
    await this._readyStance();
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
    // Low-ready: idle lower body + a modest aim_rifle layer and left-hand
    // IK to ik_hand_L (handguard). Full aiming:1 pointed the muzzle at the
    // camera so the TP gun read as a black block, with arms folded high.
    vis.pose('idle', 0);
    const st = {
      moving: false, sprint: false,
      clip: undefined,
      aiming: 0.35, pistol: false, hipReady: true,
      dead: false, lean: 0, forceTick: true,
    };
    for (let i = 0; i < 12; i++) vis.tick?.(0.05, st);
  }

  _frameOperator() {
    const vis = this._vis;
    if (!vis?.mesh) return;
    vis.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vis.mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    // Head to mid-shin / knees, with a little headroom — ~85% of the frame.
    const y0 = box.min.y + size.y * 0.12;
    const y1 = box.max.y + size.y * 0.03;
    const height = Math.max(0.9, y1 - y0);
    const midY = (y0 + y1) * 0.5;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (height / 0.85) / (2 * Math.tan(fov / 2));
    // Negative yaw puts the camera on the operator's right so the
    // portrait-side pauldron (Forge's copper, camera-left) is visible.
    const yaw = -0.38;
    this.camera.position.set(Math.sin(yaw) * dist, midY, Math.cos(yaw) * dist);
    this.camera.near = Math.max(0.05, dist - 3);
    this.camera.far = dist + 8;
    this.camera.lookAt(0, midY, 0);
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
      aiming: (clip === 'select_pick' || clip === 'select_idle') ? 0 : 0.35,
      pistol: false, hipReady: true,
      dead: false, lean: 0, forceTick: true,
    });
  }

  render(renderer) {
    const hole = document.getElementById('op-showcase');
    if (!hole) return;
    this._ensureEnv();
    const r = hole.getBoundingClientRect();
    const canvas = renderer.domElement;
    const cr = canvas.getBoundingClientRect();
    const want = Math.min(2, window.devicePixelRatio || 2);
    if (Math.abs(renderer.getPixelRatio() - want) > 0.01) {
      renderer.setPixelRatio(want);
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    }
    // three.js setViewport/setScissor take CSS (logical) pixels and multiply
    // by the target pixel ratio themselves. Passing device pixels at dpr 2
    // double-scales the scissor and crops the operator out of the hole.
    const x = Math.max(0, r.left - cr.left);
    const y = Math.max(0, cr.bottom - r.bottom);
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    const auto = renderer.autoClear;
    const prevExp = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1.18;
    renderer.autoClear = true;
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
    renderer.toneMappingExposure = prevExp;
    renderer.autoClear = auto;
  }

  dispose() {
    this._clearPivot();
    this._studioEnv = null;
  }
}
