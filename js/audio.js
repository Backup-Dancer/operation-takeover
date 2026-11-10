let ctx, master, unlocked = false;
const buffers = new Map();

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
  } catch (e) {
    console.warn('audio unlock failed', e);
    unlocked = true;
  }
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
  step: () => noise(0.05, 0.06, 80, 400),
  door: () => { beep(90, 0.12, 'triangle', 0.08, -20); noise(0.1, 0.08, 100, 800); },
  break: () => noise(0.25, 0.28, 200, 6000),
  glass: () => { noise(0.22, 0.32, 800, 9000); beep(1400, 0.08, 'triangle', 0.06, -800); },
  plant: () => beep(660, 0.08, 'square', 0.08),
  arm: () => beep(880, 0.04, 'square', 0.07),
  armBeep: () => beep(1200, 0.03, 'square', 0.05),
  explode: () => { noise(0.4, 0.45, 40, 800); beep(60, 0.3, 'sawtooth', 0.2, -40); },
  ui: () => beep(440, 0.04, 'square', 0.04),
  ping: () => { beep(980, 0.08, 'sine', 0.07); beep(1320, 0.1, 'sine', 0.05); },
  rappel: () => noise(0.15, 0.1, 100, 600),
  flash: () => noise(0.2, 0.25, 1000, 8000),
  buzz: () => beep(140, 0.2, 'sawtooth', 0.06),
};

export function startMusic() { /* no loop in v1; keep heap small */ }
