let ctx, master, unlocked = false;
const buffers = new Map();
const DISPATCH_URL = 'assets/audio/dispatch-prep.ogg';
let _dispatchRaw = null;

export function isUnlocked() { return unlocked; }

export async function unlock() {
  if (unlocked) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { unlocked = true; return; }
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume(),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    }
    if (!master && ctx) {
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
    }
    unlocked = true;
    loadDispatch().catch(() => {});
  } catch (e) {
    console.warn('audio unlock failed', e);
    unlocked = true;
  }
}

export async function loadDispatch() {
  if (buffers.has('dispatch')) return true;
  try {
    const r = await fetch(DISPATCH_URL);
    if (!r.ok) return false;
    const buf = await r.arrayBuffer();
    _dispatchRaw = buf;
    if (ctx) {
      const copy = buf.slice(0);
      const decoded = await ctx.decodeAudioData(copy);
      buffers.set('dispatch', decoded);
    }
    return true;
  } catch (e) {
    console.warn('dispatch voice failed to load', e);
    return false;
  }
}

export function dispatchReady() {
  return buffers.has('dispatch') || !!_dispatchRaw;
}

export function playDispatch() {
  if (!unlocked || !ctx) return false;
  const play = (b) => {
    const src = ctx.createBufferSource();
    src.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 1.05;
    src.connect(g); g.connect(master);
    src.start();
    return true;
  };
  const b = buffers.get('dispatch');
  if (b) return play(b);
  if (_dispatchRaw && ctx) {
    ctx.decodeAudioData(_dispatchRaw.slice(0)).then((dec) => {
      buffers.set('dispatch', dec);
      play(dec);
    }).catch(() => {});
    return true;
  }
  loadDispatch().then((ok) => { if (ok) playDispatch(); });
  return false;
}

