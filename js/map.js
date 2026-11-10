/** Halcyon Press — original two-floor + basement typography workshop. */
export const FLOORS = [
  { id: 'B', y: -3.2, h: 3.2, name: 'Basement' },
  { id: '1', y: 0.0,  h: 3.2, name: 'Ground' },
  { id: '2', y: 3.2,  h: 3.0, name: 'Upper' },
];

const BX0 = -11, BX1 = 11, BZ0 = -9, BZ1 = 11;

/** Rooms: axis-aligned, inclusive of interior. */
export const ROOMS = [
  // Ground
  { id: 'shop', name: 'Front Shop', floor: '1', x0: BX0, x1: -3, z0: BZ0, z1: -2.2, purpose: 'shop' },
  { id: 'lobby', name: 'Lobby', floor: '1', x0: -3, x1: 3.5, z0: BZ0, z1: -2.2, purpose: 'lobby' },
  { id: 'office', name: 'Front Office', floor: '1', x0: 3.5, x1: BX1, z0: BZ0, z1: -2.2, purpose: 'office' },
  { id: 'press', name: 'Press Floor', floor: '1', x0: BX0, x1: 1.2, z0: -2.2, z1: 6.2, purpose: 'press', site: 'press' },
  { id: 'bindery', name: 'Bindery', floor: '1', x0: 1.2, x1: BX1, z0: -2.2, z1: 6.2, purpose: 'bindery' },
  { id: 'loading', name: 'Loading Bay', floor: '1', x0: BX0, x1: -3.2, z0: 6.2, z1: BZ1, purpose: 'loading' },
  { id: 'stair1', name: 'Stair Hall', floor: '1', x0: -3.2, x1: 4.2, z0: 6.2, z1: BZ1, purpose: 'stairs' },
  { id: 'wash', name: 'Washroom', floor: '1', x0: 4.2, x1: BX1, z0: 6.2, z1: BZ1, purpose: 'bath' },

  // Basement
  { id: 'paper', name: 'Paper Store', floor: 'B', x0: BX0, x1: 0.8, z0: BZ0, z1: 5.0, purpose: 'storage', site: 'paper' },
  { id: 'ink', name: 'Ink Vault', floor: 'B', x0: 0.8, x1: BX1, z0: BZ0, z1: 5.0, purpose: 'vault', site: 'ink' },
  { id: 'boiler', name: 'Boiler', floor: 'B', x0: BX0, x1: -3.2, z0: 5.0, z1: BZ1, purpose: 'plant' },
  { id: 'stairb', name: 'Basement Stairs', floor: 'B', x0: -3.2, x1: 4.2, z0: 5.0, z1: BZ1, purpose: 'stairs' },
  { id: 'archive', name: 'Archive', floor: 'B', x0: 4.2, x1: BX1, z0: 5.0, z1: BZ1, purpose: 'archive' },

  // Upper — Type Studio sits over Press for a hatch rotate
  { id: 'studio', name: 'Type Studio', floor: '2', x0: BX0, x1: 1.2, z0: BZ0, z1: 6.2, purpose: 'studio', site: 'studio' },
  { id: 'loft', name: 'Paper Loft', floor: '2', x0: 1.2, x1: BX1, z0: BZ0, z1: 6.2, purpose: 'loft' },
  { id: 'lab', name: 'Conservation Lab', floor: '2', x0: BX0, x1: -3.2, z0: 6.2, z1: BZ1, purpose: 'lab' },
  { id: 'stair2', name: 'Upper Hall', floor: '2', x0: -3.2, x1: 4.2, z0: 6.2, z1: BZ1, purpose: 'stairs' },
  { id: 'apt', name: "Manager's Rooms", floor: '2', x0: 4.2, x1: BX1, z0: 6.2, z1: BZ1, purpose: 'apt' },
];

export const SITE_PAIRS = [
  { id: 'vault_store', name: 'Ink Vault / Paper Store', sites: ['ink', 'paper'] },
  { id: 'studio_press', name: 'Type Studio / Press Floor', sites: ['studio', 'press'] },
];

export const SITES = {
  ink:    { id: 'ink', name: 'Ink Vault', room: 'ink', plant: { x: 6.0, z: -2.0, floor: 'B' } },
  paper:  { id: 'paper', name: 'Paper Store', room: 'paper', plant: { x: -6.0, z: -2.0, floor: 'B' } },
  studio: { id: 'studio', name: 'Type Studio', room: 'studio', plant: { x: -5.5, z: 1.5, floor: '2' } },
  press:  { id: 'press', name: 'Press Floor', room: 'press', plant: { x: -5.5, z: 1.5, floor: '1' } },
};

