/** Original Operation: Takeover front-end data. No third-party names or art. */

export const PLAYER_DEFAULT = {
  callsign: 'WARRANT',
  tag: '01',
};

export const MAPS = [
  { id: 'halcyon', name: 'Halcyon Press', blurb: 'Two floors and a basement. Two site pairs.', ready: true, floors: '3', accent: '#c67636' },
  { id: 'wren', name: 'Wren Transit Annex', blurb: 'Doglegged parcel depot. Site A Parcel Cage, site B Lost Property loft.', ready: false, floors: '2', accent: '#6a8f4a' },
  { id: 'lowfield', name: 'Lowfield Boatworks', blurb: 'T-shaped river workshop. Site A Paint Shop loft, site B Parts Pit.', ready: false, floors: '3', accent: '#3a7ca5' },
  { id: 'glassmere', name: 'Glassmere Reclaim', blurb: 'Hillside reclaim plant. Site A Lehr Control, site B Sorting Gallery. East-face rappels.', ready: false, floors: '2', accent: '#8aa0b8' },
];

export const MODES = [
  { id: 'bomb-rush', label: 'QUICK PLAY', sub: 'BOMB RUSH', detail: 'Best of 3', bestOf: 3, kind: 'bomb' },
  { id: 'ranked', label: 'RANKED', sub: 'BOMB', detail: 'Best of 5', bestOf: 5, kind: 'bomb' },
  { id: 'practice', label: 'PRACTICE', sub: 'RANGE & MAPS', detail: 'Train on your own', bestOf: 1, kind: 'practice' },
];

export const TIPS = [
  'Reinforce soft walls before the action phase starts.',
  'Scouts can slip under doors and through the small gaps in a room.',
  'A downed teammate can be revived to half health, once per round.',
  'Break a single board out of a barricade to open a peek hole.',
  'Observation cams are named by room. Cycle them with the arrows.',
  'Marking a hostile through a scout or a cam awards points.',
  'Attackers rappel with a weapon in hand. Defenders hold the sites.',
  'There is no minimap. Read the compass, the room name, and callouts.',
  'Loadouts are set before you queue. Gunsmith has six attachment slots.',
  'Music stays in the menus. Matches run silent so footsteps carry.',
];

export const FIRETEAM_BOTS = [
  { callsign: 'KEEL', id: 'keel' },
  { callsign: 'CROFT', id: 'croft' },
  { callsign: 'NIX', id: 'nix' },
  { callsign: 'HELIX', id: 'helix' },
];

export const RIVAL_BOTS = [
  { callsign: 'CINDER', id: 'cinder' },
  { callsign: 'VELD', id: 'veld' },
  { callsign: 'TRUSS', id: 'truss' },
  { callsign: 'LANTERN', id: 'lantern' },
  { callsign: 'SPALE', id: 'spale' },
];

export const GUNSMITH_SLOTS = [
  { id: 'optic', name: 'Optic', hint: 'Sight picture and zoom.' },
  { id: 'muzzle', name: 'Muzzle', hint: 'Recoil and report.' },
  { id: 'grip', name: 'Grip', hint: 'Vertical control and ADS.' },
  { id: 'magazine', name: 'Magazine', hint: 'Capacity and reload.' },
  { id: 'siderail', name: 'Side Rail', hint: 'Laser or light.' },
  { id: 'internal', name: 'Internal', hint: 'Bolt and barrel work.' },
];

export const GUNSMITH_OPTS = {
  optic: [
    { id: 'iron', name: 'Irons', stats: { ads: 2, zoom: 0, vis: 0 } },
    { id: 'red', name: 'Reflex', stats: { ads: 1, zoom: 1, vis: 1 } },
    { id: 'holo', name: 'Holo', stats: { ads: 0, zoom: 1, vis: 2 } },
    { id: 'scope2', name: '2x Magnifier', stats: { ads: -1, zoom: 2, vis: 1 } },
    { id: 'scope4', name: '4x Optic', stats: { ads: -2, zoom: 3, vis: 0 } },
  ],
  muzzle: [
    { id: 'none', name: 'Brake Off', stats: { recoil: 0, range: 0, stealth: 0 } },
    { id: 'flashhider', name: 'Flash Hider', stats: { recoil: 1, range: 0, stealth: 1 } },
    { id: 'compensator', name: 'Compensator', stats: { recoil: 2, range: 0, stealth: 0 } },
    { id: 'suppressor', name: 'Suppressor', stats: { recoil: 0, range: -1, stealth: 3 } },
  ],
  grip: [
    { id: 'none', name: 'No Grip', stats: { recoil: 0, ads: 1, move: 0 } },
    { id: 'vert', name: 'Vertical Grip', stats: { recoil: 2, ads: 0, move: 0 } },
    { id: 'angle', name: 'Angled Grip', stats: { recoil: 0, ads: 2, move: 0 } },
    { id: 'stub', name: 'Stub Grip', stats: { recoil: 1, ads: 1, move: 1 } },
  ],
  magazine: [
    { id: 'std', name: 'Standard Mag', stats: { cap: 0, reload: 1, move: 0 } },
    { id: 'magex', name: 'Extended Mag', stats: { cap: 2, reload: 0, move: -1 } },
    { id: 'quick', name: 'Quick Mag', stats: { cap: 0, reload: 2, move: 0 } },
  ],
  siderail: [
    { id: 'none', name: 'Empty Rail', stats: { hip: 0, vis: 0 } },
    { id: 'laser', name: 'Laser', stats: { hip: 2, vis: -1 } },
    { id: 'light', name: 'Tactical Light', stats: { hip: 1, vis: 1 } },
  ],
  internal: [
    { id: 'stock', name: 'Factory', stats: { dmg: 0, move: 0, recoil: 0 } },
    { id: 'heavy', name: 'Heavy Bolt', stats: { dmg: 1, move: -1, recoil: 1 } },
    { id: 'light', name: 'Light Bolt', stats: { dmg: -1, move: 2, recoil: -1 } },
  ],
};

export const DAILY_CHALLENGES = [
  { id: 'matches-3', name: 'Run three deployments', hint: 'Finish 3 matches.', goal: 3, key: 'matches', reward: 120 },
  { id: 'rounds-5', name: 'Take five rounds', hint: 'Win 5 rounds.', goal: 5, key: 'roundsWon', reward: 150 },
  { id: 'elim-10', name: 'Ten confirmed downs', hint: 'Record 10 eliminations.', goal: 10, key: 'elims', reward: 180 },
  { id: 'head-3', name: 'Clean entries', hint: 'Land 3 headshot eliminations.', goal: 3, key: 'headshots', reward: 200 },
];

export const INDUCTION = { name: 'Induction', goal: 10, hint: 'Play 10 matches to clear induction.' };

export const FIELD_PASS = {
  name: 'Field Pass',
  season: 'Season 01 — Warrant Desk',
  tiers: 30,
  xpPerTier: 100,
};

export function mapById(id) {
  return MAPS.find(m => m.id === id) || MAPS[0];
}

export function modeById(id) {
  return MODES.find(m => m.id === id) || MODES[0];
}

/** Original stylized key art for each map (assets/ui/maps). */
export function mapArtUrl(id) {
  const m = mapById(id);
  return `assets/ui/maps/${m.id}.webp`;
}
