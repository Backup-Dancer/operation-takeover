/** Bot difficulty tables. Applied live each think tick.
 *  Reaction times: Recruit 700 ms, Regular 500 ms, Veteran 350 ms, Elite 220 ms. */

export const DIFFICULTY_IDS = ['recruit', 'regular', 'veteran', 'elite'];

export const DIFFICULTY_LABELS = {
  recruit: 'Recruit',
  regular: 'Regular',
  veteran: 'Veteran',
  elite: 'Elite',
};

export const DIFF = {
  recruit: {
    react: 0.70, acc: 0.22, firstSpread: 0.28, peek: 0.20, track: 0.28, trackErr: 0.18,
    aggro: 0.22, flank: 0.08, hear: 10, spot: 16, fov: 0.95,
    hp: 100, dmg: 0.70, aimAssist: 'med', holdInterior: 15,
  },
  regular: {
    react: 0.50, acc: 0.14, firstSpread: 0.18, peek: 0.38, track: 0.50, trackErr: 0.10,
    aggro: 0.42, flank: 0.25, hear: 14, spot: 20, fov: 1.10,
    hp: 100, dmg: 0.85, aimAssist: 'low', holdInterior: 15,
  },
  veteran: {
    react: 0.35, acc: 0.08, firstSpread: 0.10, peek: 0.55, track: 0.72, trackErr: 0.05,
    aggro: 0.62, flank: 0.48, hear: 18, spot: 24, fov: 1.22,
    hp: 100, dmg: 1.00, aimAssist: 'low', holdInterior: 0,
  },
  elite: {
    react: 0.22, acc: 0.045, firstSpread: 0.05, peek: 0.80, track: 0.90, trackErr: 0.02,
    aggro: 0.85, flank: 0.75, hear: 24, spot: 30, fov: 1.36,
    hp: 100, dmg: 1.10, aimAssist: 'off', holdInterior: 0,
  },
};

export function normalizeDifficulty(id) {
  const k = String(id || '').toLowerCase();
  return DIFF[k] ? k : 'regular';
}

export function difficultyParams(id) {
  return DIFF[normalizeDifficulty(id)];
}
