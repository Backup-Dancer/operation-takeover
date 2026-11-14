/**
 * Gamepad + directional focus for out-of-match screens.
 * D-pad / left stick moves between [data-nav] controls.
 * South (A) activates, East (B) goes back, Start opens the focused Play control.
 */
export class GamepadNav {
  constructor(fe) {
    this.fe = fe;
    this.i = 0;
    this._prev = {};
    this._stickLat = false;
    this._stickVert = false;
  }

  items() {
    const root = this.fe.activeEl();
    if (!root) return [];
    return [...root.querySelectorAll('[data-nav]:not([disabled])')].filter(el => {
      if (el.closest('.hidden')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  refresh() {
    const items = this.items();
    if (!items.length) return;
    if (this.i >= items.length) this.i = 0;
    this._paint(items);
  }

  focusIndex(i) {
    const items = this.items();
    if (!items.length) return;
    this.i = (i + items.length) % items.length;
    this._paint(items);
    items[this.i].focus?.();
  }

  _paint(items) {
    for (const el of items) el.classList.toggle('nav-focus', el === items[this.i]);
  }

  activate() {
    const items = this.items();
    const el = items[this.i];
    if (!el) return;
    el.click();
  }

  back() { this.fe.back(); }

  poll(dt) {
    const pads = navigator.getGamepads?.() || [];
    const gp = pads[0] || window.__pad;
    if (!gp) return;
    const B = gp.buttons || [], A = gp.axes || [];
    const pressed = i => !!(B[i] && (B[i].pressed || B[i].value > 0.5));
    const edge = (i) => {
      const p = pressed(i);
      const was = this._prev[i];
      this._prev[i] = p;
      return p && !was;
    };
    const items = this.items();
    if (!items.length) return;

    const move = (dx, dy) => {
      if (!dx && !dy) return;
      const cur = items[this.i] || items[0];
      const cr = cur.getBoundingClientRect();
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      let best = -1, bestScore = 1e12;
      items.forEach((el, idx) => {
        if (el === cur) return;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const vx = x - cx, vy = y - cy;
        const dot = vx * dx + vy * dy;
        if (dot <= 4) return;
        const dist = Math.hypot(vx, vy);
        const off = Math.hypot(vx - dx * dot, vy - dy * dot);
        const score = dist + off * 2;
        if (score < bestScore) { bestScore = score; best = idx; }
      });
      if (best >= 0) this.focusIndex(best);
    };

    if (edge(14) || (A[0] < -0.6 && !this._stickLat)) { move(-1, 0); this._stickLat = true; }
    else if (edge(15) || (A[0] > 0.6 && !this._stickLat)) { move(1, 0); this._stickLat = true; }
    if (edge(12) || (A[1] < -0.6 && !this._stickVert)) { move(0, -1); this._stickVert = true; }
    else if (edge(13) || (A[1] > 0.6 && !this._stickVert)) { move(0, 1); this._stickVert = true; }
    if (Math.abs(A[0] || 0) < 0.4) this._stickLat = false;
    if (Math.abs(A[1] || 0) < 0.4) this._stickVert = false;

    if (edge(0) || edge(9)) this.activate();
    if (edge(1)) this.back();

    // Right stick still yaws the operator when the showcase is up.
    const rx = A[2] || 0;
    if (Math.abs(rx) > 0.12) this.fe.game.menu?.showcase?.yawBy(rx * (dt || 0.016) * 3);
  }
}
