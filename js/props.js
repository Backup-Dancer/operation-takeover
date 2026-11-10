import * as THREE from 'three';
import { ROOMS, BOUNDS, floorY } from './map.js?v=iv-3.6.3';

/** Print-shop furnishings. Repeated pieces go through world.addInstance. */
export function furnish(world, gfx) {
  for (const r of ROOMS) furnishRoom(world, gfx, r);
  furnishExterior(world, gfx);
  world.flushInstances();
}

function furnishRoom(world, gfx, r) {
  const y = floorY(r.floor);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const wood = gfx.mat('table', { repeat: 1.2 });
  const metal = gfx.mat('metal', { repeat: 1 });
  const iron = gfx.mat('iron', { repeat: 1.4 });
  const siding = gfx.mat('siding', { repeat: 1 });
  const plaster = gfx.mat('plaster', { repeat: 2 });
  const add = (w, h, d, mat, x, z, offY = 0, collide = true, extra = {}) => {
    const m = world._box(w, h, d, mat, x, y + offY + h / 2, z, {
      static: true, collide, receive: true, cast: h > 0.5 && (w * d > 0.4),
      room: r.id, ...extra,
    });
    return m;
  };
  const inst = (key, w, h, d, mat, x, z, offY = 0, rotY = 0, collide = false, extra = {}) => {
    // offY is the bottom of a box, or the centre of a cylinder, above the floor.
    const py = extra.shape === 'cyl' ? (y + offY) : (y + offY + h / 2);
    world.addInstance(key, {
      w, h, d, mat, room: r.id, collide, cast: extra.cast ?? (h > 0.4),
      shape: extra.shape, r: extra.r, rTop: extra.rTop, seg: extra.seg,
    }, { x, y: py, z, rotY, rotX: extra.rotX, rotZ: extra.rotZ });
  };

  skirting(world, gfx, r, y);

  switch (r.purpose) {
    case 'press': {
      const beds = [[-8.4, -0.2], [-8.4, 3.4], [-4.2, -0.2], [-4.2, 3.4]];
      beds.forEach(([x, z], i) => letterpress(add, inst, world, wood, metal, iron, r, x, z, i));
      for (const [x, z] of [[-9.6, 5.2], [-6.3, 5.2], [-2.2, 5.0]]) {
        palletReams(add, inst, wood, iron, x, z);
      }
      for (const [x, z] of [[-9.5, 1.6], [-6.2, 1.6], [-2.4, 1.6]]) inkCan(inst, metal, x, z);
      bookcase(add, inst, wood, siding, -2.0, 5.4);
      add(7.5, 0.04, 0.04, metal, -6.2, 2.0, 2.85, false, { cast: false });
      add(7.5, 0.04, 0.04, metal, -6.2, 4.0, 2.85, false, { cast: false });
      pipeRun(add, inst, metal, r, y);
      break;
    }
    case 'bindery': {
      add(3.4, 0.88, 1.25, wood, 6.0, 0.8);
      officeChair(inst, gfx, metal, 5.2, 2.0, 0.1);
      officeChair(inst, gfx, metal, 6.8, 2.0, -0.1);
      // guillotine cutter
      add(1.3, 1.05, 0.8, metal, 9.0, 1.0);
      add(1.1, 0.08, 0.12, iron, 9.0, 0.7, 1.05, false);
      typeCabinet(add, inst, wood, 9.5, 4.2);
      paperStack(inst, wood, 5.0, 4.6, 0.7);
      paperStack(inst, wood, 6.6, 4.6, 0.45);
      pipeRun(add, inst, metal, r, y);
      break;
    }
    case 'shop': {
      add(3.2, 0.92, 0.85, wood, -7.2, -7.3);
      add(0.7, 1.7, 0.55, wood, -9.6, -7.4);
      // display shelves of bound volumes
      for (let i = 0; i < 3; i++) inst('bookrow', 1.1, 0.22, 0.22, siding, -9.6, -7.4, 0.35 + i * 0.38);
      officeChair(inst, gfx, metal, -6.0, -6.4, 0.4);
      add(0.08, 1.1, 1.6, siding, -5.2, -7.6, 1.0, false); // notice board
      paperStack(inst, wood, -8.4, -5.6, 0.35);
      break;
    }
    case 'lobby': {
      receptionDesk(add, inst, world, gfx, r, 0.2, -7.35);
      officeChair(inst, gfx, metal, -0.7, -6.2, 0.18);
      officeChair(inst, gfx, metal, 1.1, -6.2, -0.14);
      officeChair(inst, gfx, metal, 0.2, -6.58, Math.PI);
      filingCabinet(add, inst, gfx, 2.62, -6.15, Math.PI);
      filingCabinet(add, inst, gfx, 2.62, -5.28, Math.PI);
      bulletin(world, gfx, r, y, -2.88, -5.4, Math.PI / 2, 'JOB TICKET\nWINDOW');
      bulletin(world, gfx, r, y, 3.38, -4.4, -Math.PI / 2, 'VISITORS\nSIGN IN');
      const plaque = gfx.makeSign?.('HALCYON PRESS') || wood;
      world._decal(1.7, 0.42, plaque, 0.2, y + 2.15, r.z0 + 0.09, { room: r.id, kind: 'sign' });
      planter(add, inst, gfx, 2.55, -8.15);
      planter(add, inst, gfx, -2.45, -8.15);
      waitingBench(add, inst, wood, metal, -1.55, -3.15, 0);
      waitingBench(add, inst, wood, metal, 1.85, -3.15, 0);
      lobbyRug(add, gfx, r, 0.2, -5.2);
      break;
    }

    case 'office': {
      add(1.7, 0.76, 0.85, wood, 6.8, -6.5);
      officeChair(inst, gfx, metal, 6.8, -5.6, Math.PI);
      add(1.05, 1.55, 0.4, wood, 9.7, -7.3);
      filingCabinet(add, inst, gfx, 9.6, -5.4, Math.PI);
      paperStack(inst, wood, 6.0, -6.3, 0.18, 0.72);
      break;
    }
    case 'storage': {
      for (const z of [-6.4, -3.6, -0.8, 2.0, 4.0]) {
        add(2.5, 2.05, 0.52, wood, -8.7, z);
        paperStack(inst, wood, -8.7, z + 0.4, 0.4);
      }
      for (const z of [-5, -1, 3]) inkCan(inst, metal, -6.6, z);
      break;
    }
    case 'vault': {
      add(2.0, 1.7, 1.5, metal, 7.6, -1.4);
      add(0.9, 1.15, 0.9, iron, 4.6, 2.1);
      add(1.2, 0.8, 0.8, iron, 9.2, 2.4);
      inkCan(inst, metal, 5.8, -0.2);
      inkCan(inst, metal, 5.8, 0.5);
      break;
    }
    case 'studio': {
      add(2.5, 0.76, 1.25, wood, -7.2, -5.0);
      add(2.5, 0.76, 1.25, wood, -3.2, 1.2);
      officeChair(inst, gfx, metal, -7.2, -3.95, Math.PI);
      officeChair(inst, gfx, metal, -3.2, 2.2, Math.PI);
      // light table
      add(1.6, 0.9, 0.9, wood, -9.4, -1.2);
      add(1.4, 0.04, 0.7, gfx.basic(0xf0e8d0, { em: 0.35, emissive: 0xf0e8d0 }), -9.4, -1.2, 0.9, false);
      typeCabinet(add, inst, wood, -0.6, -5.2);
      paperStack(inst, wood, -5.0, -5.2, 0.3);
      break;
    }
    case 'loft': {
      for (const z of [-6.2, -2.2, 1.8, 4.4]) {
        add(2.3, 2.05, 0.5, wood, 8.6, z);
        paperStack(inst, wood, 8.6, z + 0.35, 0.5);
      }
      break;
    }
    case 'lab': {
      add(2.0, 0.92, 0.75, metal, -7.6, 8.5);
      add(0.9, 1.4, 0.5, metal, -9.6, 8.8);
      officeChair(inst, gfx, metal, -7.6, 9.5, Math.PI);
      break;
    }
    case 'apt': {
      add(1.9, 0.42, 2.1, wood, 8.0, 8.5);
      officeChair(inst, gfx, metal, 6.5, 8.5, 0);
      add(1.2, 0.75, 0.55, wood, 9.6, 9.6);
      add(0.7, 1.1, 0.5, siding, 9.8, 8.0);
      break;
    }
    case 'loading': {
      add(1.7, 1.15, 1.1, metal, -9.2, 8.6);
      pallet(inst, wood, iron, -6.4, 8.8);
      pallet(inst, wood, iron, -6.4, 10.0);
      paperStack(inst, wood, -6.4, 8.8, 0.85);
      for (const z of [7.4, 9.0, 10.4]) inkCan(inst, metal, -9.6, z, 0, true);
      break;
    }
    case 'bath': {
      add(0.65, 0.85, 0.42, gfx.mat('tiles', { repeat: 1 }), 9.1, 8.1);
      add(0.7, 1.1, 0.15, gfx.mat('tiles', { repeat: 1 }), 9.8, 9.4, 0.9, false);
      add(0.5, 0.12, 0.5, metal, 8.2, 9.6, 1.1, false);
      break;
    }
    case 'plant': {
      add(1.5, 1.9, 1.1, iron, -9.1, 8.1);
      add(0.5, 2.2, 0.5, metal, -9.1, 8.1, 1.9, false);
      add(0.25, 0.25, 2.8, metal, -7.2, 8.1, 2.6, false);
      add(0.9, 1.2, 0.7, iron, -6.6, 9.8);
      pipeRun(add, inst, metal, r, y);
      break;
    }
    case 'archive': {
      add(2.3, 2.05, 0.5, wood, 8.6, 7.4);
      add(2.3, 2.05, 0.5, wood, 8.6, 9.4);
      paperStack(inst, wood, 8.6, 7.4, 0.5);
      break;
    }
    case 'stairs':
    default:
      pipeRun(add, inst, metal, r, y);
      break;
  }
  dressCommon(world, gfx, r, y, add, inst, wood, metal, iron);
}

