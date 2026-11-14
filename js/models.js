/**
 * IRONVEIL v3 model loader (docs/CHAR-PIPELINE-SPEC.md).
 *
 * Loads the reference humanoid (or a drop-in v3 operator at
 * assets/models/operators/<id>.glb) and the merged realistic weapons.
 * Retired Mixamo / Quaternius rigs are ignored.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildHuman } from './characters.js?v=iv-4.1.2';
import { HUMAN, SPEED } from './config.js?v=iv-4.1.2';

export const PATHS = {
  reference: 'assets/models/reference/humanoid.glb',
  viewmodelArms: 'assets/models/viewmodel/arms.glb',
  operator: id => `assets/models/operators/${id}.glb`,
  operatorLod: (id, lod) => `assets/models/operators/${id}_lod${lod}.glb`,
  weapon: id => `assets/models/weapons/${id}.glb`,
  weaponFp: id => `assets/models/weapons/${id}_fp.glb`,
  weaponTp: id => `assets/models/weapons/${id}_tp.glb`,
  attachment: id => `assets/models/attachments/${id}.glb`,
  gadget: id => `assets/models/gadgets/${id}.glb`,
};
export const OP_URL = PATHS.operator;
export const WPN_URL = PATHS.weapon;
export const BASE_URL = PATHS.reference;

export const WEAPON_MODELS = ['carbine', 'mp5', 'm870', 'dmr', 'p9', 'pdw', 'p45', 'revolver'];
export const ATTACH_MODELS = ['red', 'holo', 'scope2', 'scope4', 'suppressor', 'laser', 'grip', 'light', 'stock', 'bipod'];
export const GADGET_MODELS = ['breach', 'mine', 'shield', 'wire', 'cam'];

export const CLIP_NAMES = [
  'idle', 'walk', 'walk_L', 'walk_R', 'walk_B', 'run', 'sprint',
  'turn_L', 'turn_R',
  'crouch_idle', 'crouch_walk', 'prone_idle', 'prone_crawl',
  'stand_to_crouch', 'crouch_to_stand', 'crouch_to_prone', 'prone_to_crouch',
  'vault_low', 'rappel_idle', 'rappel_up', 'rappel_down',
  'aim_rifle', 'aim_pistol', 'reload', 'death', 'surrender', 'lean_L', 'lean_R',
  'select_idle', 'select_pick',
];
const SOCKET_OP = ['socket_weapon', 'socket_hand_L', 'socket_gadget', 'socket_back'];
const SOCKET_WPN = ['socket_muzzle', 'socket_optic', 'socket_grip', 'socket_underbarrel', 'ik_hand_L', 'ik_hand_R', 'socket_mag'];
/** Incoming authored empties from assist/v4-guns (and older socket_* names). */
const SOCKET_ALIASES = {
  socket_muzzle: ['socket_muzzle', 'muzzle'],
  socket_optic: ['socket_optic', 'sight_anchor', 'optic_anchor'],
  socket_grip: ['socket_grip', 'grip_anchor'],
  socket_underbarrel: ['socket_underbarrel'],
  ik_hand_R: ['ik_hand_R', 'grip_ik_r', 'hand_R', 'wrist_R'],
  ik_hand_L: ['ik_hand_L', 'grip_ik_l', 'hand_L', 'wrist_L'],
  socket_mag: ['socket_mag', 'mag_well', 'magazine_well'],
};

const LOWER_BONES = new Set([
  'root', 'hips', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R',
  'foot_L', 'foot_R', 'toe_L', 'toe_R',
]);
const UPPER_BONES = new Set([
  'spine', 'spine1', 'spine2', 'neck', 'head',
  'clavicle_L', 'clavicle_R', 'upperarm_L', 'upperarm_R',
  'lowerarm_L', 'lowerarm_R', 'hand_L', 'hand_R',
  'socket_weapon', 'socket_hand_L', 'socket_gadget', 'socket_back',
]);

const V3_MARKER = 'upperarm_L';
const ONCE_CLIPS = new Set(['reload', 'death', 'surrender', 'lean_L', 'lean_R', 'turn_L', 'turn_R', 'stand_to_crouch', 'crouch_to_stand', 'crouch_to_prone', 'prone_to_crouch', 'vault_low', 'select_pick']);
const ADDITIVE_CLIPS = new Set(['lean_L', 'lean_R']);

// Atlas cells written by tools/author-reference-humanoid.py (96x64, 32px, 3x2).
const ATLAS = { w: 96, h: 64, cell: 32, cols: 3 };
const ATLAS_CELLS = { suit: 0, vest: 1, skin: 2, helm: 3, dark: 4, boot: 5 };

const cache = new Map();
const buffers = new Map();
const available = new Map();
const v3Cache = new Map();
const attachCache = new Map();
const gadgetCache = new Map();

let loader = null;
let ready = null;
let _gfx = null;

export function initModelLoaders(gfx) {
  _gfx = gfx || _gfx;
  hookWeaponInstances(_gfx);
  if (loader && ready) return ready;
  const ktx2 = _gfx?.ktx2 || new KTX2Loader().setTranscoderPath('vendor/three/addons/libs/basis/');
  if (_gfx?.renderer && !_gfx.ktx2) {
    try { ktx2.detectSupport(_gfx.renderer); } catch {}
  }
  loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2);
  ready = (MeshoptDecoder.ready || Promise.resolve()).then(() => {
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader;
  });
  return ready;
}

function getLoader() {
  if (!loader) initModelLoaders(_gfx);
  return loader;
}

export async function probe(url) {
  if (available.has(url)) return available.get(url);
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const ok = r.ok;
    available.set(url, ok);
    return ok;
  } catch {
    available.set(url, false);
    return false;
  }
}

async function getBuffer(url) {
  if (buffers.has(url)) return buffers.get(url);
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error('fetch ' + url + ' ' + r.status);
  const buf = await r.arrayBuffer();
  buffers.set(url, buf);
  available.set(url, true);
  return buf;
}

/** True if a GLB's JSON chunk names the v3 bone `upperarm_L`. */
export async function glbIsV3(url) {
  if (v3Cache.has(url)) return v3Cache.get(url);
  const pending = (async () => {
    if (!(await probe(url))) return false;
    try {
      const buf = await getBuffer(url);
      const dv = new DataView(buf);
      if (dv.byteLength < 20) return false;
      const magic = dv.getUint32(0, true);
      if (magic !== 0x46546C67) return false; // glTF
      const jsonLen = dv.getUint32(12, true);
      const json = new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen));
      return json.includes('"' + V3_MARKER + '"');
    } catch {
      return false;
    }
  })();
  v3Cache.set(url, pending);
  const ok = await pending;
  v3Cache.set(url, ok);
  return ok;
}

export async function hasOperatorModel(id) {
  const urls = [PATHS.operatorLod(id, 2), PATHS.operatorLod(id, 1), PATHS.operatorLod(id, 0), PATHS.operator(id)];
  for (const u of urls) {
    if (await glbIsV3(u)) return true;
  }
  return false;
}
export async function hasWeaponModel(id) {
  return (await probe(PATHS.weaponFp(id))) || (await probe(PATHS.weapon(id)));
}
export async function hasAttachmentModel(id) { return probe(PATHS.attachment(id)); }
export async function hasGadgetModel(id) { return probe(PATHS.gadget(id)); }
export async function hasBaseRig() { return probe(PATHS.reference); }

async function firstV3(urls) {
  for (const u of urls) {
    if (await glbIsV3(u)) return u;
  }
  return null;
}

async function loadGltf(url) {
  if (cache.has(url)) return cache.get(url);
  const pending = (async () => {
    await initModelLoaders(_gfx);
    const buf = await getBuffer(url);
    const path = url.slice(0, url.lastIndexOf('/') + 1);
    const ldr = await ready;
    return await new Promise((resolve, reject) => ldr.parse(buf, path, resolve, reject));
  })();
  cache.set(url, pending);
  try {
    return await pending;
  } catch (e) {
    cache.delete(url);
    available.set(url, false);
    throw e;
  }
}

async function loadGltfInstance(url) {
  await initModelLoaders(_gfx);
  const buf = await getBuffer(url);
  const path = url.slice(0, url.lastIndexOf('/') + 1);
  const ldr = await ready;
  return await new Promise((resolve, reject) => ldr.parse(buf, path, resolve, reject));
}

function findNode(root, name) {
  if (!root || !name) return null;
  const hit = root.getObjectByName(name)
    || root.getObjectByName(name.toLowerCase())
    || root.getObjectByName(name.toUpperCase());
  if (hit) return hit;
  const want = String(name).toLowerCase();
  let found = null;
  root.traverse?.((o) => {
    if (found || !o.name) return;
    if (o.name.toLowerCase() === want) found = o;
  });
  return found;
}

function collectSockets(root, names) {
  const out = {};
  for (const n of names) {
    const aliases = SOCKET_ALIASES[n] || [n];
    let found = null;
    for (const a of aliases) {
      found = findNode(root, a);
      if (found) break;
    }
    out[n] = found;
  }
  // Expose the assist/v4-guns names alongside the legacy socket_* keys.
  if (out.socket_optic) out.sight_anchor = out.socket_optic;
  if (out.socket_muzzle) out.muzzle = out.socket_muzzle;
  if (out.ik_hand_R) out.grip_ik_r = out.ik_hand_R;
  if (out.ik_hand_L) out.grip_ik_l = out.ik_hand_L;
  if (out.socket_mag) out.mag_well = out.socket_mag;
  return out;
}

function cloneGltfScene(gltf) {
  const src = gltf.scene || gltf.scenes?.[0];
  if (!src) return new THREE.Group();
  let cloned;
  try { cloned = SkeletonUtils.clone(src); }
  catch { cloned = src.clone(true); }
  // SkeletonUtils reuses materials (and compact used to dispose them, which
  // emptied maps on the loader cache). Give each instance its own materials;
  // textures stay shared.
  cloned.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (Array.isArray(o.material)) o.material = o.material.map((m) => (m && m.clone ? m.clone() : m));
    else if (o.material.clone) o.material = o.material.clone();
  });
  return cloned;
}

const _matCache = new Map();
function internMaterial(m) {
  if (!m) return m;
  const key = [
    m.type,
    m.name || '',
    m.map?.uuid || '',
    m.normalMap?.uuid || '',
    m.roughnessMap?.uuid || '',
    m.metalnessMap?.uuid || '',
    m.aoMap?.uuid || '',
    m.color?.isColor ? m.color.getHex() : '',
    m.roughness, m.metalness,
    m.transparent ? 1 : 0,
    m.side,
  ].join('|');
  const hit = _matCache.get(key);
  if (hit) return hit;
  _matCache.set(key, m);
  return m;
}

const TP_BATCH_MAX = 24;
const _tpBatches = new Map();
const _tpWeaponProto = new Map();
const _tpAttachProto = new Map();
const _zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
const _instMat = new THREE.Matrix4();

function hookWeaponInstances(gfx) {
  if (!gfx || gfx._tpHooked) return;
  gfx._tpHooked = true;
  const prev = gfx.onBeforeRender;
  gfx.onBeforeRender = () => { prev?.(); tickWeaponInstances(); };
}

