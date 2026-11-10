import * as THREE from 'three';
import { sfx } from './audio.js?v=iv-3.7.0';
import { MAP, FLOORS, ROOMS, DOORS, WINDOWS, HATCHES, STAIRS, SOFT_WALLS, CAMS, DRONE_GAPS, DOOR_SWEEP, BOUNDS, SITE_PAIRS, SITES, SPAWNS, floorY, roomById } from './map.js?v=iv-3.7.0';
import { COL_R } from './config.js?v=iv-3.7.0';
import { furnish } from './props.js?v=iv-3.7.0';

const WT = 0.18; // wall thickness
const CHUNK = 0.55;

const yieldFrame = () => new Promise(r => requestAnimationFrame(r));

export class World {
  constructor(gfx) {
    this.gfx = gfx;
    this.layoutId = MAP.id;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.staticGroup = new THREE.Group();
    this.dynGroup = new THREE.Group();
    this.group.add(this.staticGroup, this.dynGroup);
    this.boxes = [];
    this.doors = [];
    this.windows = [];
    this.hatches = [];
    this.stairVols = [];
    this.facades = [];
    this.secCams = [];
    this.droneGaps = [];
    this.chunks = [];
    this.rooms = ROOMS;
    this.sites = SITES;
    this.sitePairs = SITE_PAIRS;
    this.spawns = SPAWNS;
    this.bounds = BOUNDS;
    this.floors = FLOORS;
    this._geoms = [];
    this._disposed = false;
    this.softPanels = [];
    this.floorChunks = []; this._fx = [];
    this.roomGroups = {};
    this.roomAABB = {};
    this.facadeGroups = {};
    this._instances = new Map();
    this._bakeSeq = 0;
    this._bakeList = [];
    this.nav = null;
  }

  async build(progress, opts = {}) {
    progress?.('Clearing', 0.02);
    this._clear();
    this.gfx.scene.add(this.group);
    this._initRoomGroups();
    progress?.('Walls', 0.1);
    await yieldFrame();
    this._buildFloorsAndCeilings();
    this._buildWalls();
    progress?.('Openings', 0.35);
    await yieldFrame();
    this._buildDoors();
    this._buildWindows();
    this._buildHatches();
    this._buildStairs();
    progress?.('Facades', 0.5);
    this._buildFacades();
    this._buildCams();
    this._buildGaps();
    progress?.('Surroundings', 0.65);
    await yieldFrame();
    this._buildSurroundings();
    furnish(this, this.gfx);
    this._buildWindowFrames();
    progress?.('Lighting', 0.8);
    this._placeProbes();
    // UV2 must land on pre-merge meshes (bakeId is per box). Merge keeps uv2.
    await this.applyBakedLighting();
    if (!opts.skipMerge) this._mergeStatic();
    progress?.('Ready', 1);
    return this;
  }

  _clear() {
    this.dispose(false);
    this.boxes = []; this.doors = []; this.windows = []; this.hatches = [];
    this.floorChunks = []; this._fx = [];
    this.stairVols = []; this.facades = []; this.secCams = []; this.droneGaps = []; this.chunks = [];
    this._geoms = [];
    this.softPanels = [];
    this._instances = new Map();
    this._bakeSeq = 0;
    this._bakeList = [];
    for (const g of Object.values(this.roomGroups)) {
      g.traverse(o => { if (o.geometry) o.geometry.dispose?.(); });
      g.clear();
      if (g.parent) g.parent.remove(g);
    }
    this.roomGroups = {};
    this.roomAABB = {};
    for (const g of Object.values(this.facadeGroups || {})) {
      g.traverse(o => { if (o.geometry) o.geometry.dispose?.(); });
      g.clear();
      if (g.parent) g.parent.remove(g);
    }
    this.facadeGroups = {};
    this.gfx?.clearProbes?.();
    this._disposed = false;
  }

