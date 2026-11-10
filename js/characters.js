import * as THREE from 'three';
import { HUMAN } from './config.js?v=iv-4.1.1';

const H = HUMAN.height;
const HEAD = HUMAN.head;

/** Proportion-correct placeholder humanoid (7.5 heads, feet on the floor).
 *  Swap for Quaternius Universal Base / authored glTF when files exist at assets/models/. */
export function buildHuman(opts = {}) {
  const team = opts.team || 'attack';
  const seed = opts.seed || 1;
  const accent = new THREE.Color(opts.accent || (team === 'attack' ? 0xc67636 : 0x4a6a88));
  const cloth = team === 'attack' ? 0x2a2c28 : 0x1c2430;
  const skin = new THREE.Color().setHSL(0.08, 0.35, 0.42 + (seed % 5) * 0.04);
  const root = new THREE.Group();
  root.userData.kind = 'human';

  const mk = (w, h, d, color, y, matOpts) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({
      color, roughness: 0.7, metalness: 0.05, ...matOpts,
    }));
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // Feet sit on y=0. Build from the ground up.
  const footH = 0.08, calfH = 0.32, thighH = 0.40, pelvisH = 0.16, torsoH = 0.52, neckH = 0.08;
  const ankleY = footH;
  const kneeY = ankleY + calfH;
  const hipY = kneeY + thighH;
  const waistY = hipY + pelvisH;
  const shoulderY = waistY + torsoH;
  const chinY = shoulderY + neckH;
  // head center
  const headY = chinY + HEAD / 2;

  const parts = {};
  const hips = new THREE.Group(); hips.position.y = hipY; root.add(hips);
  parts.hips = hips;
  const pelvis = mk(0.32, pelvisH, 0.2, cloth, pelvisH / 2);
  hips.add(pelvis);

  function leg(side) {
    const g = new THREE.Group(); g.position.set(side * 0.11, 0, 0);
    hips.add(g);
    const thigh = new THREE.Group(); g.add(thigh);
    thigh.add(mk(0.12, thighH, 0.14, cloth, -thighH / 2));
    const knee = new THREE.Group(); knee.position.y = -thighH; thigh.add(knee);
    knee.add(mk(0.11, calfH, 0.13, 0x1a1a1c, -calfH / 2));
    const ankle = new THREE.Group(); ankle.position.y = -calfH; knee.add(ankle);
    ankle.add(mk(0.11, footH, 0.22, 0x111111, -footH / 2));
    return { thigh, knee, ankle };
  }
  parts.lLeg = leg(-1); parts.rLeg = leg(1);

  const spine = new THREE.Group(); spine.position.y = pelvisH; hips.add(spine);
  parts.spine = spine;
  spine.add(mk(0.36, torsoH, 0.22, cloth, torsoH / 2));
  // plate carrier
  const plate = mk(0.38, 0.28, 0.16, 0x3a3d38, torsoH * 0.55);
  plate.material.roughness = 0.5; spine.add(plate);
  const trim = mk(0.1, 0.06, 0.17, accent, torsoH * 0.7);
  spine.add(trim);

  const neck = mk(0.1, neckH, 0.1, skin, torsoH + neckH / 2); spine.add(neck);
  parts.head = mk(0.2, HEAD * 0.9, 0.22, skin, torsoH + neckH + HEAD / 2);
  spine.add(parts.head);
  // helmet
  const helm = mk(0.22, 0.1, 0.24, team === 'attack' ? 0x3a3328 : 0x243044, torsoH + neckH + HEAD * 0.75);
  helm.material.roughness = 0.4; spine.add(helm);

  function arm(side) {
    const g = new THREE.Group(); g.position.set(side * 0.22, torsoH - 0.04, 0);
    spine.add(g);
    const upper = new THREE.Group(); g.add(upper);
    upper.add(mk(0.09, 0.30, 0.1, cloth, -0.15));
    const elbow = new THREE.Group(); elbow.position.y = -0.30; upper.add(elbow);
    elbow.add(mk(0.08, 0.26, 0.09, skin, -0.13));
    const hand = new THREE.Group(); hand.position.y = -0.26; elbow.add(hand);
    hand.add(mk(0.07, 0.1, 0.08, skin, -0.05));
    return { upper, elbow, hand };
  }
  parts.lArm = arm(-1); parts.rArm = arm(1);

  function pose(name, t = 0) {
    // reset
    const zero = g => { g.rotation.set(0, 0, 0); };
    zero(hips); zero(spine); zero(parts.head);
    zero(parts.lLeg.thigh); zero(parts.lLeg.knee); zero(parts.rLeg.thigh); zero(parts.rLeg.knee);
    zero(parts.lArm.upper); zero(parts.lArm.elbow); zero(parts.rArm.upper); zero(parts.rArm.elbow);
    hips.position.y = hipY; root.rotation.set(0, 0, 0);
    const sw = Math.sin(t * 8), sw2 = Math.sin(t * 8 + Math.PI);
    if (name === 'idle') {
      spine.rotation.x = Math.sin(t * 1.5) * 0.02;
    } else if (name === 'walk' || name === 'run') {
      const a = name === 'run' ? 0.7 : 0.45;
      const s = name === 'run' ? 10 : 7;
      const ss = Math.sin(t * s), ss2 = Math.sin(t * s + Math.PI);
      parts.lLeg.thigh.rotation.x = ss * a;
      parts.rLeg.thigh.rotation.x = ss2 * a;
      parts.lLeg.knee.rotation.x = Math.max(0, -ss) * a * 1.2;
      parts.rLeg.knee.rotation.x = Math.max(0, -ss2) * a * 1.2;
      parts.lArm.upper.rotation.x = ss2 * a * 0.6;
      parts.rArm.upper.rotation.x = ss * a * 0.6;
      spine.rotation.y = ss * 0.05;
    } else if (name === 'crouch') {
      hips.position.y = hipY - 0.38;
      parts.lLeg.thigh.rotation.x = -0.9;
      parts.rLeg.thigh.rotation.x = -0.9;
      parts.lLeg.knee.rotation.x = 1.5;
      parts.rLeg.knee.rotation.x = 1.5;
      spine.rotation.x = 0.25;
      parts.lArm.upper.rotation.x = -0.4;
      parts.rArm.upper.rotation.x = -0.4;
    } else if (name === 'prone') {
      // lie along +Z, body close to the floor
      root.rotation.x = -Math.PI / 2;
      hips.position.y = 0.16;
      parts.lLeg.thigh.rotation.x = 0.1;
      parts.rLeg.thigh.rotation.x = 0.15;
      parts.lArm.upper.rotation.x = -0.3;
      parts.rArm.upper.rotation.x = -0.2;
      parts.lArm.elbow.rotation.x = 0.5;
      parts.rArm.elbow.rotation.x = 0.4;
    } else if (name === 'death') {
      root.rotation.z = 1.25;
      hips.position.y = 0.2;
      parts.lLeg.thigh.rotation.x = -0.3;
      parts.rLeg.thigh.rotation.x = 0.4;
      parts.lArm.upper.rotation.x = -0.6;
    } else if (name === 'surrender') {
      parts.lArm.upper.rotation.z = 2.4;
      parts.rArm.upper.rotation.z = -2.4;
    }
  }

  pose('idle', 0);
  root.userData.pose = pose;
  root.userData.parts = parts;
  root.userData.HUMAN = HUMAN;
  return { mesh: root, pose, parts, HUMAN };
}

export function measure(human) {
  const box = new THREE.Box3().setFromObject(human.mesh || human);
  return { minY: box.min.y, maxY: box.max.y, h: box.max.y - box.min.y, min: box.min, max: box.max };
}