function isWorldVisible(obj) {
  let o = obj;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}

function collectMeshes(root) {
  const out = [];
  root?.traverse((o) => { if (o.isMesh && o.geometry) out.push(o); });
  return out;
}

function stripMeshes(root) {
  const drop = [];
  root.traverse((o) => { if (o.isMesh) drop.push(o); });
  for (const o of drop) o.parent?.remove(o);
  return root;
}

function ensureBatch(key, geometry, material, scene, shadows = true) {
  let b = _tpBatches.get(key);
  if (b) {
    if (scene && !b.mesh.parent) scene.add(b.mesh);
    return b;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, TP_BATCH_MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = TP_BATCH_MAX;
  mesh.castShadow = !!shadows;
  mesh.receiveShadow = !!shadows;
  mesh.frustumCulled = false;
  mesh.name = 'tp-batch-' + key;
  mesh.userData.noMerge = true;
  mesh.userData.instanced = true;
  for (let i = 0; i < TP_BATCH_MAX; i++) mesh.setMatrixAt(i, _zeroMat);
  mesh.instanceMatrix.needsUpdate = true;
  if (scene) scene.add(mesh);
  b = { mesh, slots: new Array(TP_BATCH_MAX).fill(null), free: [] };
  for (let i = TP_BATCH_MAX - 1; i >= 0; i--) b.free.push(i);
  _tpBatches.set(key, b);
  return b;
}

function allocInstance(key, geometry, material, scene, rec) {
  const b = ensureBatch(key, geometry, material, scene, true);
  if (!b.free.length) return null;
  const slot = b.free.pop();
  b.slots[slot] = rec;
  return { key, slot };
}

function releaseInstance(handle) {
  if (!handle) return;
  const b = _tpBatches.get(handle.key);
  if (!b) return;
  b.mesh.setMatrixAt(handle.slot, _zeroMat);
  b.mesh.instanceMatrix.needsUpdate = true;
  b.slots[handle.slot] = null;
  b.free.push(handle.slot);
}

export function tickWeaponInstances() {
  for (const b of _tpBatches.values()) {
    let dirty = false;
    for (let i = 0; i < TP_BATCH_MAX; i++) {
      const rec = b.slots[i];
      if (!rec) continue;
      const anchor = rec.anchor;
      if (!anchor || !isWorldVisible(anchor)) {
        b.mesh.setMatrixAt(i, _zeroMat);
      } else {
        anchor.updateMatrixWorld(true);
        if (rec.local) _instMat.multiplyMatrices(anchor.matrixWorld, rec.local);
        else _instMat.copy(anchor.matrixWorld);
        b.mesh.setMatrixAt(i, _instMat);
      }
      dirty = true;
    }
    if (dirty) {
      b.mesh.instanceMatrix.needsUpdate = true;
      let used = 0;
      for (let i = 0; i < TP_BATCH_MAX; i++) if (b.slots[i]) used = i + 1;
      b.mesh.count = used;
    }
  }
}

export function resetWeaponInstances() {
  for (const b of _tpBatches.values()) {
    b.mesh.parent?.remove(b.mesh);
  }
  _tpBatches.clear();
}

function weaponIdOf(weapon) {
  if (!weapon) return null;
  if (typeof weapon === 'string') return weapon;
  return weapon.id || weapon.name || null;
}

async function getTpWeaponProto(id) {
  if (_tpWeaponProto.has(id)) return _tpWeaponProto.get(id);
  const url = (await probe(PATHS.weaponTp(id))) ? PATHS.weaponTp(id)
    : (await probe(PATHS.weaponFp(id))) ? PATHS.weaponFp(id)
    : (await probe(PATHS.weapon(id))) ? PATHS.weapon(id)
    : null;
  if (!url) return null;
  const gltf = await loadGltf(url);
  const model = cloneGltfScene(gltf);
  hardenMaterials(model, true);
  const meshes = collectMeshes(model).map((o) => {
    o.updateWorldMatrix(true, false);
    return { geometry: o.geometry, material: o.material, local: o.matrixWorld.clone() };
  });
  const skeleton = stripMeshes(cloneGltfScene(gltf));
  const proto = { meshes, skeleton };
  _tpWeaponProto.set(id, proto);
  return proto;
}

async function getTpAttachProto(id) {
  if (_tpAttachProto.has(id)) return _tpAttachProto.get(id);
  const node = await loadAttachment(id);
  if (!node) return null;
  hardenMaterials(node, true);
  const meshes = collectMeshes(node).map((o) => {
    o.updateWorldMatrix(true, false);
    return { geometry: o.geometry, material: o.material, local: o.matrixWorld.clone() };
  });
  const proto = { meshes };
  _tpAttachProto.set(id, proto);
  return proto;
}

const LONG_GUNS = new Set(['carbine', 'mp5', 'm870', 'dmr', 'pdw', 'shotgun_pump']);

function foldFrontSight(model, opticSock) {
  if (!model || !opticSock) return;
  model.updateMatrixWorld(true);
  opticSock.updateMatrixWorld(true);
  const opticLocal = new THREE.Vector3();
  opticSock.getWorldPosition(opticLocal);
  model.worldToLocal(opticLocal);
  const v = new THREE.Vector3();
  let folded = 0;
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    o.geometry = o.geometry.clone();
    if (o.geometry.attributes.normal) o.geometry.attributes.normal = o.geometry.attributes.normal.clone();
    const pos = o.geometry.attributes.position;
    o.updateMatrixWorld(true);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      o.localToWorld(v);
      model.worldToLocal(v);
      const dz = opticLocal.z - v.z; // >0 is forward of the socket (−Z)
      const dx = v.x - opticLocal.x;
      const dy = v.y - opticLocal.y;
      // Anything standing up from the rail in a bore-sight cylinder,
      // from just in front of the optic out to the muzzle.
      const inTube = dz > 0.003 && Math.abs(dx) < 0.028 && dy > -0.004 && Math.hypot(dx, Math.max(0, dy)) < 0.032;
      if (inTube) {
        v.y = opticLocal.y - 0.002;
        model.localToWorld(v);
        o.worldToLocal(v);
        pos.setXYZ(i, v.x, v.y, v.z);
        folded++;
      }
    }
    pos.needsUpdate = true;
    if (folded) o.geometry.computeVertexNormals?.();
  });
  model.userData.foldedSightVerts = folded;
}

function hardenMaterials(root, shadows = true) {
  root.traverse(o => {
    if (o.geometry) {
      const attrs = o.geometry.attributes;
      for (const name of Object.keys(attrs)) {
        if (/^color/i.test(name)) o.geometry.deleteAttribute(name);
      }
    }
    if (!o.isMesh || !o.material) {
      if (o.isSkinnedMesh) o.frustumCulled = true;
      return;
    }
    const compacted = /^operator-merged/.test(o.name || '') || !!(o.userData && o.userData.atlas);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(m => {
      const keepAlpha = /eyelash|eyebrow|short01|short03|hair|lashes|bob02|long01/i.test(`${o.name || ''} ${m.name || ''}`);
      const side = o.isSkinnedMesh ? THREE.DoubleSide : THREE.FrontSide;
      if (m.isMeshPhysicalMaterial) {
        const sm = new THREE.MeshStandardMaterial({
          map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap,
          aoMap: m.aoMap, color: m.color, roughness: m.roughness ?? 0.5, metalness: m.metalness ?? 0.6,
          envMapIntensity: compacted ? 0.28 : 0.4, side, depthWrite: true, vertexColors: false,
          envMap: _gfx?.env || null,
          transparent: keepAlpha, alphaTest: keepAlpha ? 0.45 : 0,
        });
        if (sm.map) { sm.map.colorSpace = THREE.SRGBColorSpace; sm.map.needsUpdate = true; }
        if (sm.normalMap) sm.normalMap.colorSpace = THREE.NoColorSpace;
        return sm;
      }
      // Authored operator LODs are DoubleSide. FrontSide punched holes in
      // suits (black patches) and showed inner head faces as a white mask.
      m.side = side;
      m.vertexColors = false;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.needsUpdate = true; }
      if (m.normalMap) m.normalMap.colorSpace = THREE.NoColorSpace;
      if (m.roughnessMap) m.roughnessMap.colorSpace = THREE.NoColorSpace;
      if (m.metalnessMap) m.metalnessMap.colorSpace = THREE.NoColorSpace;
      if (m.aoMap) m.aoMap.colorSpace = THREE.NoColorSpace;
      // CC3 marks body/suit as BLEND with opacity 1 and no alpha map. That
      // transparent pass plus FrontSide is what blew out faces and pants.
      if (!keepAlpha && (m.opacity == null || m.opacity >= 0.999) && !m.alphaMap) {
        m.transparent = false;
        m.depthWrite = true;
        m.alphaTest = 0;
      }
      // Push the body slightly back so the untextured suit wins z on
      // overlapping clothing regions (black patches on tan/purple pants).
      if (/body\b|\.body/i.test(`${o.name || ''} ${m.name || ''}`)) {
        m.polygonOffset = true;
        m.polygonOffsetFactor = 1;
        m.polygonOffsetUnits = 1;
      }
      if (compacted) {
        // Keep the cloth-like compact IBL. Boosting this to >=0.9 made the
        // outdoor HDRI paint blue/green "C" patches on dark vests.
        if (_gfx?.env && !m.envMap) m.envMap = _gfx.env;
      } else if (_gfx?.env) {
        m.envMap = _gfx.env;
        if (m.envMapIntensity == null || m.envMapIntensity >= 0.89) m.envMapIntensity = 0.4;
      }
      if (!m.map && m.color && m.color.getHex() === 0x000000) m.color.set(0x5c5e62);
      return m;
    });
    o.material = Array.isArray(o.material) ? out.map(internMaterial) : internMaterial(out[0]);
    if (shadows) { o.castShadow = true; o.receiveShadow = true; }
    if (o.isSkinnedMesh) {
      o.frustumCulled = true;
      o.geometry?.computeBoundingSphere?.();
      if (o.geometry?.boundingSphere) o.geometry.boundingSphere.radius = Math.max(1.8, o.geometry.boundingSphere.radius * 2);
    } else {
      o.frustumCulled = true;
    }
  });
}

function isV3Root(root) {
  return !!(findNode(root, 'upperarm_L') && findNode(root, 'socket_weapon'));
}

function tintAtlasTexture(tex, team, accent) {
  const img = tex?.image;
  if (!img) return tex;
  const w = img.width || ATLAS.w, h = img.height || ATLAS.h;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  try { ctx.drawImage(img, 0, 0); } catch { return tex; }
  const suit = team === 'defend' ? '#243044' : '#3a3328';
  const vest = accent || (team === 'defend' ? '#4a6a88' : '#c67636');
  const helm = team === 'defend' ? '#1c2430' : '#2a241c';
  const cell = ATLAS.cell;
  const paint = (idx, color) => {
    const col = idx % ATLAS.cols, row = (idx / ATLAS.cols) | 0;
    ctx.fillStyle = color;
    ctx.fillRect(col * cell, h - (row + 1) * cell, cell, cell); // image pixels vs uv v-flip
    // Also paint the unflipped cell in case the atlas packed without flipY quirks.
    ctx.fillRect(col * cell, row * cell, cell, cell);
  };
  paint(ATLAS_CELLS.suit, suit);
  paint(ATLAS_CELLS.vest, vest);
  paint(ATLAS_CELLS.helm, helm);
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = tex.colorSpace || THREE.SRGBColorSpace;
  out.magFilter = THREE.NearestFilter;
  out.minFilter = THREE.NearestFilter;
  out.flipY = !!tex.flipY;
  out.needsUpdate = true;
  return out;
}

