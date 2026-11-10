import * as THREE from 'three';
import { EYE, COL_H, COL_R, SPEED, ADS_IN, ADS_OUT, SPRINT_OUT_FIRE, SPRINT_OUT_ADS, CANCEL_READY } from './config.js?v=iv-3.7.0';
import { clamp, damp, wrapPi, angDiff } from './math.js?v=iv-3.7.0';
import { OPTIC_ZOOM } from './weapons.js?v=iv-3.7.0';

export function createPlayer(game) {
  const p = {
    pos: new THREE.Vector3(0, 0, -16),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    lean: 0, leanT: 0,
    stance: 0, stanceT: 0, // 0 stand, 1 crouch, 2 prone
    crouch: 0, crouchT: 0,
    ads: 0, adsToggle: false,
    sprint: false, sprintLock: false,
    rappelling: null,
    vy: 0, onGround: true,
    hp: 100, armor: 2, speed: 2, team: 'attack',
    alive: true, eye: EYE.stand,
  };
  return p;
}

export function eyeHeight(p) {
  if (p.rappelling) return 0;
  const s = p.stance;
  if (s >= 1.5) return EYE.prone;
  if (s >= 0.5) return lerp(EYE.stand, EYE.crouch, s);
  return lerp(EYE.stand, EYE.crouch, s);
}
const lerp = (a, b, t) => a + (b - a) * t;

export function colH(p) {
  if (p.stance >= 1.5) return COL_H.prone;
  if (p.stance >= 0.5) return lerp(COL_H.stand, COL_H.crouch, Math.min(1, p.stance));
  return lerp(COL_H.stand, COL_H.crouch, p.stance);
}

export function setStance(game, st, opts = {}) {
  const p = game.player, w = game.world;
  if (st === 2) {
    if (p.rappelling) return false;
    if (w.onStairs(p.pos)) return false;
    const ceil = w.ceilingAt(p.pos.x, p.pos.z, p.pos.y + 0.1);
    // prone needs very little ceiling; always ok unless somehow negative
  }
  if (st === 0) {
    const ceil = w.ceilingAt(p.pos.x, p.pos.z, p.pos.y + 0.1);
    if (ceil - p.pos.y < COL_H.stand + 0.05) {
      // force crouch
      p.stanceT = 1; p.crouchT = 1;
      return false;
    }
  }
  if (st === 1) {
    const ceil = w.ceilingAt(p.pos.x, p.pos.z, p.pos.y + 0.1);
    if (ceil - p.pos.y < COL_H.crouch + 0.05) return false;
  }
  p.stanceT = st;
  p.crouchT = st >= 1 ? 1 : 0;
  return true;
}

/** Horizontal camera forward / right in world space.
 *  Forward is the flattened camera look direction (three.js local -Z),
 *  i.e. the direction the crosshair points. Right is world-up × forward. */
export function aimAxes(game, yaw = game.player?.yaw || 0) {
  const cam = game.gfx?.camera || game.camera;
  const fwd = new THREE.Vector3();
  if (cam) {
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    else fwd.normalize();
  } else {
    fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  }
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  return { fwd, right };
}

export function clearAdsToggle(game) {
  const p = game?.player;
  if (p) p.adsToggle = false;
  if (game?.input) game.input.ads = false;
}