function skirting(world, gfx, r, y) {
  const mat = gfx.mat('table', { repeat: 2, color: 0x5a4433 });
  const t = 0.04, h = 0.1;
  const inset = 0.05;
  const segs = [
    [r.x1 - r.x0 - 0.1, t, (r.x0 + r.x1) / 2, r.z0 + inset],
    [r.x1 - r.x0 - 0.1, t, (r.x0 + r.x1) / 2, r.z1 - inset],
    [t, r.z1 - r.z0 - 0.1, r.x0 + inset, (r.z0 + r.z1) / 2],
    [t, r.z1 - r.z0 - 0.1, r.x1 - inset, (r.z0 + r.z1) / 2],
  ];
  for (const [w, d, x, z] of segs) {
    world._box(w, h, d, mat, x, y + h / 2, z, { static: true, collide: false, room: r.id, cast: false, receive: true });
  }
}

function letterpress(add, inst, world, wood, metal, iron, r, x, z, i) {
  // Side frames and a lower body — not one crate.
  add(0.12, 1.15, 1.15, iron, x - 1.05, z);
  add(0.12, 1.15, 1.15, iron, x + 1.05, z);
  add(2.1, 0.22, 1.1, iron, x, z, 0);
  add(2.0, 0.08, 0.95, metal, x, z, 0.78, false);
  // Impression and inking rollers (instanced cylinders, axis along Z).
  inst('press-roller', 0.32, 1.05, 0.32, metal, x - 0.15, z, 1.05, 0, false, {
    shape: 'cyl', r: 0.16, rotX: Math.PI / 2, seg: 12, cast: true,
  });
  inst('press-roller-sm', 0.2, 1.05, 0.2, iron, x + 0.28, z, 1.18, 0, false, {
    shape: 'cyl', r: 0.10, rotX: Math.PI / 2, seg: 12, cast: true,
  });
  inst('press-roller-sm', 0.2, 1.05, 0.2, iron, x + 0.48, z, 1.05, 0, false, {
    shape: 'cyl', r: 0.10, rotX: Math.PI / 2, seg: 12, cast: true,
  });
  // Flywheel
  inst('flywheel', 0.9, 0.1, 0.9, iron, x + 1.18, z, 0.75, 0, false, {
    shape: 'cyl', r: 0.45, rTop: 0.45, rotZ: Math.PI / 2, seg: 14, cast: true,
  });
  add(0.85, 0.05, 0.85, wood, x - 1.25, z, 0.98, false); // feed board
  add(0.55, 0.16, 0.45, metal, x + 0.7, z + 0.55, 0.86, false); // ink fountain
  if (i % 2 === 0) inst('inkcan', 0.18, 0.28, 0.18, metal, x + 0.85, z + 0.7, 0.86);
}

