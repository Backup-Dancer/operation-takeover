import { PLAYER_DEFAULT, DAILY_CHALLENGES, INDUCTION, FIELD_PASS } from './data.js?v=iv-4.1.2-t3';

const KEY = 'ironveil-profile-v4';

function blank() {
  return {
    callsign: PLAYER_DEFAULT.callsign,
    tag: PLAYER_DEFAULT.tag,
    level: 8,
    xp: 420,
    xpToNext: 1000,
    marks: 1840,
    chits: 6,
    stats: {
      matches: 14,
      wins: 8,
      roundsWon: 27,
      roundsPlayed: 48,
      mvp: 3,
      elims: 62,
      assists: 21,
      deaths: 41,
      headshots: 11,
    },
    induction: 3,
    passTier: 4,
    passXp: 40,
    challenges: DAILY_CHALLENGES.map(c => ({ id: c.id, progress: 0 })),
    loadoutNote: {},
  };
}

function clone(o) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(o);
  } catch {}
  return JSON.parse(JSON.stringify(o));
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const d = JSON.parse(raw);
    const out = blank();
    Object.assign(out, d);
    out.stats = { ...blank().stats, ...(d.stats || {}) };
    if (!Array.isArray(out.challenges) || out.challenges.length !== DAILY_CHALLENGES.length) {
      out.challenges = blank().challenges;
    }
    return out;
  } catch {
    return blank();
  }
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}

export function winRate(p) {
  const m = p.stats.matches || 0;
  if (!m) return 0;
  return Math.round((p.stats.wins / m) * 100);
}

export function challengeState(p) {
  return DAILY_CHALLENGES.map(c => {
    const row = p.challenges.find(x => x.id === c.id) || { progress: 0 };
    const progress = Math.min(c.goal, row.progress || 0);
    return { ...c, progress, done: progress >= c.goal };
  });
}

export function applyMatchRewards(p, result) {
  const won = !!result.won;
  const mvp = result.isMvp === true || result.mvp === true;
  const stats = p.stats;
  stats.matches += 1;
  if (won) stats.wins += 1;
  stats.roundsWon += result.roundsWon || 0;
  stats.roundsPlayed += result.roundsPlayed || 0;
  if (mvp) stats.mvp += 1;
  stats.elims += result.elims || 0;
  stats.assists += result.assists || 0;
  stats.deaths += result.deaths || 0;
  stats.headshots += result.headshots || 0;

  p.induction = Math.min(INDUCTION.goal, (p.induction || 0) + 1);

  const marks = 220 + (won ? 160 : 40) + (mvp ? 80 : 0) + (result.elims || 0) * 8;
  p.marks = (p.marks || 0) + marks;
  const xp = 80 + (won ? 60 : 20) + (mvp ? 40 : 0);
  p.xp += xp;
  while (p.xp >= p.xpToNext) {
    p.xp -= p.xpToNext;
    p.level += 1;
    p.xpToNext = Math.round(p.xpToNext * 1.08);
  }
  p.passXp = (p.passXp || 0) + Math.round(xp * 0.7);
  while (p.passXp >= FIELD_PASS.xpPerTier && p.passTier < FIELD_PASS.tiers) {
    p.passXp -= FIELD_PASS.xpPerTier;
    p.passTier += 1;
  }

  const inc = { matches: 1, roundsWon: result.roundsWon || 0, elims: result.elims || 0, headshots: result.headshots || 0 };
  for (const ch of p.challenges) {
    const def = DAILY_CHALLENGES.find(c => c.id === ch.id);
    if (!def) continue;
    const add = inc[def.key] || 0;
    ch.progress = Math.min(def.goal, (ch.progress || 0) + add);
  }

  const rewards = { marks, xp, won, mvp, level: p.level };
  saveProfile(p);
  return rewards;
}

export { INDUCTION, FIELD_PASS, clone };