export function updatePlayer(game, dt) {
  const p = game.player, inp = game.input, w = game.world;
  if (!p.alive) return;
  // stance
  if (p.stance !== p.stanceT) p.stance = damp(p.stance, p.stanceT, 10, dt);
  p.crouch = p.stance;
  // Free lean in every stance, including prone and ADS (research §1.1 / §7).
  p.lean = damp(p.lean, p.leanT, 14, dt); // ~0.12 s lean in/out

  // ADS: class-based in-time, faster out; sprint-out delay before the raise.
  // Toggle ADS is cancelled by sprint (iv-3.0.3). Hold ADS still drops for a
  // short sprint-out window, then can raise again if the trigger is held.
  if (p.sprint && p.stanceT < 0.5 && p.adsToggle) {
    p.adsToggle = false;
  }
  let wantAds = !!(inp.ads || p.adsToggle);
  if (wantAds && p.sprint && p.stanceT < 0.5) {
    p.sprint = false; p.sprintLock = false;
    p._sprintOutUntil = (game.time || 0) + SPRINT_OUT_ADS;
  }
  if (p._sprintOutUntil && (game.time || 0) < p._sprintOutUntil) {
    if (wantAds) wantAds = false;
  } else {
    p._sprintOutUntil = 0;
  }
  const wclass = game.weapon?.class || 'ar';
  const tIn = ADS_IN[wclass] ?? ADS_IN.ar;
  const tOut = ADS_OUT;
  const adsRate = (wantAds ? 1 : 0) === 1 ? (1 / tIn) : (1 / tOut);
  if (wantAds) p.ads = Math.min(1, p.ads + adsRate * dt);
  else p.ads = Math.max(0, p.ads - adsRate * dt);

  // Low ceiling forces crouch
  if (p.stanceT < 1 && !p.rappelling) {
    const ceil = w.ceilingAt(p.pos.x, p.pos.z, p.pos.y + 0.05);
    if (ceil - p.pos.y < COL_H.stand + 0.04) {
      p.stanceT = 1; p.crouchT = 1;
    }
  }

  if (p.rappelling) {
    updateRappel(game, dt);
    return;
  }

  const armorIdx = Math.max(0, Math.min(2, 3 - (p.speed || 2)));
  let spd = SPEED.walk[armorIdx] ?? 3.0;
  if (p.stanceT >= 1.8) spd = SPEED.prone;
  else if (p.stanceT >= 0.8) spd = SPEED.crouch;
  else if (p.sprint && p.ads < 0.2 && p.stanceT < 0.5) spd = SPEED.sprint[armorIdx];
  else if (p.ads < 0.2 && (inp.moveX || inp.moveY) && !p.sprint) {
    const mag = Math.hypot(inp.moveX || 0, inp.moveY || 0);
    if (mag > 0.85) spd = SPEED.run?.[armorIdx] ?? spd;
  }
  // Flat ADS move speed for every operator (Y7S4-style).
  if (p.ads > 0.05) spd = spd * (1 - p.ads) + (SPEED.ads ?? 2.35) * p.ads;

  const mx = inp.moveX || 0, mz = inp.moveY || 0;
  const mag = Math.hypot(mx, mz);
  const nx = mag > 1 ? mx / mag : mx, nz = mag > 1 ? mz / mag : mz;
  // Walk in the camera frame: stick up = camera horizontal forward
  // (crosshair / local -Z), stick right = camera right. (iv-3.0.3)
  const { fwd, right } = aimAxes(game, p.yaw);
  const wx = fwd.x * nz + right.x * nx;
  const wz = fwd.z * nz + right.z * nx;
  p.vel.x = damp(p.vel.x, wx * spd, 12, dt);
  p.vel.z = damp(p.vel.z, wz * spd, 12, dt);

  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  w.resolve(p.pos, COL_R, colH(p));

  // gravity / floor
  const gnd = w.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.6);
  if (p.pos.y > gnd + 0.04) {
    p.vy -= 18 * dt; p.onGround = false;
  } else {
    p.vy = 0; p.onGround = true; p.pos.y = gnd;
  }
  p.pos.y += p.vy * dt;
  if (p.pos.y < gnd) p.pos.y = gnd;

  // look
  p.yaw = wrapPi(p.yaw + inp.lookX);
  p.pitch = clamp(p.pitch - inp.lookY, -1.2, 1.2);
  inp.lookX = 0; inp.lookY = 0;

  p.eye = eyeHeight(p);

  // bounds warning
  const b = w.bounds.warn;
  p.outOfBounds = p.pos.x < b.x0 || p.pos.x > b.x1 || p.pos.z < b.z0 || p.pos.z > b.z1;
}