function receptionDesk(add, inst, world, gfx, r, x, z) {
  const laminate = gfx.mat('table', { color: 0xc6b089, repeat: 1.6 });
  const edge = gfx.mat('table', { color: 0xa89068, repeat: 1 });
  const steel = gfx.mat('metal', { color: 0x3c4046, repeat: 1 });
  const panel = gfx.mat('table', { color: 0x6a5844, repeat: 1 });
  const paper = gfx.mat('table', { color: 0xe8e0d0, repeat: 1 });
  // Thin laminate top with a slight underside bevel, plus a west return.
  add(2.46, 0.032, 0.78, laminate, x, z - 0.02, 0.73, false);
  add(2.40, 0.016, 0.72, edge, x, z - 0.02, 0.70, false);
  add(0.74, 0.032, 1.28, laminate, x - 1.22, z - 0.52, 0.73, false);
  add(0.70, 0.016, 1.22, edge, x - 1.22, z - 0.52, 0.70, false);
  // Slim steel legs, set in from the overhang.
  const legs = [
    [x - 0.95, z - 0.28], [x + 0.95, z - 0.28],
    [x - 0.95, z + 0.24], [x + 0.95, z + 0.24],
    [x - 1.46, z - 0.95], [x - 0.98, z - 0.95],
    [x - 1.46, z - 0.12], [x - 0.98, z - 0.12],
  ];
  for (const [lx, lz] of legs) inst('desk-leg', 0.032, 0.73, 0.032, steel, lx, lz, 0);
  // Thin hanging modesty panel — open knee space, not a crate.
  add(2.16, 0.26, 0.018, panel, x, z - 0.36, 0.44, false);
  add(0.018, 0.26, 1.05, panel, x - 1.48, z - 0.52, 0.44, false);
  // Pedestal of shallow drawers on the right, with faces and handles.
  add(0.38, 0.62, 0.58, panel, x + 0.82, z + 0.02, 0);
  for (let i = 0; i < 2; i++) {
    inst('drawer-face', 0.34, 0.22, 0.018, laminate, x + 0.82, z - 0.28, 0.1 + i * 0.28);
    inst('drawer-handle', 0.1, 0.014, 0.02, steel, x + 0.82, z - 0.30, 0.16 + i * 0.28);
  }
  // Monitor, slim stem, keyboard, paper, lamp
  add(0.44, 0.28, 0.03, steel, x + 0.35, z + 0.02, 1.12, false);
  inst('monitor-stem', 0.03, 0.16, 0.03, steel, x + 0.35, z + 0.06, 0.76, 0, false, { shape: 'cyl', r: 0.015, seg: 8, cast: false });
  add(0.34, 0.016, 0.14, edge, x - 0.2, z - 0.04, 0.764, false);
  inst('paper', 0.22, 0.01, 0.16, paper, x - 0.7, z + 0.02, 0.764);
  inst('lamp-arm', 0.02, 0.22, 0.02, steel, x + 0.9, z + 0.12, 0.764, 0, false, { shape: 'cyl', r: 0.01, seg: 8, cast: false });
  inst('lamp-shade', 0.14, 0.07, 0.14, gfx.basic(0xffe6b0, { em: 0.7, emissive: 0xffe0a8 }), x + 0.9, z + 0.12, 1.04, 0, false, { shape: 'cyl', r: 0.07, rTop: 0.08, seg: 10, cast: false });
}