/** Doors: openings in walls. alongX means the door faces Z (wall runs along X). */
export const DOORS = [
  // Ground north hallway
  { id: 'd-shop-lobby', floor: '1', x: -3, z: -5.6, alongX: false, w: 1.2 },
  { id: 'd-lobby-office', floor: '1', x: 3.5, z: -5.6, alongX: false, w: 1.2 },
  { id: 'd-lobby-south', floor: '1', x: 0.2, z: -2.2, alongX: true, w: 1.4 },
  { id: 'd-shop-press', floor: '1', x: -7, z: -2.2, alongX: true, w: 1.2 },
  { id: 'd-office-bind', floor: '1', x: 7.2, z: -2.2, alongX: true, w: 1.2 },
  { id: 'd-press-bind', floor: '1', x: 1.2, z: 2.0, alongX: false, w: 1.3 },
  { id: 'd-press-bind2', floor: '1', x: 1.2, z: 4.8, alongX: false, w: 1.1, soft: true },
  { id: 'd-press-stair', floor: '1', x: -1.0, z: 6.2, alongX: true, w: 1.3 },
  { id: 'd-bind-stair', floor: '1', x: 2.6, z: 6.2, alongX: true, w: 1.2 },
  { id: 'd-stair-load', floor: '1', x: -3.2, z: 8.6, alongX: false, w: 1.4 },
  { id: 'd-stair-wash', floor: '1', x: 4.2, z: 8.6, alongX: false, w: 1.0 },
  // Exterior ground
  { id: 'd-front', floor: '1', x: 0.2, z: BZ0, alongX: true, w: 1.6, exterior: true },
  { id: 'd-shopfront', floor: '1', x: -7, z: BZ0, alongX: true, w: 1.2, exterior: true },
  { id: 'd-dock', floor: '1', x: -7, z: BZ1, alongX: true, w: 2.2, exterior: true, wide: true },
  { id: 'd-east', floor: '1', x: BX1, z: 2.0, alongX: false, w: 1.2, exterior: true },
  { id: 'd-west', floor: '1', x: BX0, z: 2.0, alongX: false, w: 1.2, exterior: true },

  // Basement
  { id: 'd-paper-ink', floor: 'B', x: 0.8, z: -3.0, alongX: false, w: 1.2 },
  { id: 'd-paper-ink2', floor: 'B', x: 0.8, z: 2.2, alongX: false, w: 1.1, soft: true },
  { id: 'd-paper-stair', floor: 'B', x: -1.0, z: 5.0, alongX: true, w: 1.3 },
  { id: 'd-ink-stair', floor: 'B', x: 2.6, z: 5.0, alongX: true, w: 1.2 },
  { id: 'd-stair-boiler', floor: 'B', x: -3.2, z: 8.0, alongX: false, w: 1.2 },
  { id: 'd-stair-archive', floor: 'B', x: 4.2, z: 8.0, alongX: false, w: 1.1 },

  // Upper
  { id: 'd-studio-loft', floor: '2', x: 1.2, z: 1.5, alongX: false, w: 1.2 },
  { id: 'd-studio-loft2', floor: '2', x: 1.2, z: 4.6, alongX: false, w: 1.1, soft: true },
  { id: 'd-studio-hall', floor: '2', x: -1.0, z: 6.2, alongX: true, w: 1.3 },
  { id: 'd-loft-hall', floor: '2', x: 2.6, z: 6.2, alongX: true, w: 1.2 },
  { id: 'd-hall-lab', floor: '2', x: -3.2, z: 8.6, alongX: false, w: 1.2 },
  { id: 'd-hall-apt', floor: '2', x: 4.2, z: 8.6, alongX: false, w: 1.1 },
  { id: 'd-roof', floor: '2', x: -7.2, z: BZ1, alongX: true, w: 1.0, exterior: true, toRoof: true },
];

