import { BUILD, TITLE, SHORT_TITLE, MAP_NAME } from './version.js?v=iv-4.1.0';

export { BUILD, TITLE, SHORT_TITLE, MAP_NAME };

export const PREP_TIME = 45;
export const ACTION_TIME = 180;
export const PLANT_TIME = 7;
export const DEFUSE_TIME = 7;
export const BOMB_TIME = 45;
export const INTERMISSION = 12;
export const REINFORCE_TIME = 4;
export const DEFAULT_BEST_OF = 3;

export const EYE = { stand: 1.55, crouch: 1.00, prone: 0.35 };
export const COL_H = { stand: 1.78, crouch: 1.10, prone: 0.48 };
export const COL_R = 0.32;
export const HUMAN = { height: 1.80, heads: 7.5, head: 0.24 };

export const SPEED = {
  walk: [3.25, 3.15, 3.00],   // ~3.2 m/s for a speed-3 operator
  run: [4.40, 4.15, 3.85],
  sprint: [5.10, 4.75, 4.35], // ~5 m/s sprint
  crouch: 1.80,
  prone: 0.85,
  rappel: 2.60,
  ads: 2.20,                  // ADS slow for every operator
};
export const ADS_IN = { smg: 0.22, pdw: 0.22, ar: 0.28, shotgun: 0.34, dmr: 0.34, pistol: 0.22 };
export const ADS_OUT = 0.16;
export const SPRINT_OUT_FIRE = 0.18;
export const SPRINT_OUT_ADS = 0.26;
export const CANCEL_READY = 0.20; // gadget/reload cancel → shootable

export const BUDGET = {
  dprMax: 1.5,
  drawCalls: 150,
  tris: 400000,
  texMB: 150,
};

export const QUALITY = {
  low:  { dpr: 0.7, aniso: 1, shadows: false, bloom: false, aa: 'none', env: false, probes: false, tex: 512 },
  med:  { dpr: 1.0, aniso: 4, shadows: false, bloom: false, aa: 'fxaa', env: true,  probes: true,  tex: 1024 },
  high: { dpr: 1.5, aniso: 8, shadows: true,  bloom: true,  aa: 'fxaa', env: true,  probes: true,  tex: 1024 },
};

export const AIM_ASSIST = {
  off: 0,
  low: 0.18,
  med: 0.38,
};

export const STORAGE_KEY = 'ironveil-v1';
