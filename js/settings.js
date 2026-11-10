import { STORAGE_KEY, DEFAULT_BEST_OF } from './config.js?v=iv-3.7.1';
import { normalizeDifficulty } from './difficulty.js?v=iv-3.7.1';

export const DEFAULTS = {
  quality: 'auto',
  sensitivity: 1,
  adsSensitivity: 0.7,
  gyro: 'off',          // off | always | ads
  gyroYaw: 1,
  gyroPitch: 1,
  gyroDeadzone: 0.12,
  gyroSmooth: 0.18,
  invertY: false,
  aimAssist: 'low',     // off | low | med
  leanMode: 'toggle',   // toggle | hold
  adsMode: 'toggle',
  adsModeUser: false,
  sprintMode: 'lock',   // lock (past stick edge) | hold
  fireOnAim: 'off',     // off | hip | always
  leftFire: false,
  hudPreset: 'thumb',   // thumb | claw
  hudLayout: null,
  hudOpacity: 0.9,
  crosshair: {
    style: 'cross',     // cross | dot | circle | t
    color: '#ffffff',
    size: 18,
    thick: 2,
    gap: 5,
    outline: 2,
    opacity: 0.95,
  },
  padMap: null,
  side: 'attack',
  difficulty: 'veteran',
  bestOf: DEFAULT_BEST_OF,
  operator: { attack: 'forge', defend: 'rivet' },
  loadout: {},
};

function clone(o) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(o);
  } catch {}
  return JSON.parse(JSON.stringify(o));
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULTS);
    const d = JSON.parse(raw);
    const out = clone(DEFAULTS);
    merge(out, d);
    // Fresh installs and corrupt/legacy values must not invert look.
    out.invertY = out.invertY === true;
    out.difficulty = normalizeDifficulty(out.difficulty);
    // iv-3.0.3: touch defaults to Toggle, controller to Hold, unless the
    // player has explicitly picked a mode (legacy saves had adsMode:'hold'
    // from the old default and are treated as unset).
    if (!Object.prototype.hasOwnProperty.call(d, 'adsModeUser')) {
      out.adsMode = DEFAULTS.adsMode;
      out.adsModeUser = false;
    } else {
      out.adsMode = out.adsMode === 'hold' ? 'hold' : 'toggle';
      out.adsModeUser = out.adsModeUser === true;
    }
    return out;
  } catch {
    return clone(DEFAULTS);
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

function merge(a, b) {
  if (!b || typeof b !== 'object') return;
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]);
    else if (b[k] !== undefined) a[k] = b[k];
  }
}

/** Resolve ADS mode for the active device. Touch/mouse: Toggle unless the
 *  player set a preference. Controller: Hold by default, with an option. */
export function resolvedAdsMode(settings, input) {
  if (settings?.adsModeUser) return settings.adsMode === 'hold' ? 'hold' : 'toggle';
  if (input?.padConnected || input?.mode === 'pad') return 'hold';
  return 'toggle';
}
