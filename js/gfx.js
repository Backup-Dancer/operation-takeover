import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { QUALITY, BUDGET } from './config.js?v=iv-4.1.0';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const TEX_MAP = {
  brick: 'brick_wall_001',
  plaster: 'beige_wall_001',
  plasterGrey: 'grey_plaster_03',
  wood: 'wood_floor',
  concrete: 'concrete_floor',
  metal: 'metal_plate',
  asphalt: 'asphalt_02',
  roof: 'clay_roof_tiles',
  iron: 'corrugated_iron_02',
  fabric: 'denim_fabric',
  gravel: 'gravel_floor_02',
  tiles: 'interior_tiles',
  table: 'wood_table',
  siding: 'weathered_plank_siding',
};

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = 'med';
    this.auto = true;
    this.dpr = 1;
    this.targetFps = 60;
    this._fps = 60;
    this.mats = new Map();
    this.textures = new Map();
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    } catch (e) {
      console.warn('WebGL high-performance failed, retrying', e);
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    // During ADS, clip the viewmodel stock/receiver that would otherwise
    // sit inside the camera and appear as a near-plane slice.
    this._vmClipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), -0.03);
    this._vmClipPlanes = [this._vmClipPlane];
    this._vmClipOn = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6e8498);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.02, 180);
    this.scene.add(this.camera); // viewmodels are parented to the camera
    this.composer = null;
    this.env = null;
    this.pmrem = null;
    this.probes = [];
    this.sun = null;
    this.hemi = null;
    this.lightMap = null;
    this.aoMap = null;
    this.lightMapUV = null;
    this.lightMapIntensity = 0.68;
    this.ktx2 = null;
    this._signCache = new Map();
    this._stats = { draws: 0, tris: 0, texMB: 0 };
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const cap = this.auto ? Math.min(BUDGET.dprMax, this.dpr) : this._cfg().dpr;
    const dpr = Math.min(cap, BUDGET.dprMax, devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
    if (this._fxaa) {
      this._fxaa.material.uniforms['resolution'].value.set(1 / (w * dpr), 1 / (h * dpr));
    }
  }

  _cfg() { return QUALITY[this.quality] || QUALITY.med; }

  setQuality(q) {
    this.auto = q === 'auto';
    this.quality = this.auto ? 'med' : q;
    const c = this._cfg();
    this.dpr = c.dpr;
    this.renderer.shadowMap.enabled = !!c.shadows;
    if (this.sun) this.sun.castShadow = !!c.shadows;
    this._setupPost();
    this.resize();
  }

  _setupPost() {
    const c = this._cfg();
    if (c.aa === 'none' && !c.bloom) { this.composer = null; return; }
    const comp = new EffectComposer(this.renderer);
    comp.addPass(new RenderPass(this.scene, this.camera));
    this._fxaa = null;
    if (c.aa === 'fxaa') {
      const fx = new ShaderPass(FXAAShader);
      this._fxaa = fx;
      comp.addPass(fx);
    }
    if (c.bloom) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.10, 0.32, 0.96);
      comp.addPass(bloom);
    }
    comp.addPass(new OutputPass());
    this.composer = comp;
    this.resize();
  }

  async _loadTex(url, opts = {}) {
    const isKtx = url.endsWith('.ktx2');
    let tex;
    if (isKtx && this.ktx2) {
      tex = await this.ktx2.loadAsync(url);
    } else {
      tex = await new THREE.TextureLoader().loadAsync(url);
    }
    if (opts.srgb) tex.colorSpace = THREE.SRGBColorSpace;
    else tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = opts.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.anisotropy = this._cfg().aniso;
    if (!isKtx) {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
    return tex;
  }

  async loadAssets(progress) {
    try {
      this.ktx2 = new KTX2Loader();
      this.ktx2.setTranscoderPath('vendor/three/addons/libs/basis/');
      this.ktx2.detectSupport(this.renderer);
    } catch (e) { console.warn('KTX2 init failed', e); this.ktx2 = null; }
    const names = Object.keys(TEX_MAP);
    let i = 0;
    for (const key of names) {
      const id = TEX_MAP[key];
      const pack = {};
      for (const kind of ['diff', 'arm', 'nor']) {
        const srgb = kind === 'diff';
        const ktx = `assets/textures/${id}_${kind}.ktx2`;
        const webp = `assets/textures/${id}_${kind}.webp`;
        try {
          pack[kind] = await this._loadTex(ktx, { srgb });
        } catch {
          try { pack[kind] = await this._loadTex(webp, { srgb }); }
          catch (e) { console.warn('tex fail', webp, e); }
        }
      }
      this.textures.set(key, pack);
      i++;
      progress?.('textures', i / names.length);
    }
    await this._loadBaked();
    try {
      // 512×256 runtime IBL (downsampled from the 1k Poly Haven source to fit the cap).
      const hdr = await new HDRLoader().loadAsync('assets/hdr/kloofendal_43d_clear_puresky_512.hdr');
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const gen = new THREE.PMREMGenerator(this.renderer);
      this.pmrem = gen.fromEquirectangular(hdr);
      this.env = this.pmrem.texture;
      this.scene.environment = this._cfg().env ? this.env : null;
      this._syncVmEnv();
      hdr.dispose(); gen.dispose();
    } catch (e) { console.warn('HDRI failed', e); }
  }

  async _loadBaked() {
    const tryLoad = async (url, opts) => {
      try { return await this._loadTex(url, opts); } catch { return null; }
    };
    let lmSrc = 'assets/baked/halcyon_lm.ktx2';
    this.lightMap = await tryLoad(lmSrc, { srgb: false, repeat: false });
    if (!this.lightMap) { lmSrc = 'assets/baked/halcyon_lm.png'; this.lightMap = await tryLoad(lmSrc, { srgb: false, repeat: false }); }
    let aoSrc = 'assets/baked/halcyon_ao.ktx2';
    this.aoMap = await tryLoad(aoSrc, { srgb: false, repeat: false });
    if (!this.aoMap) { aoSrc = 'assets/baked/halcyon_ao.png'; this.aoMap = await tryLoad(aoSrc, { srgb: false, repeat: false }); }
    if (this.lightMap) {
      this.lightMap.channel = 1; // uv2
      this.lightMap.flipY = !lmSrc.endsWith('.ktx2');
    }
    if (this.aoMap) {
      this.aoMap.channel = 1;
      this.aoMap.flipY = !aoSrc.endsWith('.ktx2');
    }
    try {
      const r = await fetch('assets/baked/halcyon_uv2.uv2', { cache: 'no-store' });
      if (r.ok) this.lightMapUV = this._parseUv2Bin(await r.arrayBuffer());
    } catch {}
    if (this.lightMap && this.sun) this.sun.intensity = 0.62;
    if (this.lightMap && this.hemi) this.hemi.intensity = 0.16;
  }

  makeSign(text) {
    if (this._signCache.has(text)) return this._signCache.get(text);
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#1a120c'; g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = '#c67636'; g.lineWidth = 10; g.strokeRect(16, 16, 992, 224);
    g.fillStyle = '#f3e6d0';
    g.font = 'bold 84px Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = String(text).split('\n');
    lines.forEach((ln, i) => {
      g.font = i === 0 ? 'bold 92px Georgia, serif' : '600 42px Georgia, serif';
      g.fillText(ln, 512, 128 + (i - (lines.length - 1) / 2) * 90);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = true;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.4,
    });
    mat.userData.owned = true;
    this._signCache.set(text, mat);
    return mat;
  }

  _plasterMaps() {
    if (this._plaster) return this._plaster;
    const s = 512;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const img = g.createImageData(s, s);
    const d = img.data;
    const rnd = (x, y, salt) => {
      const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.2) * 43758.5453;
      return n - Math.floor(n);
    };
    const fbm = (x, y) => {
      let v = 0, a = 0.5, f = 1;
      for (let i = 0; i < 5; i++) { v += a * rnd(x * f, y * f, i + 3); f *= 2; a *= 0.5; }
      return v;
    };
    const bump = new Float32Array(s * s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const n = fbm(x / s * 7, y / s * 7);
        const n2 = fbm(x / s * 28, y / s * 28);
        const stain = Math.pow(fbm(x / s * 2.4 + 8, y / s * 2.4 + 3), 2.2);
        const grit = (n2 - 0.5) * 10;
        // Warm plaster with mottling, water stains and finer grit — not a flat cream.
        let r = 172 + n * 20 - stain * 40 + grit;
        let gv = 158 + n * 16 - stain * 34 + grit;
        let b = 136 + n * 12 - stain * 28 + grit * 0.8;
        const hair = Math.abs(Math.sin((x + n2 * 10) * 0.17)) * Math.abs(Math.sin((y + n * 8) * 0.45));
        if (hair < 0.018) { r -= 22; gv -= 20; b -= 16; }
        // Subtle corner/edge grime that still tiles: darker blotches, not a border.
        const grime = Math.max(0, fbm(x / s * 5 + 20, y / s * 5) - 0.62) * 40;
        r -= grime; gv -= grime * 0.9; b -= grime * 0.75;
        const i = (y * s + x) * 4;
        d[i] = Math.max(0, Math.min(255, r));
        d[i + 1] = Math.max(0, Math.min(255, gv));
        d[i + 2] = Math.max(0, Math.min(255, b));
        d[i + 3] = 255;
        bump[y * s + x] = n * 0.65 + n2 * 0.35 - stain * 0.4;
      }
    }
    g.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 4;
    map.needsUpdate = true;
    // Cheap normal from the bump field.
    const nc = document.createElement('canvas');
    nc.width = nc.height = s;
    const ng = nc.getContext('2d');
    const nimg = ng.createImageData(s, s);
    const nd = nimg.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const hL = bump[y * s + ((x + s - 1) % s)];
        const hR = bump[y * s + ((x + 1) % s)];
        const hD = bump[((y + s - 1) % s) * s + x];
        const hU = bump[((y + 1) % s) * s + x];
        const nx = (hL - hR) * 6, ny = (hD - hU) * 6, nz = 1;
        const inv = 1 / Math.hypot(nx, ny, nz);
        const i = (y * s + x) * 4;
        nd[i] = (nx * inv * 0.5 + 0.5) * 255;
        nd[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
        nd[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
        nd[i + 3] = 255;
      }
    }
    ng.putImageData(nimg, 0, 0);
    const nor = new THREE.CanvasTexture(nc);
    nor.colorSpace = THREE.NoColorSpace;
    nor.wrapS = nor.wrapT = THREE.RepeatWrapping;
    nor.anisotropy = 4;
    // ARM: mild AO in the stains, roughness high, metalness zero.
    const ac = document.createElement('canvas');
    ac.width = ac.height = s;
    const ag = ac.getContext('2d');
    const aimg = ag.createImageData(s, s);
    const ad = aimg.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const stain = Math.pow(fbm(x / s * 2.4 + 8, y / s * 2.4 + 3), 2.2);
        const ao = Math.max(0.55, 1 - stain * 0.45);
        const i = (y * s + x) * 4;
        ad[i] = ao * 255;       // AO
        ad[i + 1] = 210 + stain * 30; // roughness
        ad[i + 2] = 8;          // metalness
        ad[i + 3] = 255;
      }
    }
    ag.putImageData(aimg, 0, 0);
    const arm = new THREE.CanvasTexture(ac);
    arm.colorSpace = THREE.NoColorSpace;
    arm.wrapS = arm.wrapT = THREE.RepeatWrapping;
    this._plaster = { map, nor, arm };
    return this._plaster;
  }

  mat(name, opts = {}) {
    // Tiling is applied on mesh UVs (World._box). Ignore `repeat` so rooms share one material per texture+tint.
    const key = name + JSON.stringify({ color: opts.color || 0xffffff, roughness: opts.roughness, metalness: opts.metalness, env: opts.env, side: opts.side, transparent: !!opts.transparent, opacity: opts.opacity, lm: opts.lm });
    if (this.mats.has(key)) return this.mats.get(key);
    let pack = this.textures.get(name) || {};
    if (name === 'plaster') {
      const gen = this._plasterMaps();
      pack = { diff: gen.map, nor: pack.nor || gen.nor, arm: gen.arm || pack.arm };
    }
    const color = new THREE.Color(opts.color || 0xffffff);
    const wallLm = name === 'plaster' ? 0.36 : undefined;
    const m = new THREE.MeshStandardMaterial({
      map: pack.diff || null,
      normalMap: pack.nor || null,
      aoMap: pack.arm || null,
      roughnessMap: pack.arm || null,
      metalnessMap: pack.arm || null,
      color,
      roughness: opts.roughness ?? (name === 'plaster' ? 0.92 : 0.85),
      metalness: opts.metalness ?? (name === 'metal' || name === 'iron' ? 0.7 : 0.04),
      envMapIntensity: opts.env ?? (name === 'plaster' ? 0.22 : 0.45),
      side: opts.side || THREE.FrontSide,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      lightMap: opts.lightMap || this.lightMap || null,
      lightMapIntensity: opts.lm ?? wallLm ?? (this.lightMap ? this.lightMapIntensity : 1),
      vertexColors: false,
    });
    m.userData.texName = name;
    this.mats.set(key, m);
    return m;
  }

  basic(color, opts = {}) {
    const key = 'basic:' + JSON.stringify({ color, r: opts.roughness, m: opts.metalness, t: !!opts.transparent, o: opts.opacity, e: opts.emissive, em: opts.em });
    if (this.mats.has(key)) return this.mats.get(key);
    const m = new THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.6, metalness: opts.metalness ?? 0.05,
      envMapIntensity: 0.45, transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
      emissive: opts.emissive || 0x000000, emissiveIntensity: opts.em ?? 0,
    });
    this.mats.set(key, m);
    return m;
  }

  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xb8c8dc, 0x2a2018, 0.32);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 1.05);
    this.sun.position.set(-18, 28, 10);
    this.sun.target.position.set(0, 2, 0);
    this.sun.castShadow = this._cfg().shadows;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.camera.left = -30;
    this.sun.shadow.camera.right = 30;
    this.sun.shadow.camera.top = 24;
    this.sun.shadow.camera.bottom = -24;
    this.scene.add(this.sun, this.sun.target);
    const amb = new THREE.AmbientLight(0xffffff, 0.08);
    this.scene.add(amb);
  }

  clearProbes() {
    for (const p of this.probes || []) {
      if (p.parent) p.parent.remove(p);
    }
    this.probes = [];
  }

  addRoomProbe(pos, color, intensity = 0.4) {
    const probe = new THREE.LightProbe();
    probe.position.copy(pos);
    const sh = probe.sh;
    // modest ambient fill in the room colour
    const c = new THREE.Color(color);
    sh.coefficients[0].set(c.r * intensity, c.g * intensity, c.b * intensity);
    this.scene.add(probe);
    this.probes.push(probe);
    return probe;
  }

  applyProbeAt(x, y, z, target) {
    if (!this.probes.length || !this._cfg().probes) return;
    let best = this.probes[0], bd = 1e9;
    for (const p of this.probes) {
      const d = p.position.distanceToSquared({ x, y, z });
      if (d < bd) { bd = d; best = p; }
    }
    if (target) target.sh = best.sh;
  }

  _syncVmEnv() {
    if (!this.vmScene) return;
    this.vmScene.environment = this.env || null;
    this.vmScene.environmentIntensity = 1.05;
    if (this.vmRoot) this._prepVmMaterials(this.vmRoot);
  }

  _prepVmMaterials(root) {
    if (!root) return;
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.needsUpdate = true; }
        if (m.normalMap) { m.normalMap.colorSpace = THREE.NoColorSpace; }
        if (m.roughnessMap) { m.roughnessMap.colorSpace = THREE.NoColorSpace; }
        if (m.metalnessMap) { m.metalnessMap.colorSpace = THREE.NoColorSpace; }
        if (m.aoMap) { m.aoMap.colorSpace = THREE.NoColorSpace; }
        if (this.env) {
          m.envMap = this.env;
          m.envMapIntensity = Math.max(0.9, m.envMapIntensity || 0);
        }
        if (!m.map) {
          if (!m.color || m.color.getHex() === 0x000000) m.color.set(0x5c5e62);
          m.metalness = Math.min(m.metalness ?? 1, 0.55);
          m.roughness = Math.max(m.roughness ?? 0.5, 0.38);
        }
        m.needsUpdate = true;
      }
    });
  }

  initViewmodel() {
    if (this.vmScene) { this._syncVmEnv(); return; }
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(52, this.camera.aspect || 1, 0.02, 10);
    this.vmScene.environment = this.env || null;
    this.vmScene.environmentIntensity = 1.05;
    const hemi = new THREE.HemisphereLight(0xfff1e2, 0x2a241c, 0.85);
    const key = new THREE.DirectionalLight(0xfff6ea, 2.85);
    key.position.set(0.45, 0.9, 0.75);
    key.target.position.set(0, -0.02, -0.28);
    const fill = new THREE.DirectionalLight(0x9bb4cc, 1.25);
    fill.position.set(-0.85, 0.35, 0.55);
    fill.target.position.set(0, 0, -0.25);
    const rim = new THREE.DirectionalLight(0xffd8b0, 1.7);
    rim.position.set(-0.2, 0.45, -0.85);
    rim.target.position.set(0, 0, -0.2);
    this.vmScene.add(hemi, key, key.target, fill, fill.target, rim, rim.target);
    this._vmLights = { hemi, key, fill, rim };
  }

  setViewmodel(root) {
    this.initViewmodel();
    if (this.vmRoot && this.vmRoot.parent) this.vmRoot.parent.remove(this.vmRoot);
    // Never parent the viewmodel to the world camera.
    this._prepVmMaterials(root);
    this.vmScene.add(root);
    this.vmRoot = root;
  }

  setVmClip(distance = 0) {
    if (distance && distance > 0.021) {
      this._vmClipPlane.set(new THREE.Vector3(0, 0, -1), -distance);
      this._vmClipOn = true;
    } else {
      this._vmClipOn = false;
    }
  }

  _renderVm() {
    if (!this.vmRoot || !this.vmRoot.visible || !this.vmScene || !this.vmCamera) return;
    const r = this.renderer;
    const prevPlanes = r.clippingPlanes;
    const prevLocal = r.localClippingEnabled;
    if (this._vmClipOn) {
      r.localClippingEnabled = true;
      r.clippingPlanes = this._vmClipPlanes;
    }
    const auto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.vmScene, this.vmCamera);
    r.autoClear = auto;
    r.clippingPlanes = prevPlanes;
    r.localClippingEnabled = prevLocal;
  }

  render() {
    this.onBeforeRender?.();
    if (this.vmCamera) {
      this.vmCamera.aspect = this.camera.aspect;
      this.vmCamera.updateProjectionMatrix();
    }
    if (this.composer && !this.skipPost) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this._renderVm();
  }

  info() {
    const i = this.renderer.info;
    return { draws: i.render.calls, tris: i.render.triangles, geoms: i.memory.geometries, geometries: i.memory.geometries, tex: i.memory.textures, textures: i.memory.textures, texMB: i.memory.textures * 0.5 };
  }

  limitShadows(camera) {
    if (this.quality !== 'high' || !this._cfg().shadows) {
      return;
    }
    const origin = camera.position;
    const casters = [];
    this.scene.traverse(o => {
      if ((o.isMesh || o.isInstancedMesh) && o.castShadow) casters.push(o);
    });
    // Keep large structural casters plus the nearest few props/pawns.
    const scored = casters.map(o => {
      const box = o.geometry?.boundingSphere || { radius: 0.5 };
      const r = box.radius || 0.5;
      const d = o.getWorldPosition(new THREE.Vector3()).distanceTo(origin);
      const large = r > 1.2 || (o.userData.kind === 'floor') || o.name === 'merged-static';
      return { o, d, large, r };
    });
    scored.sort((a, b) => (b.large - a.large) || (a.d - b.d));
    const cap = 28;
    scored.forEach((s, i) => { s.o.castShadow = i < cap && (s.large || s.d < 22); });
  }

  measure() {
    // Direct render so renderer.info reflects the scene, not a composer blit.
    this.onBeforeRender?.();
    if (this.quality === 'high' && this._cfg().shadows) this.limitShadows(this.camera);
    const prevAuto = this.renderer.info.autoReset;
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    const world = this.info();
    let vmDraws = 0;
    if (this.vmRoot && this.vmRoot.visible && this.vmScene && this.vmCamera) {
      this._renderVm();
      const all = this.info();
      vmDraws = Math.max(0, (all.draws || 0) - (world.draws || 0));
    }
    const out = { ...world, vmDraws };
    this.renderer.info.autoReset = prevAuto;
    return out;
  }

  tickAuto(dt) {
    if (!this.auto) return;
    const fps = 1 / Math.max(0.001, dt);
    this._fps = this._fps * 0.9 + fps * 0.1;
    if (this._fps < 48 && this.dpr > 0.6) { this.dpr = Math.max(0.6, this.dpr - 0.05); this.resize(); }
    else if (this._fps > 57 && this.dpr < this._cfg().dpr) { this.dpr = Math.min(this._cfg().dpr, this.dpr + 0.02); this.resize(); }
  }
}