function waitingBench(add, inst, wood, metal, x, z, rotY = 0) {
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  inst('bench-seat', 1.55, 0.07, 0.42, wood, x, z, 0.42, rotY);
  inst('bench-back', 1.55, 0.38, 0.06, wood, x - sn * 0.18, z - cs * 0.18, 0.64, rotY);
  for (const dx of [-0.62, 0.62]) {
    const rx = x + dx * cs, rz = z + dx * sn;
    inst('bench-leg', 0.06, 0.42, 0.06, metal, rx - sn * 0.14, rz - cs * 0.14, 0, rotY);
    inst('bench-leg', 0.06, 0.42, 0.06, metal, rx + sn * 0.14, rz + cs * 0.14, 0, rotY);
  }
}

function lobbyRug(add, gfx, r, x, z) {
  const rug = gfx.mat('fabric', { color: 0x6a3a2a, repeat: 1.2 });
  const trim = gfx.mat('fabric', { color: 0xc4a46a, repeat: 1 });
  add(2.8, 0.02, 2.05, rug, x, z, 0, false, { cast: false });
  add(2.88, 0.015, 0.07, trim, x, z - 1.02, 0, false, { cast: false });
  add(2.88, 0.015, 0.07, trim, x, z + 1.02, 0, false, { cast: false });
}

