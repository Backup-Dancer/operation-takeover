import { saveSettings, resolvedAdsMode } from './settings.js?v=iv-4.1.2';
import { stickFromDelta, moveFromPad, lookFromDrag, lookFromPad, applyAxisTweaks, unrotateDelta, readPadSticks, detectPadMapping } from './match/axes.js?v=iv-4.1.2';
import { aimAssistScale } from './match/combat.js?v=iv-4.1.2';

/** Clockwise degrees from the device's natural portrait. */
export function screenOrientationAngle() {
  try {
    const so = typeof screen !== 'undefined' ? screen.orientation : null;
    if (so && Number.isFinite(so.angle)) return ((so.angle % 360) + 360) % 360;
  } catch {}
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    return ((window.orientation % 360) + 360) % 360;
  }
  return 0;
}

/**
 * Map DeviceMotion rotationRate (deg/s, device-fixed axes) to look rates.
 * yaw > 0 = turn right; pitch > 0 = look up.
 * angle 90 = landscape, clockwise 90 from portrait (home/USB typically on the right);
 * angle 270 / window.orientation -90 = the other landscape.
 */
export function gyroYawPitch(rr, angle) {
  const a = ((Number(angle) % 360) + 360) % 360;
  const x = rr?.beta || 0;   // around device +X (portrait-right)
  const y = rr?.gamma || 0;  // around device +Y (portrait-top)
  const z = rr?.alpha || 0;  // around device +Z (out of screen)
  if (a === 90) {
    // device +X points down, +Y points right. World-up is -X.
    return { yaw: -x, pitch: y };
  }
  if (a === 270) {
    // device +X points up, +Y points left. World-up is +X.
    return { yaw: x, pitch: -y };
  }
  if (a === 180) {
    return { yaw: -z, pitch: -x };
  }
  // Portrait: keep the historical alpha=yaw, beta-as-lookY mapping
  // (positive beta was look-down / positive lookY).
  return { yaw: z, pitch: -x };
}

function noop() {}

/** Touch-fallback events must never throw in _stickDown / _press. */
function synthPointer(t, target) {
  return {
    pointerId: 1000 + t.identifier,
    clientX: t.clientX,
    clientY: t.clientY,
    pointerType: 'touch',
    target: target || (typeof document !== 'undefined' && document.elementFromPoint(t.clientX, t.clientY)) || t.target,
    preventDefault: noop,
    stopPropagation: noop,
    stopImmediatePropagation: noop,
  };
}

function safePrevent(e) {
  try { e?.preventDefault?.(); } catch {}
  try { e?.stopPropagation?.(); } catch {}
}

function capturePointer(el, e) {
  if (!el || e == null || e.pointerId == null) return;
  if (typeof el.setPointerCapture !== 'function') return;
  try { el.setPointerCapture(e.pointerId); } catch {}
}