function applyTint(root, opts = {}) {
  const team = opts.team || 'attack';
  const accent = opts.accent || (team === 'attack' ? '#c67636' : '#4a6a88');
  // Leave the authored atlas alone (repainting cells blew out the vest).
  // A chest band on spine2 carries team / operator colour.
  if (findNode(root, 'accent-band')) return;
  const col = new THREE.Color(accent);
  col.multiplyScalar(0.7);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.12, envMapIntensity: 0.25 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.045, 8), mat);
  band.name = 'accent-band';
  band.castShadow = false;
  const arm = findNode(root, 'upperarm_L') || findNode(root, 'spine2');
  if (arm) {
    // Cylinder height is already along +Y, which is the bone axis.
    band.position.set(0, 0.12, 0);
    arm.add(band);
  }
}

function trackBoneName(track) {
  const dot = track.name.lastIndexOf('.');
  if (dot < 0) return track.name;
  const path = track.name.slice(0, dot);
  return path.split('/').pop();
}

function normalizeClipTracks(clip, root) {
  const names = new Set();
  root.traverse(o => { if (o.name) names.add(o.name); });
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const path = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    if (names.has(path)) continue;
    const leaf = path.split('/').pop().split('.').pop();
    if (leaf && names.has(leaf)) track.name = leaf + '.' + prop;
  }
  return clip;
}

function filterClip(clip, keep) {
  const c = clip.clone();
  c.tracks = c.tracks.filter(t => keep.has(trackBoneName(t)));
  c.name = clip.name;
  return c;
}

function bindClips(root, gltf) {
  const mixerRoot = findNode(root, 'root')?.parent || root;
  const mixer = new THREE.AnimationMixer(mixerRoot);
  const actions = {};
  const clips = {};
  for (const raw of (gltf.animations || [])) {
    const key = (raw.name || '').toLowerCase();
    if (!key) continue;
    const c = normalizeClipTracks(raw.clone ? raw.clone() : THREE.AnimationClip.parse(raw), mixerRoot);
    c.name = key;
    clips[key] = c;
    const mk = (clip, suffix) => {
      if (!clip || !clip.tracks.length) return null;
      const act = mixer.clipAction(clip, mixerRoot);
      act.enabled = true;
      if (ONCE_CLIPS.has(key)) {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      } else {
        act.setLoop(THREE.LoopRepeat, Infinity);
      }
      if (ADDITIVE_CLIPS.has(key)) {
        try {
          const add = THREE.AnimationUtils.makeClipAdditive(clip);
          const a = mixer.clipAction(add, mixerRoot);
          a.blendMode = THREE.AdditiveAnimationBlendMode;
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          a.enabled = true;
          a.weight = 0;
          return a;
        } catch {
          act.weight = 0;
          return act;
        }
      }
      act.weight = 0;
      return act;
    };
    actions[key] = mk(c);
    const lower = filterClip(c, LOWER_BONES);
    const upper = filterClip(c, UPPER_BONES);
    if (lower.tracks.length) actions[key + '_lower'] = mk(lower);
    if (upper.tracks.length) actions[key + '_upper'] = mk(upper);
  }
  // Fallbacks so a partial drop-in still animates.
  if (!actions.walk && actions.run) actions.walk = actions.run;
  if (!actions.run && actions.walk) actions.run = actions.walk;
  if (!actions.crouch_idle && actions.idle) actions.crouch_idle = actions.idle;
  if (!actions.crouch_walk && actions.walk) actions.crouch_walk = actions.walk;
  if (!actions.prone_idle && actions.crouch_idle) actions.prone_idle = actions.crouch_idle;
  if (!actions.aim_rifle && actions.idle) actions.aim_rifle = actions.idle;
  if (!actions.aim_pistol && actions.aim_rifle) actions.aim_pistol = actions.aim_rifle;
  return { mixer, actions, mixerRoot, clips };
}

function setActionWeight(act, w, resetIfNeeded = false) {
  if (!act) return;
  if (w > 0.001) {
    if (!act.isRunning()) {
      if (resetIfNeeded) act.reset();
      act.play();
    }
    act.enabled = true;
    act.setEffectiveWeight(w);
  } else {
    act.setEffectiveWeight(0);
    if (act.isRunning() && !act.clampWhenFinished) act.stop();
  }
}

/**
 * Locomotion state machine + upper-body aim layer + additive lean.
 * `state`: { speed, stance, aiming, pistol, lean, dead, surrender, reloading, dt }
 */

function standLoco(spd, s) {
  const mx = s.strafe ?? s.moveX ?? 0;
  const my = s.fwd ?? s.moveY ?? (spd > 0.25 ? 1 : 0);
  if (Math.abs(mx) > 0.45 && Math.abs(mx) >= Math.abs(my) + 0.1) {
    return mx < 0 ? 'walk_L' : 'walk_R';
  }
  if (my < -0.35) return 'walk_B';
  const runSpd = SPEED.run?.[1] ?? 4.30;
  const sprintSpd = SPEED.sprint[1] ?? 4.55;
  if (spd >= (runSpd + sprintSpd) * 0.5) return 'sprint';
  if (spd > (SPEED.walk[1] ?? 2.95) + 0.35) return 'run';
  return 'walk';
}

const ANIM_LOD = { near: 12, mid: 28, hzNear: 60, hzMid: 30, hzFar: 12 };

export function tickOperator(vis, dt, state) {
  if (!vis) return;
  let d = Math.max(0, Math.min(0.08, dt || 0));
  vis._t = (vis._t || 0) + d;
  if (!vis.mixer || !vis.actions) return;

  // Animation LOD: 60 / 30 / 15 Hz mixer update throttle (research §9).
  if (state) vis._loco = { ...(vis._loco || {}), ...state };
  const lodS = vis._loco || {};
  const dist = lodS.lodDist ?? lodS.camDist ?? 0;
  const hz = (lodS.offscreen || dist > ANIM_LOD.mid) ? ANIM_LOD.hzFar
    : dist > ANIM_LOD.near ? ANIM_LOD.hzMid
    : ANIM_LOD.hzNear;
  if (hz < 60 && !lodS.forceTick) {
    vis._animAcc = (vis._animAcc || 0) + d;
    if (vis._animAcc < 1 / hz) return;
    d = Math.min(0.08, vis._animAcc);
    vis._animAcc = 0;
  }

  const s = vis._loco || {};
  const acts = vis.actions;

  const showcase = s.clip === 'select_idle' || s.clip === 'select_pick'
    || s.pose === 'select_idle' || s.pose === 'select_pick';
  if (showcase) {
    let name = (s.clip === 'select_pick' || s.pose === 'select_pick') ? 'select_pick' : 'select_idle';
    const pick = acts.select_pick;
    if (name === 'select_pick' && pick && vis._current === pick && !pick.isRunning()) name = 'select_idle';
    const act = acts[name];
    if (act && vis._current !== act) {
      vis.mixer.stopAllAction();
      act.reset().setEffectiveWeight(1).play();
      vis._current = act;
    }
    vis.mixer.update(d);
    vis._ikOff = true;
    return;
  }

  if (s.dead) {
    const death = acts.death;
    if (death && vis._current !== death) {
      vis.mixer.stopAllAction();
      death.reset().setEffectiveWeight(1).play();
      vis._current = death;
    }
    vis.mixer.update(d);
    vis._ikOff = true;
    return;
  }
  if (s.surrender) {
    const sur = acts.surrender;
    if (sur && vis._current !== sur) {
      vis.mixer.stopAllAction();
      sur.reset().setEffectiveWeight(1).play();
      vis._current = sur;
    }
    vis.mixer.update(d);
    vis._ikOff = true;
    return;
  }

  const spd = Math.max(0, s.speed || 0);
  const stance = s.stance || 0;
  const aiming = !s.reloading && (s.aiming ? 1 : (s.aim || 0));
  let aimW = typeof aiming === 'number' ? THREE.MathUtils.clamp(aiming, 0, 1) : (aiming ? 1 : 0);
  if (aimW < 0.02 && !s.reloading && s.hipReady !== false && !s.vault && !s.rappel) {
    aimW = 0.35; // light hip-ready (research §3.1)
  }
  const pistol = !!s.pistol;
  const moving = spd > 0.25;

  const weights = {};
  const add = (name, w) => { if (w > 0.001) weights[name] = (weights[name] || 0) + w; };

  if (s.vault && acts.vault_low) {
    add('vault_low', 1);
  } else if (s.rappel) {
    const r = s.rappel === 'up' ? 'rappel_up' : s.rappel === 'down' ? 'rappel_down' : 'rappel_idle';
    add(acts[r] ? r : 'rappel_idle', 1);
  } else if (stance >= 1.5) {
    add(moving ? 'prone_crawl' : 'prone_idle', 1);
  } else if (stance >= 0.5) {
    const c = THREE.MathUtils.clamp((stance - 0.5) / 0.7, 0, 1);
    const crouchClip = moving ? 'crouch_walk' : 'crouch_idle';
    const standClip = moving ? standLoco(spd, s) : 'idle';
    add(standClip, 1 - c);
    add(crouchClip, c);
  } else if (!moving) {
    add('idle', 1);
  } else {
    const walkSpd = SPEED.walk[1] ?? 2.95;
    const runSpd = SPEED.run?.[1] ?? 4.30;
    const sprintSpd = SPEED.sprint[1] ?? 4.55;
    const clip = standLoco(spd, s);
    if (clip === 'sprint' || (clip === 'run' && spd > runSpd + 0.15)) {
      const t = THREE.MathUtils.clamp((spd - runSpd) / Math.max(0.15, sprintSpd - runSpd), 0, 1);
      add('run', 1 - t);
      add('sprint', t);
    } else if (clip === 'run' || clip === 'walk') {
      const t = THREE.MathUtils.clamp((spd - walkSpd) / Math.max(0.2, runSpd - walkSpd), 0, 1);
      add('walk', 1 - t);
      add('run', t);
    } else {
      add(clip, 1);
    }
  }

  // Apply loco as full-body when not aiming, lower-body when aiming.
  const used = new Set();
  for (const key of Object.keys(acts)) {
    if (key.endsWith('_lower') || key.endsWith('_upper')) continue;
    if (ONCE_CLIPS.has(key)) continue;
    const w = weights[key] || 0;
    const full = acts[key];
    const lower = acts[key + '_lower'];
    if (aimW > 0.02 && lower) {
      setActionWeight(full, w * (1 - aimW));
      setActionWeight(lower, w * aimW);
    } else {
      setActionWeight(full, w);
      setActionWeight(lower, 0);
    }
    used.add(key); used.add(key + '_lower');
    // Speed-matched playback for moving clips.
    const scale = (!w || key === 'idle' || key === 'crouch_idle' || key === 'prone_idle' || key.startsWith('rappel'))
      ? 1
      : (key === 'sprint' ? spd / (SPEED.sprint[1] || 4.55)
        : key === 'run' ? spd / (SPEED.run?.[1] || 4.30)
        : key === 'crouch_walk' ? spd / (SPEED.crouch || 1.70)
        : key === 'prone_crawl' ? spd / (SPEED.prone || 0.85)
        : spd / (SPEED.walk[1] || 2.95));
    const ts = THREE.MathUtils.clamp(scale, 0.4, 2.2);
    if (full) full.timeScale = ts;
    if (lower) lower.timeScale = ts;
  }

  const aimName = pistol ? 'aim_pistol' : 'aim_rifle';
  const aimAct = acts[aimName + '_upper'] || acts[aimName];
  const otherAim = acts[(pistol ? 'aim_rifle' : 'aim_pistol') + '_upper'] || acts[pistol ? 'aim_rifle' : 'aim_pistol'];
  setActionWeight(aimAct, aimW, true);
  setActionWeight(otherAim, 0);
  used.add(aimName); used.add(aimName + '_upper');

  if (s.reloading && acts.reload) {
    if (vis._current !== acts.reload) {
      acts.reload.reset().setEffectiveWeight(1).play();
      vis._current = acts.reload;
    }
    vis._ikOff = true;
  } else if (vis._current === acts.reload) {
    vis._current = null;
    vis._ikOff = false;
  }

  // Additive lean
  const lean = s.lean || 0;
  setActionWeight(acts.lean_L, lean > 0.05 ? Math.min(1, lean) : 0, true);
  setActionWeight(acts.lean_R, lean < -0.05 ? Math.min(1, -lean) : 0, true);

  vis.mixer.update(d);
  vis._ikOff = vis._ikOff || !!s.reloading;
  if (!vis._ikOff && aimW > 0.15) applyLeftHandIK(vis);
}