  dispose(remove = true) {
    const drop = obj => {
      obj.traverse(o => {
        if (o.geometry) { o.geometry.dispose(); }
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            // shared gfx materials are kept
            if (m.userData && m.userData.owned) m.dispose();
          }
        }
      });
    };
    drop(this.group);
    this.staticGroup.clear();
    this.dynGroup.clear();
    for (const g of Object.values(this.roomGroups || {})) {
      g.clear();
      if (g.parent) g.parent.remove(g);
    }
    this.roomGroups = {};
    this.roomAABB = {};
    for (const g of Object.values(this.facadeGroups || {})) {
      g.clear();
      if (g.parent) g.parent.remove(g);
    }
    this.facadeGroups = {};
    this.gfx?.clearProbes?.();
    if (remove && this.group.parent) this.group.parent.remove(this.group);
    this.boxes = []; this.chunks = [];
    this.softPanels = [];
    this._instances = new Map();
    this._disposed = true;
  }

  // ---------- floors / ceilings ----------
  _buildFloorsAndCeilings() {
    for (const room of ROOMS) {
      const fl = FLOORS.find(f => f.id === room.floor);
      const w = room.x1 - room.x0, d = room.z1 - room.z0;
      const fx = (room.x0 + room.x1) / 2, fz = (room.z0 + room.z1) / 2;
      const matName = room.purpose === 'bath' ? 'tiles'
        : (room.floor === 'B' ? 'concrete' : (room.purpose === 'loading' || room.purpose === 'plant' ? 'concrete' : 'wood'));
      const softFloor = matName === 'wood';
      if (softFloor) this._chunkSoftFloor(room, fl, matName, w, d, fx, fz);
      else {
        const floor = this._box(w, 0.08, d, this.gfx.mat(matName, { repeat: Math.max(w, d) / 2 }), fx, fl.y - 0.04, fz, { static: true, receive: true, room: room.id, kind: 'floor' });
        floor.userData.kind = 'floor';
      }
      const cmat = this.gfx.mat('plasterGrey', { repeat: Math.max(w, d) / 3 });
      this._box(w, 0.06, d, cmat, fx, fl.y + fl.h - 0.03, fz, { static: true, room: room.id, kind: 'ceiling', receive: true });
      // walk box is not a collider from above except as ground
    }
  }


  _chunkSoftFloor(room, fl, matName, w, d, fx, fz) {
    const TILE = 1.4;
    const mat = this.gfx.mat(matName, { repeat: Math.max(w, d) / 2 });
    const mesh = this._box(w, 0.08, d, mat, fx, fl.y - 0.04, fz, {
      static: true, receive: true, noMerge: true, room: room.id, kind: 'floor',
    });
    mesh.userData.kind = 'floor';
    const nx = Math.max(1, Math.round(w / TILE));
    const nz = Math.max(1, Math.round(d / TILE));
    const tw = w / nx, td = d / nz;
    const flIdx = FLOORS.findIndex(f => f.id === room.floor);
    const belowY = flIdx > 0 ? FLOORS[flIdx - 1].y : fl.y - 3.0;
    const panelChunks = [];
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const x = room.x0 + tw * (ix + 0.5);
        const z = room.z0 + td * (iz + 0.5);
        const ch = {
          mesh: null, hp: 90, max: 90, destroyed: false, reinforced: false,
          floorTile: true, x, z, y: fl.y, h: 0.08, w: tw, d: td, hw: tw / 2, hd: td / 2,
          floor: room.floor, below: belowY, panel: null, room: room.id,
        };
        this.chunks.push(ch);
        this.floorChunks.push(ch);
        panelChunks.push(ch);
      }
    }
    const panel = { mesh, chunks: panelChunks, split: false, mat: matName, kind: 'floor' };
    this.softPanels.push(panel);
    for (const ch of panelChunks) ch.panel = panel;
  }

  _splitFloorPanel(panel) {
    if (!panel || panel.split) return;
    panel.split = true;
    if (panel.mesh) panel.mesh.visible = false;
    const mat = this.gfx.mat(panel.mat || 'wood', { repeat: 1 });
    for (const ch of panel.chunks) {
      const mesh = this._box(ch.w, 0.08, ch.d, mat, ch.x, ch.y - 0.04, ch.z, {
        static: false, collide: false, receive: true, noMerge: true, room: ch.room, kind: 'floor',
      });
      ch.mesh = mesh;
      mesh.userData.chunk = ch;
      mesh.userData.kind = 'floor';
      if (ch.destroyed) mesh.visible = false;
    }
  }

  // ---------- walls ----------
  _buildWalls() {
    const edges = this._collectEdges();
    this._openings = this._openingSpans();
    for (const e of edges) {
      const spans = this._subtract(e, this._openings);
      for (const s of spans) {
        if (s.len < 0.12) continue;
        const soft = !e.exterior && this._isSoft(e.floor, s);
        if (soft) this._chunkWall(e, s);
        else this._solidWall(e, s, e.exterior ? 'brick' : 'plaster', false);
      }
    }
  }

  _collectEdges() {
    const key = (fl, ax, a, b, c) => `${fl}|${ax}|${c.toFixed(3)}|${Math.min(a, b).toFixed(3)}|${Math.max(a, b).toFixed(3)}`;
    const map = new Map();
    const add = (fl, alongX, a0, a1, constV, exteriorHint) => {
      const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
      if (hi - lo < 0.05) return;
      const k = `${fl}|${alongX ? 'X' : 'Z'}|${constV.toFixed(3)}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ lo, hi, floor: fl, alongX, c: constV });
    };
    for (const r of ROOMS) {
      add(r.floor, true, r.x0, r.x1, r.z0);
      add(r.floor, true, r.x0, r.x1, r.z1);
      add(r.floor, false, r.z0, r.z1, r.x0);
      add(r.floor, false, r.z0, r.z1, r.x1);
    }
    // split into unique coverage counts
    const edges = [];
    for (const segs of map.values()) {
      const fl = segs[0].floor, alongX = segs[0].alongX, c = segs[0].c;
      const pts = [];
      for (const s of segs) { pts.push(s.lo, s.hi); }
      pts.sort((a, b) => a - b);
      const uniq = [];
      for (const p of pts) if (!uniq.length || Math.abs(uniq[uniq.length - 1] - p) > 0.001) uniq.push(p);
      for (let i = 0; i < uniq.length - 1; i++) {
        const lo = uniq[i], hi = uniq[i + 1], mid = (lo + hi) / 2;
        if (hi - lo < 0.08) continue;
        let n = 0;
        for (const s of segs) if (s.lo <= mid + 0.01 && s.hi >= mid - 0.01) n++;
        if (n === 0) continue;
        const flDef = FLOORS.find(f => f.id === fl);
        const exterior = n === 1;
        edges.push({ floor: fl, alongX, c, lo, hi, len: hi - lo, y: flDef.y, h: flDef.h, exterior, n });
      }
    }
    return edges;
  }

  _openingSpans() {
    const list = [];
    for (const d of DOORS) {
      const fl = floorY(d.floor);
      list.push({ floor: d.floor, alongX: d.alongX, c: d.alongX ? d.z : d.x, lo: (d.alongX ? d.x : d.z) - d.w / 2, hi: (d.alongX ? d.x : d.z) + d.w / 2, y0: fl, y1: fl + (d.wide ? 2.6 : 2.25), kind: 'door', id: d.id });
    }
    for (const w of WINDOWS) {
      const fl = floorY(w.floor);
      const h = 1.25;
      list.push({ floor: w.floor, alongX: w.alongX, c: w.alongX ? w.z : w.x, lo: (w.alongX ? w.x : w.z) - w.w / 2, hi: (w.alongX ? w.x : w.z) + w.w / 2, y0: fl + w.sill, y1: fl + w.sill + h, kind: 'window', id: w.id });
    }
    for (const g of DRONE_GAPS) {
      const fl = floorY(g.floor);
      list.push({
        floor: g.floor, alongX: g.alongX, c: g.alongX ? g.z : g.x,
        lo: (g.alongX ? g.x : g.z) - g.w / 2, hi: (g.alongX ? g.x : g.z) + g.w / 2,
        y0: fl + g.y0, y1: fl + g.y1, kind: 'drone-gap', id: g.id,
      });
    }
    return list;
  }

  _subtract(edge, openings) {
    let spans = [{ lo: edge.lo, hi: edge.hi, len: edge.hi - edge.lo, yFull: true }];
    const hits = openings.filter(o => o.floor === edge.floor && o.alongX === edge.alongX && Math.abs(o.c - edge.c) < 0.12);
    for (const o of hits) {
      const next = [];
      for (const s of spans) {
        const a = Math.max(s.lo, o.lo), b = Math.min(s.hi, o.hi);
        if (b - a < 0.05) { next.push(s); continue; }
        if (a - s.lo > 0.08) next.push({ lo: s.lo, hi: a, len: a - s.lo });
        if (s.hi - b > 0.08) next.push({ lo: b, hi: s.hi, len: s.hi - b });
        // keep lintels / sills as extra solid pieces
        s._open = o;
      }
      spans = next;
      // lintel and sill around this opening, clipped to edge
      const lo = Math.max(edge.lo, o.lo), hi = Math.min(edge.hi, o.hi);
      if (hi > lo + 0.05) {
        edge._holes = edge._holes || [];
        edge._holes.push({ ...o, lo, hi });
      }
    }
    // add lintels as separate later
    this._lintels = this._lintels || [];
    if (edge._holes) {
      for (const h of edge._holes) this._lintels.push({ edge, hole: h });
    }
    return spans.map(s => ({ ...s, len: s.hi - s.lo }));
  }

  _isSoft(floor, span) {
    const mid = (span.lo + span.hi) / 2;
    for (const s of SOFT_WALLS) {
      if (s.floor !== floor) continue;
      const alongX = Math.abs(s.z0 - s.z1) < 0.05;
      const c = alongX ? s.z0 : s.x0;
      const lo = alongX ? Math.min(s.x0, s.x1) : Math.min(s.z0, s.z1);
      const hi = alongX ? Math.max(s.x0, s.x1) : Math.max(s.z0, s.z1);
      // The span's parent edge is needed; we check mid along either axis later in _chunkWall via soft list overlap
      if (mid >= lo - 0.15 && mid <= hi + 0.15) {
        // const axis match deferred — treat as candidate
        if (Math.abs((alongX ? 0 : 1)) >= 0) return true;
      }
    }
    return false;
  }

  _wallPos(edge, lo, hi) {
    const mid = (lo + hi) / 2, len = hi - lo;
    if (edge.alongX) return { x: mid, z: edge.c, w: len, d: WT };
    return { x: edge.c, z: mid, w: WT, d: len };
  }

  _solidWall(edge, span, mat, soft) {
    const p = this._wallPos(edge, span.lo, span.hi);
    const m = this.gfx.mat(mat, { repeat: Math.max(p.w, p.d, edge.h) / 2.2 });
    this._box(p.w, edge.h, p.d, m, p.x, edge.y + edge.h / 2, p.z, { static: true, collide: true, soft, receive: true, cast: true });
  }

  _chunkWall(edge, span) {
    const mid = (span.lo + span.hi) / 2;
    let ok = false;
    for (const s of SOFT_WALLS) {
      if (s.floor !== edge.floor) continue;
      const alongX = Math.abs(s.z0 - s.z1) < 0.05;
      if (alongX !== edge.alongX) continue;
      const c = alongX ? s.z0 : s.x0;
      if (Math.abs(c - edge.c) > 0.15) continue;
      const lo = alongX ? Math.min(s.x0, s.x1) : Math.min(s.z0, s.z1);
      const hi = alongX ? Math.max(s.x0, s.x1) : Math.max(s.z0, s.z1);
      if (mid >= lo - 0.2 && mid <= hi + 0.2) { ok = true; break; }
    }
    if (!ok) { this._solidWall(edge, span, 'plaster', false); return; }
    // Collision is pre-chunked; visuals stay as one panel until first damage (merge-until-breached).
    const n = Math.max(1, Math.round(span.len / CHUNK));
    const sl = span.len / n;
    const rows = 2;
    const rh = edge.h / rows;
    const panelChunks = [];
    for (let i = 0; i < n; i++) {
      const lo = span.lo + i * sl, hi = lo + sl;
      const p = this._wallPos(edge, lo, hi);
      for (let r = 0; r < rows; r++) {
        const y = edge.y + rh * r;
        const box = {
          x0: p.x - p.w / 2, x1: p.x + p.w / 2,
          y0: y, y1: y + rh,
          z0: p.z - p.d / 2, z1: p.z + p.d / 2,
          solid: true, soft: true, mesh: null,
        };
        this.boxes.push(box);
        const ch = {
          mesh: null, hp: 70, max: 70, destroyed: false, reinforced: false,
          box, x: p.x, z: p.z, y, h: rh, w: p.w, d: p.d, floor: edge.floor, panel: null,
        };
        this.chunks.push(ch);
        panelChunks.push(ch);
      }
    }
    const p = this._wallPos(edge, span.lo, span.hi);
    const mat = this.gfx.mat('plaster', { repeat: Math.max(p.w, edge.h) / 2.2 });
    const room = this._roomAt(p.x, p.z, edge.floor);
    const mesh = this._box(p.w, edge.h, p.d, mat, p.x, edge.y + edge.h / 2, p.z, {
      static: true, collide: false, receive: true, cast: true, noMerge: true, kind: 'soft-panel', room: room?.id,
    });
    mesh.userData.softPanel = true;
    const panel = { mesh, chunks: panelChunks, split: false, mat: 'plaster', x: p.x, z: p.z, y: edge.y, w: p.w, h: edge.h, d: p.d };
    this.softPanels.push(panel);
    for (const ch of panelChunks) ch.panel = panel;
  }

  _splitPanel(panel) {
    if (!panel || panel.split) return;
    if (panel.kind === 'floor') return this._splitFloorPanel(panel);
    panel.split = true;
    if (panel.mesh) panel.mesh.visible = false;
    const mat = this.gfx.mat('plaster', { repeat: 1.2 });
    for (const ch of panel.chunks) {
      const room = this._roomAt(ch.x, ch.z, ch.floor);
      const mesh = this._box(ch.w, ch.h - 0.01, ch.d, mat, ch.x, ch.y + ch.h / 2, ch.z, {
        static: false, collide: false, receive: true, cast: true, noMerge: true, room: room?.id,
      });
      ch.mesh = mesh;
      mesh.userData.chunk = ch;
      if (ch.box) ch.box.mesh = mesh;
      if (ch.destroyed) mesh.visible = false;
      if (ch.reinforced) mesh.material = this.gfx.mat('metal', { repeat: 1, color: 0x8899aa });
    }
  }

  _finishLintels() {
    if (!this._lintels) return;
    for (const { edge, hole } of this._lintels) {
      const p = this._wallPos(edge, hole.lo, hole.hi);
      const mat = this.gfx.mat(edge.exterior ? 'brick' : 'plaster', { repeat: 1 });
      // sill
      if (hole.y0 > edge.y + 0.05) {
        const h = hole.y0 - edge.y;
        this._box(p.w, h, p.d, mat, p.x, edge.y + h / 2, p.z, { static: true, collide: true, receive: true, cast: true });
      }
      // lintel
      if (hole.y1 < edge.y + edge.h - 0.05) {
        const top = edge.y + edge.h;
        const h = top - hole.y1;
        this._box(p.w, h, p.d, mat, p.x, hole.y1 + h / 2, p.z, { static: true, collide: true, receive: true, cast: true });
      }
    }
    this._lintels = [];
  }

  // ---------- doors / windows / hatches / stairs ----------
  _buildDoors() {
    this._finishLintels();
    for (const d of DOORS) {
      const y = floorY(d.floor);
      const h = d.wide ? 2.55 : 2.2;
      const thick = 0.08;
      const alongX = d.alongX;
      const nx = alongX ? 0 : 1, nz = alongX ? 1 : 0;
      const mat = this.gfx.mat('table', { repeat: 1, color: d.exterior ? 0x5a3a22 : 0x6a4a2e });
      const facade = d.exterior ? this._facadeSide(d.x, d.z) : null;
      const room = facade ? null : this._roomAt(d.x, d.z, d.floor);
      const sweep = DOOR_SWEEP;
      const visH = h - sweep;
      const mesh = this._box(alongX ? d.w : thick, visH, alongX ? thick : d.w, mat, d.x, y + sweep + visH / 2, d.z, { static: false, collide: false, cast: true, room: room?.id, facade });
      const door = {
        ...d, y, h, thick, nx, nz, sweep, visH, state: 'closed', angle: 0, target: 0,
        locked: false, barricaded: false, reinforced: false, mesh,
        box: { x0: 0, x1: 0, y0: y + sweep, y1: y + h, z0: 0, z1: 0, door: true },
      };
      this._syncDoorBox(door);
      this.boxes.push(door.box);
      this.doors.push(door);
      mesh.userData.door = door;
    }
  }

  _syncDoorBox(door) {
    // When closed, fill the opening. When open/opening, only the swung leaf blocks; the opening is clear.
    const openAmt = Math.abs(door.angle);
    const alongX = door.alongX;
    const hleaf = door.w;
    if (openAmt < 0.12) {
      if (alongX) {
        door.box.x0 = door.x - door.w / 2; door.box.x1 = door.x + door.w / 2;
        door.box.z0 = door.z - 0.08; door.box.z1 = door.z + 0.08;
      } else {
        door.box.z0 = door.z - door.w / 2; door.box.z1 = door.z + door.w / 2;
        door.box.x0 = door.x - 0.08; door.box.x1 = door.x + 0.08;
      }
      door.box.solid = true;
    } else {
      // leaf swings +Y or +X side (positive around up). Opening is walkable.
      const ca = Math.cos(door.angle), sa = Math.sin(door.angle);
      // hinge at -end of the door
      let hx, hz, fx, fz;
      if (alongX) { hx = door.x - door.w / 2; hz = door.z; fx = hx + door.w * ca; fz = hz + door.w * sa; }
      else { hx = door.x; hz = door.z - door.w / 2; fx = hx - door.w * sa; fz = hz + door.w * ca; }
      door.box.x0 = Math.min(hx, fx) - 0.06; door.box.x1 = Math.max(hx, fx) + 0.06;
      door.box.z0 = Math.min(hz, fz) - 0.06; door.box.z1 = Math.max(hz, fz) + 0.06;
      door.box.solid = true;
      // mesh rotation
    }
    door.box.y0 = door.y + (door.sweep ?? DOOR_SWEEP); door.box.y1 = door.y + door.h;
    door.box.ignoreIfOpenCenter = openAmt >= 0.12;
    if (door.mesh) {
      door.mesh.rotation.y = door.alongX ? door.angle : door.angle;
      // hinge offset
      const hinge = door.alongX ? door.w / 2 : door.w / 2;
      if (door.alongX) {
        door.mesh.position.set(door.x - door.w / 2 + Math.cos(door.angle) * (door.w / 2), door.y + (door.sweep ?? DOOR_SWEEP) + (door.visH ?? door.h) / 2, door.z + Math.sin(door.angle) * (door.w / 2));
      } else {
        door.mesh.position.set(door.x - Math.sin(door.angle) * (door.w / 2), door.y + (door.sweep ?? DOOR_SWEEP) + (door.visH ?? door.h) / 2, door.z - door.w / 2 + Math.cos(door.angle) * (door.w / 2));
      }
      door.mesh.updateMatrix();
    }
  }

  toggleDoor(door) {
    if (door.locked || door.barricaded || door.reinforced) return false;
    if (door.state === 'closed' || door.state === 'closing') {
      door.target = Math.PI / 2; door.state = 'opening';
    } else {
      door.target = 0; door.state = 'closing';
    }
    return true;
  }

  updateDoors(dt) {
    for (const d of this.doors) {
      if (Math.abs(d.angle - d.target) < 0.01) {
        d.angle = d.target;
        d.state = d.angle > 0.2 ? 'open' : 'closed';
      } else {
        const dir = Math.sign(d.target - d.angle);
        d.angle += dir * 2.8 * dt;
        if ((dir > 0 && d.angle >= d.target) || (dir < 0 && d.angle <= d.target)) d.angle = d.target;
      }
      if (Math.abs(d.angle - d.target) < 0.01) {
        d.angle = d.target;
        d.state = d.angle > 0.2 ? 'open' : 'closed';
      }
      this._syncDoorBox(d);
    }
  }

  _buildWindows() {
    for (const w of WINDOWS) {
      const y = floorY(w.floor);
      const h = 1.25, thick = 0.06;
      const alongX = w.alongX;
      const nx = alongX ? 0 : (w.x < 0 ? -1 : 1);
      const nz = alongX ? (w.z < 0 ? -1 : 1) : 0;
      // better normals from building center
      const nnx = alongX ? 0 : (w.x >= 0 ? 1 : -1);
      const nnz = alongX ? (w.z >= 0 ? 1 : -1) : 0;
      const glass = this.gfx.basic(0x9ec3d4, { roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.35 });
      glass.userData.owned = true;
      const facade = this._facadeSide(w.x, w.z);
      const room = facade ? null : this._roomAt(w.x, w.z, w.floor);
      const mesh = this._box(alongX ? w.w : thick, h, alongX ? thick : w.w, glass, w.x, y + w.sill + h / 2, w.z, { static: false, collide: false, room: room?.id, facade });
      const frame = this.gfx.mat('table', { repeat: 1 });
      // simple frame already implied by lintel; add a thin sill board
      const win = {
        ...w, y, h, nx: nnx, nz: nnz, exterior: true,
        state: 'intact', mesh, sillY: y + w.sill,
        box: null,
      };
      this.windows.push(win);
      mesh.userData.window = win;
    }
  }

  damageWindow(win, amt) {
    if (!win || win.state === 'broken') return false;
    if (win.state === 'reinforced') return false;
    if (win.state === 'barricaded') {
      win._hp = (win._hp ?? 80) - amt;
      if (win._hp > 0) return false;
      win.state = 'intact';
      if (win.board) { win.board.visible = false; }
      for (const s of win.slats || []) s.visible = false;
      win.peek = false;
      // Board is gone; leftover force can still crack / shatter the pane.
    }
    win.hp = (win.hp ?? 40) - amt;
    if (win.hp > 0) {
      win.state = 'cracked';
      this._crackWindow(win);
      return 'cracked';
    }
    this._shatterWindow(win);
    return 'broken';
  }

  _crackWindow(win) {
    const mesh = win.mesh;
    if (!mesh) return;
    const mat = mesh.material;
    if (mat) {
      mat.opacity = 0.7;
      mat.transparent = true;
      if (mat.color) mat.color.setHex(0x8aa8b8);
      // etch a brighter crack overlay by darkening + slightly emissive chips
      if ('emissive' in mat) { mat.emissive = mat.emissive || new THREE.Color(0x223344); mat.emissiveIntensity = 0.15; }
    }
    mesh.visible = true;
  }

  _shatterWindow(win) {
    win.state = 'broken';
    win.hp = 0;
    if (win.mesh) win.mesh.visible = false;
    this._spawnGlassShards(win);
    try { sfx.glass(); } catch { try { sfx.break(); } catch {} }
  }

  _spawnGlassShards(win) {
    this._fx = this._fx || [];
    const n = 14;
    const geo = new THREE.BoxGeometry(0.07, 0.09, 0.012);
    const mat = this.gfx.basic(0xc5e0ee, { roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.8 });
    const shards = [];
    const y0 = (win.y || 0) + (win.sill || 0) + (win.h || 1.2) * 0.55;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(win.x + (Math.random() - 0.5) * 0.5, y0 + (Math.random() - 0.5) * 0.4, win.z + (Math.random() - 0.5) * 0.5);
      m.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
      m.userData.noMerge = true;
      this.dynGroup.add(m);
      shards.push({
        m,
        vx: (Math.random() - 0.5) * 3.5,
        vy: 1.2 + Math.random() * 2.2,
        vz: (Math.random() - 0.5) * 3.5,
      });
    }
    this._fx.push({ shards, t: 0, life: 0.85 });
  }

  updateFx(dt) {
    if (!this._fx || !this._fx.length) return;
    for (const fx of this._fx) {
      fx.t += dt;
      const fade = 1 - fx.t / fx.life;
      for (const s of fx.shards) {
        s.vy -= 14 * dt;
        s.m.position.x += s.vx * dt;
        s.m.position.y += s.vy * dt;
        s.m.position.z += s.vz * dt;
        s.m.rotation.x += 8 * dt;
        s.m.rotation.z += 5 * dt;
        if (s.m.material && s.m.material.opacity != null) s.m.material.opacity = Math.max(0, fade * 0.8);
      }
      if (fx.t >= fx.life) {
        for (const s of fx.shards) this.dynGroup.remove(s.m);
        fx.dead = true;
      }
    }
    this._fx = this._fx.filter(f => !f.dead);
  }

  rayHitsWindow(origin, dir, max, win) {
    if (!win || win.state === 'broken') return null;
    const alongX = win.alongX;
    let t;
    if (alongX) {
      if (Math.abs(dir.z) < 1e-6) return null;
      t = (win.z - origin.z) / dir.z;
    } else {
      if (Math.abs(dir.x) < 1e-6) return null;
      t = (win.x - origin.x) / dir.x;
    }
    if (t < 0.02 || t > max) return null;
    const hx = origin.x + dir.x * t;
    const hy = origin.y + dir.y * t;
    const hz = origin.z + dir.z * t;
    const y0 = win.sillY ?? ((win.y || 0) + (win.sill || 0));
    const y1 = y0 + (win.h || 1.25);
    if (hy < y0 - 0.02 || hy > y1 + 0.02) return null;
    if (alongX) { if (Math.abs(hx - win.x) > (win.w || 1) / 2 + 0.02) return null; }
    else { if (Math.abs(hz - win.z) > (win.w || 1) / 2 + 0.02) return null; }
    if (win.state === 'barricaded' && win.peek && win.peekY != null && Math.abs(hy - win.peekY) < 0.16) return null;
    return t;
  }

  hitWindowOnRay(origin, dir, max) {
    let best = null, bt = max;
    for (const w of this.windows) {
      const t = this.rayHitsWindow(origin, dir, bt, w);
      if (t != null && t < bt) { bt = t; best = w; }
    }
    return best;
  }

  /** True if a ray from a to b is not blocked by solid world geometry.
   *  Broken glass and destroyed chunks / open hatches do not block. */
  lineOfSight(a, b) {
    const dir = b.clone().sub(a);
    const dist = dir.length();
    if (dist < 0.05) return true;
    dir.multiplyScalar(1 / dist);
    if (this.hitWindowOnRay(a, dir, dist - 0.04)) return false;
    const ray = new THREE.Raycaster(a, dir, 0.05, dist - 0.04);
    const hits = ray.intersectObjects([this.staticGroup, this.dynGroup], true);
    for (const h of hits) {
      const o = h.object;
      if (!o.visible) continue;
      const win = o.userData.window;
      if (win && win.state === 'broken') continue;
      const ch = o.userData.chunk;
      if (ch && ch.destroyed) continue;
      const hat = o.userData.hatch;
      if (hat && this.hatchOpen(hat)) continue;
      return false;
    }
    return true;
  }

  damageNeighbors(ch, amt) {
    if (!ch) return;
    for (const n of this.chunks) {
      if (n === ch || n.destroyed) continue;
      if (Math.hypot((n.x || 0) - ch.x, (n.z || 0) - ch.z) < 0.95 && Math.abs((n.y || 0) - (ch.y || 0)) < 1.5) {
        this.damageChunk(n, amt);
      }
    }
  }



  barricadeWindow(win) {
    if (!win || win.state === 'reinforced') return false;
    win.state = 'barricaded';
    win._hp = 80;
    win.peek = false; win.peekY = null; win._peeked = 0;
    this._buildBarricadeSlats(win);
    if (win.board) win.board.visible = true;
    for (const s of win.slats || []) s.visible = true;
    return true;
  }

  _buildBarricadeSlats(win) {
    if (win.slats?.length) return;
    const alongX = win.alongX;
    const mat = this.gfx.mat('siding', { repeat: 1 });
    const facade = this._facadeSide(win.x, win.z);
    const room = facade ? null : this._roomAt(win.x, win.z, win.floor);
    const n = 5;
    const slatH = (win.h || 1.25) / n;
    const y0 = (win.y || 0) + (win.sill || 0);
    win.slats = [];
    for (let i = 0; i < n; i++) {
      const y = y0 + slatH * (i + 0.5);
      const m = this._box(alongX ? win.w : 0.07, slatH - 0.01, alongX ? 0.07 : win.w, mat, win.x, y, win.z, {
        static: false, collide: true, room: room?.id, facade,
      });
      m.userData.window = win;
      m.userData.slat = i;
      m.userData.slatY = y;
      win.slats.push(m);
    }
    win.board = win.slats[0];
  }

  /** First melee opens a peek hole in one slat; a second melee knocks the board down. */
  peekBarricade(win, hitY) {
    if (!win || win.state !== 'barricaded') return false;
    this._buildBarricadeSlats(win);
    const slats = (win.slats || []).filter(s => s.visible);
    if (!slats.length) return false;
    let pick = slats[Math.floor(slats.length / 2)];
    if (hitY != null) {
      let bd = 1e9;
      for (const s of slats) {
        const d = Math.abs((s.userData.slatY || 0) - hitY);
        if (d < bd) { bd = d; pick = s; }
      }
    }
    pick.visible = false;
    if (pick.userData && pick.parent) {
      // drop collision for the missing slat
      const box = this.boxes.find(b => b.mesh === pick);
      if (box) box.solid = false;
    }
    win.peek = true;
    win.peekY = pick.userData.slatY;
    win._peeked = (win._peeked || 0) + 1;
    try { sfx.break(); } catch {}
    if (win._peeked >= 2) {
      for (const s of win.slats) s.visible = false;
      win.state = 'intact';
      win.peek = false;
    }
    return true;
  }

  _buildHatches() {
    for (const h of HATCHES) {
      const fromY = h.to === 'roof' ? floorY('2') + 3.0 : floorY(h.to);
      const y = fromY;
      const mat = this.gfx.mat('metal', { repeat: 1 });
      const room = this._roomAt(h.x, h.z, h.from || h.to);
      const mesh = this._box(1.2, 0.08, 1.2, mat, h.x, y + 0.02, h.z, { static: false, collide: false, receive: true, room: room?.id });
      const cell = { chunks: [], open: false };
      const hat = { ...h, y, mesh, cell, state: 'closed', type: h.to === 'roof' ? 'roof' : 'floor' };
      // hatch cover is a single "chunk" for breach
      const ch = { mesh, hp: 120, max: 120, destroyed: false, hatch: hat, x: h.x, z: h.z, y };
      cell.chunks.push(ch);
      this.hatches.push(hat);
      mesh.userData.hatch = hat;
      mesh.userData.chunk = ch;
      // floor hole collider is handled in groundAt when open
    }
  }

  hatchOpen(h) { return !!(h && (h.cell?.open || h.state === 'open')); }

  damageChunk(ch, amt) {
    if (!ch || ch.destroyed) return;
    if (ch.panel && !ch.panel.split) this._splitPanel(ch.panel);
    // Reinforced walls only fall to breach-gadget scale damage (hearthlance, etc.).
    if (ch.reinforced && amt < 500) { ch.hp -= amt * 0.08; if (ch.hp > 0) return; }
    else ch.hp -= amt;
    if (ch.hp > 0) return;
    ch.destroyed = true; ch.hp = 0;
    if (ch.mesh) ch.mesh.visible = false;
    if (ch.box) ch.box.solid = false;
    if (ch.hatch) { ch.hatch.cell.open = true; ch.hatch.state = 'open'; if (ch.hatch.mesh) ch.hatch.mesh.visible = false; }
    this.nav?.onBreach?.(ch);
  }

  reinforceChunk(ch) {
    if (!ch || ch.destroyed) return false;
    if (ch.panel && !ch.panel.split) this._splitPanel(ch.panel);
    ch.reinforced = true; ch.hp = 400; ch.max = 400;
    if (ch.mesh) ch.mesh.material = this.gfx.mat('metal', { repeat: 1, color: 0x8899aa });
    this.nav?.onReinforce?.(ch);
    return true;
  }

  _buildStairs() {
    for (const s of STAIRS) {
      this.stairVols.push({ ...s });
      const rise = s.y1 - s.y0;
      const alongZ = Math.abs(s.z1 - s.z0) >= Math.abs(s.x1 - s.x0);
      const steps = 12;
      const mat = this.gfx.mat('wood', { repeat: 1 });
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        const y = s.y0 + rise * t0;
        let x, z, w, d;
        if (alongZ) {
          const z0 = s.dir.includes('z-') ? s.z1 - (s.z1 - s.z0) * t0 : s.z0 + (s.z1 - s.z0) * t0;
          const z1 = s.dir.includes('z-') ? s.z1 - (s.z1 - s.z0) * t1 : s.z0 + (s.z1 - s.z0) * t1;
          x = (s.x0 + s.x1) / 2; z = (z0 + z1) / 2; w = s.x1 - s.x0; d = Math.abs(z1 - z0);
        } else {
          x = (s.x0 + s.x1) / 2; z = (s.z0 + s.z1) / 2; w = (s.x1 - s.x0) / steps; d = s.z1 - s.z0;
        }
        this._box(Math.max(0.3, w), 0.07, Math.max(0.2, d), mat, x, y + 0.035, z, { static: true, receive: true });
      }
      // rail
      const rail = this.gfx.mat('metal', { repeat: 1 });
      this._box(0.05, rise, 0.05, rail, s.x0 + 0.08, (s.y0 + s.y1) / 2 + 0.5, (s.z0 + s.z1) / 2, { static: true });
    }
  }

  _buildFacades() {
    const b = BOUNDS.building;
    const roofY = 6.2;
    this.facades = [
      { id: 'north', kind: 'main', alongX: true, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z0, faceX: 0, faceZ: b.z0, nx: 0, nz: -1, y0: -3.2, y1: roofY },
      { id: 'south', kind: 'main', alongX: true, x0: b.x0, x1: b.x1, z0: b.z1, z1: b.z1, faceX: 0, faceZ: b.z1, nx: 0, nz: 1, y0: -3.2, y1: roofY },
      { id: 'west', kind: 'main', alongX: false, x0: b.x0, x1: b.x0, z0: b.z0, z1: b.z1, faceX: b.x0, faceZ: 0, nx: -1, nz: 0, y0: -3.2, y1: roofY },
      { id: 'east', kind: 'main', alongX: false, x0: b.x1, x1: b.x1, z0: b.z0, z1: b.z1, faceX: b.x1, faceZ: 0, nx: 1, nz: 0, y0: -3.2, y1: roofY },
    ];
    // roof slab
    const mat = this.gfx.mat('roof', { repeat: 8 });
    this._box(b.x1 - b.x0 + 0.4, 0.12, b.z1 - b.z0 + 0.4, mat, 0, roofY + 0.06, 1, { static: true, collide: true, receive: true });
  }

  _buildCams() {
    for (const c of CAMS) {
      const mat = this.gfx.basic(0x111111, { roughness: 0.4, metalness: 0.6 });
      const facade = this._facadeSide(c.x, c.z);
      const room = facade ? null : this._roomAt(c.x, c.z, c.floor);
      const body = this._box(0.18, 0.12, 0.22, mat, c.x, c.y, c.z, { static: false, room: room?.id, facade });
      const light = this.gfx.basic(0x330000, { emissive: 0x990000, em: 0.4 });
      const led = this._box(0.04, 0.04, 0.04, light, c.x + Math.sin(c.yaw) * 0.1, c.y, c.z + Math.cos(c.yaw) * 0.1, { static: false, room: room?.id, facade });
      const cam = { ...c, mesh: body, led, alive: true, watched: false };
      this.secCams.push(cam);
      body.userData.cam = cam;
    }
  }

  setCamWatched(cam, on) {
    if (!cam || !cam.led) return;
    cam.watched = on && cam.alive;
    cam.led.material.emissive = new THREE.Color(cam.watched ? 0xff2222 : 0x330000);
    cam.led.material.emissiveIntensity = cam.watched ? 1.2 : 0.2;
  }

  // ---------- surroundings ----------
  _buildSurroundings() {
    const asphalt = this.gfx.mat('asphalt', { repeat: 18 });
    this._box(56, 0.06, 60, asphalt, 0, -0.03, 0, { static: true, receive: true });
    const grav = this.gfx.mat('gravel', { repeat: 6 });
    // courtyards
    this._box(8, 0.05, 22, grav, -16, 0.01, 1, { static: true, receive: true });
    this._box(8, 0.05, 22, grav, 16, 0.01, 1, { static: true, receive: true });
    // sidewalks
    const conc = this.gfx.mat('concrete', { repeat: 8 });
    this._box(24, 0.07, 2.2, conc, 0, 0.02, -11.4, { static: true, receive: true });
    this._box(24, 0.07, 2.2, conc, 0, 0.02, 13.2, { static: true, receive: true });
    // neighboring facades (non-enterable)
    const brick = this.gfx.mat('brick', { repeat: 6 });
    this._box(28, 10, 1.2, brick, 0, 5, -25, { static: true, collide: true, receive: true, cast: true });
    this._box(1.2, 10, 28, brick, 25, 5, 0, { static: true, collide: true, receive: true, cast: true });
    this._box(1.2, 10, 28, brick, -25, 5, 0, { static: true, collide: true, receive: true, cast: true });
    this._box(28, 10, 1.2, brick, 0, 5, 27, { static: true, collide: true, receive: true, cast: true });
    // cover at spawns: vans / barriers
    const metal = this.gfx.mat('iron', { repeat: 2 });
    const covers = [
      [0, -16.5], [18, 1], [2, 17.5], [-16.5, 2], [-8, -18.5], [-15, 14],
    ];
    for (const [x, z] of covers) {
      this._box(2.4, 1.6, 1.2, metal, x, 0.8, z, { static: true, collide: true, receive: true, cast: true });
    }
    // street lights
    const pole = this.gfx.mat('metal', { repeat: 1 });
    for (const [x, z] of [[-12, -14], [12, -14], [-14, 14], [14, 14]]) {
      this._box(0.12, 5.5, 0.12, pole, x, 2.75, z, { static: true, collide: true });
      const lamp = this.gfx.basic(0xffe6b0, { emissive: 0xffcc88, em: 0.8 });
      this._box(0.4, 0.12, 0.4, lamp, x, 5.5, z, { static: true });
    }
    // play-boundary posts (visual only at warn edge)
  }

  _placeProbes() {
    this.gfx?.clearProbes?.();
    for (const r of ROOMS) {
      const fl = FLOORS.find(f => f.id === r.floor);
      const x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2, y = fl.y + 1.5;
      const warm = r.floor === 'B' ? 0xb8c4b8 : (r.purpose === 'loading' || r.purpose === 'plant' ? 0xd8d2c4 : 0xffe2b8);
      const i = r.floor === 'B' ? 0.28 : 0.4;
      this.gfx.addRoomProbe(new THREE.Vector3(x, y, z), warm, i);
    }
  }

  _mergeStatic() {
    const parents = [this.staticGroup, ...Object.values(this.roomGroups), ...Object.values(this.facadeGroups || {})];
    for (const parent of parents) this._mergeChildren(parent);
  }

  _mergeChildren(parent) {
    const children = [...parent.children];
    const groups = new Map();
    for (const m of children) {
      if (!m.isMesh || m.isInstancedMesh) continue;
      if (m.userData.chunk || m.userData.door || m.userData.window || m.userData.cam || m.userData.noMerge || m.userData.softPanel) continue;
      const key = (m.material && m.material.uuid) || 'x';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geoms = [];
      for (const m of list) {
        const g = m.geometry.clone();
        m.updateWorldMatrix(true, false);
        g.applyMatrix4(m.matrixWorld);
        geoms.push(g);
      }
      const merged = this._mergeGeoms(geoms);
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.castShadow = list.some(m => m.castShadow);
      mesh.receiveShadow = list.some(m => m.receiveShadow);
      mesh.name = 'merged-static';
      mesh.userData.room = parent.userData.room;
      parent.add(mesh);
      for (const m of list) {
        parent.remove(m);
        m.geometry?.dispose();
      }
      for (const g of geoms) g.dispose();
    }
  }

  _mergeGeoms(geoms) {
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'uv2']) {
      if (!geoms[0].getAttribute(name)) continue;
      const itemSize = geoms[0].getAttribute(name).itemSize;
      let len = 0;
      const arrs = [];
      for (const g of geoms) {
        const a = g.getAttribute(name).array;
        arrs.push(a); len += a.length;
      }
      const out = new Float32Array(len);
      let o = 0;
      for (const a of arrs) { out.set(a, o); o += a.length; }
      merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
    }
    let offset = 0, total = 0;
    const chunks = [];
    for (const g of geoms) {
      const posCount = g.getAttribute('position').count;
      let idx;
      if (g.index) idx = Array.from(g.index.array, i => i + offset);
      else { idx = new Array(posCount); for (let i = 0; i < posCount; i++) idx[i] = i + offset; }
      chunks.push(idx); total += idx.length; offset += posCount;
    }
    const out = new Uint32Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    merged.setIndex(new THREE.BufferAttribute(out, 1));
    merged.computeBoundingSphere();
    return merged;
  }

  _box(w, h, d, mat, x, y, z, opt = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    // uv2 for lightmaps (simple planar)
    const uv = g.getAttribute('uv');
    g.setAttribute('uv2', uv.clone());
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = !!opt.cast;
    m.receiveShadow = !!opt.receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    (opt.static ? this.staticGroup : this.dynGroup).add(m);
    if (opt.collide !== false && opt.collide !== undefined ? opt.collide : !!opt.collide) {
      this.boxes.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, z0: z - d / 2, z1: z + d / 2, solid: true, soft: !!opt.soft, mesh: m });
    } else if (opt.collide === true || (opt.static && opt.collide !== false && h > 0.2 && (w <= 8 && d <= 8 && (w < 20)))) {
      // explicit only
    }
    if (opt.collide === true) {
      // already pushed
    } else if (opt.collide !== false && h > 0.15 && (opt.static || opt.collide)) {
      // handled
    }
    return m;
  }

  // Fix: _box collide logic was messy. Provide addCollider used by _box when opt.collide is true.
  // Recreate cleaner add used above — many walls already pass collide:true.

  // ---------- queries ----------
  groundAt(x, z, fromY = 20) {
    // hatch holes
    for (const h of this.hatches) {
      if (!this.hatchOpen(h)) continue;
      if (Math.abs(x - h.x) < 0.6 && Math.abs(z - h.z) < 0.6) {
        // drop through this floor
        const below = h.type === 'roof' ? floorY('2') : floorY(h.from);
        if (fromY > below + 0.2 && fromY <= h.y + 0.4) {
          // continue to look below
          fromY = below + 0.05;
        }
      }
    }
    // destroyed soft-floor tiles drop through like hatches (highest first)
    if (this.floorChunks) {
      const holes = this.floorChunks.filter(fc => fc.destroyed)
        .sort((a, b) => (b.y || 0) - (a.y || 0));
      for (const fc of holes) {
        if (Math.abs(x - fc.x) <= (fc.hw || fc.w / 2) && Math.abs(z - fc.z) <= (fc.hd || fc.d / 2)) {
          const below = fc.below ?? (fc.y - 3);
          if (fromY > fc.y - 0.15 && fromY <= fc.y + 1.6) fromY = Math.min(fromY, below + 0.05);
        }
      }
    }
    // stairs
    for (const s of this.stairVols) {
      if (x < s.x0 - 0.02 || x > s.x1 + 0.02 || z < s.z0 - 0.02 || z > s.z1 + 0.02) continue;
      const alongZ = Math.abs(s.z1 - s.z0) >= Math.abs(s.x1 - s.x0);
      let t;
      if (alongZ) {
        t = s.dir.includes('z-') ? (s.z1 - z) / (s.z1 - s.z0) : (z - s.z0) / (s.z1 - s.z0);
      } else t = (x - s.x0) / (s.x1 - s.x0);
      t = Math.min(1, Math.max(0, t));
      const y = s.y0 + (s.y1 - s.y0) * t;
      if (y <= fromY + 0.6) return y;
    }
    // roof
    const b = BOUNDS.building;
    if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) {
      // inside footprint: pick highest floor <= fromY
      let best = null;
      if (fromY >= 6.1) return 6.2;
      for (const fl of FLOORS) {
        if (fl.y <= fromY + 0.35 && (best === null || fl.y >= best)) {
          // must be inside a room on this floor
          const room = ROOMS.find(r => r.floor === fl.id && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
          if (room) best = fl.y;
        }
      }
      if (best !== null) return best;
      // In a wall or doorway: highest floor slab at or below the hint,
      // so a basement query is never yanked up to y=0.
      let fallback = null;
      for (const fl of FLOORS) {
        if (fl.y <= fromY + 0.35 && (fallback === null || fl.y > fallback)) fallback = fl.y;
      }
      return fallback ?? 0;
    }
    return 0;
  }

  onStairs(p) {
    for (const s of this.stairVols) {
      if (p.x >= s.x0 && p.x <= s.x1 && p.z >= s.z0 && p.z <= s.z1 && p.y >= s.y0 - 0.3 && p.y <= s.y1 + 0.6) return s;
    }
    return null;
  }

  ceilingAt(x, z, fromY) {
    const b = BOUNDS.building;
    if (x <= b.x0 || x >= b.x1 || z <= b.z0 || z >= b.z1) return 40;
    for (const fl of FLOORS) {
      const top = fl.y + fl.h;
      if (top > fromY + 0.2) {
        const room = ROOMS.find(r => r.floor === fl.id && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
        if (room) {
          const hole = this.floorChunks?.find(fc => fc.destroyed && fc.floor === fl.id
            && Math.abs(x - fc.x) <= (fc.hw || fc.w / 2) && Math.abs(z - fc.z) <= (fc.hd || fc.d / 2)
            && Math.abs(fc.y - top) < 1.2);
          if (hole) continue;
          return top - 0.08;
        }
      }
    }
    if (fromY >= 6) return 40;
    return 6.2;
  }

  pointInSolid(x, y, z, r = COL_R, h = 1.6) {
    const y1 = y + h;
    for (const b of this.boxes) {
      if (b.solid === false) continue;
      if (y1 < b.y0 || y > b.y1) continue;
      if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return b;
    }
    return null;
  }

  resolve(pos, r, h) {
    let x = pos.x, z = pos.z, y = pos.y;
    for (let i = 0; i < 4; i++) {
      const hit = this.pointInSolid(x, y + 0.05, z, r, h - 0.08);
      if (!hit) break;
      const cx = Math.min(Math.max(x, hit.x0), hit.x1);
      const cz = Math.min(Math.max(z, hit.z0), hit.z1);
      let dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d < 1e-5) {
        const left = x - hit.x0, right = hit.x1 - x, down = z - hit.z0, up = hit.z1 - z;
        const m = Math.min(left, right, down, up);
        if (m === left) x = hit.x0 - r;
        else if (m === right) x = hit.x1 + r;
        else if (m === down) z = hit.z0 - r;
        else z = hit.z1 + r;
      } else {
        const s = (r - d) / d + 0.001;
        x += dx * s; z += dz * s;
      }
    }
    pos.x = x; pos.z = z;
    return pos;
  }

  isOutside(x, z, y = 1) {
    const b = BOUNDS.building;
    // treat as outside if not in the footprint, or on roof edge
    if (x < b.x0 - 0.1 || x > b.x1 + 0.1 || z < b.z0 - 0.1 || z > b.z1 + 0.1) return true;
    // interior of footprint is inside unless on roof beyond walls... roof is "outside" for rappel from roof edge
    if (y >= 6.15) return true;
    return false;
  }

  findRappelSpot(pos, yaw, maxDist = 2.4) {
    if (!this.isOutside(pos.x, pos.z, pos.y)) return null;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bestD = maxDist;
    for (const f of this.facades) {
      // distance from point to plane of facade
      const px = f.alongX ? 0 : (f.faceX - pos.x) * f.nx;
      const pz = f.alongX ? (f.faceZ - pos.z) * f.nz : 0;
      const dist = f.alongX ? (pos.z - f.faceZ) * f.nz : (pos.x - f.faceX) * f.nx;
      // we want to be outside, facing the wall (dot with normal should be toward wall, i.e. looking into -wait)
      // standing outside, yaw should face the wall, so forward dot inward normal is positive
      const inwardX = -f.nx, inwardZ = -f.nz; // from outside toward building? nx is outward
      // nx is outward, so facing the wall means forward · -outward ≈ 1, i.e. forward · outward < 0
      const faceDot = fx * f.nx + fz * f.nz;
      if (faceDot < 0.35) continue; // not facing this facade (outward normal: we look toward wall if we look along -outward? 
      // If north facade nz=-1 (outward north), we stand at z more negative, look +z (fz>0), forward·outward = fz*(-1) < 0.
      // So we should require forward · outward < -0.35 (looking against the outward normal).
    }
    // redo with correct facing
    for (const f of this.facades) {
      const lookingIn = fx * (-f.nx) + fz * (-f.nz);
      if (lookingIn < 0.35) continue;
      let hitX, hitZ, along;
      if (f.alongX) {
        const t = (f.faceZ - pos.z) / (fz || 1e-6);
        if (t < 0 || t > maxDist + 0.4) continue;
        hitX = pos.x + fx * t; hitZ = f.faceZ;
        if (hitX < f.x0 + 0.3 || hitX > f.x1 - 0.3) continue;
        along = Math.abs(hitZ - pos.z);
      } else {
        const t = (f.faceX - pos.x) / (fx || 1e-6);
        if (t < 0 || t > maxDist + 0.4) continue;
        hitX = f.faceX; hitZ = pos.z + fz * t;
        if (hitZ < f.z0 + 0.3 || hitZ > f.z1 - 0.3) continue;
        along = Math.abs(hitX - pos.x);
      }
      if (along > bestD + 0.15) continue;
      // must be standing just outside
      const outside = f.alongX ? (pos.z - f.faceZ) * f.nz > 0.05 : (pos.x - f.faceX) * f.nx > 0.05;
      if (!outside) continue;
      bestD = along;
      best = { x: hitX + f.nx * 0.45, z: hitZ + f.nz * 0.45, y: pos.y, nx: f.nx, nz: f.nz, facade: f, topY: f.y1, botY: Math.max(0, f.y0) };
    }
    return best;
  }

  rappelSpotAtWindow(win, standOff = 0.5) {
    if (!win) return null;
    const nx = win.nx, nz = win.nz;
    return {
      x: win.x + nx * standOff, z: win.z + nz * standOff, y: 0,
      nx, nz, facade: this.facades.find(f => Math.abs(f.nx - nx) < 0.1 && Math.abs(f.nz - nz) < 0.1) || this.facades[0],
      topY: 6.2, botY: 0, window: win,
    };
  }

  alignedWindow(rp, slack = 0.7) {
    if (!rp) return null;
    for (const w of this.windows) {
      if (!w.exterior) continue;
      const along = Math.abs(w.nx) > 0.5;
      const sameWall = along ? Math.abs(w.x - (rp.x - rp.nx * 0.45)) < 0.4 : Math.abs(w.z - (rp.z - rp.nz * 0.45)) < 0.4;
      if (!sameWall) continue;
      const lateral = along ? Math.abs(w.z - rp.z) : Math.abs(w.x - rp.x);
      if (lateral > slack + w.w / 2) continue;
      const y = rp.y ?? 0;
      if (y + 1.2 < w.sillY || y > w.sillY + w.h + 0.4) continue;
      return w;
    }
    return null;
  }


  _buildGaps() {
    this.droneGaps = [];
    const metal = this.gfx.mat?.('metal', { repeat: 1, color: 0x3a3d42 }) || this.gfx.basic(0x3a3d42, { roughness: 0.55, metalness: 0.6 });
    const wood = this.gfx.mat?.('table', { repeat: 1, color: 0x5a3a22 }) || this.gfx.basic(0x5a3a22, { roughness: 0.8, metalness: 0.1 });
    for (const g of DRONE_GAPS) {
      const fl = floorY(g.floor);
      const y0 = fl + g.y0, y1 = fl + g.y1;
      const h = y1 - y0, midY = (y0 + y1) / 2;
      const alongX = g.alongX;
      const facade = this._facadeSide?.(g.x, g.z);
      const room = facade ? null : this._roomAt(g.x, g.z, g.floor);
      const frameMat = g.kind === 'board' ? wood : metal;
      const w = g.w, thick = 0.06;
      // Frame around the opening — collision already punched via _openingSpans.
      const fw = alongX ? w + 0.06 : thick;
      const fd = alongX ? thick : w + 0.06;
      const frame = this._box(fw, h + 0.05, fd, frameMat, g.x, midY, g.z, { static: true, collide: false, receive: true, room: room?.id, facade });
      // One slat / broken board so the hole reads as a vent, not a missing wall.
      if (g.kind === 'vent' || g.kind === 'window-corner') {
        this._box(alongX ? w * 0.7 : 0.02, 0.02, alongX ? 0.02 : w * 0.7, frameMat, g.x, midY, g.z, { static: true, collide: false, room: room?.id, facade });
      } else if (g.kind === 'board') {
        this._box(alongX ? w * 0.45 : 0.03, 0.04, alongX ? 0.03 : w * 0.45, wood, g.x + (alongX ? -0.08 : 0), midY + 0.02, g.z + (alongX ? 0 : -0.08), { static: true, collide: false, room: room?.id, facade });
      }
      this.droneGaps.push({
        ...g, y0, y1, midY, mesh: frame,
        x: g.x, z: g.z, alongX, w,
      });
    }
  }

  nearestDroneGap(pos, toward = null) {
    let best = null, bd = 1e9;
    for (const g of this.droneGaps || []) {
      const d = Math.hypot(g.x - pos.x, g.z - pos.z);
      let score = d;
      if (toward) {
        const after = Math.hypot(g.x - toward.x, g.z - toward.z);
        const now = Math.hypot(pos.x - toward.x, pos.z - toward.z);
        if (after < now - 0.4) score *= 0.65;
      }
      const dy = Math.abs(((g.y0 + g.y1) / 2) - (pos.y || 0));
      if (dy > 2.2) continue;
      if (score < bd) { bd = score; best = g; }
    }
    return best;
  }

  nearestDoor(pos, max = 1.6) {
    let best = null, bd = max;
    for (const d of this.doors) {
      const dist = Math.hypot(d.x - pos.x, d.z - pos.z);
      if (dist < bd && Math.abs((pos.y || 0) - d.y) < 2.2) { bd = dist; best = d; }
    }
    return best;
  }
}


function applyBoxUVScale(g, w, h, d, tile = 2) {
  const uv = g.getAttribute('uv');
  if (!uv) return;
  // BoxGeometry faces: +X -X +Y -Y +Z -Z (4 verts each)
  const faceU = [d, d, w, w, w, w];
  const faceV = [h, h, d, d, h, h];
  const arr = uv.array;
  for (let f = 0; f < 6; f++) {
    const us = Math.max(0.05, faceU[f] / tile);
    const vs = Math.max(0.05, faceV[f] / tile);
    for (let i = 0; i < 4; i++) {
      arr[(f * 4 + i) * 2] *= us;
      arr[(f * 4 + i) * 2 + 1] *= vs;
    }
  }
  uv.needsUpdate = true;
}

World.prototype._box = function(w, h, d, mat, x, y, z, opt = {}) {
  const g = new THREE.BoxGeometry(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d));
  if (!opt.lockUV) applyBoxUVScale(g, w, h, d, 2);
  const uv = g.getAttribute('uv');
  g.setAttribute('uv2', uv.clone());
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  if (opt.rotY) m.rotation.y = opt.rotY;
  m.castShadow = !!opt.cast;
  m.receiveShadow = !!opt.receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  m.userData.bakeId = 'box_' + String(this._bakeSeq++).padStart(4, '0');
  m.userData.kind = opt.kind || m.userData.kind;
  m.userData.room = opt.room;
  m.userData.noMerge = !!opt.noMerge;
  if (opt.facade && this.facadeGroups[opt.facade]) this.facadeGroups[opt.facade].add(m);
  else if (opt.room && this.roomGroups[opt.room]) this.roomGroups[opt.room].add(m);
  else (opt.static ? this.staticGroup : this.dynGroup).add(m);
  if (opt.collide) {
    this.boxes.push({
      x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, z0: z - d / 2, z1: z + d / 2,
      solid: true, soft: !!opt.soft, mesh: m,
    });
  }
  if (opt.bake !== false && opt.static !== false) {
    this._bakeList.push({
      id: m.userData.bakeId, w, h, d, x, y, z, rotY: opt.rotY || 0,
      kind: opt.kind || 'box', room: opt.room || '', receive: !!opt.receive, cast: !!opt.cast,
      mat: (mat && (mat.userData?.texName || mat.name)) || '',
    });
  }
  return m;
};

World.prototype._cyl = function(r, h, mat, x, y, z, opt = {}) {
  const g = new THREE.CylinderGeometry(opt.rTop ?? r, r, Math.max(0.02, h), opt.seg || 10);
  const uv = g.getAttribute('uv');
  if (uv) g.setAttribute('uv2', uv.clone());
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  if (opt.rotY) m.rotation.y = opt.rotY;
  if (opt.rotX) m.rotation.x = opt.rotX;
  if (opt.rotZ) m.rotation.z = opt.rotZ;
  m.castShadow = !!opt.cast;
  m.receiveShadow = !!opt.receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  m.userData.kind = opt.kind || 'cyl';
  m.userData.room = opt.room;
  m.userData.noMerge = !!opt.noMerge;
  if (opt.facade && this.facadeGroups[opt.facade]) this.facadeGroups[opt.facade].add(m);
  else if (opt.room && this.roomGroups[opt.room]) this.roomGroups[opt.room].add(m);
  else (opt.static === false ? this.dynGroup : this.staticGroup).add(m);
  if (opt.collide) {
    this.boxes.push({
      x0: x - r, x1: x + r, y0: y - h / 2, y1: y + h / 2, z0: z - r, z1: z + r,
      solid: true, soft: !!opt.soft, mesh: m,
    });
  }
  return m;
};

World.prototype._decal = function(w, h, mat, x, y, z, opt = {}) {
  const g = new THREE.PlaneGeometry(w, h);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  if (opt.rotY) m.rotation.y = opt.rotY;
  if (opt.rotX) m.rotation.x = opt.rotX;
  if (opt.rotZ) m.rotation.z = opt.rotZ;
  m.receiveShadow = !!opt.receive;
  m.castShadow = false;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  m.userData.kind = opt.kind || 'decal';
  m.userData.room = opt.room;
  m.userData.noMerge = true;
  if (opt.room && this.roomGroups[opt.room]) this.roomGroups[opt.room].add(m);
  else this.staticGroup.add(m);
  return m;
};

World.prototype._roomAt = function(x, z, floor) {
  let best = null, bestD = 1e9, loose = null, looseD = 1e9;
  const pad = 0.7;
  for (const r of ROOMS) {
    if (floor && r.floor !== floor) continue;
    const d = Math.hypot(x - (r.x0 + r.x1) / 2, z - (r.z0 + r.z1) / 2);
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
      if (d < bestD) { bestD = d; best = r; }
    } else if (x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad) {
      if (d < looseD) { looseD = d; loose = r; }
    }
  }
  return best || loose;
};

World.prototype._facadeSide = function(x, z) {
  const b = BOUNDS.building;
  const ds = [
    ['z0', Math.abs(z - b.z0)],
    ['z1', Math.abs(z - b.z1)],
    ['x0', Math.abs(x - b.x0)],
    ['x1', Math.abs(x - b.x1)],
  ];
  ds.sort((a, b) => a[1] - b[1]);
  return ds[0][1] < 1.25 ? ds[0][0] : null;
};

World.prototype._initRoomGroups = function() {
  this.roomGroups = {};
  this.roomAABB = {};
  this.facadeGroups = {};
  for (const side of ['z0', 'z1', 'x0', 'x1']) {
    const g = new THREE.Group();
    g.name = 'facade-' + side;
    this.group.add(g);
    this.facadeGroups[side] = g;
  }
  for (const r of ROOMS) {
    const fl = FLOORS.find(f => f.id === r.floor);
    const g = new THREE.Group();
    g.name = 'room-' + r.id;
    g.userData.room = r.id;
    this.group.add(g);
    this.roomGroups[r.id] = g;
    this.roomAABB[r.id] = new THREE.Box3(
      new THREE.Vector3(r.x0, fl.y, r.z0),
      new THREE.Vector3(r.x1, fl.y + fl.h, r.z1),
    );
  }
};

World.prototype.addInstance = function(key, proto, pose) {
  if (!this._instances.has(key)) this._instances.set(key, { proto, poses: [] });
  this._instances.get(key).poses.push(pose);
};

World.prototype.flushInstances = function() {
  const _boxG = {};
  for (const [key, rec] of this._instances) {
    const { proto, poses } = rec;
    if (!poses.length) continue;
    const cyl = proto.shape === 'cyl';
    if (poses.length === 1 && !cyl) {
      const p = poses[0];
      this._box(proto.w, proto.h, proto.d, proto.mat, p.x, p.y, p.z, {
        static: true, collide: !!proto.collide, receive: true, cast: !!proto.cast,
        room: proto.room, rotY: p.rotY, kind: key,
      });
      continue;
    }
    if (poses.length === 1 && cyl) {
      const p = poses[0];
      this._cyl(proto.r ?? proto.w / 2, proto.h, proto.mat, p.x, p.y, p.z, {
        static: true, collide: !!proto.collide, receive: true, cast: !!proto.cast,
        room: proto.room, rotY: p.rotY, rotX: p.rotX, rotZ: p.rotZ,
        rTop: proto.rTop, seg: proto.seg, kind: key,
      });
      continue;
    }
    const geom = cyl
      ? new THREE.CylinderGeometry(proto.rTop ?? proto.r ?? proto.w / 2, proto.r ?? proto.w / 2, Math.max(0.02, proto.h), proto.seg || 10)
      : new THREE.BoxGeometry(Math.max(0.02, proto.w), Math.max(0.02, proto.h), Math.max(0.02, proto.d));
    const uv = geom.getAttribute('uv');
    if (uv) geom.setAttribute('uv2', uv.clone());
    const mesh = new THREE.InstancedMesh(geom, proto.mat, poses.length);
    mesh.castShadow = !!proto.cast;
    mesh.receiveShadow = true;
    mesh.userData.instanced = true;
    mesh.userData.kind = key;
    mesh.userData.noMerge = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    poses.forEach((p, i) => {
      pos.set(p.x, p.y, p.z);
      e.set(p.rotX || 0, p.rotY || 0, p.rotZ || 0);
      q.setFromEuler(e);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);
      if (proto.collide) {
        const hw = (cyl ? (proto.r ?? proto.w / 2) : proto.w / 2);
        const hh = proto.h / 2, hd = cyl ? hw : proto.d / 2;
        this.boxes.push({ x0: p.x - hw, x1: p.x + hw, y0: p.y - hh, y1: p.y + hh, z0: p.z - hd, z1: p.z + hd, solid: true, mesh });
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    const host = proto.room && this.roomGroups[proto.room] ? this.roomGroups[proto.room] : this.staticGroup;
    host.add(mesh);
  }
  this._instances.clear();
};

World.prototype.cull = function(camera) {
  if (!camera) return;
  if (!this._frustum) this._frustum = new THREE.Frustum();
  if (!this._cullMat) this._cullMat = new THREE.Matrix4();
  this._cullMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  this._frustum.setFromProjectionMatrix(this._cullMat);
  const cp = camera.position;
  const b = BOUNDS.building;
  const outside = cp.x < b.x0 - 1.2 || cp.x > b.x1 + 1.2 || cp.z < b.z0 - 1.2 || cp.z > b.z1 + 1.2;
  const camFloor = cp.y < 1.15 ? 'B' : (cp.y < 4.2 ? '1' : '2');
  for (const r of ROOMS) {
    const g = this.roomGroups[r.id];
    if (!g) continue;
    const box = this.roomAABB[r.id];
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const dist = Math.hypot(cp.x - cx, cp.z - cz);
    const close = cp.x > r.x0 - 2.2 && cp.x < r.x1 + 2.2 && cp.z > r.z0 - 2.2 && cp.z < r.z1 + 2.2
      && cp.y > box.min.y - 1.2 && cp.y < box.max.y + 1.8;
    const sameBand = cp.y > box.min.y - 2.5 && cp.y < box.max.y + 2.5;
    if (outside) {
      const pad = 2.5;
      const onNear = (cp.z < b.z0 && r.z0 < b.z0 + pad)
        || (cp.z > b.z1 && r.z1 > b.z1 - pad)
        || (cp.x < b.x0 && r.x0 < b.x0 + pad)
        || (cp.x > b.x1 && r.x1 > b.x1 - pad);
      g.visible = onNear && r.floor === camFloor && dist < 12 && this._frustum.intersectsBox(box);
    } else {
      g.visible = close || (sameBand && dist < 14 && this._frustum.intersectsBox(box));
    }
  }
  for (const [side, fg] of Object.entries(this.facadeGroups || {})) {
    if (!fg) continue;
    if (!outside) { fg.visible = true; continue; }
    const onNear = (side === 'z0' && cp.z < b.z0)
      || (side === 'z1' && cp.z > b.z1)
      || (side === 'x0' && cp.x < b.x0)
      || (side === 'x1' && cp.x > b.x1);
    fg.visible = onNear;
  }
  for (const o of this.dynGroup?.children || []) {
    if (o.userData?.feedHide) { o.visible = false; continue; }
    const p = o.position;
    if (outside) {
      const onNear = (cp.z < b.z0 && p.z < b.z0 + 1.5)
        || (cp.z > b.z1 && p.z > b.z1 - 1.5)
        || (cp.x < b.x0 && p.x < b.x0 + 1.5)
        || (cp.x > b.x1 && p.x > b.x1 - 1.5);
      o.visible = onNear;
    } else {
      o.visible = true;
    }
  }
  // Hide operators parked deep inside when the camera is in the street.
  const B = BOUNDS.building;
  const outsideOps = cp.x < B.x0 - 1.2 || cp.x > B.x1 + 1.2 || cp.z < B.z0 - 1.2 || cp.z > B.z1 + 1.2;
  const scene = this.gfx?.scene;
  if (!this._cullDir) this._cullDir = new THREE.Vector3();
  camera.getWorldDirection(this._cullDir);
  if (scene) {
    for (const o of scene.children) {
      if (!o.name || o.name.indexOf('op-') !== 0) continue;
      if (!outsideOps) { o.visible = true; continue; }
      const p = o.position;
      const deep = p.x > B.x0 + 0.8 && p.x < B.x1 - 0.8 && p.z > B.z0 + 0.8 && p.z < B.z1 - 0.8;
      const dx = p.x - cp.x, dz = p.z - cp.z;
      const dist = Math.hypot(dx, dz);
      const ahead = this._cullDir.x * dx + this._cullDir.z * dz > -1.5;
      if (!this._cullBox) this._cullBox = new THREE.Box3();
      this._cullBox.setFromObject(o);
      const inView = this._cullBox.isEmpty() ? ahead : this._frustum.intersectsBox(this._cullBox);
      o.visible = !deep && dist < 8 && ahead && inView;
    }
  }
};

World.prototype._buildWindowFrames = function() {
  const mat = this.gfx.mat('table', { repeat: 1, color: 0x3e2a1c });
  for (const w of this.windows) {
    const alongX = w.alongX;
    const t = 0.05, d = 0.1;
    const y0 = w.sillY, y1 = w.sillY + w.h;
    const cx = w.x, cz = w.z;
    const facade = this._facadeSide(cx, cz);
    const room = facade ? null : this._roomAt(cx, cz, w.floor);
    const opt = { static: true, collide: false, receive: true, kind: 'frame', room: room?.id, facade };
    if (alongX) {
      this._box(w.w + t * 2, t, d, mat, cx, y0, cz, opt);
      this._box(w.w + t * 2, t, d, mat, cx, y1, cz, opt);
      this._box(t, w.h, d, mat, cx - w.w / 2, (y0 + y1) / 2, cz, opt);
      this._box(t, w.h, d, mat, cx + w.w / 2, (y0 + y1) / 2, cz, opt);
    } else {
      this._box(d, t, w.w + t * 2, mat, cx, y0, cz, opt);
      this._box(d, t, w.w + t * 2, mat, cx, y1, cz, opt);
      this._box(d, w.h, t, mat, cx, (y0 + y1) / 2, cz - w.w / 2, opt);
      this._box(d, w.h, t, mat, cx, (y0 + y1) / 2, cz + w.w / 2, opt);
    }
  }
};

World.prototype.exportBakeList = function() { return this._bakeList.slice(); };

World.prototype.applyBakedLighting = async function() {
  if (!this.gfx?.lightMap) return;
  const uv = this.gfx.lightMapUV;
  const apply = (obj) => {
    obj.traverse(m => {
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat.isMeshStandardMaterial) continue;
        mat.lightMap = this.gfx.lightMap;
        mat.lightMapIntensity = this.gfx.lightMapIntensity ?? 1.15;
        if (this.gfx.aoMap) { mat.aoMap = this.gfx.aoMap; mat.aoMapIntensity = 0.85; }
        mat.needsUpdate = true;
      }
      const id = m.userData.bakeId;
      if (uv && id && uv[id] && m.geometry) {
        const arr = uv[id];
        m.geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(arr, 2));
      }
    });
  };
  apply(this.group);
};
