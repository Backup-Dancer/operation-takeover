import { ATTACKERS, DEFENDERS, getOp, listSide } from './operators.js?v=iv-3.7.1';
import { loadLore, loreFor, loreUnits } from './menu/lore.js?v=iv-3.7.1';
import { cardUrl, hasPortrait, loadBust } from './menu/portraits.js?v=iv-3.7.1';
import { WEAPONS, UTIL, makeLoadout } from './weapons.js?v=iv-3.7.1';
import { saveSettings, DEFAULTS } from './settings.js?v=iv-3.7.1';
import { DIFFICULTY_IDS, normalizeDifficulty } from './difficulty.js?v=iv-3.7.1';
import { QUALITY, TITLE, BUILD } from './config.js?v=iv-3.7.1';

export class UI {
  constructor(game) {
    this.game = game;
    this.stack = ['boot'];
    this._lastAct = -1e9;
    const menus = document.getElementById('menus');
    const fire = (e) => {
      const src = (e.target && e.target.nodeType === 1) ? e.target : (e.target && e.target.parentElement);
      const b = src && src.closest && src.closest('[data-action]');
      if (!b || !menus.contains(b)) return;
      if (e.type === 'pointerup' && e.button != null && e.button !== 0) return;
      if (e.type === 'pointerup' || e.type === 'touchend') {
        try { e.preventDefault(); } catch {}
      }
      const now = performance.now();
      if (now - this._lastAct < 350) return;
      this._lastAct = now;
      this._click(e);
    };
    menus.addEventListener('click', fire);
    menus.addEventListener('pointerup', fire);
    menus.addEventListener('touchend', fire, { passive: false });
    this._renderSettings();
    this._renderControls('touch');
    this._opFocus = 0;
    loadLore().then(() => { if (!document.getElementById('scr-opselect')?.classList.contains('hidden')) this._renderOps(); });
  }
  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    const el = document.getElementById('scr-' + id);
    if (el) el.classList.remove('hidden');
    document.getElementById('menus').classList.toggle('hidden', id === 'none');
    if (id === 'opselect') this._renderOps();
    const menu = this.game.menu;
    if (menu) {
      if (id === 'opselect') menu.setMode('showcase');
      else if (id === 'settings' || id === 'controls' || id === 'credits' || id === 'loadout') menu.setMode('dim');
      else if (id === 'main' || id === 'setup' || id === 'boot') menu.setMode('street');
    }
    const scrMain = document.getElementById('scr-main');
    // already handled by hidden class
    if (id === 'loadout') this._renderLoadout();
    if (id === 'settings') this._renderSettings();
    if (id === 'credits') {
      this.stack = ['main'];
      const el = document.getElementById('credits-build');
      if (el) el.textContent = BUILD;
    }
    if (id === 'end') this._renderEnd();
    if (id === 'pause' || id === 'score') this._renderBoard(id === 'pause' ? 'pause-score' : 'board-body');
  }
  hide() { document.getElementById('menus').classList.add('hidden'); }
  _click(e) {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action, arg = b.dataset.arg, k = b.dataset.k, v = b.dataset.v;
    const g = this.game;
    if (a === 'boot') return g.boot();
    if (a === 'goto') {
      if (arg === 'hudedit') { this.show('hudedit'); g.input.startHudEdit(); return; }
      this.show(arg); return;
    }
    if (a === 'back') {
      if (document.getElementById('scr-hudedit') && !document.getElementById('scr-hudedit').classList.contains('hidden')) {
        g.input.stopHudEdit(true);
      }
      this.show(this.stack.pop() || 'main'); return;
    }
    if (a === 'set') {
      if (k === 'leftFire' && v === 'toggle') {
        g.settings.leftFire = !g.settings.leftFire;
        saveSettings(g.settings);
        g.input.applyLayout();
        return;
      }
      g.settings[k] = isNaN(Number(v)) ? v : Number(v);
      if (k === 'bestOf') g.settings.bestOf = Number(v);
      if (k === 'difficulty') {
        g.settings.difficulty = normalizeDifficulty(v);
        if (g.cfg) g.cfg.difficulty = g.settings.difficulty;
      }
      saveSettings(g.settings);
      this._syncChips();
      if (k === 'side') {
        this._opFocus = 0;
        if (!document.getElementById('scr-opselect')?.classList.contains('hidden')) this._renderOps();
      }
      return;
    }
    if (a === 'deploy') return g.deploy();
    if (a === 'resume') return g.resume();
    if (a === 'quit') return g.quitToMenu();
    if (a === 'close-score') return g.closeScore();
    if (a === 'ctrl-tab') { this._renderControls(v); return; }
    if (a === 'hud-reset') return g.input.resetHud();
    if (a === 'hud-save') { g.input.stopHudEdit(true); this.show('controls'); return; }
    if (a === 'pick-op') {
      g.pickOp(b.dataset.id);
      const list = listSide(g.settings.side);
      this._opFocus = Math.max(0, list.findIndex(o => o.id === b.dataset.id));
      this._renderOps();
      return;
    }
  }
  _syncChips() {
    const s = this.game.settings;
    for (const chip of document.querySelectorAll('#scr-setup .chip')) {
      const k = chip.dataset.k, v = chip.dataset.v;
      chip.classList.toggle('on', String(s[k]) === String(v));
    }
  }
  _renderOps() {
    const g = this.game;
    const side = g.settings.side === 'defend' ? 'defend' : 'attack';
    const list = listSide(side);
    const cur = g.settings.operator[side] || list[0]?.id;
    if (this._opFocus == null || this._opFocus < 0 || this._opFocus >= list.length) {
      this._opFocus = Math.max(0, list.findIndex(o => o.id === cur));
    }
    const units = loreUnits();
    const atk = document.getElementById('ops-side-atk');
    const def = document.getElementById('ops-side-def');
    if (atk) { atk.classList.toggle('on', side === 'attack'); atk.textContent = (units.attack?.shortName || 'ASHLINE').toUpperCase(); }
    if (def) { def.classList.toggle('on', side === 'defend'); def.textContent = (units.defend?.shortName || 'HOLDFAST').toUpperCase(); }
    const info = document.getElementById('ops-match-info');
    if (info) info.textContent = (side === 'attack' ? (units.attack?.name || 'Ashline Entry Command') : (units.defend?.name || 'Holdfast Protective Cadre'));
    const grid = document.getElementById('op-grid');
    if (grid) {
      grid.innerHTML = list.map((o, i) => {
        const lore = loreFor(o.id) || {};
        const acc = o.accent || lore.accent || '#c67636';
        const on = o.id === cur;
        const focus = i === this._opFocus;
        const art = hasPortrait(o.id) ? `<img class="op-card-art" src="${cardUrl(o.id)}" alt="" width="512" height="640" loading="lazy" decoding="async">` : '';
        return `<button class="op-card ${on ? 'on' : ''} ${focus ? 'focus' : ''}" data-action="pick-op" data-id="${o.id}" style="--op-accent:${acc}">
          <i class="op-accent"></i>
          ${art}
          <div class="name">${o.name}</div>
          <div class="role">${o.role}</div>
          <div class="stats"><span>SPD ${pips(o.speed)}</span><span>ARM ${pips(o.armor)}</span></div>
        </button>`;
      }).join('');
    }
    const op = getOp(cur, side) || list[0];
    const lore = loreFor(op?.id) || {};
    const unitName = side === 'attack' ? (units.attack?.name || 'Ashline Entry Command') : (units.defend?.name || 'Holdfast Protective Cadre');
    const stars = '★'.repeat(lore.difficulty || 1) + '☆'.repeat(Math.max(0, 3 - (lore.difficulty || 1)));
    const lines = lore.voiceLines || [];
    const line = lines.length ? lines[this._voiceIdx = ((this._voiceIdx || 0) + 1) % lines.length] : '';
    const prim = (op.primaries || lore.primaries || []).map(id => id.toUpperCase()).join(' · ');
    const sec = (op.secondaries || lore.secondaries || []).map(id => id.toUpperCase()).join(' · ');
    const util = (op.util || lore.util || []).map(id => id.toUpperCase()).join(' · ');
    const detail = document.getElementById('op-detail');
    if (detail && op) {
      detail.innerHTML = `
        <div class="op-id"><b>${op.name}</b> <span class="real">${escapeHtml(lore.realName || '')}</span></div>
        <div class="role">${escapeHtml(op.role)} · ${escapeHtml(unitName)}</div>
        <p class="tagline">${escapeHtml(lore.tagline || op.bio || '')}</p>
        <div class="bars">
          <div class="bar-row"><span>SPEED</span><i class="pips">${bar(op.speed)}</i></div>
          <div class="bar-row"><span>ARMOR</span><i class="pips">${bar(op.armor)}</i></div>
          <div class="bar-row"><span>DIFF</span><i class="stars">${stars}</i> <em>${escapeHtml(lore.difficultyLabel || '')}</em></div>
        </div>
        <div class="gadget"><b>${escapeHtml(op.gadget.name)}</b> · ×${op.gadget.count || 1}<p>${escapeHtml(op.gadget.blurb)}</p></div>
        <div class="load-chips">
          <span>${prim}</span>
          <span>${sec}</span>
          <span>${util}</span>
        </div>
        ${line ? `<p class="voice">“${escapeHtml(line)}”</p>` : ''}
      `;
    }
    const bio = document.getElementById('op-bio');
    if (bio) {
      const text = lore.background || op.bio || '';
      const i = String(text).indexOf('. '); bio.textContent = i > 0 ? String(text).slice(0, i + 1) : text;
    }
    const confirm = document.getElementById('ops-confirm');
    if (confirm) confirm.disabled = !op;
    if (op && hasPortrait(op.id)) loadBust(op.id);
    if (op && g.menu?.showcase) g.menu.showcase.show(op.id, op.accent || lore.accent);
    function pips(n) { return '●'.repeat(n) + '○'.repeat(Math.max(0, 3 - n)); }
    function bar(n) { return `<u style="width:${(n/3)*100}%"></u>`; }
    function escapeHtml(s) {
      return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  }

  pollOpsPad(dt) {
    const scr = document.getElementById('scr-opselect');
    if (!scr || scr.classList.contains('hidden')) return;
    const pads = navigator.getGamepads?.() || [];
    const gp = pads[0] || window.__pad;
    if (!gp) return;
    const B = gp.buttons || [], A = gp.axes || [];
    const pressed = i => !!(B[i] && (B[i].pressed || B[i].value > 0.5));
    const edge = (i) => {
      const p = pressed(i);
      const was = this._padPrev?.[i];
      this._padPrev = this._padPrev || {};
      this._padPrev[i] = p;
      return p && !was;
    };
    const g = this.game;
    const list = listSide(g.settings.side);
    if (edge(14) || (A[0] < -0.6 && !this._stickLat)) { this._opFocus = (this._opFocus + list.length - 1) % list.length; this._stickLat = true; this._applyFocus(); }
    else if (edge(15) || (A[0] > 0.6 && !this._stickLat)) { this._opFocus = (this._opFocus + 1) % list.length; this._stickLat = true; this._applyFocus(); }
    else if (edge(12) || (A[1] < -0.6 && !this._stickVert)) { this._opFocus = (this._opFocus + list.length - 2) % list.length; this._stickVert = true; this._applyFocus(); }
    else if (edge(13) || (A[1] > 0.6 && !this._stickVert)) { this._opFocus = (this._opFocus + 2) % list.length; this._stickVert = true; this._applyFocus(); }
    if (Math.abs(A[0] || 0) < 0.4) this._stickLat = false;
    if (Math.abs(A[1] || 0) < 0.4) this._stickVert = false;
    // L1/R1 or LB/RB switch side (buttons 4/5)
    if (edge(4) || edge(5)) {
      g.settings.side = g.settings.side === 'attack' ? 'defend' : 'attack';
      this._opFocus = 0;
      this._renderOps();
    }
    // South / A / Cross = 0 confirm; Start = 9
    if (edge(0) || edge(9)) g.deploy();
    // East / B = 1 back
    if (edge(1)) this.show('setup');
    // West / X = 2 emote
    if (edge(2)) g.menu?.showcase?.playEmote();
    // Right stick yaws showcase
    const rx = A[2] || 0;
    if (Math.abs(rx) > 0.12) g.menu?.showcase?.yawBy(rx * (dt || 0.016) * 3);
  }

  _applyFocus() {
    const g = this.game;
    const list = listSide(g.settings.side);
    const op = list[this._opFocus];
    if (op) { g.pickOp(op.id); this._renderOps(); }
  }
  _renderLoadout() {
    const g = this.game;
    const side = g.settings.side;
    const op = getOp(g.settings.operator[side], side);
    const lo = g.settings.loadout[op.id] = makeLoadout(op, g.settings.loadout[op.id] || {});
    const w = WEAPONS[lo.primary];
    const el = document.getElementById('loadout-body');
    el.innerHTML = `
      <div class="slotlbl">PRIMARY</div>
      <div class="chips">${op.primaries.map(id => chip('primary', id, lo.primary, WEAPONS[id].name)).join('')}</div>
      <div class="slotlbl">SECONDARY</div>
      <div class="chips">${op.secondaries.map(id => chip('secondary', id, lo.secondary, WEAPONS[id].name)).join('')}</div>
      <div class="slotlbl">OPTIC</div>
      <div class="chips">${w.optics.map(id => chip('optic', id, lo.optic, id)).join('')}</div>
      <div class="slotlbl">ATTACHMENTS</div>
      <div class="chips">${w.attach.map(id => {
        const on = lo.attach[id];
        return `<button class="chip ${on ? 'on' : ''}" data-k="attach" data-v="${id}">${id}</button>`;
      }).join('')}</div>
      <div class="slotlbl">UTILITY</div>
      <div class="chips">${op.util.map(id => chip('util', id, lo.util, (UTIL[id]||{}).name || id)).join('')}</div>
      <p class="fine">${op.gadget.name} is your signature gadget.</p>`;
    el.onclick = ev => {
      const b = ev.target.closest('.chip'); if (!b) return;
      const k = b.dataset.k, v = b.dataset.v;
      if (k === 'attach') { lo.attach[v] = !lo.attach[v]; }
      else lo[k] = v;
      g.settings.loadout[op.id] = lo;
      saveSettings(g.settings);
      this._renderLoadout();
    };
    function chip(k, id, cur, label) {
      return `<button class="chip ${id === cur ? 'on' : ''}" data-k="${k}" data-v="${id}">${label.toUpperCase()}</button>`;
    }
  }
  _renderSettings() {
    const s = this.game.settings;
    const body = document.getElementById('settings-body');
    if (!body) return;
    body.innerHTML = `
      <div class="slotlbl">GRAPHICS</div>
      ${rowSel('quality', 'Quality', s.quality, ['auto','low','med','high'])}
      <div class="slotlbl">AIM</div>
      ${rowSel('aimAssist', 'Aim assist (enemies only)', s.aimAssist, ['off','low','med'])}
      ${rowRange('sensitivity', 'Look sensitivity', s.sensitivity, 0.3, 2.5, 0.05)}
      ${rowRange('adsSensitivity', 'ADS sensitivity', s.adsSensitivity, 0.3, 1.5, 0.05)}
      ${rowSel('gyro', 'Gyro aim', s.gyro, ['off','always','ads'])}
      <button class="btn" id="btn-gyro">ENABLE GYRO (taps to allow motion)</button>
      ${rowRange('gyroYaw', 'Gyro yaw', s.gyroYaw, 0.2, 2, 0.05)}
      ${rowRange('gyroPitch', 'Gyro pitch', s.gyroPitch, 0.2, 2, 0.05)}
      ${rowChk('invertY', 'Invert Y', s.invertY)}
      <div class="slotlbl">BOT DIFFICULTY</div>
      ${rowSel('difficulty', 'Difficulty', s.difficulty, DIFFICULTY_IDS)}
      <div class="slotlbl">CONTROLS</div>
      ${rowSel('leanMode', 'Lean', s.leanMode, ['toggle','hold'])}
      ${rowSel('adsMode', 'ADS (touch default Toggle; controller default Hold)', s.adsModeUser ? s.adsMode : 'toggle', ['toggle','hold'])}
      ${rowSel('hudPreset', 'HUD preset', s.hudPreset, ['thumb','claw'])}
      ${rowChk('leftFire', 'Left fire button', s.leftFire)}
      ${rowSel('fireOnAim', 'Fire-on-aim', s.fireOnAim, ['off','hip','always'])}
      <div class="slotlbl">CROSSHAIR</div>
      ${rowSel('ch-style', 'Style', s.crosshair.style, ['cross','dot','circle','t'])}
      ${rowColor('ch-color', 'Colour', s.crosshair.color)}
      ${rowRange('ch-size', 'Size', s.crosshair.size, 8, 40, 1)}
      ${rowRange('ch-thick', 'Thickness', s.crosshair.thick, 1, 5, 1)}
      ${rowRange('ch-gap', 'Gap', s.crosshair.gap, 0, 16, 1)}
      ${rowRange('ch-outline', 'Outline', s.crosshair.outline, 0, 4, 1)}
      ${rowRange('ch-opacity', 'Opacity', s.crosshair.opacity, 0.2, 1, 0.05)}
      <div class="ch-preview" id="ch-preview"><div id="crosshair-prev" class="ch-cross"></div></div>
      <div class="slotlbl">ABOUT</div>
      <p class="fine" style="padding:8px 0 4px">${TITLE} · build ${BUILD}. An original 5v5 tactical attack and defense game. See Credits on the main menu.</p>
    `;
    body.onchange = ev => this._setFrom(ev.target);
    body.oninput = ev => this._setFrom(ev.target);
    body.querySelector('#btn-gyro')?.addEventListener('click', async () => {
      const ok = await this.game.input.enableGyroFromTap();
      this.game.toast(ok ? 'Gyro allowed' : 'Gyro permission denied');
    });
    this._previewCH();
  }
  _setFrom(el) {
    const s = this.game.settings;
    const id = el.id || el.name;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    if (id === 'quality') { s.quality = val; this.game.gfx.setQuality(val); }
    else if (id === 'aimAssist') s.aimAssist = val;
    else if (id === 'sensitivity') s.sensitivity = +val;
    else if (id === 'adsSensitivity') s.adsSensitivity = +val;
    else if (id === 'gyro') s.gyro = val;
    else if (id === 'gyroYaw') s.gyroYaw = +val;
    else if (id === 'gyroPitch') s.gyroPitch = +val;
    else if (id === 'invertY') s.invertY = !!val;
    else if (id === 'difficulty') {
      s.difficulty = normalizeDifficulty(val);
      if (this.game.cfg) this.game.cfg.difficulty = s.difficulty;
    }
    else if (id === 'leanMode') s.leanMode = val;
    else if (id === 'adsMode') { s.adsMode = val; s.adsModeUser = true; }
    else if (id === 'hudPreset') { s.hudPreset = val; this.game.input.applyLayout(val); }
    else if (id === 'leftFire') { s.leftFire = !!val; this.game.input.applyLayout(); }
    else if (id === 'fireOnAim') s.fireOnAim = val;
    else if (id?.startsWith('ch-')) {
      const k = id.slice(3);
      if (k === 'style') s.crosshair.style = val;
      else if (k === 'color') s.crosshair.color = val;
      else s.crosshair[k] = +val;
      this.game.applyCrosshair();
      this._previewCH();
    }
    saveSettings(s);
  }
  _previewCH() {
    const s = this.game.settings.crosshair;
    const el = document.getElementById('crosshair-prev');
    if (!el) return;
    el.className = 'ch-' + s.style;
    el.style.setProperty('--ch-color', s.color);
    el.style.setProperty('--ch-size', s.size + 'px');
    el.style.setProperty('--ch-thick', s.thick + 'px');
    el.style.setProperty('--ch-gap', s.gap + 'px');
    el.style.setProperty('--ch-outline', s.outline + 'px');
    el.style.opacity = s.opacity;
    el.style.width = s.size + 'px'; el.style.height = s.size + 'px';
    el.style.position = 'absolute'; el.style.left = '50%'; el.style.top = '50%';
    el.style.transform = 'translate(-50%,-50%)';
  }
  _renderControls(tab) {
    for (const c of document.querySelectorAll('#ctrl-tabs .chip')) c.classList.toggle('on', c.dataset.v === tab);
    const body = document.getElementById('ctrl-body');
    if (tab === 'touch') body.innerHTML = `<p>Left stick moves. Push past the top edge to lock sprint. Drag the right side to look. FIRE is the large right button; ADS sits inward of it. Lean L / R are toggles and stay on while you aim. Hold ACTION to plant or defuse, or to open a door. RAPPEL appears on any exterior wall. DETONATE appears once a charge is placed — nothing auto-explodes.</p>`;
    if (tab === 'pad') body.innerHTML = `<p>LT ADS · RT fire · LB / RB lean · B crouch (hold for prone) · X reload (hold to interact) · Y swap · A vault / rappel · D-pad gadgets / drone / cams · Start pause · View scoreboard. Sticks: move and look, click left stick to sprint.</p>`;
    if (tab === 'kbm') body.innerHTML = `<p>WASD move, Shift sprint, mouse look (click the game to lock the pointer), LMB fire, RMB ADS, Ctrl / C crouch, hold Ctrl or Z for prone, Q lean left, R reload, F / E interact, G gadget, B detonate, T drone, H ping, X swap, Tab scoreboard, Esc pause.</p>`;
  }
  _renderBoard(id) {
    const el = document.getElementById(id); if (!el) return;
    const g = this.game;
    const rows = [g.player, ...g.bots].filter(Boolean);
    const atk = rows.filter(r => r.team === 'attack');
    const def = rows.filter(r => r.team === 'defend');
    const table = (list, cls) => `<table class="${cls}"><tr><th>Operator</th><th>K</th><th>D</th></tr>${list.map(r => `<tr><td>${r.opId?.toUpperCase?.() || r.op?.name || 'YOU'}${r === g.player ? ' (you)' : ''}</td><td>${r.kills||0}</td><td>${r.deaths||0}</td></tr>`).join('')}</table>`;
    el.innerHTML = `<div class="atk">Attack ${g.round?.scoreAtk ?? 0}</div>${table(atk,'atk')}<div class="def">Defense ${g.round?.scoreDef ?? 0}</div>${table(def,'def')}`;
  }
  _renderEnd() {
    const g = this.game;
    const won = g.round.winner === g.player.team;
    document.getElementById('end-title').textContent = won ? 'VICTORY' : 'DEFEAT';
    document.getElementById('end-slash')?.classList.toggle('hidden', won);
    document.getElementById('scr-end')?.classList.toggle('defeat', !won);
    document.getElementById('end-sub').textContent = `Final ${g.round.scoreAtk} – ${g.round.scoreDef}`;
    this._renderBoard('end-board');
  }
}
function rowSel(id, label, cur, opts) {
  const lab = (o) => id === 'difficulty' ? o.charAt(0).toUpperCase() + o.slice(1) : o;
  return `<div class="set-row"><label>${label}</label><select id="${id}">${opts.map(o => `<option value="${o}" ${o==cur?'selected':''}>${lab(o)}</option>`).join('')}</select></div>`;
}
function rowRange(id, label, cur, min, max, step) {
  return `<div class="set-row"><label>${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${cur}"></div>`;
}
function rowChk(id, label, cur) {
  return `<div class="set-row"><label>${label}</label><input id="${id}" type="checkbox" ${cur?'checked':''}></div>`;
}
function rowColor(id, label, cur) {
  return `<div class="set-row"><label>${label}</label><input id="${id}" type="color" value="${cur}"></div>`;
}