/** Windows on every exterior face, mixed sill heights. */
export const WINDOWS = [
  // North (street) ground + upper
  { id: 'w-n-shop1', floor: '1', x: -9.2, z: BZ0, alongX: true, w: 1.4, sill: 0.9 },
  { id: 'w-n-shop2', floor: '1', x: -5.0, z: BZ0, alongX: true, w: 1.4, sill: 0.9 },
  { id: 'w-n-lobby', floor: '1', x: 1.8, z: BZ0, alongX: true, w: 1.5, sill: 0.95 },
  { id: 'w-n-off1', floor: '1', x: 5.5, z: BZ0, alongX: true, w: 1.3, sill: 0.9 },
  { id: 'w-n-off2', floor: '1', x: 9.0, z: BZ0, alongX: true, w: 1.3, sill: 0.9 },
  { id: 'w-n-st1', floor: '2', x: -8.5, z: BZ0, alongX: true, w: 1.3, sill: 0.85 },
  { id: 'w-n-st2', floor: '2', x: -4.2, z: BZ0, alongX: true, w: 1.3, sill: 0.85 },
  { id: 'w-n-loft1', floor: '2', x: 4.0, z: BZ0, alongX: true, w: 1.3, sill: 0.85 },
  { id: 'w-n-loft2', floor: '2', x: 8.5, z: BZ0, alongX: true, w: 1.3, sill: 0.85 },

  // South (alley / dock)
  { id: 'w-s-load', floor: '1', x: -9.2, z: BZ1, alongX: true, w: 1.6, sill: 1.05 },
  { id: 'w-s-stair', floor: '1', x: 1.0, z: BZ1, alongX: true, w: 1.2, sill: 1.1 },
  { id: 'w-s-wash', floor: '1', x: 7.5, z: BZ1, alongX: true, w: 1.0, sill: 1.2 },
  { id: 'w-s-lab', floor: '2', x: -8.8, z: BZ1, alongX: true, w: 1.3, sill: 0.85 },
  { id: 'w-s-hall', floor: '2', x: 0.6, z: BZ1, alongX: true, w: 1.2, sill: 0.9 },
  { id: 'w-s-apt', floor: '2', x: 7.8, z: BZ1, alongX: true, w: 1.3, sill: 0.85 },
  // Basement wells on south
  { id: 'w-s-boil', floor: 'B', x: -8.5, z: BZ1, alongX: true, w: 1.1, sill: 1.4, well: true },
  { id: 'w-s-arch', floor: 'B', x: 7.5, z: BZ1, alongX: true, w: 1.1, sill: 1.4, well: true },

  // East
  { id: 'w-e-off', floor: '1', x: BX1, z: -5.6, alongX: false, w: 1.3, sill: 0.9 },
  { id: 'w-e-bind1', floor: '1', x: BX1, z: 0.2, alongX: false, w: 1.3, sill: 0.95 },
  { id: 'w-e-bind2', floor: '1', x: BX1, z: 4.4, alongX: false, w: 1.3, sill: 0.95 },
  { id: 'w-e-wash', floor: '1', x: BX1, z: 8.6, alongX: false, w: 1.0, sill: 1.2 },
  { id: 'w-e-loft1', floor: '2', x: BX1, z: -5.2, alongX: false, w: 1.3, sill: 0.85 },
  { id: 'w-e-loft2', floor: '2', x: BX1, z: 2.0, alongX: false, w: 1.3, sill: 0.85 },
  { id: 'w-e-apt', floor: '2', x: BX1, z: 8.6, alongX: false, w: 1.2, sill: 0.85 },
  { id: 'w-e-ink', floor: 'B', x: BX1, z: -3.0, alongX: false, w: 1.1, sill: 1.4, well: true },
  { id: 'w-e-arch2', floor: 'B', x: BX1, z: 8.0, alongX: false, w: 1.0, sill: 1.4, well: true },

  // West
  { id: 'w-w-shop', floor: '1', x: BX0, z: -5.6, alongX: false, w: 1.3, sill: 0.9 },
  { id: 'w-w-press1', floor: '1', x: BX0, z: 0.2, alongX: false, w: 1.3, sill: 0.95 },
  { id: 'w-w-press2', floor: '1', x: BX0, z: 4.4, alongX: false, w: 1.3, sill: 0.95 },
  { id: 'w-w-load', floor: '1', x: BX0, z: 8.6, alongX: false, w: 1.4, sill: 1.0 },
  { id: 'w-w-st1', floor: '2', x: BX0, z: -5.2, alongX: false, w: 1.3, sill: 0.85 },
  { id: 'w-w-st2', floor: '2', x: BX0, z: 2.0, alongX: false, w: 1.3, sill: 0.85 },
  { id: 'w-w-lab', floor: '2', x: BX0, z: 8.6, alongX: false, w: 1.2, sill: 0.85 },
  { id: 'w-w-paper', floor: 'B', x: BX0, z: -3.0, alongX: false, w: 1.1, sill: 1.4, well: true },
  { id: 'w-w-boil', floor: 'B', x: BX0, z: 8.0, alongX: false, w: 1.0, sill: 1.4, well: true },
];

