/** Generic real-world weapon types with attachments. Models are unbranded originals. */
export const WEAPONS = {
  carbine: {
    id: 'carbine', name: 'C-16 Carbine', class: 'ar',
    dmg: 38, head: 2.5, rpm: 750, mag: 30, reserve: 150, reload: 2.4,
    spread: 0.9, adsSpread: 0.18, recoil: [0.22, 0.08], range: [18, 42],
    optics: ['iron', 'red', 'holo', 'scope2'],
    attach: ['suppressor', 'laser', 'light', 'grip', 'stock', 'magex'],
  },
  mp5: {
    id: 'mp5', name: 'SMG-5', class: 'smg',
    dmg: 30, head: 2.6, rpm: 800, mag: 30, reserve: 150, reload: 2.2,
    spread: 0.75, adsSpread: 0.16, recoil: [0.16, 0.07], range: [12, 28],
    optics: ['iron', 'red', 'holo'],
    attach: ['suppressor', 'laser', 'light', 'grip', 'magex'],
  },
  pdw: {
    id: 'pdw', name: 'PDW-90', class: 'smg',
    dmg: 24, head: 2.4, rpm: 900, mag: 50, reserve: 150, reload: 2.8,
    spread: 0.85, adsSpread: 0.2, recoil: [0.14, 0.1], range: [10, 24],
    optics: ['iron', 'red', 'holo'],
    attach: ['suppressor', 'laser', 'light', 'magex'],
  },
  m870: {
    id: 'm870', name: 'M870 Pump', class: 'shotgun',
    dmg: 18, pellets: 8, head: 1.6, rpm: 70, mag: 6, reserve: 24, reload: 0.45, pump: true,
    spread: 3.2, adsSpread: 2.1, recoil: [0.7, 0.12], range: [6, 16],
    optics: ['iron', 'red'],
    attach: ['laser', 'light', 'grip'],
  },
  dmr: {
    id: 'dmr', name: 'DMR-76', class: 'dmr',
    dmg: 58, head: 2.2, rpm: 280, mag: 10, reserve: 50, reload: 2.7, semi: true,
    spread: 0.5, adsSpread: 0.08, recoil: [0.4, 0.05], range: [30, 70],
    optics: ['iron', 'red', 'scope2', 'scope4'],
    attach: ['suppressor', 'bipod', 'magex'],
  },
  p45: {
    id: 'p45', name: 'P-45', class: 'pistol',
    dmg: 44, head: 2.4, rpm: 380, mag: 8, reserve: 40, reload: 1.7, semi: true,
    spread: 1.1, adsSpread: 0.25, recoil: [0.3, 0.08], range: [10, 22],
    optics: ['iron'],
    attach: ['suppressor', 'laser', 'light'],
  },
  revolver: {
    id: 'revolver', name: 'R-44', class: 'pistol',
    dmg: 52, head: 2.3, rpm: 140, mag: 6, reserve: 24, reload: 2.2, semi: true,
    spread: 1.2, adsSpread: 0.28, recoil: [0.45, 0.1], range: [10, 24],
    optics: ['iron'],
    attach: ['laser', 'light'],
  },
  p9: {
    id: 'p9', name: 'P-9', class: 'pistol',
    dmg: 32, head: 2.3, rpm: 480, mag: 15, reserve: 60, reload: 1.55, semi: true,
    spread: 1.0, adsSpread: 0.22, recoil: [0.22, 0.08], range: [10, 20],
    optics: ['iron'],
    attach: ['suppressor', 'laser', 'light'],
  },
};

export const OPTIC_ZOOM = { iron: 1.0, red: 1.05, holo: 1.05, scope2: 2.0, scope4: 4.0 };
export const UTIL = {
  breach: { id: 'breach', name: 'Breach Charge', count: 3, kind: 'explosive', remote: true },
  smoke: { id: 'smoke', name: 'Smoke Grenade', count: 2, kind: 'throw' },
  stun: { id: 'stun', name: 'Stun Grenade', count: 2, kind: 'throw' },
  mine: { id: 'mine', name: 'Remote Mine', count: 2, kind: 'explosive', remote: true, directional: true },
  demo: { id: 'demo', name: 'Demo Charge', count: 1, kind: 'explosive', remote: true },
  wire: { id: 'wire', name: 'Razor Tape', count: 2, kind: 'place' },
  shield: { id: 'shield', name: 'Deployable Shield', count: 1, kind: 'place' },
  impact: { id: 'impact', name: 'Impact Grenade', count: 2, kind: 'throw', impact: true },
  cam: { id: 'cam', name: 'Shield Cam', count: 1, kind: 'place' },
};

export function makeLoadout(op, saved = {}) {
  const primary = saved.primary && op.primaries.includes(saved.primary) ? saved.primary : op.primaries[0];
  const secondary = saved.secondary && op.secondaries.includes(saved.secondary) ? saved.secondary : op.secondaries[0];
  const util = saved.util && op.util.includes(saved.util) ? saved.util : op.util[0];
  const w = WEAPONS[primary];
  const optic = saved.optic && w.optics.includes(saved.optic) ? saved.optic : (w.optics.includes('red') ? 'red' : w.optics[0]);
  const attach = { ...(saved.attach || {}) };
  return { primary, secondary, util, optic, attach, gadget: op.gadget.id };
}

export function instWeapon(id, load) {
  const def = WEAPONS[id];
  const mag = def.mag + (load?.attach?.magex ? (def.class === 'shotgun' ? 2 : 10) : 0) + (load?.attach?.drum ? 20 : 0);
  return {
    ...def,
    optic: (load?.optic && def.optics.includes(load.optic)) ? load.optic : def.optics[0],
    attach: { ...(load?.attach || {}) },
    clip: mag, mag, reserve: def.reserve, heat: 0,
  };
}