const DEFAULT_LAYOUT = {
  thumb: {
    'stick-base': { l: 22, b: 18 },
    'tb-fire': { r: 14, b: 66, w: 72, h: 72 },
    'tb-fire-l': { l: 154, b: 22, w: 64, h: 64, hide: true },
    'tb-ads': { r: 96, b: 78, w: 44, h: 44 },
    'tb-crouch': { r: 96, b: 130, w: 44, h: 44 },
    'tb-prone': { r: 96, b: 182, w: 44, h: 44 },
    'tb-leanl': { r: 56, b: 148, w: 32, h: 32 },
    'tb-leanr': { r: 18, b: 148, w: 32, h: 32 },
    'tb-reload': { r: 28, b: 196, w: 44, h: 44 },
    'tb-gadget': { r: 148, b: 182, w: 44, h: 44 },
    'tb-gadget2': { r: 148, b: 130, w: 44, h: 44 },
    'tb-drone': { r: 16, t: 8, w: 44, h: 44 },
    'tb-cams': { r: 16, t: 8, w: 44, h: 44 },
    'tb-interact': { cx: 0.5, b: 62, w: 108, h: 40 },
    'tb-swap': { r: 16, t: 60, w: 40, h: 40 },
    'tb-ping': { r: 148, b: 78, w: 44, h: 44 },
    'tb-rappel': { cx: 0.5, b: 110, w: 108, h: 40 },
    'tb-detonate': { cx: 0.5, t: 70, w: 120, h: 48 },
    'tb-pause': { l: 10, t: 8, w: 44, h: 44 },
    'tb-score': { l: 58, t: 8, w: 44, h: 44 },
    'tb-sprint': { l: 54, b: 148, w: 56, h: 56 },
    'tb-hop': { r: 16, b: 66, w: 72, h: 72, hide: true },
    'tb-scan': { r: 16, b: 152, w: 92, h: 92, hide: true },
    'tb-switch': { r: 100, b: 74, w: 72, h: 48, hide: true },
    'tb-feed-exit': { l: 10, t: 60, w: 64, h: 44, hide: true },
  },
  claw: {
    'stick-base': { l: 22, b: 18 },
    'tb-fire': { r: 14, b: 66, w: 72, h: 72 },
    'tb-fire-l': { l: 154, b: 22, w: 64, h: 64, hide: false },
    'tb-ads': { r: 96, b: 78, w: 44, h: 44 },
    'tb-crouch': { r: 96, b: 130, w: 44, h: 44 },
    'tb-prone': { r: 96, b: 182, w: 44, h: 44 },
    'tb-leanl': { r: 56, b: 148, w: 32, h: 32 },
    'tb-leanr': { r: 18, b: 148, w: 32, h: 32 },
    'tb-reload': { r: 28, b: 196, w: 44, h: 44 },
    'tb-gadget': { r: 148, b: 182, w: 44, h: 44 },
    'tb-gadget2': { r: 148, b: 130, w: 44, h: 44 },
    'tb-drone': { r: 16, t: 8, w: 44, h: 44 },
    'tb-cams': { r: 16, t: 8, w: 44, h: 44 },
    'tb-interact': { cx: 0.5, b: 62, w: 108, h: 40 },
    'tb-swap': { r: 16, t: 60, w: 40, h: 40 },
    'tb-ping': { r: 148, b: 78, w: 44, h: 44 },
    'tb-rappel': { cx: 0.5, b: 110, w: 108, h: 40 },
    'tb-detonate': { cx: 0.5, t: 70, w: 120, h: 48 },
    'tb-pause': { l: 10, t: 8, w: 44, h: 44 },
    'tb-score': { l: 58, t: 8, w: 44, h: 44 },
    'tb-sprint': { l: 54, b: 148, w: 56, h: 56 },
    'tb-hop': { r: 16, b: 66, w: 72, h: 72, hide: true },
    'tb-scan': { r: 16, b: 152, w: 92, h: 92, hide: true },
    'tb-switch': { r: 100, b: 74, w: 72, h: 48, hide: true },
    'tb-feed-exit': { l: 10, t: 60, w: 64, h: 44, hide: true },
  },
};

const STD_PAD = {
  fire: 7, ads: 6, jump: 0, reload: 2, interactHold: 2, swap: 3, crouch: 1,
  sprint: 10, melee: 11, leanL: 4, leanR: 5, pause: 9, score: 8,
  // D-pad
  dUp: 12, dDown: 13, dLeft: 14, dRight: 15,
};

export class Input {
  constructor(game, settings) {
    this.game = game;
    this.settings = settings;
    this.mode = 'touch';
    this.events = new Set();
    this.held = new Set();
    this.moveX = 0; this.moveY = 0;
    this.lookX = 0; this.lookY = 0;
    this.ads = false;
    this.fire = false;
    this.leanHold = 0;
    this._padLean = 0;
    this.padConnected = false;
    this.stick = { active: false, id: -1, x: 0, y: 0, cx: 0, cy: 0 };
    this.lookId = -1;
    this.lookLast = null;
    this.btnTouches = new Map();
    this._ctrlHold = 0;
    this._padPrev = {};
    this.padMap = { ...STD_PAD, ...(settings.padMap || {}) };
    this._bindDom();
    this._bindKeys();
    this._bindPad();
    this.applyLayout();
  }

