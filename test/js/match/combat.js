/** v4 gunplay helpers: damage model, recoil recovery, aim-assist slowdown, wall pen. */

export const MAX_HP = 100;
export const BLEED_TIME = 14;
export const REVIVE_TIME = 3.2;
export const REVIVE_HP = 50;
export const DBNO_HP = 0;

const PART_MUL = { head: 1, torso: 1, arm: 0.75, limb: 0.6, leg: 0.6 };

export function armorBodyMul(armor) {
  const a = Math.max(1, Math.min(3, armor || 2));
  return 1 - (a - 1) * 0.12;
}

export function lethalHead(wclass) {
  return wclass === 'ar' || wclass === 'dmr' || wclass === 'smg' || wclass === 'pistol';
}

export function computeDamage(wpn, part, armor) {
  const p = part || 'torso';
  if (p === 'head' && lethalHead(wpn?.class)) return MAX_HP;
  const headMul = p === 'head' ? (wpn?.head || 2.3) : 1;
  const base = (wpn?.dmg || 30) * (PART_MUL[p] || 1) * headMul;
  const armorMul = p === 'head' ? 1 : armorBodyMul(armor);
  return base * armorMul;
}

export function hitPartFromOffset(origin, dir, pawn, t) {
  const hy = (pawn.pos.y || 0);
  const y = origin.y + dir.y * t;
  const headY = hy + 1.58;
  const torsoTop = hy + 1.35;
  const hip = hy + 0.85;
  if (y >= headY - 0.16) return 'head';
  if (y >= torsoTop) return 'torso';
  if (y >= hip) {
    const dx = (origin.x + dir.x * t) - pawn.pos.x;
    const dz = (origin.z + dir.z * t) - pawn.pos.z;
    if (Math.hypot(dx, dz) > 0.16) return 'arm';
    return 'torso';
  }
  return 'leg';
}

/** Recoil pattern: list of [up, right] look units per shot. Recovers when idle. */
export function defaultPattern(wpn) {
  if (wpn?.pattern) return wpn.pattern;
  const up = wpn?.recoil?.[0] || 0.2;
  const side = wpn?.recoil?.[1] || 0.08;
  const n = 12;
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = 1 - i * 0.04;
    const sway = (i % 4 === 0 ? 1 : i % 4 === 1 ? -0.6 : i % 4 === 2 ? 0.3 : -0.2);
    out.push([up * k, side * sway]);
  }
  return out;
}

export function nextRecoil(wpn) {
  const pat = defaultPattern(wpn);
  const i = wpn._recoilI || 0;
  wpn._recoilI = i + 1;
  wpn._recoilIdle = 0;
  const row = pat[Math.min(i, pat.length - 1)];
  return { up: row[0] * 0.016, right: row[1] * 0.018 };
}

export function recoverRecoil(wpn, dt) {
  if (!wpn) return;
  wpn._recoilIdle = (wpn._recoilIdle || 0) + dt;
  if (wpn._recoilIdle > 0.16 && (wpn._recoilI || 0) > 0) {
    const rate = wpn.recover || 14;
    wpn._recoilI = Math.max(0, (wpn._recoilI || 0) - rate * dt);
  }
  if ((wpn.heat || 0) > 0) wpn.heat = Math.max(0, wpn.heat - dt * 1.6);
}

export function bloomSpread(wpn, ads, stance, heat) {
  const base = (wpn.spread || 0.9) * (1 - ads) + (wpn.adsSpread || 0.18) * ads;
  const stanceMul = stance >= 1.8 ? 0.6 : stance >= 0.8 ? 0.8 : 1;
  const bloom = 1 + Math.min(1.6, (heat || 0) * 0.55);
  return base * stanceMul * bloom * 0.01745;
}

/** Touch look slowdown near a visible hostile. 1 = no assist, lower = slower.
 *  Off at Elite and when aim assist is set to off. */
export function aimAssistScale(game) {
  const diff = game.cfg?.difficulty || game.settings?.difficulty;
  if (diff === 'elite') return 1;
  const level = game.settings?.aimAssist || 'low';
  if (level === 'off') return 1;
  // Touch only — gamepad players aim themselves.
  if (game.input?.padConnected && game.input?.mode === 'pad' && game.input.lookId < 0) return 1;
  const str = level === 'med' ? 0.42 : 0.24;
  const diffMul = diff === 'recruit' ? 1 : diff === 'regular' ? 0.75 : 0.5;
  const t = game._aimAssistNear;
  if (!t) return 1;
  const k = Math.max(0, 1 - t.ang / 0.22);
  return 1 - str * diffMul * k;
}

export function markAimAssistNear(game, target) {
  game._aimAssistNear = target;
}