export const HATCHES = [
  { id: 'h-press-studio', x: -6.2, z: 3.2, from: '1', to: '2' },      // primary vertical for studio/press
  { id: 'h-paper-shop', x: -6.4, z: -5.4, from: 'B', to: '1' },       // paper store up to shop
  { id: 'h-ink-office', x: 6.4, z: -5.4, from: 'B', to: '1' },        // ink vault up to office (secondary, slower)
  { id: 'h-loft-roof', x: 6.2, z: 3.2, from: '2', to: 'roof' },
];

/** Stairs: volumes with a ramp from y0 to y1. */
export const STAIRS = [
  // Main stair: B <-> 1 <-> 2 in the stair hall (x -2.2..3.4, z 7.0..10.4)
  { id: 'st-b-1', x0: -2.4, x1: 0.6, z0: 7.1, z1: 10.5, y0: -3.2, y1: 0, dir: 'z-', flight: 'main' },
  { id: 'st-1-2', x0: 0.8, x1: 3.8, z0: 7.1, z1: 10.5, y0: 0, y1: 3.2, dir: 'z-', flight: 'main' },
  // Back service stair in loading / boiler (slower covered rotate)
  { id: 'st-b-1b', x0: -10.6, x1: -8.2, z0: 7.2, z1: 10.6, y0: -3.2, y1: 0, dir: 'z+', flight: 'back' },
  { id: 'st-1-2b', x0: -10.6, x1: -8.2, z0: 7.2, z1: 10.6, y0: 0, y1: 3.2, dir: 'z+', flight: 'back' },
];

/** Reinforceable interior walls near sites (soft unless reinforced). Listed as wall segments. */
export const SOFT_WALLS = [
  // Between paper and ink (two segments besides doors)
  { floor: 'B', x0: 0.8, z0: BZ0, x1: 0.8, z1: -3.7 },
  { floor: 'B', x0: 0.8, z0: -2.3, x1: 0.8, z1: 1.55 },
  { floor: 'B', x0: 0.8, z0: 2.85, x1: 0.8, z1: 5.0 },
  // Between press and bindery
  { floor: '1', x0: 1.2, z0: -2.2, x1: 1.2, z1: 1.25 },
  { floor: '1', x0: 1.2, z0: 2.75, x1: 1.2, z1: 4.15 },
  { floor: '1', x0: 1.2, z0: 5.45, x1: 1.2, z1: 6.2 },
  // Between studio and loft
  { floor: '2', x0: 1.2, z0: BZ0, x1: 1.2, z1: 0.8 },
  { floor: '2', x0: 1.2, z0: 2.2, x1: 1.2, z1: 3.95 },
  { floor: '2', x0: 1.2, z0: 5.25, x1: 1.2, z1: 6.2 },
  // Site to hallway soft
  { floor: '1', x0: BX0, z0: -2.2, x1: -3, z1: -2.2 },
  { floor: 'B', x0: BX0, z0: 5.0, x1: -3.2, z1: 5.0 },
  { floor: '2', x0: BX0, z0: 6.2, x1: -3.2, z1: 6.2 },
];

export const SPAWNS = {
  attack: [
    { id: 'street', x: 0, y: 0, z: -18.5, yaw: 0, cover: true },
    { id: 'eastwalk', x: 18.5, y: 0, z: 1, yaw: -Math.PI / 2, cover: true },
    { id: 'alley', x: 2, y: 0, z: 19.5, yaw: Math.PI, cover: true },
    { id: 'courtyard', x: -18.5, y: 0, z: 2, yaw: Math.PI / 2, cover: true },
    { id: 'parking', x: -8, y: 0, z: -20.5, yaw: 0.15, cover: true },
    { id: 'dockside', x: -16, y: 0, z: 16, yaw: Math.PI / 4, cover: true },
  ],
  defend: [
    { id: 'siteA', x: 0, y: 0, z: 0 }, // filled per site at start
  ],
};

export const CAMS = [
  { id: 'cam-street', name: 'Street Front', x: 0.2, y: 2.7, z: -9.15, yaw: 0, floor: '1' },
  { id: 'cam-east', name: 'East Alley', x: 11.15, y: 2.7, z: 2, yaw: -Math.PI / 2, floor: '1' },
  { id: 'cam-dock', name: 'Loading Dock', x: -7, y: 2.7, z: 11.15, yaw: Math.PI, floor: '1' },
  { id: 'cam-court', name: 'West Court', x: -11.15, y: 2.7, z: 2, yaw: Math.PI / 2, floor: '1' },
  { id: 'cam-press', name: 'Press Corner', x: -10.4, y: 2.6, z: 5.6, yaw: -2.4, floor: '1' },
  { id: 'cam-stair', name: 'Stair Hall', x: 0.6, y: 2.6, z: 10.4, yaw: 3.5, floor: '1' },
  { id: 'cam-vault', name: 'Ink Vault', x: 10.3, y: -0.6, z: 4.3, yaw: -2.2, floor: 'B' },
  { id: 'cam-upper', name: 'Upper Hall', x: 0.5, y: 5.7, z: 10.3, yaw: 3.4, floor: '2' },
];