  _bindDom() {
    const touch = document.getElementById('touch');
    const stick = document.getElementById('stick-base');
    // Bind TouchEvent and PointerEvent together and de-dupe. iOS Safari
    // fires both for every finger; handling both without a de-dupe doubled
    // toggles. Pointer-only was also wrong: Playwright then passed on the
    // pointer path while a real iPhone still delivers TouchEvents (and
    // Pointer Events for a second finger are unreliable on iOS).
    // __IV_FORCE_TOUCH / __IV_FORCE_POINTER pin a single path for tests.
    const forceTouch = typeof window !== 'undefined' && !!window.__IV_FORCE_TOUCH;
    const forcePointer = typeof window !== 'undefined' && !!window.__IV_FORCE_POINTER;
    const hasPointer = typeof window.PointerEvent === 'function';
    const touchy = (typeof window !== 'undefined') && (
      'ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0)
    );
    const bindPointer = hasPointer && !forceTouch;
    const bindTouch = forceTouch || (!forcePointer && (touchy || !hasPointer));
    this._usePointer = bindPointer;
    this._useTouch = bindTouch;
    this._recentInput = [];
    if (bindPointer) {
      touch.addEventListener('pointerdown', e => this._pDown(e), { passive: false });
      touch.addEventListener('pointermove', e => this._pMove(e), { passive: false });
      touch.addEventListener('pointerup', e => this._pUp(e), { passive: false });
      touch.addEventListener('pointercancel', e => this._pUp(e), { passive: false });
      stick.addEventListener('pointerdown', e => this._stickDown(e), { passive: false });
    }
    if (bindTouch) {
      touch.addEventListener('touchstart', e => this._touchStart(e), { passive: false });
      touch.addEventListener('touchmove', e => this._touchMove(e), { passive: false });
      touch.addEventListener('touchend', e => this._touchEnd(e));
      touch.addEventListener('touchcancel', e => this._touchEnd(e));
    }
    addEventListener('contextmenu', e => e.preventDefault());
    this._bindOrientation();
  }

  _bindOrientation() {
    if (this._orientBound) return;
    this._orientBound = true;
    const reset = () => this._resetGestures();
    addEventListener('orientationchange', reset);
    addEventListener('resize', reset);
    try {
      visualViewport?.addEventListener('resize', reset);
      visualViewport?.addEventListener('scroll', () => {
        if (this.stick.active) this._recomputeStickCenter();
      });
    } catch {}
  }

  _resetGestures() {
    this.lookId = -1;
    this.lookLast = null;
    if (this.stick.active) this._stickUp();
  }

  _recomputeStickCenter() {
    const stick = document.getElementById('stick-base');
    if (!stick) return;
    const r = stick.getBoundingClientRect();
    this.stick.cx = r.left + r.width / 2;
    this.stick.cy = r.top + r.height / 2;
    this.stick.r = r.width / 2;
  }