function officeChair(inst, gfx, metal, x, z, rotY = 0) {
  const fabric = gfx.mat('plaster', { color: 0x3a4652, repeat: 1 });
  const plastic = gfx.mat('metal', { color: 0x2e3338, repeat: 1 });
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  inst('chair-seat', 0.38, 0.032, 0.38, fabric, x, z, 0.44, rotY);
  inst('chair-back', 0.36, 0.34, 0.028, fabric, x - sn * 0.16, z - cs * 0.16, 0.64, rotY);
  inst('chair-pole', 0.04, 0.22, 0.04, metal, x, z, 0.34, 0, false, { shape: 'cyl', r: 0.018, seg: 8, cast: false });
  inst('chair-hub', 0.16, 0.03, 0.16, plastic, x, z, 0.12, 0, false, { shape: 'cyl', r: 0.08, seg: 10, cast: false });
  for (let i = 0; i < 5; i++) {
    const a = rotY + i * (Math.PI * 2 / 5);
    const armL = 0.2;
    const ax = x + Math.sin(a) * armL * 0.5;
    const az = z + Math.cos(a) * armL * 0.5;
    inst('chair-arm', 0.03, 0.025, 0.2, metal, ax, az, 0.12, a, false);
    inst('chair-caster', 0.05, 0.05, 0.05, plastic, x + Math.sin(a) * armL, z + Math.cos(a) * armL, 0.04, 0, false, { shape: 'cyl', r: 0.025, seg: 8, cast: false });
  }
}

function filingCabinet(add, inst, gfx, x, z, rotY = 0) {
  const steel = gfx.mat('metal', { color: 0x5a6168, repeat: 1 });
  const paint = gfx.mat('metal', { color: 0x4a5158, repeat: 1 });
  add(0.44, 1.22, 0.58, paint, x, z);
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const fx = x + sn * 0.30, fz = z + cs * 0.30;
  for (let i = 0; i < 4; i++) {
    inst('drawer-face', 0.4, 0.22, 0.02, steel, fx, fz, 0.12 + i * 0.28, rotY);
    inst('drawer-handle', 0.12, 0.012, 0.018, steel, fx + sn * 0.02, fz + cs * 0.02, 0.18 + i * 0.28, rotY);
  }
}

function bookcase(add, inst, wood, siding, x, z) {
  add(0.05, 1.9, 0.38, wood, x - 0.62, z);
  add(0.05, 1.9, 0.38, wood, x + 0.62, z);
  add(1.28, 0.05, 0.38, wood, x, z, 0);
  add(1.28, 0.05, 0.38, wood, x, z, 1.85, false);
  for (let i = 0; i < 4; i++) {
    add(1.22, 0.04, 0.36, wood, x, z, 0.38 + i * 0.38, false);
    inst('bookrow', 1.1, 0.16, 0.22, siding, x, z, 0.42 + i * 0.38);
  }
}

function bulletin(world, gfx, r, y, x, z, rotY, text) {
  const frame = gfx.mat('table', { color: 0x3a2a1c });
  const cork = gfx.mat('siding', { color: 0xc4a66a });
  const along = Math.abs(rotY) > 0.5; // roughly ±90°: board faces ±X
  const w = 0.95, h = 0.7, t = 0.04;
  if (along) {
    world._box(t, h, w, frame, x, y + 1.5, z, { static: true, collide: false, room: r.id, kind: 'board-frame' });
    world._decal(w - 0.08, h - 0.08, cork, x + Math.sign(Math.sin(rotY) || 1) * 0.025, y + 1.5, z, {
      rotY, room: r.id, kind: 'board-cork',
    });
  } else {
    world._box(w, h, t, frame, x, y + 1.5, z, { static: true, collide: false, room: r.id, kind: 'board-frame' });
    world._decal(w - 0.08, h - 0.08, cork, x, y + 1.5, z + 0.025, { rotY, room: r.id, kind: 'board-cork' });
  }
  if (text && gfx.makeSign) {
    const sign = gfx.makeSign(text);
    const ox = along ? (Math.sign(Math.sin(rotY) || 1) * 0.03) : 0;
    const oz = along ? 0 : 0.03;
    world._decal(0.42, 0.28, sign, x + ox, y + 1.55, z + oz, { rotY, room: r.id, kind: 'sign' });
  }
}

function planter(add, inst, gfx, x, z) {
  const pot = gfx.mat('plaster', { color: 0xb45a32, repeat: 1 });
  const leaf = gfx.mat('plaster', { color: 0x2a5a30, repeat: 1 });
  inst('pot', 0.3, 0.26, 0.3, pot, x, z, 0, 0, false, { shape: 'cyl', r: 0.13, rTop: 0.15, seg: 10, cast: false });
  inst('leaf', 0.2, 0.38, 0.2, leaf, x, z, 0.26, 0, false, { shape: 'cyl', r: 0.015, rTop: 0.1, seg: 8, cast: false });
  inst('leaf', 0.14, 0.28, 0.14, leaf, x + 0.05, z - 0.04, 0.28, 0.5, false, { shape: 'cyl', r: 0.012, rTop: 0.07, seg: 8, cast: false });
}