/** Under-door clearance (metres). Operators cannot fit; scouts can. */
export const DOOR_SWEEP = 0.22;

/** Drone-only openings. New maps should ship their own list. Operators
 *  cannot fit (opening height ~0.28, width ~0.42). Coordinates follow
 *  the same alongX convention as DOORS. y0/y1 are offsets from the floor. */
export const DRONE_GAPS = [
  // Exterior crawl vents — original Halcyon Press service openings
  { id: 'vent-street', kind: 'vent', floor: '1', alongX: true,  x: -2.4, z: -9,   w: 0.46, y0: 0.02, y1: 0.30, name: 'Street crawl vent' },
  { id: 'vent-dock',   kind: 'vent', floor: '1', alongX: true,  x: -4.6, z: 11,   w: 0.46, y0: 0.02, y1: 0.30, name: 'Dock crawl vent' },
  { id: 'vent-west',   kind: 'vent', floor: '1', alongX: false, x: -11,  z: -0.8, w: 0.46, y0: 0.02, y1: 0.30, name: 'West court vent' },
  { id: 'vent-east',   kind: 'vent', floor: '1', alongX: false, x: 11,   z: 6.8,  w: 0.46, y0: 0.02, y1: 0.30, name: 'East alley vent' },
  // Interior wall holes / vents between rooms (not on door leaves)
  { id: 'hole-press-bind', kind: 'hole',  floor: '1', alongX: false, x: 1.2, z: -0.6, w: 0.42, y0: 0.02, y1: 0.28, name: 'Press wall gap' },
  { id: 'vent-lobby-press', kind: 'vent', floor: '1', alongX: true,  x: -1.8, z: -2.2, w: 0.42, y0: 0.02, y1: 0.28, name: 'Lobby crawl vent' },
  { id: 'board-paper-ink', kind: 'board', floor: 'B', alongX: false, x: 0.8, z: -5.5, w: 0.44, y0: 0.02, y1: 0.28, name: 'Paper-store board gap' },
  { id: 'vent-paper-stair', kind: 'vent', floor: 'B', alongX: true,  x: -5.5, z: 5.0, w: 0.42, y0: 0.02, y1: 0.28, name: 'Paper-store vent' },
  { id: 'vent-studio-loft', kind: 'vent', floor: '2', alongX: false, x: 1.2, z: -4.0, w: 0.42, y0: 0.02, y1: 0.28, name: 'Studio vent' },
  // Window-corner sneak holes beside an existing window, at floor height
  { id: 'wc-shop', kind: 'window-corner', floor: '1', alongX: true,  x: -10.35, z: -9, w: 0.30, y0: 0.02, y1: 0.26, name: 'Shop window corner' },
  { id: 'wc-east', kind: 'window-corner', floor: '1', alongX: false, x: 11, z: -0.95, w: 0.30, y0: 0.02, y1: 0.26, name: 'Bindery window corner' },
];

export const BOUNDS = {
  play: { x0: -24, x1: 24, z0: -26, z1: 26 },
  warn: { x0: -22, x1: 22, z0: -23, z1: 23 },
  building: { x0: BX0, x1: BX1, z0: BZ0, z1: BZ1 },
};

export const MAP = {
  id: 'halcyon',
  name: 'Halcyon Press',
  address: '19 Binder Street',
  floors: FLOORS,
  rooms: ROOMS,
  doors: DOORS,
  windows: WINDOWS,
  hatches: HATCHES,
  stairs: STAIRS,
  softWalls: SOFT_WALLS,
  sitePairs: SITE_PAIRS,
  sites: SITES,
  spawns: SPAWNS,
  cams: CAMS,
  droneGaps: DRONE_GAPS,
  doorSweep: DOOR_SWEEP,
  bounds: BOUNDS,
};

export function floorY(id) {
  return (FLOORS.find(f => f.id === id) || FLOORS[1]).y;
}
export function roomById(id) {
  return ROOMS.find(r => r.id === id);
}