export function startRappel(game, spot) {
  const p = game.player;
  if (!spot) return false;
  if (p.stanceT === 2) setStance(game, 1);
  p.rappelling = {
    x: spot.x, z: spot.z, y: Math.max(spot.botY ?? 0, p.pos.y),
    nx: spot.nx, nz: spot.nz,
    topY: spot.topY ?? 6.2, botY: spot.botY ?? 0,
    facade: spot.facade, alongX: spot.facade?.alongX ?? Math.abs(spot.nz) > 0.5,
  };
  p.pos.set(spot.x, p.rappelling.y, spot.z);
  p.yaw = Math.atan2(-spot.nx, -spot.nz); // face the wall
  p.stanceT = 0;
  return true;
}

export function detachRappel(game, reason, opts = {}) {
  const p = game.player, rp = p.rappelling;
  if (!rp) return;
  if (!opts.keepPos) {
    // land just outside or inside depending on reason
    if (reason === 'enter') {
      p.pos.x = rp.x - rp.nx * 1.15;
      p.pos.z = rp.z - rp.nz * 1.15;
    } else {
      p.pos.x = rp.x + rp.nx * 0.2;
      p.pos.z = rp.z + rp.nz * 0.2;
    }
    const g = game.world.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.5);
    p.pos.y = g;
    game.world.resolve(p.pos, COL_R, colH(p));
    // depenetrate a second time in case of vault
    game.world.resolve(p.pos, COL_R, colH(p));
  }
  p.rappelling = null;
  p.vy = 0;
}

export function updateRappel(game, dt) {
  const p = game.player, rp = p.rappelling, inp = game.input, w = game.world;
  if (!rp) return;
  const rightX = rp.nz, rightZ = -rp.nx;
  const mx = inp.moveX || 0, mz = inp.moveY || 0;
  rp.x += rightX * mx * SPEED.rappel * dt;
  rp.z += rightZ * mx * SPEED.rappel * dt;
  rp.y += mz * SPEED.rappel * dt;
  rp.y = clamp(rp.y, rp.botY, rp.topY);
  // clamp to facade bounds
  const f = rp.facade;
  if (f) {
    if (f.alongX) rp.x = clamp(rp.x, f.x0 + 0.3, f.x1 - 0.3);
    else rp.z = clamp(rp.z, f.z0 + 0.3, f.z1 - 0.3);
  }
  p.pos.set(rp.x, rp.y, rp.z);
  p.yaw = wrapPi(p.yaw + inp.lookX);
  p.pitch = clamp(p.pitch - inp.lookY, -1.1, 1.1);
  inp.lookX = 0; inp.lookY = 0;
  p.eye = 0;
}

export function updateCamera(game, dt) {
  const p = game.player, cam = game.gfx.camera;
  const ads = p.ads;
  const fovStand = 72, fovAds = 72 / (OPTIC_ZOOM[game.weapon?.optic || 'iron'] || 1);
  cam.fov = lerp(fovStand, fovAds, ads);
  cam.updateProjectionMatrix();

  const eye = p.rappelling ? 0.15 : eyeHeight(p);
  const leanOff = 0.38 * p.lean;
  const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  const origin = new THREE.Vector3(p.pos.x, p.pos.y + eye, p.pos.z);
  origin.addScaledVector(right, leanOff);
  cam.position.copy(origin);
  const look = origin.clone().add(new THREE.Vector3(
    Math.sin(p.yaw) * Math.cos(p.pitch),
    Math.sin(p.pitch),
    Math.cos(p.yaw) * Math.cos(p.pitch)
  ));
  cam.up.set(0, 1, 0);
  cam.lookAt(look);
  // roll with lean — applied after lookAt
  cam.rotateZ(-p.lean * 0.18);
  updateVm(game);
}

/** Viewmodel lives in gfx.vmScene, never as a child of the world camera. */
export function buildVm(game) {
  game.gfx.initViewmodel();
  const g = new THREE.Group();
  g.name = 'vm-fallback';
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.42), metal);
  body.position.set(0, -0.04, 0.05);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.28, 8), metal);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, -0.01, 0.32);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.18), dark);
  stock.position.set(0, -0.04, -0.22);
  g.add(body, barrel, stock);
  const optic = new THREE.Group(); optic.name = 'optic';
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.003, 8, 16), dark);
  ring.position.z = 0.12;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.016, 16), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.4 }));
  glass.position.z = 0.12;
  const reticle = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }));
  reticle.name = 'reticle';
  reticle.position.z = 0.12;
  optic.add(ring, glass, reticle);
  g.add(optic);
  g.userData.reticle = reticle;
  g.userData.optic = optic;
  g.userData.opticSocket = optic;
  game.gfx.setViewmodel(g);
  game.vm = g;
  return g;
}