  _isDupe(phase, x, y, source) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const rec = this._recentInput || (this._recentInput = []);
    while (rec.length && now - rec[0].t > 80) rec.shift();
    // Only collapse the iOS pair (touch + pointer for the same finger).
    // Two real TouchEvents in a row at the same point must still count.
    return rec.some(r => r.phase === phase && r.source !== source
      && now - r.t < 50 && Math.hypot(r.x - x, r.y - y) < 6);
  }

  _markInput(phase, x, y, source) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const rec = this._recentInput || (this._recentInput = []);
    rec.push({ phase, x, y, t: now, source: source || 'unknown' });
    if (rec.length > 24) rec.shift();
  }

  _screenDelta(dx, dy) {
    const el = document.getElementById('touch') || document.getElementById('game') || document.body;
    return unrotateDelta(dx, dy, el);
  }

  _touchStart(e) {
    safePrevent(e);
    for (const t of e.changedTouches) {
      if (this._isDupe('start', t.clientX, t.clientY, 'touch')) continue;
      this._markInput('start', t.clientX, t.clientY, 'touch');
      const ev = synthPointer(t, document.elementFromPoint(t.clientX, t.clientY) || e.target);
      const el = ev.target?.closest?.('[data-ctl],.tbtn,#stick-base');
      if (el && (el.id === 'stick-base' || el.id === 'stick-knob')) this._stickDown(ev, 'touch');
      else this._pDown(ev, true);
    }
  }
  _touchMove(e) {
    safePrevent(e);
    for (const t of e.changedTouches) {
      if (this._isDupe('move', t.clientX, t.clientY, 'touch')) continue;
      this._markInput('move', t.clientX, t.clientY, 'touch');
      const ev = synthPointer(t, e.target);
      this._pMove(ev, true);
    }
  }
  _touchEnd(e) {
    for (const t of e.changedTouches) {
      if (this._isDupe('end', t.clientX, t.clientY, 'touch')) continue;
      this._markInput('end', t.clientX, t.clientY, 'touch');
      const ev = synthPointer(t, e.target);
      this._pUp(ev, true);
      if (this.stick.id === ev.pointerId) this._stickUp();
    }
  }

  _ctlFromEvent(e) {
    const el = e.target.closest('[data-ctl],.tbtn,#stick-base');
    return el;
  }

  _pDown(e, fromTouch = false) {
    if (this.hudEdit) return this._editDown(e);
    if (!fromTouch) {
      if (this._isDupe('start', e.clientX, e.clientY, 'pointer')) return;
      this._markInput('start', e.clientX, e.clientY, 'pointer');
    }
    const el = this._ctlFromEvent(e);
    if (!el) {
      // look drag if on look zone, the touch layer, the canvas, or empty hud
      const t = e.target;
      if (!t || t.id === 'look-zone' || t.id === 'touch' || t.id === 'game'
          || t.closest?.('#look-zone, #touch, #game, #hud, canvas')) this._lookStart(e);
      return;
    }
    if (el.id === 'stick-base' || el.id === 'stick-knob') return;
    const ctl = el.dataset.ctl;
    if (!ctl) return;
    e.preventDefault();
    this.btnTouches.set(e.pointerId, { ctl, el });
    el.classList.add('down');
    this._press(ctl, true, e);
  }
  _pMove(e, fromTouch = false) {
    if (this.hudEdit) return this._editMove(e);
    if (!fromTouch) {
      if (this._isDupe('move', e.clientX, e.clientY, 'pointer')) return;
      this._markInput('move', e.clientX, e.clientY, 'pointer');
    }
    if (e.pointerId === this.stick.id) this._stickMove(e);
    if (e.pointerId === this.lookId) this._lookMove(e);
  }
  _pUp(e, fromTouch = false) {
    if (this.hudEdit) return this._editUp(e);
    if (!fromTouch) {
      if (this._isDupe('end', e.clientX, e.clientY, 'pointer')) return;
      this._markInput('end', e.clientX, e.clientY, 'pointer');
    }
    if (e.pointerId === this.stick.id) this._stickUp();
    if (e.pointerId === this.lookId) this.lookId = -1;
    const rec = this.btnTouches.get(e.pointerId);
    if (rec) {
      rec.el.classList.remove('down');
      this._press(rec.ctl, false, e);
      this.btnTouches.delete(e.pointerId);
    }
  }

  _press(ctl, down, ev) {
    const p = this.game.player;
    const s = this.settings;
    if (ctl === 'fire' || ctl === 'fireL') { this.fire = down; return; }
    if (ctl === 'ads') {
      const held = this._downCtl || (this._downCtl = new Set());
      if (!down) held.delete('ads');
      else if (held.has('ads')) return;
      else held.add('ads');
      if (resolvedAdsMode(s, this) === 'toggle') { if (down) p.adsToggle = !p.adsToggle; }
      else this.ads = down;
      return;
    }
    if (ctl === 'leanL' || ctl === 'leanR') {
      const dir = ctl === 'leanL' ? -1 : 1;
      const held = this._downCtl || (this._downCtl = new Set());
      if (!down) held.delete(ctl);
      else if (held.has(ctl)) return;
      else held.add(ctl);
      if (s.leanMode === 'hold') this.leanHold = down ? dir : (this.leanHold === dir ? 0 : this.leanHold);
      else if (down) {
        p.leanT = p.leanT === dir ? 0 : dir;
      }
      this._refreshLeanBtns();
      return;
    }
    if (ctl === 'crouch' && down) {
      if (p.stanceT === 2) this.game.setStance(1);
      else this.game.setStance(p.stanceT === 1 ? 0 : 1);
      return;
    }
    if (ctl === 'prone' && down) {
      if (p.stanceT === 2) this.game.setStance(1);
      else this.game.setStance(2);
      return;
    }
    if (ctl === 'sprint' && down) {
      p.sprintLock = !p.sprintLock;
      p.sprint = !!p.sprintLock;
      return;
    }
    if (down) this.events.add(ctl);
    if (ctl === 'pause' && down) this.events.add('pause');
    if (ctl === 'score' && down) this.events.add('score');
  }

  _refreshLeanBtns() {
    const p = this.game.player;
    document.getElementById('tb-leanl')?.classList.toggle('on', p.leanT < 0 || this.leanHold < 0);
    document.getElementById('tb-leanr')?.classList.toggle('on', p.leanT > 0 || this.leanHold > 0);
  }

  _stickDown(e, source = 'pointer') {
    safePrevent(e);
    if (this._isDupe('stick', e.clientX, e.clientY, source)) return;
    this._markInput('stick', e.clientX, e.clientY, source);
    const stick = document.getElementById('stick-base');
    capturePointer(stick, e);
    const r = stick.getBoundingClientRect();
    this.stick.active = true; this.stick.id = e.pointerId;
    this.stick.cx = r.left + r.width / 2; this.stick.cy = r.top + r.height / 2;
    this.stick.r = r.width / 2;
    this._stickMove(e);
  }
  _stickMove(e) {
    this._recomputeStickCenter();
    const rawX = e.clientX - this.stick.cx, rawY = e.clientY - this.stick.cy;
    const rot = this._screenDelta(rawX, rawY);
    const dx = rot.dx, dy = rot.dy;
    const r = this.stick.r || 60;
    const shaped = stickFromDelta(dx, dy, r);
    const tw = applyAxisTweaks(shaped.x, shaped.y, this.settings.axisTweaks, 'move');
    this.moveX = tw.x;
    this.moveY = tw.y;
    const knob = document.getElementById('stick-knob');
    if (knob) {
      const mag = Math.min(r, Math.hypot(rawX, rawY)) || 0;
      const k = mag ? (mag / Math.hypot(rawX, rawY)) : 0;
      knob.style.transform = `translate(${rawX * k}px,${rawY * k}px)`;
    }
    // sprint lock past the top edge
    if (this.settings.sprintMode === 'lock') {
      if (this.moveY > 0.92 && Math.abs(this.moveX) < 0.5) this.game.player.sprintLock = true;
      if (this.moveY < 0.3) this.game.player.sprintLock = false;
      this.game.player.sprint = this.game.player.sprintLock && this.moveY > 0.2;
    } else {
      this.game.player.sprint = this.moveY > 0.85;
    }
  }
  _stickUp() {
    this.stick.active = false; this.stick.id = -1;
    this.moveX = 0; this.moveY = 0;
    const knob = document.getElementById('stick-knob');
    if (knob) knob.style.transform = '';
    if (this.settings.sprintMode !== 'lock') this.game.player.sprint = false;
  }
  _lookStart(e) {
    this.lookId = e.pointerId;
    this.lookLast = { x: e.clientX, y: e.clientY };
    const zone = document.getElementById('look-zone') || document.getElementById('touch');
    capturePointer(zone, e);
  }
  _lookMove(e) {
    if (!this.lookLast) return;
    const rot = this._screenDelta(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y);
    this.lookLast = { x: e.clientX, y: e.clientY };
    const look = lookFromDrag(rot.dx, rot.dy, {
      sensitivity: this.settings.sensitivity || 1,
      adsSensitivity: this.settings.adsSensitivity || 0.7,
      ads: this.game.player?.ads || 0,
      invertY: this.settings.invertY === true,
    });
    const tw = applyAxisTweaks(look.lookX, look.lookY, this.settings.axisTweaks, 'look');
    const assist = aimAssistScale(this.game);
    this.lookX += tw.x * assist;
    this.lookY += tw.y * assist;
  }

  _bindKeys() {
    const map = {
      KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
      ShiftLeft: 'sprint', ShiftRight: 'sprint',
      ControlLeft: 'crouch', ControlRight: 'crouch',
      KeyZ: 'prone', KeyC: 'crouch',
      KeyR: 'reload', KeyF: 'interact', KeyG: 'gadget', KeyQ: 'gadget2',
      KeyE: 'interact', KeyV: 'melee', KeyT: 'drone', KeyH: 'ping',
      KeyX: 'swap', Space: 'jump', KeyB: 'detonate',
      KeyQ_lean: 'leanL', // handled below
      Tab: 'score', Escape: 'pause',
    };
    this._keys = map;
    addEventListener('keydown', e => {
      if (e.repeat && (e.code === 'Tab' || e.code === 'Escape')) e.preventDefault();
      if (['Tab', 'Space', 'Slash'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyQ' && !e.ctrlKey) { this.game.player.leanT = this.game.player.leanT === -1 ? 0 : -1; this._refreshLeanBtns(); }
      if (e.code === 'KeyE' && e.altKey) { this.game.player.leanT = this.game.player.leanT === 1 ? 0 : 1; this._refreshLeanBtns(); }
      if (e.code === 'KeyC' && e.ctrlKey === false && e.code === 'KeyC') {}
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        this._ctrlHold = performance.now();
      }
      if (e.code === 'KeyZ') { this.events.add('prone'); this.game.setStance(this.game.player.stanceT === 2 ? 1 : 2); }
      if (e.code === 'KeyC' || e.code === 'ControlLeft') {
        if (this.game.player.stanceT === 2) this.game.setStance(1);
        else if (e.code === 'KeyC') this.game.setStance(this.game.player.stanceT === 1 ? 0 : 1);
      }
      if (e.code === 'ShiftLeft') this.game.player.sprint = true;
      if (e.code === 'KeyR') this.events.add('reload');
      if (e.code === 'KeyF' || e.code === 'KeyE') { this.held.add('interact'); this.events.add('interact'); }
      if (e.code === 'KeyG') this.events.add('gadget');
      if (e.code === 'KeyB') this.events.add('detonate');
      if (e.code === 'KeyT') this.events.add('drone');
      if (e.code === 'Space') {
        if (this.game.inDrone || this.game.droneSys?.active) this.events.add('hop');
      }
      if (e.code === 'KeyN' || e.code === 'BracketRight') this.events.add('cycle');
      if (e.code === 'KeyX') this.events.add('swap');
      if (e.code === 'KeyV') this.events.add('melee');
      if (e.code === 'KeyH') this.events.add('ping');
      if (e.code === 'Escape') this.events.add('pause');
      if (e.code === 'Tab') { e.preventDefault(); this.events.add('score'); }
      if (e.code === 'MouseLeft') {}
      this._wasd(e.code, true);
    });
    addEventListener('keyup', e => {
      this._wasd(e.code, false);
      if (e.code === 'ShiftLeft') this.game.player.sprint = false;
      if (e.code === 'KeyF' || e.code === 'KeyE') this.held.delete('interact');
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        const held = performance.now() - (this._ctrlHold || 0);
        if (held > 280) this.game.setStance(2);
        else if (this.game.player.stanceT !== 2) this.game.setStance(this.game.player.stanceT === 1 ? 0 : 1);
      }
    });
    addEventListener('mousedown', e => {
      if (e.button === 0 && this.mode !== 'touch') this.fire = true;
      if (e.button === 2) this._mouseAds(true);
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this._mouseAds(false);
    });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement) {
        const look = lookFromDrag(e.movementX, e.movementY, {
          scale: 0.0022,
          sensitivity: this.settings.sensitivity || 1,
          adsSensitivity: this.settings.adsSensitivity || 0.7,
          ads: this.game.player?.ads || 0,
          invertY: this.settings.invertY === true,
        });
        const assist = aimAssistScale(this.game);
        this.lookX += look.lookX * assist;
        this.lookY += look.lookY * assist;
      }
    });
  }
  _wasd(code, down) {
    const v = down ? 1 : 0;
    if (code === 'KeyW') this._w = v; if (code === 'KeyS') this._s = v;
    if (code === 'KeyA') this._a = v; if (code === 'KeyD') this._d = v;
    if (!this.stick.active) {
      this.moveX = (this._d || 0) - (this._a || 0);
      this.moveY = (this._w || 0) - (this._s || 0);
    }
  }

  _keyMap() { return { KeyZ: 'prone', KeyH: 'ping' }; }

  _bindPad() {
    addEventListener('gamepadconnected', e => {
      this.padConnected = true; this.mode = 'pad';
      this._toggleTouch(false);
    });
    addEventListener('gamepaddisconnected', () => {
      this.padConnected = false; this.mode = 'touch';
      this._toggleTouch(true);
    });
  }

  _toggleTouch(show) {
    const t = document.getElementById('touch');
    if (t) t.classList.toggle('pad-hidden', !show);
  }

  _mouseAds(down) {
    if (resolvedAdsMode(this.settings, this) === 'toggle') {
      if (down) this.game.player.adsToggle = !this.game.player.adsToggle;
    } else {
      this.ads = down;
    }
  }

  /** Face-button glyph shown in context prompts when a pad is connected. */
  interactGlyph() {
    if (!this.padConnected) return '';
    return ' [X]';
  }

  pollPad() {
    const pads = navigator.getGamepads?.() || [];
    const gp = pads[0] || window.__pad;
    if (!gp) return;
    if (!this.padConnected) { this.padConnected = true; this.mode = 'pad'; this._toggleTouch(false); }
    const B = gp.buttons, A = gp.axes, M = this.padMap;
    const pressed = i => !!(B[i] && (B[i].pressed || B[i].value > 0.5));
    const val = i => B[i]?.value || 0;
    const mapping = this.settings.padMapping || 'auto';
    const sticks = readPadSticks(A, mapping);
    this._padMapping = sticks.mapping;
    this._lastPadAxes = Array.from(A || []);
    const dead = Number.isFinite(this.settings.padDeadzone) ? this.settings.padDeadzone : undefined;
    const curve = Number.isFinite(this.settings.padCurve) ? this.settings.padCurve : undefined;
    const mv0 = moveFromPad(sticks.lx, sticks.ly, dead, curve);
    const mv = applyAxisTweaks(mv0.x, mv0.y, this.settings.axisTweaks, 'move');
    this.moveX = mv.x; this.moveY = mv.y;
    if (this.game.player) this.game.player.sprint = pressed(M.sprint) || mv.y > 0.9;
    const look0 = lookFromPad(sticks.rx, sticks.ry, {
      sensitivity: this.settings.sensitivity || 1,
      adsSensitivity: this.settings.adsSensitivity || 0.7,
      ads: this.game.player?.ads || 0,
      invertY: this.settings.invertY === true,
      dead,
    });
    const look = applyAxisTweaks(look0.lookX, look0.lookY, this.settings.axisTweaks, 'look');
    this.lookX += look.x;
    this.lookY += look.y;
    this.fire = val(M.fire) > 0.2;
    const adsDown = val(M.ads) > 0.2;
    if (resolvedAdsMode(this.settings, this) === 'toggle') {
      if (adsDown && !this._padAdsPrev) this.game.player.adsToggle = !this.game.player.adsToggle;
      this.ads = false;
    } else {
      this.ads = adsDown;
    }
    this._padAdsPrev = adsDown;
    const lean = (pressed(M.leanL) ? -1 : 0) + (pressed(M.leanR) ? 1 : 0);
    this.leanHold = lean; this._padLean = lean;
    if (lean) this.game.player.leanT = lean;
    const edge = (i, name) => {
      const p = pressed(i);
      if (p && !this._padPrev[i]) this.events.add(name);
      this._padPrev[i] = p;
    };
    // X / Square: interact when a prompt is up, otherwise reload on tap.
    // Hold still plants / defuses. Melee is the right-stick click.
    if (pressed(M.reload) && !this._padPrev[M.reload]) {
      if (this.game.promptAction) this.events.add('interact');
      else this.events.add('reload');
    }
    this._padPrev[M.reload] = pressed(M.reload);
    edge(M.melee, 'melee');
    edge(M.swap, 'swap');
    edge(M.pause, 'pause');
    edge(M.score, 'score');
    const inFeed = !!(this.game.inDrone || this.game.inCams || this.game.droneSys?.active || this.game.droneSys?.camsOn);
    edge(M.dUp, 'gadget');
    edge(M.dDown, 'drone');
    edge(M.dLeft, 'gadget2');
    edge(M.dRight, 'cams');
    if (inFeed) {
      // A hop (drone), RB ping, B exit, bumpers cycle.
      edge(M.jump, 'hop');
      edge(M.leanR, 'ping');
      edge(M.crouch, 'exitfeed');
      edge(M.leanL, 'cycle');
    } else {
      edge(M.jump, 'rappel');
    }
    if (pressed(M.reload) && B[M.reload]) {
      // hold X to interact
      if (!this._xHold) this._xHold = performance.now();
      if (performance.now() - this._xHold > 220) this.held.add('interact');
    } else this._xHold = 0, this.held.delete('interact');
    if (inFeed) {
      this._bHold = 0;
      return;
    }
    if (pressed(M.crouch)) {
      if (!this._bHold) this._bHold = performance.now();
    } else if (this._bHold) {
      const held = performance.now() - this._bHold;
      this._bHold = 0;
      if (held > 280) this.game.setStance(2);
      else this.game.setStance(this.game.player.stanceT === 1 ? 0 : (this.game.player.stanceT === 2 ? 1 : 1));
    }
  }

  leanIsHold() { return this.settings.leanMode === 'hold'; }

  /* Gyro: rotationRate from DeviceMotionEvent. Permission must be requested from a tap. */
  async enableGyroFromTap() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return false;
      }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch {}
      }
    } catch { return false; }
    this._bindGyro();
    return true;
  }
  _bindGyro() {
    if (this._gyroBound) return;
    this._gyroBound = true;
    addEventListener('devicemotion', e => {
      const mode = this.settings.gyro;
      if (mode === 'off') return;
      if (mode === 'ads' && this.game.player.ads < 0.4) return;
      const rr = e.rotationRate;
      if (!rr) return;
      const dz = this.settings.gyroDeadzone || 0.12;
      const sm = this.settings.gyroSmooth || 0.18;
      const angle = (typeof this._orientationAngle === 'function')
        ? this._orientationAngle()
        : screenOrientationAngle();
      const gp = gyroYawPitch(rr, angle);
      let yaw = gp.yaw, pitch = gp.pitch;
      if (Math.abs(yaw) < dz * 30) yaw = 0;
      if (Math.abs(pitch) < dz * 30) pitch = 0;
      const k = 0.0009;
      // lookY is mouse-like: positive lookY looks down (camera pitch -= lookY).
      const y = yaw * k * (this.settings.gyroYaw || 1);
      const p = -pitch * k * (this.settings.gyroPitch || 1);
      this._gy = (this._gy || 0) * sm + y * (1 - sm);
      this._gp = (this._gp || 0) * sm + p * (1 - sm);
      this.lookX += this._gy;
      this.lookY += this._gp * (this.settings.invertY ? -1 : 1);
    });
  }


  debugState() {
    const vv = (typeof visualViewport !== 'undefined') ? visualViewport : null;
    let standalone = false;
    try {
      standalone = !!(navigator.standalone || window.matchMedia?.('(display-mode: standalone)').matches);
    } catch {}
    return {
      angle: screenOrientationAngle(),
      windowOrientation: (typeof window !== 'undefined') ? window.orientation : null,
      visualViewport: vv ? { width: vv.width, height: vv.height, scale: vv.scale, offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft } : null,
      standalone,
      usePointer: !!this._usePointer,
      useTouch: !!this._useTouch,
      moveX: this.moveX, moveY: this.moveY,
      lookX: this.lookX, lookY: this.lookY,
      invertY: this.settings.invertY === true,
      axisTweaks: { ...(this.settings.axisTweaks || {}) },
      padMapping: this._padMapping || this.settings.padMapping || 'auto',
      padAxes: this._lastPadAxes || [],
      padConnected: !!this.padConnected,
    };
  }

  applyLayout(preset) {
    const pre = preset || this.settings.hudPreset || 'thumb';
    const src = this.settings.hudLayout?.[pre] || DEFAULT_LAYOUT[pre] || DEFAULT_LAYOUT.thumb;
    const sl = 'var(--sl)', sr = 'var(--sr)', st = 'var(--st)', sb = 'var(--sb)';
    for (const [id, L] of Object.entries(src)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.style.left = el.style.right = el.style.top = el.style.bottom = el.style.transform = '';
      if (L.hide) el.classList.add('hidden');
      else if (id === 'tb-fire-l') el.classList.toggle('hidden', !this.settings.leftFire && L.hide !== false);
      if (L.w) el.style.width = L.w + 'px';
      if (L.h) el.style.height = L.h + 'px';
      if (L.l != null) el.style.left = `calc(${L.l}px + ${sl})`;
      if (L.r != null) el.style.right = `calc(${L.r}px + ${sr})`;
      if (L.t != null) el.style.top = `calc(${L.t}px + ${st})`;
      if (L.b != null) el.style.bottom = `calc(${L.b}px + ${sb})`;
      if (L.cx != null) { el.style.left = (L.cx * 100) + '%'; el.style.transform = 'translateX(-50%)'; }
    }
    document.getElementById('tb-fire-l')?.classList.toggle('hidden', !this.settings.leftFire && pre !== 'claw');
  }

  startHudEdit() {
    this.hudEdit = true;
    document.getElementById('touch').classList.add('hud-edit');
    document.getElementById('touch').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
  }
  stopHudEdit(save) {
    this.hudEdit = false;
    document.getElementById('touch').classList.remove('hud-edit');
    if (save) {
      this.settings.hudLayout = this.settings.hudLayout || {};
      // store current inline positions loosely by reading computed style is hard; keep last drag map
      this.settings.hudLayout[this.settings.hudPreset || 'thumb'] = this._editMap || this.settings.hudLayout[this.settings.hudPreset] || DEFAULT_LAYOUT[this.settings.hudPreset || 'thumb'];
      saveSettings(this.settings);
    }
  }
  resetHud() {
    this.settings.hudLayout = null;
    saveSettings(this.settings);
    this.applyLayout(this.settings.hudPreset);
  }
  _editDown(e) {
    const el = e.target.closest('.tbtn,#stick-base');
    if (!el) return;
    this._drag = { el, x: e.clientX, y: e.clientY, l: el.offsetLeft, t: el.offsetTop };
  }
  _editMove(e) {
    if (!this._drag) return;
    const d = this._drag;
    const nx = d.l + (e.clientX - d.x), ny = d.t + (e.clientY - d.y);
    d.el.style.left = nx + 'px'; d.el.style.top = ny + 'px';
    d.el.style.right = d.el.style.bottom = 'auto'; d.el.style.transform = 'none';
  }
  _editUp() { this._drag = null; }

  consume(name) {
    const h = this.events.has(name);
    if (h) this.events.delete(name);
    return h;
  }
}

export { DEFAULT_LAYOUT };