const _ikEnd = new THREE.Vector3();
const _ikBone = new THREE.Vector3();
const _ikTgt = new THREE.Vector3();
const _ikToEnd = new THREE.Vector3();
const _ikToTgt = new THREE.Vector3();
const _ikQ = new THREE.Quaternion();
const _ikWorld = new THREE.Quaternion();
const _ikParent = new THREE.Quaternion();

function applyLeftHandIK(vis) {
  const target = vis._weapon?.userData?.sockets?.ik_hand_L || findNode(vis._weapon, 'ik_hand_L');
  const upper = findNode(vis.mesh, 'upperarm_L');
  const lower = findNode(vis.mesh, 'lowerarm_L');
  const hand = findNode(vis.mesh, 'hand_L');
  if (!target || !upper || !lower || !hand) return;
  target.getWorldPosition(_ikTgt);
  const chain = [upper, lower, hand];
  for (let iter = 0; iter < 6; iter++) {
    for (let b = chain.length - 2; b >= 0; b--) {
      const bone = chain[b];
      const end = chain[chain.length - 1];
      bone.updateWorldMatrix(true, true);
      end.updateWorldMatrix(true, true);
      end.getWorldPosition(_ikEnd);
      bone.getWorldPosition(_ikBone);
      _ikToEnd.copy(_ikEnd).sub(_ikBone).normalize();
      _ikToTgt.copy(_ikTgt).sub(_ikBone).normalize();
      if (_ikToEnd.lengthSq() < 1e-8 || _ikToTgt.lengthSq() < 1e-8) continue;
      _ikQ.setFromUnitVectors(_ikToEnd, _ikToTgt);
      bone.getWorldQuaternion(_ikWorld);
      _ikWorld.premultiply(_ikQ);
      if (bone.parent) {
        bone.parent.getWorldQuaternion(_ikParent);
        bone.quaternion.copy(_ikParent.invert()).multiply(_ikWorld);
      } else {
        bone.quaternion.copy(_ikWorld);
      }
      bone.updateMatrix();
    }
  }
  hand.updateWorldMatrix(true, true);
}

function playPose(vis, name, t = 0) {
  vis._lastPose = name || 'idle';
  vis._t = t;
  const key = String(name || 'idle').toLowerCase();
  const map = {
    crouch: 'crouch_idle', prone: 'prone_idle', aim: 'aim_rifle',
  };
  const clip = map[key] || key;
  if (vis.mixer && vis.actions) {
    if (clip === 'select_idle' || clip === 'select_pick') {
      vis.mixer.stopAllAction();
      const act = vis.actions[clip];
      if (act) {
        act.reset().setEffectiveWeight(1).play();
        vis._current = act;
        vis._ikOff = true;
        vis.mixer.update(Math.max(0, t || 0));
      }
      return;
    }
    const dead = clip === 'death';
    const sur = clip === 'surrender';
    vis.mixer.stopAllAction();
    vis._current = null;
    vis._ikOff = false;
    tickOperator(vis, 0, {
      speed: (clip === 'walk' || clip === 'walk_L' || clip === 'walk_R' || clip === 'walk_B' || clip === 'crouch_walk' || clip === 'prone_crawl') ? (SPEED.walk[1] || 2.95)
        : clip === 'run' ? (SPEED.run?.[1] || 4.30)
        : clip === 'sprint' ? (SPEED.sprint[1] || 4.55) : 0,
      forceTick: true, hipReady: clip.startsWith('aim') ? undefined : false,
      rappel: clip.startsWith('rappel') ? (clip === 'rappel_up' ? 'up' : clip === 'rappel_down' ? 'down' : 'idle') : 0,
      vault: clip === 'vault_low',
      moveX: clip === 'walk_L' ? -1 : clip === 'walk_R' ? 1 : 0,
      moveY: clip === 'walk_B' ? -1 : 1,
      stance: (clip.startsWith('prone') ? 2 : clip.startsWith('crouch') ? 1 : 0),
      aiming: clip === 'aim_rifle' || clip === 'aim_pistol' || clip === 'aim' ? 1 : 0,
      pistol: clip === 'aim_pistol',
      dead, surrender: sur, reloading: clip === 'reload', lean: 0,
    });
    vis.mixer.update(Math.max(1 / 30, t || 0));
    if (!vis._ikOff && (clip === 'aim_rifle' || clip === 'aim_pistol' || clip === 'aim' || clip === 'walk' || clip === 'run' || clip.startsWith('crouch') || clip.startsWith('prone'))) {
      // keep the gun in the hand; IK only when aiming
    }
    if (!vis._ikOff && (clip === 'aim_rifle' || clip === 'aim_pistol' || clip === 'aim')) applyLeftHandIK(vis);
    return;
  }
}

export { tickOperator as tickOperatorMixer };

function desiredLod(dist, quality = 'med') {
  if (quality === 'low') return 2;
  if (quality === 'high') return dist < 8 ? 0 : (dist < 22 ? 1 : 2);
  return dist < 14 ? 1 : 2;
}

async function resolveOperatorUrl(id, lod = 2) {
  if (!id) return null;
  return firstV3([
    PATHS.operatorLod(id, lod),
    PATHS.operatorLod(id, Math.min(2, lod + 1)),
    PATHS.operatorLod(id, 2),
    PATHS.operator(id),
  ]);
}