const _retWorld = new THREE.Vector3();
const _adsMat = new THREE.Matrix4();
const _sockLocal = new THREE.Matrix4();
const _hipPos = new THREE.Vector3();
const _adsPos = new THREE.Vector3();
const _hipQ = new THREE.Quaternion();
const _adsQ = new THREE.Quaternion();
const _idQ = new THREE.Quaternion();
const _scl = new THREE.Vector3(1, 1, 1);

const _adsAxis = new THREE.Vector3(1, 0, 0);
const _adsPitch = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _camFwd = new THREE.Vector3(0, 0, -1);

function alignOpticToCamera(vm, distance = 0.11) {
  // Put the lens (sight) on the viewmodel camera's centre ray, at the
  // authored eye relief, with the sight −Z colinear with the camera −Z.
  // No extra pitch: the receiver/stock already sit below the optic.
  const sight = vm.userData.sight || vm.userData.opticSocket || vm.userData.optic || vm.userData.reticle;
  vm.position.set(0, 0, 0);
  vm.quaternion.identity();
  vm.updateMatrixWorld(true);
  if (!sight) {
    vm.position.set(0, -0.02, -0.40);
    return;
  }
  sight.getWorldQuaternion(_adsQ);
  _fwd.set(0, 0, -1).applyQuaternion(_adsQ).normalize();
  _adsQ.setFromUnitVectors(_fwd, _camFwd);
  vm.quaternion.copy(_adsQ);
  vm.updateMatrixWorld(true);
  sight.getWorldPosition(_retWorld);
  vm.position.set(-_retWorld.x, -_retWorld.y, -distance - _retWorld.z);
  vm.updateMatrixWorld(true);
  // Pitch around the LENS (not the rail) so the receiver/stock drop
  // below the frame while the sight axis stays on the centre ray.
  const drop = vm.userData.adsPitch ?? -0.4;
  if (drop) {
    _adsPitch.setFromAxisAngle(_adsAxis, drop);
    vm.quaternion.premultiply(_adsPitch);
    vm.updateMatrixWorld(true);
    sight.getWorldPosition(_retWorld);
    vm.position.x -= _retWorld.x;
    vm.position.y -= _retWorld.y;
    vm.position.z += (-distance - _retWorld.z);
  }
}

function viewmodelAllowed(game) {
  if (game.hideViewmodel) return false;
  if (game.viewMode && game.viewMode !== 'fp') return false;
  if (game.inDrone || game.inCams) return false;
  return true;
}

function applyPistolAdsLight(game, ads) {
  const lights = game.gfx?._vmLights;
  if (!lights) return;
  const pistol = game.weapon?.class === 'pistol';
  const k = pistol ? Math.max(0, Math.min(1, ads || 0)) : 0;
  lights.hemi.intensity = 0.7 + 0.22 * k;
  lights.key.intensity = 2.5 + 0.35 * k;
  lights.fill.intensity = 0.95 + 0.55 * k;
  lights.rim.intensity = 1.55 + 0.25 * k;
  if (game.gfx.vmScene) game.gfx.vmScene.environmentIntensity = 1.05 + 0.18 * k;
}

