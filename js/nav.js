import { ROOMS, STAIRS, HATCHES, WINDOWS, FLOORS, BOUNDS, floorY } from './map.js?v=iv-4.1.0';

const CS = 0.6;

/**
 * Runtime nav. Prefers a recast-navigation-js baked poly mesh
 * (assets/nav/halcyon.json) and always keeps off-mesh links for
 * stairs, hatches, window vaults and facade rappel. Falls back to
 * the v1 room grid if the bake is missing. When a wall or hatch is
 * breached, a local portal is added so bots can path through.
 */
export class Nav {
  constructor(world) {
    this.world = world;
    this.nodes = [];
    this.grid = new Map();
    this.links = [];
    this._ready = this._loadBake().then(() => this.build()).catch(() => this.build());
  }
  get ready() { return this._ready; }

  key(i, j, fl) { return fl + ':' + i + ':' + j; }

  async _loadBake() {
    try {
      const r = await fetch('assets/nav/halcyon.json', { cache: 'no-store' });
      if (r.ok) this.bake = await r.json();
    } catch { this.bake = null; }
  }

  build() {
    this.nodes = []; this.grid.clear(); this.links = [];
    if (this.bake?.nodes?.length) this._fromBake();
    else this._fromGrid();
    this._addStairLinks();
    this._addHatchLinks();
    this._addVaultLinks();
    this._addRappelLinks();
  }

  _fromBake() {
    for (const n of this.bake.nodes) {
      const node = { x: n.x, y: n.y, z: n.z, i: n.i, j: n.j, floor: n.floor, room: n.room, nb: [] };
      this.nodes.push(node);
      if (n.i != null) this.grid.set(this.key(n.i, n.j, n.floor), node);
    }
    const by = new Map(this.nodes.map((n, i) => [n.i + ':' + n.j + ':' + n.floor, n]));
    const bak = this.bake.nodes;
    bak.forEach((src, i) => {
      const a = this.nodes[i];
      for (const idx of (src.nb || [])) {
        const b = this.nodes[idx];
        if (b && !a.nb.includes(b)) a.nb.push(b);
      }
    });
  }

  _fromGrid() {
    for (const room of ROOMS) {
      const y = floorY(room.floor);
      for (let x = room.x0 + 0.4; x < room.x1 - 0.4; x += CS) {
        for (let z = room.z0 + 0.4; z < room.z1 - 0.4; z += CS) {
          const i = Math.round(x / CS), j = Math.round(z / CS);
          const k = this.key(i, j, room.floor);
          if (this.grid.has(k)) continue;
          if (this.world.pointInSolid(x, y + 0.2, z, 0.2, 1.4)) continue;
          const n = { x, y, z, i, j, floor: room.floor, room: room.id, nb: [] };
          this.grid.set(k, n);
          this.nodes.push(n);
        }
      }
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const n of this.nodes) {
      for (const [di, dj] of dirs) {
        const o = this.grid.get(this.key(n.i + di, n.j + dj, n.floor));
        if (o) n.nb.push(o);
      }
    }
  }

  _link(a, b, kind) {
    if (!a || !b) return;
    if (!a.nb.includes(b)) a.nb.push(b);
    if (!b.nb.includes(a)) b.nb.push(a);
    this.links.push({ a, b, kind });
  }

  _addStairLinks() {
    for (const s of STAIRS) {
      const a = this.nearest((s.x0 + s.x1) / 2, s.y0, (s.z0 + s.z1) / 2);
      const b = this.nearest((s.x0 + s.x1) / 2, s.y1, (s.z0 + s.z1) / 2);
      this._link(a, b, 'stair');
    }
  }
  _addHatchLinks() {
    for (const h of HATCHES) {
      if (h.to === 'roof') continue;
      if (!this.world.hatchOpen(h)) continue;
      const a = this.nearest(h.x, floorY(h.from), h.z);
      const b = this.nearest(h.x, floorY(h.to), h.z);
      this._link(a, b, 'hatch');
    }
  }
  _addVaultLinks() {
    const list = this.world.windows?.length ? this.world.windows : WINDOWS;
    for (const w of list) {
      const y = (w.sillY != null ? w.sillY : floorY(w.floor) + (w.sill || 0.9)) + 0.2;
      const nx = w.nx || (w.alongX ? 0 : Math.sign(w.x || 1));
      const nz = w.nz || (w.alongX ? Math.sign(w.z || 1) : 0);
      const outside = this.nearest(w.x + nx * 1.1, 0, w.z + nz * 1.1);
      const inside = this.nearest(w.x - nx * 1.1, floorY(w.floor), w.z - nz * 1.1);
      this._link(outside, inside, 'vault');
    }
  }
  _addRappelLinks() {
    const b = BOUNDS.building;
    const faces = [
      { x: 0, z: b.z0, nx: 0, nz: -1, x0: b.x0 + 2, x1: b.x1 - 2, alongX: true },
      { x: 0, z: b.z1, nx: 0, nz: 1, x0: b.x0 + 2, x1: b.x1 - 2, alongX: true },
      { x: b.x0, z: 0, nx: -1, nz: 0, z0: b.z0 + 2, z1: b.z1 - 2, alongX: false },
      { x: b.x1, z: 0, nx: 1, nz: 0, z0: b.z0 + 2, z1: b.z1 - 2, alongX: false },
    ];
    for (const f of faces) {
      const samples = f.alongX
        ? [f.x0, (f.x0 + f.x1) / 2, f.x1]
        : [f.z0, (f.z0 + f.z1) / 2, f.z1];
      for (const s of samples) {
        const x = f.alongX ? s : f.x + f.nx * 0.8;
        const z = f.alongX ? f.z + f.nz * 0.8 : s;
        const ground = this.nearest(x, 0, z);
        const roof = this.nearest(x - f.nx * 1.4, 6.2, z - f.nz * 1.4);
        this._link(ground, roof, 'rappel');
      }
    }
  }