function beep(freq, dur, type = 'square', vol = 0.12, slide = 0) {
  if (!unlocked || !ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.2, hp = 800, lp = 4000) {
  if (!unlocked || !ctx) return;
  const n = ctx.sampleRate * dur | 0;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f1 = ctx.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  src.connect(f1); f1.connect(f2); f2.connect(g); g.connect(master);
  src.start();
}

export const sfx = {
  fire: (shotgun) => { noise(shotgun ? 0.18 : 0.07, shotgun ? 0.35 : 0.22, 200, shotgun ? 2500 : 5000); beep(shotgun ? 80 : 140, 0.06, 'sawtooth', 0.05, -40); },
  reload: () => { beep(220, 0.05, 'square', 0.06); setTimeout(() => beep(180, 0.06, 'square', 0.05), 120); },
  hit: () => beep(180, 0.05, 'sawtooth', 0.08, -80),
  head: () => { beep(420, 0.06, 'square', 0.08); beep(880, 0.04, 'sine', 0.05); },
  step: (surface, vol) => footstep(surface, vol),
  door: () => { beep(90, 0.12, 'triangle', 0.08, -20); noise(0.1, 0.08, 100, 800); },
  break: () => noise(0.25, 0.28, 200, 6000),
  glass: () => { noise(0.22, 0.32, 800, 9000); beep(1400, 0.08, 'triangle', 0.06, -800); },
  plant: () => beep(660, 0.08, 'square', 0.08),
  arm: () => beep(880, 0.04, 'square', 0.07),
  armBeep: () => beep(1200, 0.03, 'square', 0.05),
  explode: () => { noise(0.4, 0.45, 40, 800); beep(60, 0.3, 'sawtooth', 0.2, -40); },
  ui: () => beep(440, 0.04, 'square', 0.04),
  ping: () => { beep(980, 0.08, 'sine', 0.07); beep(1320, 0.1, 'sine', 0.05); },
  droneHop: () => { noise(0.12, 0.16, 120, 900); beep(160, 0.08, 'triangle', 0.06, -60); },
  static: () => noise(0.25, 0.12, 400, 8000),
  rappel: () => noise(0.15, 0.1, 100, 600),
  flash: () => noise(0.2, 0.25, 1000, 8000),
  buzz: () => beep(140, 0.2, 'sawtooth', 0.06),
};

/* Menu beds are file-swappable: drop new loops at
 * assets/audio/warrant-desk/main_menu_loop.{ogg,mp3} and
 * assets/audio/warrant-desk/matchmaking_loop.{ogg,mp3}.
 * Stingers: stinger_win, stinger_loss, stinger_round_start.
 * Never start a bed from a match — stopMusic() on deploy. */
const MUSIC_BASE = 'assets/audio/warrant-desk/';
let musicEl = null;
let musicId = null;
let musicVol = 0.42;
let stingerEl = null;

function musicUrl(id, ext) { return MUSIC_BASE + id + ext; }

function fadeTo(el, target, ms) {
  if (!el) return;
  const from = el.volume;
  const t0 = performance.now();
  const step = (now) => {
    const u = Math.min(1, (now - t0) / Math.max(16, ms));
    try { el.volume = Math.max(0, Math.min(1, from + (target - from) * u)); } catch {}
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function setMusicVolume(v) {
  musicVol = Math.max(0, Math.min(1, v));
  if (musicEl) musicEl.volume = musicVol;
}

export function currentMusic() { return musicId; }

export function startMusic(id = 'main_menu_loop') {
  return playLoop(id);
}

export function playLoop(id, { volume } = {}) {
  if (!id) return;
  if (musicId === id && musicEl && !musicEl.paused) return musicEl;
  const vol = volume == null ? musicVol : volume;
  const prev = musicEl;
  if (prev) {
    fadeTo(prev, 0, 180);
    setTimeout(() => { try { prev.pause(); prev.src = ''; } catch {} }, 220);
  }
  const el = new Audio();
  el.loop = true;
  el.preload = 'auto';
  el.volume = 0;
  const tryPlay = (src) => {
    el.src = src;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
  };
  el.addEventListener('error', () => {
    if (el.src && !el.src.endsWith('.mp3')) tryPlay(musicUrl(id, '.mp3'));
  }, { once: true });
  tryPlay(musicUrl(id, '.ogg'));
  musicEl = el;
  musicId = id;
  fadeTo(el, vol, 220);
  return el;
}

export function playStinger(id, { volume = 0.72 } = {}) {
  if (!id) return;
  try { if (stingerEl) { stingerEl.pause(); stingerEl.src = ''; } } catch {}
  const el = new Audio();
  el.preload = 'auto';
  el.volume = volume;
  const tryPlay = (src) => {
    el.src = src;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
  };
  el.addEventListener('error', () => {
    if (el.src && !el.src.endsWith('.mp3')) tryPlay(musicUrl(id, '.mp3'));
  }, { once: true });
  tryPlay(musicUrl(id, '.ogg'));
  stingerEl = el;
  return el;
}

export function stopMusic() {
  const el = musicEl;
  musicEl = null;
  musicId = null;
  if (!el) return;
  fadeTo(el, 0, 160);
  setTimeout(() => { try { el.pause(); el.src = ''; } catch {} }, 200);
}

const SURF = {
  concrete: [140, 1100],
  wood: [220, 2200],
  metal: [500, 5000],
  dirt: [70, 380],
};

export function footstep(surface = 'concrete', vol = 0.06) {
  const [hp, lp] = SURF[surface] || SURF.concrete;
  noise(0.05, vol ?? 0.06, hp, lp);
}

/** Distance-attenuated gunfire, muffled when occluded. */
export function gunfireAt(dist = 0, occluded = false, shotgun = false) {
  const fall = Math.max(0.08, 1 / (1 + (dist || 0) * 0.08));
  const vol = (shotgun ? 0.35 : 0.22) * fall * (occluded ? 0.55 : 1);
  const lp = occluded ? 900 : (shotgun ? 2500 : 5000);
  noise(shotgun ? 0.18 : 0.07, vol, occluded ? 180 : 200, lp);
  beep(shotgun ? 80 : 140, 0.06, 'sawtooth', 0.05 * fall, -40);
}

export function occludedBetween(world, ax, ay, az, bx, by, bz) {
  if (!world?.pointInSolid) return false;
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    if (world.pointInSolid(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, 0.05, 0.08)) return true;
  }
  return false;
}

/** Original announcer stingers — short tones, not licensed voice. */
export function announce(kind) {
  const lines = {
    action: () => { beep(520, 0.09, 'square', 0.07); setTimeout(() => beep(780, 0.1, 'square', 0.06), 90); },
    plant: () => { beep(440, 0.08, 'square', 0.07); setTimeout(() => beep(660, 0.12, 'square', 0.07), 100); },
    defuse: () => { beep(660, 0.08, 'square', 0.07); setTimeout(() => beep(440, 0.14, 'square', 0.07), 110); },
    detonate: () => { beep(160, 0.2, 'sawtooth', 0.1, -80); },
    win: () => { beep(520, 0.08, 'square', 0.06); setTimeout(() => beep(780, 0.16, 'square', 0.07), 100); },
    lose: () => { beep(300, 0.18, 'triangle', 0.07, -120); },
    down: () => { beep(180, 0.1, 'sawtooth', 0.06, -40); },
  };
  (lines[kind] || lines.action)();
}