function palletReams(add, inst, wood, iron, x, z) {
  // Slatted pallet
  inst('pallet-deck', 1.15, 0.04, 0.9, wood, x, z, 0.1);
  inst('pallet-skid', 1.15, 0.1, 0.1, wood, x, z - 0.35, 0);
  inst('pallet-skid', 1.15, 0.1, 0.1, wood, x, z + 0.35, 0);
  inst('pallet-skid', 0.1, 0.1, 0.9, wood, x - 0.5, z, 0);
  inst('pallet-skid', 0.1, 0.1, 0.9, wood, x + 0.5, z, 0);
  // Stacked reams
  inst('ream-stack', 0.95, 0.55, 0.7, wood, x, z, 0.14);
}

function typeCabinet(add, inst, wood, x, z) {
  add(1.15, 1.35, 0.55, wood, x, z);
  for (let i = 0; i < 6; i++) inst('drawer', 1.05, 0.1, 0.5, wood, x, z, 0.12 + i * 0.2);
}

function paperStack(inst, wood, x, z, h = 0.4, w = 0.7) {
  inst('paper', w, h, 0.55, wood, x, z, 0);
}

function inkCan(inst, metal, x, z, rot = 0, big = false) {
  inst(big ? 'barrel' : 'inkcan', big ? 0.42 : 0.18, big ? 0.7 : 0.28, big ? 0.42 : 0.18, metal, x, z, 0, rot);
}

function pallet(inst, wood, iron, x, z) {
  inst('pallet-deck', 1.2, 0.04, 1.0, wood, x, z, 0.1);
  inst('pallet-skid', 1.2, 0.1, 0.1, wood, x, z - 0.4, 0);
  inst('pallet-skid', 1.2, 0.1, 0.1, wood, x, z + 0.4, 0);
}

function pipeRun(add, inst, metal, r, y) {
  const x = r.x0 + 0.16, z0 = r.z0 + 0.35, z1 = r.z1 - 0.35;
  const len = Math.max(0.4, z1 - z0);
  const py = (r.floor === 'B' ? 2.55 : 2.82);
  add(0.06, 0.06, len, metal, x, (z0 + z1) / 2, py, false, { cast: false });
  // Vertical drop and a mid-height conduit run.
  add(0.06, py, 0.06, metal, x, z0 + 0.15, 0, false, { cast: false });
  add(0.045, 0.045, Math.max(0.4, len * 0.7), metal, x + 0.02, (z0 + z1) / 2, 1.55, false, { cast: false });
  inst('pipe-elbow', 0.1, 0.1, 0.1, metal, x, z0 + 0.15, py, 0, false, { shape: 'cyl', r: 0.05, seg: 8, cast: false });
}