  onBreach(ch) {
    if (!ch) return;
    // Open a portal through the destroyed panel / hatch.
    if (ch.hatch) { this._addHatchLinks(); return; }
    if (ch.floorTile) {
      const above = this.nearest(ch.x, ch.y, ch.z);
      const below = this.nearest(ch.x, ch.below ?? (ch.y - 3), ch.z);
      if (above && below && above !== below) this._link(above, below, 'breach-floor');
      const mid = { x: ch.x, y: ch.below ?? (ch.y - 3), z: ch.z, floor: null, room: 'breach-floor', nb: [] };
      this.nodes.push(mid);
      if (above) this._link(mid, above, 'breach-floor');
      if (below) this._link(mid, below, 'breach-floor');
      return;
    }
    const sides = this._nodesAround(ch, 1.2);
    for (let i = 0; i < sides.length; i++) {
      for (let j = i + 1; j < sides.length; j++) {
        const a = sides[i], b = sides[j];
        const dx = a.x - b.x, dz = a.z - b.z;
        // only connect opposite sides of the wall
        const alongX = ch.w > ch.d;
        const opposite = alongX ? Math.sign(a.z - ch.z) !== Math.sign(b.z - ch.z) : Math.sign(a.x - ch.x) !== Math.sign(b.x - ch.x);
        if (opposite) this._link(a, b, 'breach');
      }
    }
    // also allow walking into the opening: register a node at the chunk centre
    const mid = { x: ch.x, y: ch.y, z: ch.z, i: Math.round(ch.x / CS), j: Math.round(ch.z / CS), floor: ch.floor, room: 'breach', nb: [] };
    this.nodes.push(mid);
    for (const n of sides) this._link(mid, n, 'breach');
  }

  onReinforce(/* ch */) {
    // Reinforced walls stay solid; no new links.
  }

  _nodesAround(ch, r) {
    return this.nodes.filter(n => n.floor === ch.floor && Math.hypot(n.x - ch.x, n.z - ch.z) < r + 0.6);
  }

  rebuildHatches() { this._addHatchLinks(); }

  nearest(x, y, z) {
    let best = null, bd = 9e9;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + (n.y - y) ** 2 * 0.4;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  path(ax, ay, az, bx, by, bz) {
    const start = this.nearest(ax, ay, az), goal = this.nearest(bx, by, bz);
    if (!start || !goal) return [];
    if (start === goal) return [goal];
    const open = [start], came = new Map(), g = new Map(), f = new Map();
    g.set(start, 0); f.set(start, heur(start, goal));
    const seen = new Set();
    while (open.length) {
      let bi = 0, bf = f.get(open[0]) || 1e9;
      for (let i = 1; i < open.length; i++) {
        const fv = f.get(open[i]) || 1e9;
        if (fv < bf) { bf = fv; bi = i; }
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) return unwind(came, cur);
      seen.add(cur);
      for (const nb of cur.nb) {
        if (seen.has(nb)) continue;
        const tg = (g.get(cur) || 0) + Math.hypot(nb.x - cur.x, nb.z - cur.z, nb.y - cur.y);
        if (tg < (g.get(nb) ?? 1e9)) {
          came.set(nb, cur); g.set(nb, tg); f.set(nb, tg + heur(nb, goal));
          if (!open.includes(nb)) open.push(nb);
        }
      }
      if (seen.size > 2500) break;
    }
    return [];
  }
}
function heur(a, b) { return Math.hypot(a.x - b.x, a.z - b.z, a.y - b.y); }
function unwind(came, cur) {
  const out = [cur];
  while (came.has(cur)) { cur = came.get(cur); out.push(cur); }
  return out.reverse();
}