function updateVm(game) {
  const p = game.player, vm = game.vm;
  if (!vm) return;
  if (!viewmodelAllowed(game)) {
    vm.visible = false;
    game.gfx?.setVmClip?.(0);
    document.getElementById('scope-overlay')?.classList.add('hidden');
    return;
  }
  const ads = p.ads;
  const optic = game.weapon?.optic || 'iron';
  // Keep the FP viewmodel visible for every optic — the housing is the
  // frame around a lens-projected reticle. A soft vignette is enough for 2x/4x.
  const scoped = (optic === 'scope2' || optic === 'scope4') && ads > 0.7;
  vm.visible = true;
  document.getElementById('scope-overlay')?.classList.toggle('hidden', !scoped);
  applyPistolAdsLight(game, ads);
  const authored = !!vm.userData.authored;
  const sprint = p.sprint && p.ads < 0.2 && p.stanceT < 0.5 ? 1 : 0;

  // Hip / sprint poses in viewmodel-camera space (camera at origin, looks down -Z).
  _hipPos.set(authored ? 0.18 : 0.16, authored ? -0.16 : -0.14, authored ? -0.42 : -0.36);
  if (sprint) _hipPos.set(0.12, -0.28, -0.30);
  _hipQ.setFromEuler(new THREE.Euler(sprint ? 0.35 : -0.06, authored ? 0.08 : 0.14, 0));

  // ADS: camera sits on the optic sight line at the right eye relief.
  // Keep the viewmodel near plane at 0.02 m so we never clip through the
  // gun and look at the back of the receiver.
  const relief = vm.userData.eyeRelief || (authored ? 0.11 : 0.22);
  alignOpticToCamera(vm, relief);
  const vcam = game.gfx.vmCamera;
  if (vcam && Math.abs(vcam.near - 0.02) > 0.001) {
    vcam.near = 0.02;
    vcam.updateProjectionMatrix();
  }
  // Clip the stock/receiver that would sit inside the camera at true
  // eye relief, so ADS never shows a near-plane cross-section.
  if (ads > 0.55) {
    const clip = vm.userData.clipDistance ?? Math.min(0.034, relief * 0.42);
    game.gfx.setVmClip(clip);
  } else {
    game.gfx.setVmClip(0);
  }
  // Authored optic meshes are opaque at the lens, so ADS uses an open
  // housing around the reticle; the authored mesh stays on the rail at hip.
  if (vm.userData.authoredAtt) vm.userData.authoredAtt.visible = ads < 0.55;
  if (vm.userData.opticHousing) vm.userData.opticHousing.visible = ads >= 0.55;

  _adsPos.copy(vm.position);
  _adsQ.copy(vm.quaternion);

  vm.position.lerpVectors(_hipPos, _adsPos, ads);
  vm.quaternion.slerpQuaternions(_hipQ, _adsQ, ads);
  vm.frustumCulled = false;

  if (game.vmKick) {
    vm.position.y -= game.vmKick * 0.015;
    vm.rotation.x -= game.vmKick * 0.02;
    game.vmKick = Math.max(0, game.vmKick - 0.08);
  }

  // Final XY centre of the reticle once ADS is mostly in — lean-safe because
  // this is the dedicated viewmodel camera, which does not roll with lean.
  const ret = vm.userData.reticle;
  if (ret && ads > 0.55) {
    vm.updateMatrixWorld(true);
    const cam = game.gfx.vmCamera || game.gfx.camera;
    ret.getWorldPosition(_retWorld);
    cam.worldToLocal(_retWorld);
    vm.position.x -= _retWorld.x;
    vm.position.y -= _retWorld.y;
  }
}

export function opticScreenPos(game) {
  const cam = game.gfx.vmCamera || game.gfx.camera;
  const w = innerWidth, h = innerHeight;
  const cx = w / 2, cy = h / 2;
  const ret = game.vm?.userData?.reticle;
  const optic = game.weapon?.optic || 'iron';
  if ((optic === 'scope2' || optic === 'scope4') && game.player.ads > 0.7 && !game.vm?.userData?.reticle) {
    return { x: cx, y: cy, cx, cy, visible: false };
  }
  const v = new THREE.Vector3();
  if (ret) ret.getWorldPosition(v);
  else v.set(0, 0, -1).applyMatrix4(cam.matrixWorld);
  v.project(cam);
  const x = (v.x * 0.5 + 0.5) * w;
  const y = (-v.y * 0.5 + 0.5) * h;
  return { x, y, cx, cy, visible: v.z < 1 };
}