export function furnishExterior(world, gfx) {
  const wood = gfx.mat('table', { repeat: 1.4 });
  const metal = gfx.mat('metal', { repeat: 1 });
  const iron = gfx.mat('iron', { repeat: 1.5 });
  const brick = gfx.mat('brick', { repeat: 3 });
  const siding = gfx.mat('siding', { repeat: 2 });
  const concrete = gfx.mat('concrete', { repeat: 3 });
  const b = BOUNDS.building;

  // Front sign + awning
  const sign = gfx.makeSign?.('HALCYON PRESS\n19 BINDER STREET') || siding;
  world._box(6.4, 0.9, 0.08, sign, 0.2, 3.55, b.z0 - 0.22, { static: true, receive: true, noMerge: true });
  world._box(6.6, 0.06, 1.1, metal, 0.2, 4.05, b.z0 - 0.7, { static: true, cast: true, receive: true });
  world._box(0.08, 1.1, 0.08, metal, -3.0, 3.5, b.z0 - 1.2, { static: true });
  world._box(0.08, 1.1, 0.08, metal, 3.4, 3.5, b.z0 - 1.2, { static: true });

  // Gutters + downspouts
  for (const [x, z] of [[b.x0 + 0.15, b.z0], [b.x1 - 0.15, b.z0], [b.x0 + 0.15, b.z1], [b.x1 - 0.15, b.z1]]) {
    world._box(0.1, 0.1, 0.1, metal, x, 6.15, z - Math.sign(z || 1) * 0.05, { static: true });
    world._box(0.08, 6.1, 0.08, metal, x, 3.05, z + (z === b.z0 ? -0.1 : 0.1), { static: true });
  }
  world._box(b.x1 - b.x0, 0.08, 0.1, metal, 0, 6.18, b.z0 - 0.08, { static: true });
  world._box(b.x1 - b.x0, 0.08, 0.1, metal, 0, 6.18, b.z1 + 0.08, { static: true });

  // Chimney + roof AC
  world._box(1.2, 1.6, 1.2, brick, 8.4, 7.1, 8.4, { static: true, collide: true, cast: true, receive: true });
  world._box(1.8, 0.7, 1.2, metal, -6.5, 6.65, 3.2, { static: true, collide: true, cast: true, receive: true });

  // Loading dock bumpers, ramp, palettes
  world._box(3.2, 0.18, 1.6, concrete, -7, 0.1, b.z1 + 1.2, { static: true, receive: true });
  world._box(2.4, 0.5, 0.18, iron, -7, 0.55, b.z1 + 0.15, { static: true, collide: true });
  for (const [x, z] of [[-9.5, 13.4], [-5.0, 13.6], [-9.2, 15.0]]) {
    world.addInstance('pallet', { w: 1.2, h: 0.12, d: 1.0, mat: wood, collide: true, cast: false }, { x, y: 0.07, z, rotY: 0.1 });
  }
  world.addInstance('barrel', { w: 0.45, h: 0.75, d: 0.45, mat: iron, collide: true, cast: true }, { x: -10.4, y: 0.38, z: 13.2 });
  world.addInstance('barrel', { w: 0.45, h: 0.75, d: 0.45, mat: iron, collide: true, cast: true }, { x: -10.4, y: 0.38, z: 13.8 });

  // More detailed vans at attack spawns (cab + box)
  const vans = [[0, -16.5, 0], [18, 1, Math.PI / 2], [-16.5, 2, -Math.PI / 2], [-8, -18.5, 0.2]];
  for (const [x, z, yaw] of vans) {
    world.addInstance('vanbox', { w: 2.4, h: 1.7, d: 1.3, mat: iron, collide: false, cast: true }, { x, y: 1.15, z, rotY: yaw });
    const fx = x + Math.sin(yaw) * 1.5, fz = z + Math.cos(yaw) * 1.5;
    world.addInstance('vancab', { w: 1.1, h: 1.2, d: 1.25, mat: metal, collide: false, cast: true }, { x: fx, y: 0.95, z: fz, rotY: yaw });
  }

  // Planters along the street
  for (const x of [-8, -4, 4, 8]) {
    world._box(0.7, 0.45, 0.7, concrete, x, 0.22, b.z0 - 3.4, { static: true, collide: true, receive: true });
    world._box(0.55, 0.4, 0.55, gfx.mat('fabric', { color: 0x2f4a2c, repeat: 1 }), x, 0.65, b.z0 - 3.4, { static: true });
  }

  // Dumpster in the east alley
  world._box(2.2, 1.3, 1.1, iron, 14.5, 0.65, 6.0, { static: true, collide: true, cast: true, receive: true });
  world._box(2.2, 0.06, 1.1, metal, 14.5, 1.35, 6.0, { static: true });
}

const POSTER_COPY = [
  'HALCYON PRESS\nJOB TICKET',
  'INK ROOM\nNO SMOKING',
  'BINDERY\nCUTTER RULES',
  'PRESS 3\nMAKE-READY',
  'SHIPPING\nDOCK A',
];

