/** Bot difficulty tables. New maps and modes should read from here
 *  rather than hard-coding literals. Applied live each think tick;
 *  health is applied on spawn / next round. */

export const DIFFICULTY_IDS = ['recruit', 'regular', 'veteran', 'elite'];

export const DIFFICULTY_LABELS = {
  recruit: 'Recruit',
  regular: 'Regular',
  veteran: 'Veteran',
  elite: 'Elite',
};

export const DIFF = {
  recruit: {
    react: 0.60, acc: 0.16, peek: 0.22, track: 0.32,
    aggro: 0.25, flank: 0.10, hear: 10, spot: 16,
    hp: 100, dmg: 0.75,
  },
  regular: {
    react: 0.42, acc: 0.10, peek: 0.40, track: 0.55,
    aggro: 0.45, flank: 0.28, hear: 14, spot: 20,
    hp: 100, dmg: 0.90,
  },
  veteran: {
    react: 0.32, acc: 0.07, peek: 0.55, track: 0.72,
    aggro: 0.65, flank: 0.50, hear: 18, spot: 24,
    hp: 100, dmg: 1.00,
  },
  elite: {
    react: 0.18, acc: 0.04, peek: 0.80, track: 0.90,
    aggro: 0.88, flank: 0.78, hear: 24, spot: 30,
    hp: 110, dmg: 1.12,
  },
};

export function normalizeDifficulty(id) {
  const k = String(id || '').toLowerCase();
  return DIFF[k] ? k : 'veteran';
}

export function difficultyParams(id) {
  return DIFF[normalizeDifficulty(id)];
}
