/** On-device input check: open with ?inputtest=1 or Settings → Controls Test. */

import { saveSettings, setAxisTweak, DEFAULTS } from './settings.js?v=iv-4.1.2-t2';
import { screenOrientationAngle } from './input.js?v=iv-4.1.2-t2';

const AXES = [
  ['lookX', 'Look X (right)'],
  ['lookY', 'Look Y (down +)'],
  ['moveX', 'Move X (right)'],
  ['moveY', 'Move Y (forward)'],
];

export function shouldOpenInputTest() {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('inputtest');
    return v === '1' || v === 'true' || v === 'yes';
  } catch {
    return false;
  }
}

export function mountInputTest(game, { open = false } = {}) {
  if (!game) return;
  let root = document.getElementById('input-test');
  if (!root) {
    root = document.createElement('div');
    root.id = 'input-test';
    root.hidden = true;
    document.body.appendChild(root);
  }
  const s = game.settings;
  if (!s.axisTweaks) s.axisTweaks = { ...DEFAULTS.axisTweaks };

  const render = () => {
    const tw = s.axisTweaks || {};
    const flipBtn = (key, label) => {
      const on = tw[key] === -1;
      return `<button type="button" class="it-btn ${on ? 'on' : ''}" data-it="flip" data-k="${key}">${label}: ${on ? 'FLIPPED' : 'NORMAL'}</button>`;
    };
    root.innerHTML = `
      <div class="it-panel">
        <div class="it-head">
          <strong>Controls Test</strong>
          <button type="button" class="it-close" data-it="close" aria-label="Close">×</button>
        </div>
        <p class="it-hint">Drag to look, use the stick to move. Drag right should yaw right; drag up should look up (Invert Y off). Stick up should walk forward. Use Flip if a real device still inverts an axis — it is saved in settings.</p>
        <div class="it-meta" id="it-meta"></div>
        <div class="it-arrows">
          <div class="it-cell" data-ch="look"><div class="it-lab">LOOK</div><div class="it-arr" id="it-look">•</div><div class="it-num" id="it-lookn"></div></div>
          <div class="it-cell" data-ch="move"><div class="it-lab">MOVE</div><div class="it-arr" id="it-move">•</div><div class="it-num" id="it-moven"></div></div>
          <div class="it-cell" data-ch="drone"><div class="it-lab">DRONE</div><div class="it-arr" id="it-drone">•</div><div class="it-num" id="it-dronen"></div></div>
          <div class="it-cell" data-ch="pad"><div class="it-lab">PAD</div><div class="it-arr" id="it-pad">•</div><div class="it-num" id="it-padn"></div></div>
        </div>
        <div class="it-flips">
          ${AXES.map(([k, lab]) => flipBtn(k, lab)).join('')}
          <button type="button" class="it-btn ${tw.swapLook ? 'on' : ''}" data-it="swap" data-k="swapLook">Swap look X/Y: ${tw.swapLook ? 'ON' : 'OFF'}</button>
          <button type="button" class="it-btn ${tw.swapMove ? 'on' : ''}" data-it="swap" data-k="swapMove">Swap move X/Y: ${tw.swapMove ? 'ON' : 'OFF'}</button>
        </div>
        <div class="it-row">
          <label>Pad mapping
            <select id="it-padmap">
              <option value="auto">auto</option>
              <option value="standard">standard (axes 2/3)</option>
              <option value="axes-34">non-standard (axes 3/4)</option>
            </select>
          </label>
          <label class="it-chk"><input type="checkbox" id="it-inverty"> Invert Y</label>
        </div>
        <div class="it-row">
          <button type="button" class="it-btn" data-it="live">Start live check</button>
          <button type="button" class="it-btn" data-it="drone">Enter / exit drone</button>
          <button type="button" class="it-btn" data-it="cams">Cycle cams</button>
        </div>
      </div>
    `;
    const sel = root.querySelector('#it-padmap');
    if (sel) sel.value = s.padMapping || 'auto';
    const inv = root.querySelector('#it-inverty');
    if (inv) inv.checked = s.invertY === true;
  };

  render();

  if (!root._itBound) {
    root._itBound = true;
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-it]');
      if (!b) return;
      const act = b.dataset.it;
      if (act === 'close') { hideInputTest(); return; }
      if (act === 'flip') {
        const k = b.dataset.k;
        const next = (s.axisTweaks?.[k] === -1) ? 1 : -1;
        setAxisTweak(s, k, next);
        saveSettings(s);
        render();
        syncForm();
        return;
      }
      if (act === 'swap') {
        const k = b.dataset.k;
        setAxisTweak(s, k, !s.axisTweaks?.[k]);
        saveSettings(s);
        render();
        syncForm();
        return;
      }
      if (act === 'live') {
        try {
          if (game.running) game.quit(false);
          await game.start({
            side: 'attack', difficulty: 'recruit', bestOf: 1,
            prepTime: 120, actionTime: 180, skipMatchCard: true, godMode: true,
          });
          game.godMode = true;
          game.inMenu = false;
          game.ui?.hide();
          document.getElementById('hud')?.classList.remove('hidden');
          document.getElementById('touch')?.classList.remove('hidden');
          game.toast('Controls test — god mode, 2 min prep');
        } catch (err) {
          console.warn('input test start failed', err);
        }
        return;
      }
      if (act === 'drone') {
        if (game.inDrone || game.droneSys?.active) game.exitDrone();
        else game.enterDrone?.();
        return;
      }
      if (act === 'cams') {
        if (game.inCams || game.droneSys?.camsOn) game.exitCams();
        else game.enterCams?.();
      }
    });
    root.addEventListener('change', (e) => {
      if (e.target.id === 'it-padmap') {
        s.padMapping = e.target.value;
        saveSettings(s);
      }
      if (e.target.id === 'it-inverty') {
        s.invertY = !!e.target.checked;
        saveSettings(s);
      }
    });
  }

  function syncForm() {
    const sel = root.querySelector('#it-padmap');
    if (sel) sel.value = s.padMapping || 'auto';
    const inv = root.querySelector('#it-inverty');
    if (inv) inv.checked = s.invertY === true;
  }

  const arrow = (x, y) => {
    const mag = Math.hypot(x || 0, y || 0);
    if (mag < 0.04) return '•';
    const ang = Math.atan2(x || 0, y || 0) * 180 / Math.PI; // 0 = up (forward / look-up is -lookY)
    // look: lookX right, lookY down. Visual: right = +x, up = -lookY
    return `<span style="display:inline-block;transform:rotate(${ang}deg)">▲</span>`;
  };
  const lookArrow = (lx, ly) => arrow(lx, -(ly || 0));
  const moveArrow = (mx, my) => arrow(mx, my);

  const tick = () => {
    if (root.hidden) { root._itRaf = requestAnimationFrame(tick); return; }
    const d = game.input?.debugState?.() || {};
    const inFeed = !!(game.inDrone || game.droneSys?.active);
    const inCams = !!(game.inCams || game.droneSys?.camsOn);
    const meta = root.querySelector('#it-meta');
    if (meta) {
      const vv = d.visualViewport;
      meta.innerHTML = [
        `orientation angle: <b>${d.angle}</b>`,
        `window.orientation: <b>${d.windowOrientation ?? 'n/a'}</b>`,
        `standalone / A2HS: <b>${d.standalone ? 'yes' : 'no'}</b>`,
        `visualViewport scale: <b>${vv ? Number(vv.scale).toFixed(3) : 'n/a'}</b>`,
        `input path: <b>${[d.useTouch ? 'touch' : null, d.usePointer ? 'pointer' : null].filter(Boolean).join('+') || 'none'}</b>`,
        `pad: <b>${d.padConnected ? (d.padMapping || 'none') : 'not connected'}</b>`,
        `invertY: <b>${d.invertY ? 'on' : 'off'}</b>`,
        `mode: <b>${inFeed ? 'drone' : inCams ? 'cams' : 'on-foot'}</b>`,
      ].join(' · ');
    }
    const set = (id, glyph, text) => {
      const a = root.querySelector('#it-' + id);
      const n = root.querySelector('#it-' + id + 'n');
      if (a) a.innerHTML = glyph;
      if (n) n.textContent = text;
    };
    const lx = d.lookX || 0, ly = d.lookY || 0, mx = d.moveX || 0, my = d.moveY || 0;
    set('look', lookArrow(lx, ly), `x ${lx.toFixed(3)}  y ${ly.toFixed(3)}`);
    set('move', moveArrow(mx, my), `x ${mx.toFixed(3)}  y ${my.toFixed(3)}`);
    set('drone', inFeed ? lookArrow(lx, ly) + ' ' + moveArrow(mx, my) : '—', inFeed ? 'steer + look' : 'not in drone');
    const axes = (d.padAxes || []).map((v, i) => `${i}:${Number(v).toFixed(2)}`).join(' ');
    set('pad', d.padConnected ? lookArrow(lx, ly) + ' ' + moveArrow(mx, my) : '—', d.padConnected ? `${d.padMapping} ${axes}` : 'no pad');
    root._itRaf = requestAnimationFrame(tick);
  };
  if (!root._itRaf) root._itRaf = requestAnimationFrame(tick);

  game._inputTest = { show, hide: hideInputTest, root };
  if (open) show();
  return game._inputTest;

  function show() {
    root.hidden = false;
    root.classList.add('open');
    render();
    syncForm();
  }
}

export function hideInputTest() {
  const root = document.getElementById('input-test');
  if (root) { root.hidden = true; root.classList.remove('open'); }
}

export function showInputTest(game) {
  const h = game?._inputTest || mountInputTest(game, { open: true });
  const root = document.getElementById('input-test');
  if (root) { root.hidden = false; root.classList.add('open'); }
}
