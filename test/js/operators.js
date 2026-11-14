/** Original IRONVEIL operators. Roles match the genre; names, looks and gadgets are original. */
export const ATTACKERS = [
  {
    id: 'forge', name: 'FORGE', side: 'attack', role: 'Hard Breacher',
    speed: 1, armor: 3,
    bio: 'Cuts a vault-sized port through reinforced steel with a planted thermal lance.',
    gadget: { id: 'hearthlance', name: 'Hearth Lance', count: 2, kind: 'hardbreach',
      blurb: 'Plant on a reinforced wall or hatch, then detonate remotely. The lance burns a walkable port. Shoot the charge or hit it with a Null Disc to stop it.' },
    primaries: ['carbine', 'm870'], secondaries: ['p45'], util: ['breach', 'smoke'],
    accent: '#c67636',
  },
  {
    id: 'quill', name: 'QUILL', side: 'attack', role: 'Flash Entry',
    speed: 3, armor: 1,
    bio: 'Opens rooms with a surface-stuck needle that flashes only the far side.',
    gadget: { id: 'needleburst', name: 'Needleburst', count: 3, kind: 'flash',
      blurb: 'Throws a dart that sticks to a wall, door or floor. Remote-detonate to fire a cone of light through the surface, blinding only people on the other side. Shoot the dart to destroy it.' },
    primaries: ['mp5', 'carbine'], secondaries: ['p9'], util: ['stun', 'breach'],
    accent: '#e8c696',
  },
  {
    id: 'marrow', name: 'MARROW', side: 'attack', role: 'Intel',
    speed: 2, armor: 2,
    bio: 'Paints targets from a scout drone so the fireteam can see their trail.',
    gadget: { id: 'staindart', name: 'Stain Dart', count: 3, kind: 'intel',
      blurb: 'Your scout drone fires a paint dart. Marked enemies leave a visible trail for the team for several seconds. Blindwell static and destroyed drones stop the feed.' },
    primaries: ['pdw', 'dmr'], secondaries: ['p45'], util: ['smoke', 'stun'],
    accent: '#8fb56a',
  },
  {
    id: 'glyph', name: 'GLYPH', side: 'attack', role: 'Anti-Gadget',
    speed: 2, armor: 2,
    bio: 'Kills defender utility with a remote electromagnetic disc.',
    gadget: { id: 'nulldisc', name: 'Null Disc', count: 2, kind: 'emp',
      blurb: 'Throw or place a disc, then detonate it remotely. Gadgets in the blast go dead (traps, jammers, cameras, unexploded charges). It can be shot before it triggers.' },
    primaries: ['carbine', 'mp5'], secondaries: ['p9'], util: ['mine', 'breach'],
    accent: '#7eb0e0',
  },
];

export const DEFENDERS = [
  {
    id: 'rivet', name: 'RIVET', side: 'defend', role: 'Anchor',
    speed: 1, armor: 3,
    bio: 'Turns a door or window into a steel shutter with a firing slit.',
    gadget: { id: 'portcullis', name: 'Portcullis', count: 2, kind: 'shutter',
      blurb: 'Deploys a steel frame over a door or window with a narrow two-way gun port. Hard-breach tools and demo charges can cut it; bullets cannot, except through the slit.' },
    primaries: ['m870', 'mp5'], secondaries: ['p45'], util: ['shield', 'wire'],
    accent: '#9aa4b2',
  },
  {
    id: 'briar', name: 'BRIAR', side: 'defend', role: 'Trapper',
    speed: 2, armor: 2,
    bio: 'Strings near-invisible trip lines that stun anyone who crosses them.',
    gadget: { id: 'bramble', name: 'Bramble Line', count: 3, kind: 'trap',
      blurb: 'A taut line between two anchors. Crossing it stuns and slows. Drones can catch a faint glint; bullets or a Null Disc destroy the anchors.' },
    primaries: ['mp5', 'm870'], secondaries: ['p9'], util: ['demo', 'wire'],
    accent: '#6a8f4a',
  },
  {
    id: 'husk', name: 'HUSK', side: 'defend', role: 'Roamer',
    speed: 3, armor: 1,
    bio: 'Throws false footsteps to pull attackers off an angle.',
    gadget: { id: 'afterstep', name: 'Afterstep', count: 3, kind: 'decoy',
      blurb: 'Projects a short burst of footsteps in a chosen direction. Sound does not match camera vision. Useful to bait a swing or cover a rotate.' },
    primaries: ['mp5', 'pdw'], secondaries: ['p45'], util: ['wire', 'impact'],
    accent: '#b08a5a',
  },
  {
    id: 'shade', name: 'SHADE', side: 'defend', role: 'Intel Denial',
    speed: 2, armor: 2,
    bio: 'Blinds scout drones and paints static over nearby cameras.',
    gadget: { id: 'blindwell', name: 'Blindwell', count: 2, kind: 'jammer',
      blurb: 'A deployable beacon. Drones and attacker cameras inside its radius go to static, and Stain Darts cannot paint. It does not stop hard-breach tools. Shoot it to disable.' },
    primaries: ['mp5', 'm870'], secondaries: ['p9'], util: ['cam', 'impact'],
    accent: '#6e6a88',
  },
];

export const BY_ID = Object.fromEntries([...ATTACKERS, ...DEFENDERS].map(o => [o.id, o]));
export const listSide = side => side === 'defend' ? DEFENDERS : ATTACKERS;
export function getOp(id, side) {
  if (id && BY_ID[id] && (!side || BY_ID[id].side === side)) return BY_ID[id];
  return listSide(side || 'attack')[0];
}