function dressCommon(world, gfx, r, y, add, inst, wood, metal, iron) {
  const h = (r.z1 - r.z0);
  const w = (r.x1 - r.x0);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const ceil = y + (r.floor === 'B' ? 2.7 : 3.05);
  const inset = 0.05;

  // Crown trim around the ceiling (pairs with skirting).
  const trim = gfx.mat('table', { color: 0x4a382c });
  const t = 0.035, th = 0.07;
  const segs = [
    [w - 0.1, t, cx, r.z0 + inset],
    [w - 0.1, t, cx, r.z1 - inset],
    [t, h - 0.1, r.x0 + inset, cz],
    [t, h - 0.1, r.x1 - inset, cz],
  ];
  for (const [bw, bd, x, z] of segs) {
    world._box(bw, th, bd, trim, x, ceil - 0.04, z, { static: true, collide: false, room: r.id, receive: true, kind: 'trim' });
  }

  // Painted dado + chair rail so walls aren't a flat cream field, plus
  // a darker vertical bead in each corner for cheap contact AO.
  const dado = gfx.mat('plaster', { color: 0xb08d68, lm: 0.38 });
  const dh = 0.96;
  const band = [
    [w - 0.08, 0.03, cx, r.z0 + 0.04],
    [w - 0.08, 0.03, cx, r.z1 - 0.04],
    [0.03, h - 0.08, r.x0 + 0.04, cz],
    [0.03, h - 0.08, r.x1 - 0.04, cz],
  ];
  for (const [bw, bd, x, z] of band) {
    world._box(bw, dh, bd, dado, x, y + dh / 2, z, { static: true, collide: false, room: r.id, receive: true, kind: 'wainscot' });
  }
  const railH = 0.04;
  for (const [bw, bd, x, z] of band) {
    world._box(bw, railH, bd, trim, x, y + dh + railH / 2, z, { static: true, collide: false, room: r.id, receive: true, kind: 'chair-rail' });
  }
  const ao = gfx.mat('plaster', { color: 0x6a5542, lm: 0.28 });
  const corners = [
    [r.x0 + 0.035, r.z0 + 0.035],
    [r.x1 - 0.035, r.z0 + 0.035],
    [r.x0 + 0.035, r.z1 - 0.035],
    [r.x1 - 0.035, r.z1 - 0.035],
  ];
  const ch = ceil - y;
  for (const [x, z] of corners) {
    world._box(0.07, ch, 0.07, ao, x, y + ch / 2, z, { static: true, collide: false, room: r.id, receive: true, kind: 'corner-ao' });
  }

  // Fluorescent fixtures with a visible pan, tubes and end caps.
  const tube = gfx.basic(0xf2ead4, { em: 1.05, emissive: 0xffe6b0, roughness: 0.25, metalness: 0.08 });
  const nLights = w * h > 40 ? 3 : (w * h > 16 ? 2 : 1);
  for (let i = 0; i < nLights; i++) {
    const lx = r.x0 + w * ((i + 1) / (nLights + 1));
    const lz = cz;
    const fy = ceil - y - 0.08;
    add(1.42, 0.05, 0.28, metal, lx, lz, fy, false, { cast: false });           // pan
    add(0.08, 0.06, 0.28, metal, lx - 0.67, lz, fy - 0.02, false, { cast: false });
    add(0.08, 0.06, 0.28, metal, lx + 0.67, lz, fy - 0.02, false, { cast: false });
    inst('fluoro-tube', 0.06, 1.22, 0.06, tube, lx, lz - 0.06, fy - 0.05, 0, false, {
      shape: 'cyl', r: 0.03, rotZ: Math.PI / 2, seg: 8, cast: false,
    });
    inst('fluoro-tube', 0.06, 1.22, 0.06, tube, lx, lz + 0.06, fy - 0.05, 0, false, {
      shape: 'cyl', r: 0.03, rotZ: Math.PI / 2, seg: 8, cast: false,
    });
  }

  inst('vent', 0.55, 0.06, 0.35, metal, r.x1 - 0.55, r.z0 + 0.55, ceil - y - 0.08, 0, false);

  // Skip the leftover crate in the lobby so the desk reads clearly.
  if (r.purpose !== 'lobby') {
    inst('crate', 0.55, 0.5, 0.55, wood, r.x0 + 0.55, r.z1 - 0.55, 0, 0.1, true);
    if (w > 5) paperStack(inst, wood, r.x1 - 0.7, r.z1 - 0.7, 0.35);
  }

  const copy = POSTER_COPY[Math.abs(Math.floor(cx * 3 + cz)) % POSTER_COPY.length];
  const poster = gfx.makeSign?.(copy) || wood;
  const midY = 1.55;
  if (w >= 3 && r.purpose !== 'lobby') {
    world._decal(0.7, 0.95, poster, cx, y + midY, r.z0 + 0.08, { room: r.id, kind: 'poster' });
  }
  if (h >= 3 && r.purpose !== 'stairs' && r.purpose !== 'lobby') {
    const copy2 = POSTER_COPY[(Math.abs(Math.floor(cx * 3 + cz)) + 2) % POSTER_COPY.length];
    const poster2 = gfx.makeSign?.(copy2) || wood;
    world._decal(0.7, 0.85, poster2, r.x0 + 0.08, y + midY, cz, { rotY: Math.PI / 2, room: r.id, kind: 'poster' });
  }
}