let _blit = null;
function _ensureBlit() {
  if (_blit) return _blit;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.MeshBasicMaterial({
    depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const inpaint = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null },
      color: { value: new THREE.Color(1, 1, 1) },
      texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 color;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.45) {
          vec4 acc = vec4(0.0);
          float wt = 0.0;
          for (int i = 1; i <= 14; i++) {
            float d = float(i) * 1.6;
            vec2 offs[8];
            offs[0] = vec2(d, 0.0); offs[1] = vec2(-d, 0.0);
            offs[2] = vec2(0.0, d); offs[3] = vec2(0.0, -d);
            offs[4] = vec2(d, d); offs[5] = vec2(-d, d);
            offs[6] = vec2(d, -d); offs[7] = vec2(-d, -d);
            for (int k = 0; k < 8; k++) {
              vec4 s = texture2D(map, vUv + offs[k] * texel);
              if (s.a > 0.5) { acc += s; wt += 1.0; }
            }
            if (wt > 0.0) break;
          }
          if (wt > 0.0) c = vec4(acc.rgb / wt, 1.0);
          else c = vec4(color, 1.0);
        }
        gl_FragColor = vec4(c.rgb * color, 1.0);
      }
    `,
    depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  _blit = { cam, mat, mesh, scene, inpaint };
  return _blit;
}

function blitInto(renderer, target, srcTex, color, x, y, w, h, opts = {}) {
  const blit = _ensureBlit();
  const prevRT = renderer.getRenderTarget();
  const prevVP = new THREE.Vector4(); renderer.getViewport(prevVP);
  const prevSC = new THREE.Vector4(); renderer.getScissor(prevSC);
  const prevTest = renderer.getScissorTest();
  const prevAuto = renderer.autoClear;
  const prevOut = renderer.outputColorSpace;
  const prevMat = blit.mesh.material;
  renderer.outputColorSpace = target.texture.colorSpace || prevOut;
  renderer.setRenderTarget(target);
  renderer.setScissorTest(true);
  renderer.setViewport(x, y, w, h);
  renderer.setScissor(x, y, w, h);
  renderer.autoClear = false;
  if (srcTex) {
    try { renderer.initTexture(srcTex); } catch {}
  }
  const hex = color || 0xffffff;
  if (opts.fillHoles && srcTex) {
    const img = srcTex.image;
    const tw = img?.width || srcTex.source?.data?.width || srcTex.source?.data?.[0]?.width || 1024;
    const th = img?.height || srcTex.source?.data?.height || srcTex.source?.data?.[0]?.height || tw;
    blit.inpaint.uniforms.map.value = srcTex;
    blit.inpaint.uniforms.color.value.set(hex);
    blit.inpaint.uniforms.texel.value.set(1 / Math.max(1, tw), 1 / Math.max(1, th));
    blit.mesh.material = blit.inpaint;
  } else {
    blit.mat.map = srcTex || null;
    blit.mat.color.set(hex);
    blit.mat.needsUpdate = true;
    blit.mesh.material = blit.mat;
  }
  renderer.render(blit.scene, blit.cam);
  blit.mesh.material = prevMat;
  renderer.setRenderTarget(prevRT);
  renderer.setViewport(prevVP);
  renderer.setScissor(prevSC);
  renderer.setScissorTest(prevTest);
  renderer.autoClear = prevAuto;
  renderer.outputColorSpace = prevOut;
}

/**
 * Collapse a multi-mesh operator into two SkinnedMeshes (opaque + alpha)
 * sharing one albedo/normal atlas so 8–9 operators stay inside the world
 * draw cap. Meshes that share a material also share an atlas tile.
 */
const _compactTemplates = new Map();

function hideMouthInternals(root) {
  if (!root) return;
  // CC3/MPFB leftovers: teeth/tongue (dark lip bar) and the untextured
  // clothing-cage "low-poly" / "Delete.low-poly" mesh (white face mask,
  // shoulder blobs that read as a second head or a copper pauldron).
  const skipRe = /teeth_base|tongue01|\bteeth\b|\btongue\b|\bgums?\b|low-?poly|delete\.low/i;
  const rm = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const name = `${o.name || ''} ${mat?.name || ''}`;
    if (skipRe.test(name)) rm.push(o);
  });
  for (const mesh of rm) mesh.parent?.remove(mesh);
}

function compactOperatorScene(root) {
  if (!root || root.userData._opCompact) return;
  // Closed-mouth ready stance: teeth/tongue in the opaque atlas show up
  // as a dark bar across the lips (BLEND hole + premultiplied black).
  hideMouthInternals(root);
  const skinned = [];
  root.traverse((o) => { if (o.isSkinnedMesh && o.geometry) skinned.push(o); });
  if (skinned.length <= 2) { root.userData._opCompact = true; return; }
  const renderer = _gfx?.renderer;
  if (!renderer) {
    console.warn('compact operator skipped: no renderer', skinned.length);
    return;
  }

  const skeleton = skinned[0].skeleton;
  const parent = skinned[0].parent || root;
  const byMat = new Map();
  for (const mesh of skinned) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const name = `${mesh.name || ''} ${mat?.name || ''}`;
    const key = mat?.uuid || mesh.uuid;
    const alpha = /eyelash|eyebrow|short01|short03|hair|lashes|bob02|long01/i.test(name);
    if (!byMat.has(key)) byMat.set(key, { mat, meshes: [], alpha, name });
    const g = byMat.get(key);
    g.meshes.push(mesh);
    if (alpha) g.alpha = true;
  }
  const tiles = [...byMat.values()];
  const srcUrl = String(root.userData._srcUrl || '');
  const atlas = /_lod2\\.glb/.test(srcUrl) ? 512 : 1024;
  const cols = Math.max(2, Math.ceil(Math.sqrt(tiles.length)));
  const rows = Math.ceil(tiles.length / cols);
  const tile = Math.floor(atlas / Math.max(cols, rows));
  const pad = 12;

  const colorRT = new THREE.WebGLRenderTarget(atlas, atlas, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
  });
  colorRT.texture.colorSpace = THREE.SRGBColorSpace;
  colorRT.texture.generateMipmaps = false;
  colorRT.texture.minFilter = THREE.LinearFilter;
  colorRT.texture.magFilter = THREE.LinearFilter;
  colorRT.texture.wrapS = THREE.ClampToEdgeWrapping;
  colorRT.texture.wrapT = THREE.ClampToEdgeWrapping;
  const normalRT = new THREE.WebGLRenderTarget(atlas, atlas, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
  });
  normalRT.texture.colorSpace = THREE.NoColorSpace;
  normalRT.texture.generateMipmaps = false;
  normalRT.texture.minFilter = THREE.LinearFilter;
  normalRT.texture.magFilter = THREE.LinearFilter;
  normalRT.texture.wrapS = THREE.ClampToEdgeWrapping;
  normalRT.texture.wrapT = THREE.ClampToEdgeWrapping;

  const prevRT = renderer.getRenderTarget();
  const prevClear = new THREE.Color(); renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(colorRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.setRenderTarget(normalRT);
  renderer.setClearColor(0x8080ff, 1);
  renderer.clear();
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.setRenderTarget(prevRT);

  const opaqueGeos = [];
  const alphaGeos = [];
  tiles.forEach((tileSrc, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = col * tile + pad, y = row * tile + pad;
    const tw = tile - pad * 2, th = tile - pad * 2;
    const mat = tileSrc.mat;
    const color = mat?.color ? mat.color.getHex() : 0x808080;
    if (mat?.map && mat.map.colorSpace == null) mat.map.colorSpace = THREE.SRGBColorSpace;
    if (mat?.normalMap) mat.normalMap.colorSpace = THREE.NoColorSpace;
    const bleed = Math.max(1, pad - 1);
    const fillHoles = /\.body|body\b|skin/i.test(tileSrc.name) || !!(mat && (mat.transparent || mat.alphaMap));
    try {
      blitInto(renderer, colorRT, mat?.map || null, color, x - bleed, y - bleed, tw + bleed * 2, th + bleed * 2, { fillHoles });
      blitInto(renderer, colorRT, mat?.map || null, color, x, y, tw, th, { fillHoles });
    } catch (e) { console.warn('atlas color blit', e); }
    try {
      blitInto(renderer, normalRT, mat?.normalMap || null, 0x8080ff, x - bleed, y - bleed, tw + bleed * 2, th + bleed * 2);
      blitInto(renderer, normalRT, mat?.normalMap || null, 0x8080ff, x, y, tw, th);
    } catch (e) { console.warn('atlas normal blit', e); }
    const u0 = (col * tile + pad) / atlas;
    const v0 = (row * tile + pad) / atlas;
    const us = tw / atlas, vs = th / atlas;
    for (const mesh of tileSrc.meshes) {
      let geo = mesh.geometry.clone();
      if (geo.index) geo = geo.toNonIndexed();
      geo.morphTargetsRelative = false;
      geo.morphAttributes = {};
      geo.clearGroups?.();
      for (const name of Object.keys(geo.attributes)) {
        if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) geo.deleteAttribute(name);
      }
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      let uv = geo.getAttribute('uv');
      if (!uv) {
        const arr = new Float32Array(geo.getAttribute('position').count * 2);
        for (let v = 0; v < arr.length; v += 2) { arr[v] = 0.5; arr[v + 1] = 0.5; }
        geo.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
        uv = geo.getAttribute('uv');
      }
      for (let v = 0; v < uv.count; v++) {
        const uu = Math.min(1, Math.max(0, uv.getX(v)));
        const vv = Math.min(1, Math.max(0, uv.getY(v)));
        uv.setXY(v, u0 + uu * us, v0 + vv * vs);
      }
      uv.needsUpdate = true;
      (tileSrc.alpha ? alphaGeos : opaqueGeos).push(geo);
    }
  });

  const makeMat = (alphaTest) => {
    const material = new THREE.MeshStandardMaterial({
      map: colorRT.texture,
      normalMap: normalRT.texture,
      roughness: 0.86,
      metalness: 0.02,
      envMapIntensity: 0.28,
      side: THREE.DoubleSide,
      alphaTest: alphaTest || 0,
      transparent: false,
      depthWrite: true,
    });
    if (_gfx?.env) material.envMap = _gfx.env;
    return material;
  };

  const bindMerged = (geos, name, alphaTest) => {
    if (!geos.length) return null;
    let merged;
    try { merged = mergeGeometries(geos, false); }
    catch (e) {
      console.warn('operator merge failed', name, e, geos.map((g) => Object.keys(g.attributes)));
      return null;
    }
    if (!merged) return null;
    const compact = new THREE.SkinnedMesh(merged, makeMat(alphaTest));
    compact.name = name;
    compact.bind(skeleton, skinned[0].bindMatrix);
    compact.castShadow = true;
    compact.receiveShadow = true;
    compact.frustumCulled = false;
    compact.userData.atlas = { colorRT, normalRT };
    parent.add(compact);
    return compact;
  };

  const opaqueMesh = bindMerged(opaqueGeos, 'operator-merged', 0);
  const alphaMesh = bindMerged(alphaGeos, 'operator-merged-alpha', 0.45);
  if (!opaqueMesh && !alphaMesh) {
    colorRT.dispose(); normalRT.dispose();
    return;
  }

  for (const mesh of skinned) {
    mesh.parent?.remove(mesh);
    try { mesh.geometry.dispose(); } catch {}
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      // Maps are shared with the uncompacted loader cache and other clones.
      try { m.dispose(); } catch {}
    }
  }
  root.userData._opCompact = true;
}


async function loadOperatorGltf(url, opts = {}) {
  const gltf = await loadGltf(url);
  if (gltf.scene) gltf.scene.userData._srcUrl = url;
  // Keep the loader cache uncompacted so the select-panel LOD0 showcase
  // always gets authored meshes. Compact a fully isolated re-parse (not a
  // SkeletonUtils clone) so remapping UVs or disposing geos/materials
  // cannot poison the cache or later skipCompact clones.
  if (opts.skipCompact) {
    const scene = cloneGltfScene(gltf);
    hideMouthInternals(scene);
    hideForeignPauldron(scene, opts.id);
    return { scene, animations: gltf.animations, userData: gltf.userData };
  }
  let template = _compactTemplates.get(url);
  if (!template) {
    const isolated = await loadGltfInstance(url);
    template = isolated.scene || isolated.scenes?.[0] || new THREE.Group();
    template.userData._srcUrl = url;
    hideForeignPauldron(template, opts.id);
    try { compactOperatorScene(template); } catch (e) { console.warn('compact operator cache', e); }
    _compactTemplates.set(url, template);
  }
  return {
    scene: cloneGltfScene({ scene: template }),
    animations: gltf.animations,
    userData: gltf.userData,
  };
}

// Copper pauldron is Forge-only. Rivet keeps her authored steel pauldron.
function hideForeignPauldron(root, id) {
  if (!root || id === 'forge' || id === 'rivet' || !id) return;
  const rm = [];
  root.traverse((o) => {
    if (o.isMesh && /pauldron/i.test(o.name || '')) rm.push(o);
  });
  for (const mesh of rm) mesh.parent?.remove(mesh);
}

function installRig(vis, gltf, opts = {}) {
  const mesh = gltf.scene || gltf.scenes?.[0] || new THREE.Group();
  try {
    if (opts.skipCompact) hideMouthInternals(mesh);
    else compactOperatorScene(mesh);
  } catch (e) { console.warn('compact operator', e); }
  hardenMaterials(mesh, true);
  if (!opts.skipTint) applyTint(mesh, opts);
  while (vis.mesh.children.length) vis.mesh.remove(vis.mesh.children[0]);
  vis.mesh.add(mesh);
  const bound = bindClips(mesh, gltf);
  vis.mixer = bound.mixer;
  vis.actions = bound.actions;
  vis._current = null;
  vis.sockets = collectSockets(mesh, SOCKET_OP);
  vis.authored = isV3Root(mesh);
  vis.gltf = gltf;
  vis.mesh.userData.HUMAN = HUMAN;
  vis.mesh.frustumCulled = false;
  vis._loco = vis._loco || { speed: 0, stance: 0, aiming: 0 };
  vis.pose(vis._lastPose || 'idle', vis._t || 0);
  if (vis._pendingWeapon) {
    const w = vis._pendingWeapon;
    vis._pendingWeapon = null;
    attachWeaponToHand(vis, w).catch(() => {});
  }
}

async function loadOperatorLod(vis, lod) {
  const url = (await resolveOperatorUrl(vis.id, lod)) || PATHS.reference;
  vis._loading = true;
  try {
    const gltf = await loadOperatorGltf(url, { skipCompact: !!vis.skipCompact, id: vis.id });
    vis.lod = lod;
    vis.sourceUrl = url;
    installRig(vis, gltf, {
      team: vis.team, accent: vis.accent,
      skipTint: url !== PATHS.reference && vis.skipTint,
      skipCompact: !!vis.skipCompact,
    });
  } finally {
    vis._loading = false;
  }
}

export async function createOperatorMesh(opts = {}) {
  const id = opts.id || opts.opId;
  const quality = opts.quality || 'med';
  const lodHint = opts.lod != null ? opts.lod : (quality === 'high' ? 1 : 2);
  const root = new THREE.Group();
  root.name = 'op-' + (id || 'reference');
  root.userData.HUMAN = HUMAN;
  root.frustumCulled = false;

  const vis = {
    mesh: root, pose: () => {}, parts: {}, HUMAN,
    authored: false, lod: null, sockets: {},
    mixer: null, actions: {}, id, team: opts.team, accent: opts.accent,
    _loading: false, _t: 0, _current: null,
  };
  vis.pose = (name, t = 0) => playPose(vis, name, t);
  vis.tick = (dt, state) => tickOperator(vis, dt, state);

  const tryUrl = async (url, fallback) => {
    if (!(url && await probe(url))) return false;
    const gltf = await loadOperatorGltf(url, { skipCompact: !!opts.skipCompact, id });
    vis.lod = lodHint;
    vis.sourceUrl = url;
    vis.skipTint = !fallback;
    vis.skipCompact = !!opts.skipCompact;
    installRig(vis, gltf, {
      team: opts.team, accent: opts.accent, skipTint: !fallback,
      skipCompact: !!opts.skipCompact,
    });
    vis.authored = isV3Root(vis.mesh);
    return true;
  };
  try {
    const url = id && await resolveOperatorUrl(id, lodHint);
    if (url && await tryUrl(url, false)) return vis;
  } catch (e) {
    console.warn('v3 operator load failed, trying reference humanoid', id, e);
  }
  try {
    if (await tryUrl(PATHS.reference, true)) return vis;
  } catch (e) {
    console.warn('reference humanoid failed, using procedural fallback', id, e);
  }
  const human = buildHuman({ team: opts.team, seed: opts.seed, accent: opts.accent });
  root.add(human.mesh);
  vis.pose = human.pose;
  vis.parts = human.parts;
  return vis;
}

export function updateOperatorLod(vis, cameraOrPos, quality = 'med') {
  if (!vis?.authored || !vis.id || vis._loading) return;
  // Reference humanoid has no LODs. Only swap when a v3 operator drop-in exists.
  if (vis.sourceUrl === PATHS.reference) return;
  const pos = cameraOrPos.isVector3 ? cameraOrPos : cameraOrPos.position;
  const d = vis.mesh.position.distanceTo(pos);
  const want = desiredLod(d, quality);
  if (want === vis.lod) return;
  vis._triedLod = vis._triedLod || new Set();
  if (vis._triedLod.has(want)) return;
  vis._triedLod.add(want);
  const weapon = vis._weaponId || vis._pendingWeapon;
  loadOperatorLod(vis, want).then(() => {
    if (weapon) attachWeaponToHand(vis, weapon).catch(() => {});
  }).catch(() => {});
}

/** Lens centre relative to socket_optic (rail). Authored attachments sit on the rail. */
export const LENS_OFFSET = {
  iron: [0, 0.038, 0.10],
  red: [0, 0.028, 0],
  holo: [0, 0.032, 0.004],
  scope2: [0, 0.036, -0.004],
  scope4: [0, 0.040, -0.0175],
};
/** Eye relief (metres) from the lens to the viewmodel camera. */
export const EYE_RELIEF = {
  // Chosen so a ~0.011–0.013 m optic ring fills ~25–35% of 844-wide
  // screen at the ADS viewmodel FOV (red/holo ~40°).
  iron: 0.07,
  red: 0.055,
  holo: 0.058,
  scope2: 0.065,
  scope4: 0.075,
};
/** Radians of downward pitch around the lens so the receiver leaves the frame. */
export const ADS_PITCH = {
  iron: 0,
  red: 0,
  holo: 0,
  scope2: 0,
  scope4: 0,
};

function reticleTexture(kind, variant = 'core') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  const cx = 64, cy = 64;
  if (variant === 'bloom') {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, 36);
    grd.addColorStop(0, 'rgba(255, 240, 230, 0.55)');
    grd.addColorStop(0.45, 'rgba(255, 50, 40, 0.22)');
    grd.addColorStop(1, 'rgba(255, 16, 8, 0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, 36, 0, Math.PI * 2); g.fill();
  } else if (kind === 'holo') {
    g.strokeStyle = 'rgba(255, 80, 70, 1)';
    g.lineWidth = 3.5;
    g.beginPath(); g.moveTo(64, 26); g.lineTo(50, 80); g.lineTo(64, 70); g.lineTo(78, 80); g.closePath(); g.stroke();
    g.fillStyle = 'rgba(255, 245, 230, 1)';
    g.beginPath(); g.arc(64, 64, 3.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 40, 32, 1)';
    g.beginPath(); g.arc(64, 64, 1.6, 0, Math.PI * 2); g.fill();
  } else if (kind === 'scope2' || kind === 'scope4') {
    g.fillStyle = 'rgba(255, 245, 230, 1)';
    g.beginPath(); g.arc(64, 64, 3.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 36, 28, 1)';
    g.beginPath(); g.arc(64, 64, 1.7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 48, 36, 1)';
    g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(64, 16); g.lineTo(64, 52); g.moveTo(64, 76); g.lineTo(64, 112);
    g.moveTo(16, 64); g.lineTo(52, 64); g.moveTo(76, 64); g.lineTo(112, 64); g.stroke();
  } else if (kind === 'iron') {
    g.fillStyle = 'rgba(255, 220, 90, 1)';
    g.beginPath(); g.arc(64, 64, 3.4, 0, Math.PI * 2); g.fill();
  } else {
    // Disc fills enough of the 128px atlas that a 0.0032 m plane
    // reads as a ~6–8 CSS-px crisp dot at 0.055 m relief, not a sub-pixel speck.
    g.fillStyle = 'rgba(255, 255, 245, 1)';
    g.beginPath(); g.arc(cx, cy, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 32, 24, 1)';
    g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeReticle(kind = 'red') {
  const size = kind === 'holo' ? 0.006 : (kind === 'scope2' || kind === 'scope4' ? 0.007 : (kind === 'iron' ? 0.0024 : 0.0032));
  const g = new THREE.Group();
  g.name = 'reticle';
  g.frustumCulled = false;
  if (kind !== 'iron') {
    // Dark disc so the additive glow stays readable on a bright wall.
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.28, 20),
      new THREE.MeshBasicMaterial({
        color: 0x1a0000,
        transparent: true,
        opacity: 0.62,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.position.z = 0.0005;
    halo.renderOrder = 8;
    halo.name = 'reticle-halo';
    const bloom = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 1.6, size * 1.6),
      new THREE.MeshBasicMaterial({
        map: reticleTexture(kind, 'bloom'),
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    bloom.position.z = -0.0002;
    bloom.renderOrder = 9;
    bloom.name = 'reticle-bloom';
    g.add(halo, bloom);
  }
  const core = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: reticleTexture(kind),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  core.name = 'reticle-core';
  core.frustumCulled = false;
  core.renderOrder = 10;
  g.add(core);
  return g;
}

function makeLensGlass(radius = 0.011) {
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({
      color: 0x0a1014,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  glass.name = 'lens-glass';
  glass.renderOrder = 7;
  return glass;
}

function makeIronSight() {
  const g = new THREE.Group();
  g.name = 'iron-sight';
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.45, metalness: 0.65 });
  // Group origin is the sight / lens. Rear U-notch here, front post down the barrel
  // over the baked front-sight rise at socket z ≈ -0.30 (local z ≈ -0.40).
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.014, 0.003), dark);
  post.position.set(0, -0.0072, -0.40);
  const tip = new THREE.Mesh(
    new THREE.BoxGeometry(0.0026, 0.0026, 0.0026),
    new THREE.MeshBasicMaterial({ color: 0xffcc55, toneMapped: false }),
  );
  tip.position.set(0, 0.0, -0.40);
  const notchL = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.004), dark);
  const notchR = notchL.clone();
  notchL.position.set(-0.007, 0.0, 0.0);
  notchR.position.set(0.007, 0.0, 0.0);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.0035, 0.004), dark);
  blade.position.set(0, -0.0088, 0.0);
  g.add(post, tip, notchL, notchR, blade);
  return g;
}

function makeLensVignette(radius) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 36, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.62, 'rgba(0,0,0,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(64, 64, 64, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    }),
  );
  mesh.name = 'lens-vignette';
  mesh.renderOrder = 7.5;
  return mesh;
}

function makeOpticHousing(kind) {
  const g = new THREE.Group();
  g.name = 'optic-housing';
  // Matte dark-grey tube, not a glossy black torus. Wall ~2% of screen
  // per side at the ADS eye relief (~4% across the rim pair).
  const matte = new THREE.MeshStandardMaterial({
    color: 0x3a3c3e, roughness: 0.9, metalness: 0.1,
  });
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0x1a1b1d, roughness: 0.95, metalness: 0.04, side: THREE.BackSide,
  });
  const rIn = kind === 'holo' ? 0.015 : (kind === 'scope2' || kind === 'scope4' ? 0.012 : 0.011);
  const wall = 0.0018;
  const rOut = rIn + wall;
  const len = kind === 'scope4' ? 0.09 : (kind === 'scope2' ? 0.07 : (kind === 'holo' ? 0.028 : 0.032));
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(rOut, rOut, len, 28, 1, true), matte);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = -len * 0.5;
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, len, 28, 1, true), innerMat);
  bore.rotation.x = Math.PI / 2;
  bore.position.z = -len * 0.5;
  const rim = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 28), matte);
  rim.position.z = 0;
  const rimFront = rim.clone();
  rimFront.position.z = -len;
  const vignette = makeLensVignette(rIn);
  vignette.position.z = 0.0004;
  g.add(tube, bore, rim, rimFront, vignette);
  return g;
}



export async function createWeaponViewmodel(weapon = {}) {
  const id = weapon.id || weapon.name;
  if (!id || !WEAPON_MODELS.includes(id)) return null;
  if (!(await hasWeaponModel(id))) return null;
  try {
    await initModelLoaders(_gfx);
    // First-person only — never the low-detail TP mesh.
    const url = (await probe(PATHS.weaponFp(id))) ? PATHS.weaponFp(id) : null;
    if (!url) return null;
    const gltf = await loadGltf(url);
    const root = new THREE.Group();
    root.name = 'weapon-vm';
    root.frustumCulled = false;
    const model = cloneGltfScene(gltf);
    hardenMaterials(model, false);
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    root.add(model);
    const sockets = collectSockets(model, SOCKET_WPN);
    root.userData.sockets = sockets;
    root.userData.authored = true;
    root.userData.weaponId = id;

    const opticSock = sockets.socket_optic || sockets.sight_anchor;
    const optic = new THREE.Group();
    optic.name = 'optic';
    optic.frustumCulled = false;
    if (opticSock) opticSock.add(optic);
    else model.add(optic);

    const opticKind = (weapon.optic && ATTACH_MODELS.includes(weapon.optic)) ? weapon.optic : (weapon.optic || 'iron');
    const kind = opticKind === 'iron' || !opticKind ? 'iron' : opticKind;
    let usedAuthoredOptic = false;
    let att = null;
    if (kind !== 'iron') {
      if (LONG_GUNS.has(id)) foldFrontSight(model, opticSock || optic);
      att = await loadAttachment(kind);
      if (att) { optic.add(att); usedAuthoredOptic = true; }
      else optic.add(makeOpticHousing(kind));
    }

    const off = (LENS_OFFSET[kind] || LENS_OFFSET.red).slice();
    let relief = EYE_RELIEF[kind] ?? EYE_RELIEF.red;
    let pitch = ADS_PITCH[kind] ?? ADS_PITCH.red;
    let clipDistance = Math.max(0.024, relief * 0.35);
    const pistolIrons = kind === 'iron' && (id === 'p45' || id === 'p9' || id === 'revolver');
    if (att) {
      optic.updateMatrixWorld(true);
      // World AABB of the attachment converted into the optic group's local space.
      // (setFromObject returns world coords; the sight is positioned locally.)
      const worldBox = new THREE.Box3().setFromObject(att);
      const box = worldBox.clone().applyMatrix4(optic.matrixWorld.clone().invert());
      const size = new THREE.Vector3(); box.getSize(size);
      const min = box.min;
      // Upper-third of the housing is the lens window; sit just behind the rear cap.
      off[0] = (min.x + box.max.x) / 2;
      off[1] = min.y + size.y * 0.72;
      off[2] = (min.z + box.max.z) / 2;
      // ADS hides the authored optic and shows the procedural housing,
      // so keep eye relief at EYE_RELIEF (25–35% ring) rather than
      // padding for the (hidden) authored AABB.
      clipDistance = Math.max(0.02, relief * 0.28);
    }
    if (pistolIrons) {
      model.updateMatrixWorld(true);
      optic.updateMatrixWorld(true);
      const worldBox = new THREE.Box3().setFromObject(model);
      const box = worldBox.clone().applyMatrix4(optic.matrixWorld.clone().invert());
      off[0] = (box.min.x + box.max.x) / 2;
      off[1] = box.max.y + 0.004;
      // Rear third of the slide — look over the rear 3-dot notch toward the front sight.
      off[2] = box.min.z * 0.25 + box.max.z * 0.75;
      // Pistols need more relief than a tube optic or the slide fills the frame.
      relief = Math.max(0.22, EYE_RELIEF.iron);
      clipDistance = 0.018;
    }

    const minRelief = EYE_RELIEF[kind] ?? 0.14;
    relief = Math.max(relief, minRelief);
    clipDistance = Math.min(clipDistance, Math.max(0.02, relief * 0.28));

    const sight = new THREE.Group();
    sight.name = 'sight';
    sight.position.set(off[0], off[1], off[2]);
    optic.add(sight);

    const reticle = makeReticle(kind);
    // Sit just inside the lens, on the sight axis, so the housing frames it.
    reticle.position.set(0, 0, -0.001);
    if (kind === 'iron') {
      if (!pistolIrons) {
        sight.add(makeIronSight());
      }
      // Pistols/revolver already have authored 3-dot sights on the slide;
      // a procedural U-notch would sit in front of them at carbine height.
      // The gold front-post tip is the iron reticle on long guns.
    } else {
      const glassR = kind === 'holo' ? 0.014 : 0.011;
      const glass = makeLensGlass(glassR);
      glass.position.set(0, 0, 0.002);
      sight.add(glass, reticle);
    }

    let housing = null;
    if (kind !== 'iron') {
      housing = makeOpticHousing(kind);
      housing.visible = false; // shown in ADS; authored att stays on the rail at hip
      sight.add(housing);
    }

    root.userData.reticle = reticle;
    root.userData.opticHousing = housing;
    root.userData.authoredAtt = att;
    root.userData.optic = optic;
    root.userData.sight = sight;
    root.userData.opticSocket = opticSock || optic;
    root.userData.eyeRelief = relief;
    root.userData.adsPitch = pitch;
    root.userData.clipDistance = clipDistance;
    root.userData.opticKind = kind;
    root.userData.sourceUrl = url;
    root.userData.authoredOptic = usedAuthoredOptic;
    root.userData.foldedSightVerts = model.userData.foldedSightVerts || 0;

    const attach = weapon.attach || {};
    const list = Array.isArray(attach) ? attach : Object.values(attach).filter(Boolean);
    for (const a of list) {
      if (!ATTACH_MODELS.includes(a)) continue;
      const sockName = (a === 'suppressor') ? 'socket_muzzle'
        : (a === 'grip' || a === 'bipod') ? 'socket_grip'
        : (a === 'laser' || a === 'light') ? 'socket_underbarrel'
        : (a === 'stock') ? '__root'
        : 'socket_optic';
      const sock = sockName === '__root' ? model : sockets[sockName];
      const node = await loadAttachment(a);
      if (sock && node) sock.add(node);
    }
    return root;
  } catch (e) {
    console.warn('weapon glTF failed', id, e);
    return null;
  }
}

export async function createWeaponWorldmodel(weapon = {}, opts = {}) {
  const id = weaponIdOf(weapon);
  if (!id || !WEAPON_MODELS.includes(id)) return null;
  try {
    await initModelLoaders(_gfx);
    if (opts.solid) {
      // Full visible TP (or FP) mesh, parented to socket_weapon. Used by the
      // operator-select showcase, which renders a different scene than the
      // instanced world batches.
      const url = (await probe(PATHS.weaponTp(id))) ? PATHS.weaponTp(id)
        : (await probe(PATHS.weaponFp(id))) ? PATHS.weaponFp(id)
        : (await probe(PATHS.weapon(id))) ? PATHS.weapon(id)
        : null;
      if (!url) return null;
      const gltf = await loadGltf(url);
      const root = new THREE.Group();
      root.name = 'weapon-tp';
      root.frustumCulled = false;
      const model = cloneGltfScene(gltf);
      hardenMaterials(model, true);
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      model.scale.set(1, 1, 1);
      root.add(model);
      const sockets = collectSockets(root, SOCKET_WPN);
      root.userData.sockets = sockets;
      root.userData.authored = true;
      root.userData.weaponId = id;
      root.userData.sourceUrl = url;
      root.userData.solid = true;

      const opticKind = (weapon && typeof weapon !== 'string' && weapon.optic) || null;
      const kind = (opticKind && ATTACH_MODELS.includes(opticKind) && opticKind !== 'iron') ? opticKind : null;
      if (kind) {
        if (LONG_GUNS.has(id)) foldFrontSight(model, sockets.socket_optic);
        const att = await loadAttachment(kind);
        const sock = sockets.socket_optic || model;
        if (att && sock) sock.add(att);
      }
      const extras = attachListOf(weapon).filter((a) => ATTACH_MODELS.includes(a) && a !== kind);
      for (const a of extras) {
        const sockName = (a === 'suppressor') ? 'socket_muzzle'
          : (a === 'grip' || a === 'bipod') ? 'socket_grip'
          : (a === 'laser' || a === 'light') ? 'socket_underbarrel'
          : (a === 'stock') ? null
          : 'socket_optic';
        const sock = sockName ? (sockets[sockName] || model) : model;
        const node = await loadAttachment(a);
        if (sock && node) sock.add(node);
      }
      return root;
    }
    const proto = await getTpWeaponProto(id);
    if (!proto) return null;
    const root = proto.skeleton ? proto.skeleton.clone(true) : new THREE.Group();
    root.name = 'weapon-tp';
    root.frustumCulled = false;
    root.userData.sockets = collectSockets(root, SOCKET_WPN);
    root.userData.authored = true;
    root.userData.weaponId = id;
    root.userData.tpMeshes = proto.meshes;
    return root;
  } catch (e) {
    console.warn('tp weapon failed', id, e);
    return null;
  }
}

function releaseVisualWeapons(vis) {
  if (!vis?._tpHandles) return;
  for (const h of vis._tpHandles) releaseInstance(h);
  vis._tpHandles = [];
}

function attachListOf(weapon) {
  if (!weapon || typeof weapon === 'string') return [];
  const attach = weapon.attach || {};
  return Array.isArray(attach) ? attach.filter(Boolean) : Object.values(attach).filter(Boolean);
}

/** Parent a TP weapon to socket_weapon (v3). Barrel is the socket −Z axis.
 *  Visible meshes are instanced in the world scene and follow this anchor,
 *  unless opts.solid is set (showcase): then the real TP/FP mesh is parented
 *  to the socket so it renders in the operator's own scene. */
export async function attachWeaponToHand(vis, weapon, opts = {}) {
  if (!vis?.mesh) return null;
  vis._weaponId = weapon;
  vis._pendingWeapon = weapon;
  const socket = findNode(vis.mesh, 'socket_weapon') || findNode(vis.mesh, 'hand_R');
  if (!socket) return null;
  releaseVisualWeapons(vis);
  if (vis._weapon && vis._weapon.parent) vis._weapon.parent.remove(vis._weapon);
  const wpn = await createWeaponWorldmodel(weapon, opts);
  if (!wpn) return null;
  // Weapon is Y-up, −Z forward. socket_weapon −Z is the barrel axis (bind −X, aim +Z).
  wpn.position.set(0, 0, 0);
  wpn.rotation.set(0, 0, 0);
  socket.add(wpn);
  vis._weapon = wpn;
  vis._pendingWeapon = null;
  vis._ikOff = false;

  if (opts.solid || wpn.userData.solid) {
    vis._tpHandles = [];
    return wpn;
  }

  const scene = vis.mesh.parent || _gfx?.scene;
  const id = weaponIdOf(weapon);
  const handles = [];
  for (let i = 0; i < (wpn.userData.tpMeshes || []).length; i++) {
    const piece = wpn.userData.tpMeshes[i];
    const rec = { anchor: wpn, local: piece.local };
    const h = allocInstance(`wpn:${id}:${i}`, piece.geometry, piece.material, scene, rec);
    if (h) handles.push(h);
  }

  const optic = (weapon && typeof weapon !== 'string' && weapon.optic) || null;
  const extras = attachListOf(weapon).filter((a) => ATTACH_MODELS.includes(a));
  const parts = [];
  if (optic && ATTACH_MODELS.includes(optic) && optic !== 'iron') parts.push({ id: optic, sock: 'socket_optic' });
  for (const a of extras) {
    if (a === optic) continue;
    const sockName = (a === 'suppressor') ? 'socket_muzzle'
      : (a === 'grip' || a === 'bipod') ? 'socket_grip'
      : (a === 'laser' || a === 'light') ? 'socket_underbarrel'
      : (a === 'stock') ? null
      : 'socket_optic';
    parts.push({ id: a, sock: sockName });
  }
  for (const part of parts) {
    const proto = await getTpAttachProto(part.id);
    if (!proto) continue;
    const sock = part.sock ? (wpn.userData.sockets?.[part.sock] || wpn) : wpn;
    for (let i = 0; i < proto.meshes.length; i++) {
      const piece = proto.meshes[i];
      const rec = { anchor: sock, local: piece.local };
      const h = allocInstance(`att:${part.id}:${i}`, piece.geometry, piece.material, scene, rec);
      if (h) handles.push(h);
    }
  }
  vis._tpHandles = handles;
  tickWeaponInstances();
  return wpn;
}

function makeFinger(mat, len, thick) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick * 0.85, len), mat);
  m.position.z = -len * 0.5;
  m.castShadow = false;
  m.frustumCulled = false;
  return m;
}

function makeHand(side, leather) {
  // side > 0 is the right hand. Local −Z is fingers-forward, +Y is the back of the hand.
  const g = new THREE.Group();
  g.name = side > 0 ? 'hand_R' : 'hand_L';
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.018, 0.052), leather);
  palm.position.set(0, 0, -0.004);
  palm.frustumCulled = false;
  g.add(palm);
  const knuck = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.014, 0.014), leather);
  knuck.position.set(0, 0.004, -0.028);
  knuck.frustumCulled = false;
  g.add(knuck);
  const lens = [0.026, 0.031, 0.029, 0.023];
  const thicks = [0.0072, 0.008, 0.0076, 0.0064];
  for (let i = 0; i < 4; i++) {
    const f = makeFinger(leather, lens[i], thicks[i]);
    f.position.set(side * (-0.013 + i * 0.0088), -0.001, -0.028);
    f.rotation.x = 0.42;
    g.add(f);
    const tip = makeFinger(leather, lens[i] * 0.42, thicks[i] * 0.9);
    tip.position.set(0, -0.002, -lens[i] * 0.55);
    tip.rotation.x = 0.55;
    f.add(tip);
  }
  const thumb = makeFinger(leather, 0.026, 0.0085);
  thumb.position.set(side * -0.02, 0.006, -0.006);
  thumb.rotation.set(0.35, side * 0.85, side * 0.55);
  g.add(thumb);
  const t2 = makeFinger(leather, 0.016, 0.0075);
  t2.position.set(0, 0, -0.018);
  t2.rotation.y = side * 0.35;
  thumb.add(t2);
  return g;
}

function makeGlove(side) {
  const leather = new THREE.MeshStandardMaterial({
    color: 0x8a7352, roughness: 0.72, metalness: 0.08,
  });
  const cuffMat = new THREE.MeshStandardMaterial({
    color: 0x2a2620, roughness: 0.72, metalness: 0.08,
  });
  const sleeve = new THREE.MeshStandardMaterial({
    color: 0x2c2e28, roughness: 0.84, metalness: 0.04,
  });
  const g = new THREE.Group();
  g.name = side > 0 ? 'arm_R' : 'arm_L';
  const hand = makeHand(side, leather);
  // Right hand wraps the pistol grip (palm inward, fingers down around the grip).
  // Left hand C-clamps the handguard (palm up-left, fingers over the rail).
  if (side > 0) hand.rotation.set(1.15, 0.15, 1.45);
  else hand.rotation.set(0.35, 0.05, -0.35);
  g.add(hand);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.028, 10), cuffMat);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0, 0.0, 0.028);
  wrist.frustumCulled = false;
  g.add(wrist);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.26, 10), sleeve);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(side * 0.01, 0.01, 0.16);
  arm.frustumCulled = false;
  g.add(arm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.036, 10), cuffMat);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(side * 0.006, 0.006, 0.06);
  cuff.frustumCulled = false;
  g.add(cuff);
  g.traverse(o => { o.frustumCulled = false; });
  return g;
}

function makeDefuserDevice() {
  const root = new THREE.Group();
  root.name = 'defuser-device';
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: 0.55, metalness: 0.4 });
  const accMat = new THREE.MeshStandardMaterial({ color: 0xc67636, roughness: 0.45, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6, metalness: 0.3 });
  const led = new THREE.MeshStandardMaterial({ color: 0x44ff88, emissive: 0x22aa44, emissiveIntensity: 1.4, toneMapped: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.14), bodyMat);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 8), dark);
  ant.position.set(0.03, 0.055, -0.04);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.01, 0.05), accMat);
  cap.position.set(0, 0.028, 0.02);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), led);
  light.position.set(-0.028, 0.028, 0.05);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.08), dark);
  handle.position.set(0, -0.03, 0.01);
  root.add(body, ant, cap, light, handle);
  root.traverse(o => { o.frustumCulled = false; });
  return root;
}

export function createDefuserViewmodel() {
  const root = new THREE.Group();
  root.name = 'vm-defuser';
  root.frustumCulled = false;
  const device = makeDefuserDevice();
  device.position.set(0.02, -0.06, -0.28);
  device.rotation.set(0.15, 0.35, 0.05);
  root.add(device);
  const rArm = makeGlove(1);
  rArm.position.set(0.05, -0.09, -0.22);
  rArm.rotation.set(0.4, 0.2, 0.3);
  const lArm = makeGlove(-1);
  lArm.position.set(-0.04, -0.08, -0.24);
  lArm.rotation.set(0.35, -0.15, -0.25);
  root.add(rArm, lArm);
  root.userData.arms = { l: lArm, r: rArm };
  root.userData.device = device;
  root.userData.authored = false;
  root.userData.plant = true;
  return root;
}

async function loadViewmodelArms() {
  if (await probe(PATHS.viewmodelArms)) {
    try {
      const gltf = await loadGltf(PATHS.viewmodelArms);
      const arms = cloneGltfScene(gltf);
      hardenMaterials(arms, false);
      arms.name = 'vm-arms';
      arms.traverse(o => { o.frustumCulled = false; });
      return arms;
    } catch (e) {
      console.warn('viewmodel arms glb failed', e);
    }
  }
  return null;
}

/**
 * First-person viewmodel: gloves/sleeves + authored weapon, meant to live in
 * a dedicated viewmodel scene (not parented to the world camera).
 */
export async function createFirstPersonViewmodel(weapon = {}) {
  const root = new THREE.Group();
  root.name = 'vm-root';
  root.frustumCulled = false;
  const wpn = await createWeaponViewmodel(weapon);
  if (!wpn) return null;
  root.add(wpn);
  root.userData.weapon = wpn;
  root.userData.reticle = wpn.userData.reticle;
  root.userData.optic = wpn.userData.optic;
  root.userData.sight = wpn.userData.sight;
  root.userData.opticSocket = wpn.userData.opticSocket || wpn.userData.sockets?.socket_optic;
  root.userData.sockets = wpn.userData.sockets;
  root.userData.eyeRelief = wpn.userData.eyeRelief;
  root.userData.adsPitch = wpn.userData.adsPitch;
  root.userData.clipDistance = wpn.userData.clipDistance;
  root.userData.authoredOptic = wpn.userData.authoredOptic;
  root.userData.opticHousing = wpn.userData.opticHousing;
  root.userData.authoredAtt = wpn.userData.authoredAtt;
  root.userData.opticKind = wpn.userData.opticKind;
  root.userData.sourceUrl = wpn.userData.sourceUrl;
  root.userData.authored = true;
  root.userData.weaponId = wpn.userData.weaponId;
  root.userData.foldedSightVerts = wpn.userData.foldedSightVerts || 0;

  const sockets = wpn.userData.sockets || {};
  const authoredArms = await loadViewmodelArms();
  if (authoredArms) {
    // Snap authored arm wrist bones to the weapon IK sockets when present.
    const rBone = findNode(authoredArms, 'ik_hand_R') || findNode(authoredArms, 'grip_ik_r') || findNode(authoredArms, 'hand_R') || findNode(authoredArms, 'wrist_R');
    const lBone = findNode(authoredArms, 'ik_hand_L') || findNode(authoredArms, 'grip_ik_l') || findNode(authoredArms, 'hand_L') || findNode(authoredArms, 'wrist_L');
    root.add(authoredArms);
    root.userData.arms = authoredArms;
    authoredArms.userData.rBone = rBone;
    authoredArms.userData.lBone = lBone;
  } else {
    const rHold = sockets.ik_hand_R || sockets.grip_ik_r || wpn;
    const lHold = sockets.ik_hand_L || sockets.grip_ik_l || wpn;
    const rArm = makeGlove(1);
    const lArm = makeGlove(-1);
    rHold.add(rArm);
    lHold.add(lArm);
    if (!sockets.ik_hand_R) rArm.position.set(0.03, -0.04, 0.02);
    if (!sockets.ik_hand_L) lArm.position.set(-0.04, -0.02, -0.12);
    // Nudge the palms slightly off the mesh so they read as a grip, not a clip.
    if (sockets.ik_hand_R) rArm.position.set(0.016, -0.012, 0.008);
    if (sockets.ik_hand_L) lArm.position.set(-0.014, 0.010, 0.004);
    rArm.scale.setScalar(1.12);
    lArm.scale.setScalar(1.12);
    root.userData.arms = { l: lArm, r: rArm };
  }
  return root;
}

async function loadAttachment(id) {
  if (!id || !(await hasAttachmentModel(id))) return null;
  try {
    if (!attachCache.has(id)) attachCache.set(id, loadGltf(PATHS.attachment(id)));
    const gltf = await attachCache.get(id);
    const node = cloneGltfScene(gltf);
    hardenMaterials(node, false);
    return node;
  } catch (e) {
    console.warn('attachment failed', id, e);
    return null;
  }
}

export async function createGadgetMesh(kind) {
  const id = kind;
  if (!GADGET_MODELS.includes(id)) return null;
  if (!(await hasGadgetModel(id))) return null;
  try {
    if (!gadgetCache.has(id)) gadgetCache.set(id, loadGltf(PATHS.gadget(id)));
    const gltf = await gadgetCache.get(id);
    const mesh = cloneGltfScene(gltf);
    mesh.name = 'gadget-' + id;
    return mesh;
  } catch (e) {
    console.warn('gadget glTF failed', id, e);
    return null;
  }
}

export async function preloadKnown(ids = []) {
  await initModelLoaders(_gfx);
  await getBuffer(PATHS.reference).catch(() => false);
  await Promise.all(ids.map(async id => {
    const url = await resolveOperatorUrl(id, 2);
    if (url) await getBuffer(url).catch(() => false);
  }));
}

/** Warm the cache for one weapon (FP preferred, then unsuffixed, then TP). */
export async function preloadWeapon(id) {
  if (!id || !WEAPON_MODELS.includes(id)) return false;
  await initModelLoaders(_gfx);
  const url = (await probe(PATHS.weaponFp(id))) ? PATHS.weaponFp(id) : null;
  if (!url) return false;
  try { await getBuffer(url); return true; } catch { return false; }
}

/** After the match is up, fetch the weapons the player isn't holding. */
export async function prefetchOtherWeapons(hold = []) {
  const skip = new Set(hold.filter(Boolean));
  for (const id of WEAPON_MODELS) {
    if (skip.has(id)) continue;
    await preloadWeapon(id);
    await new Promise(r => setTimeout(r, 0));
  }
}

export function hasCachedWeapon(id) { return buffers.has(PATHS.weaponFp(id)) || buffers.has(PATHS.weapon(id)) || cache.has(PATHS.weaponFp(id)); }
export { CLIP_NAMES as CLIP_LIST, SOCKET_OP, SOCKET_WPN, PATHS as MODEL_PATHS };
