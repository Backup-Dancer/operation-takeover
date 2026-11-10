import { ATTACKERS, DEFENDERS, getOp, listSide } from '../operators.js?v=iv-4.1.1';
import { loadLore, loreFor, loreUnits } from '../menu/lore.js?v=iv-4.1.1';
import { cardUrl, hasPortrait, loadBust } from '../menu/portraits.js?v=iv-4.1.1';
import { WEAPONS, UTIL, makeLoadout } from '../weapons.js?v=iv-4.1.1';
import { saveSettings } from '../settings.js?v=iv-4.1.1';
import { BUILD, TITLE, MAP_NAME } from '../config.js?v=iv-4.1.1';
import { playLoop, playStinger, stopMusic, unlock as unlockAudio } from '../audio.js?v=iv-4.1.1';
import {
  MAPS, MODES, TIPS, GUNSMITH_SLOTS, GUNSMITH_OPTS,
  mapById, modeById, mapArtUrl, FIRETEAM_BOTS, RIVAL_BOTS,
} from './data.js';
import { loadProfile, saveProfile, winRate, challengeState, applyMatchRewards, INDUCTION, FIELD_PASS } from './profile.js?v=iv-4.1.1';
import { startMatch, bindHooks, mockMatchResult, peekMatchApi, matchSnapshot, snapshotFromApi, isCompleteSnapshot, richerSnapshot, isStrictlyRicher } from './match-adapter.js?v=iv-4.1.1';
import { GamepadNav } from './nav.js?v=iv-4.1.1';

const MENU_LOOP = 'main_menu_loop';
const QUEUE_LOOP = 'matchmaking_loop';

const MENU_SCREENS = new Set([
  'boot', 'main', 'lobby', 'matchmaking', 'matchstart',
  'slam', 'highlights', 'postscore', 'progress',
  'operators', 'gunsmith', 'missions', 'rewards', 'shop', 'practice',
  'settings', 'controls', 'hudedit', 'credits',
]);

function opThumb(opId, letter, kind) {
  const cls = kind === 'portrait' ? 'av av-portrait' : 'av';
  if (opId && hasPortrait(opId)) {
    return `<img class="${cls}" src="${cardUrl(opId)}" alt="">`;
  }
  return `<i class="${cls}">${esc(letter || '?')}</i>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(n) { return (n || 0).toLocaleString(); }

export class FrontEnd {
  constructor(game) {
    this.game = game;
    this.profile = loadProfile();
    this.screen = 'boot';
    this.tab = 'play';
    this.sel = {
      map: 'halcyon',
      mode: 'bomb-rush',
      difficulty: game.settings?.difficulty || 'veteran',
      side: game.settings?.side || 'attack',
      operator: game.settings?.operator?.[game.settings?.side || 'attack'] || 'forge',
      practiceKind: 'range',
    };
    this.queue = { t: 0, est: 12, running: false, timer: null };
    this.lastResult = null;
    this.lastRewards = null;
    this.test = { instantQueues: false, mockMatch: false, autoAdvance: true };
    this.nav = new GamepadNav(this);
    this._tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    this._stack = [];
    this._mmTick = null;
    this._cardTick = null;
    loadLore().catch(() => {});
    this._bind();
    this._wrapGame();
    this._paintChrome();
  }

  _wrapGame() {
    const g = this.game;
    const ui = g.ui;
    if (ui && !ui.__feWrapped) {
      ui.__feWrapped = true;
      const show = ui.show.bind(ui);
      ui.show = (id) => {
        if (id === 'end') {
          // Prefer the frozen matchend snapshot (taken before quit clears bots).
          const snap = isCompleteSnapshot(this.lastResult)
            ? this.lastResult
            : (g._matchEndSnapshot
              ? snapshotFromApi(g._matchEndSnapshot, g)
              : this._liveResult());
          this.beginMatchEnd(snap);
          return;
        }
        if (id === 'main' || id === 'setup') {
          if (['settings', 'controls', 'credits', 'hudedit'].includes(this.screen)) {
            const prev = this._stack.pop() || 'main';
            return this.show(prev);
          }
          return this.show(id === 'setup' ? 'lobby' : 'main');
        }
        if (id === 'opselect' || id === 'loadout') return this.show(id === 'loadout' ? 'gunsmith' : 'operators');
        if (MENU_SCREENS.has(id) && id !== 'settings' && id !== 'controls' && id !== 'hudedit' && id !== 'credits') {
          return this.show(id);
        }
        // pause / score / settings / controls / credits keep the existing screens
        this._hideFeScreens();
        document.getElementById('op-showcase')?.classList.add('hidden');
        show(id);
        if (id === 'settings' || id === 'controls' || id === 'credits' || id === 'hudedit') {
          this._stack.push(this.screen);
          this.screen = id;
          this._setMenuMode('flat');
        }
        this.nav.refresh();
      };
      const poll = ui.pollOpsPad.bind(ui);
      ui.pollOpsPad = (dt) => {
        if (g.running && !g.inMenu) return;
        if (this._menuMode && g.menu && g.menu.mode !== this._menuMode) {
          g.menu.setMode(this._menuMode);
        }
        this.nav.poll(dt);
        // Keep the original operator-pad yaw/emote when that screen is up.
        if (this.screen === 'operators') {
          // already handled by GamepadNav + right stick yaw
        }
        void poll;
      };
    }
    bindHooks(g, {
      onMatchEnd: (snap) => this.beginMatchEnd(snap),
      onQuit: (showMenu) => {
        if (showMenu === false) return;
        this.show('lobby');
        this._musicFor('lobby');
      },
    });
    peekMatchApi().catch(() => {});
    setInterval(() => peekMatchApi().catch(() => {}), 20000);
  }

  _bind() {
    const menus = document.getElementById('menus');
    menus?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fe]');
      if (!b || !menus.contains(b)) return;
      e.preventDefault();
      e.stopPropagation();
      this._act(b);
    }, true);
    // Keyboard helper for desktop QA
    addEventListener('keydown', (e) => {
      if (this.game.running && !this.game.inMenu) return;
      if (e.key === 'Escape') { this.back(); e.preventDefault(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.nav.activate();
    });
  }

  _act(b) {
    const a = b.dataset.fe;
    const v = b.dataset.v;
    const k = b.dataset.k;
    if (a === 'boot') return this.boot();
    if (a === 'show') return this.show(v, { push: true });
    if (a === 'tab') return this.show(v, { push: false });
    if (a === 'back') return this.back();
    if (a === 'play') return this.show('lobby', { push: true });
    if (a === 'start') return this.beginQueue();
    if (a === 'cancel-queue') return this.cancelQueue();
    if (a === 'next-game') return this.beginQueue();
    if (a === 'to-lobby') { this.lastResult = null; this._endOpen = false; return this.show('lobby'); }
    if (a === 'to-main') return this.show('main');
    if (a === 'set-mode') { this.sel.mode = v; if (v === 'practice') return this.show('practice', { push: true }); this._paintLobby(); this.nav.refresh(); return; }
    if (a === 'set-map') { this.sel.map = v; this._paintLobby(); this._paintPractice(); this.nav.refresh(); return; }
    if (a === 'set-side') { this._setSide(v); return; }
    if (a === 'set-diff') {
      this.sel.difficulty = v;
      this.game.settings.difficulty = v;
      saveSettings(this.game.settings);
      this._paintLobby();
      this.nav.refresh();
      return;
    }
    if (a === 'pick-op') { this._pickOp(v); return; }
    if (a === 'practice-kind') { this.sel.practiceKind = v; this.sel.mode = 'practice'; this._paintPractice(); this.nav.refresh(); return; }
    if (a === 'practice-go') return this.beginQueue();
    if (a === 'gun-slot') return this._gunSlot(v);
    if (a === 'gun-opt') return this._gunOpt(v);
    if (a === 'gun-skin') return this._gunSkin(v);
    if (a === 'commend') { b.classList.toggle('on'); b.dataset.commended = b.classList.contains('on') ? '1' : '0'; return; }
    if (a === 'invite') { this._toast('Invites are local-only. Empty slots fill with fireteam bots.'); return; }
    if (a === 'mail') { this._toast('No new dispatches.'); return; }
    if (a === 'friends') { this._toast('Fireteam invites will land here.'); return; }
    if (a === 'settings') { this.game.ui.show('settings'); return; }
    if (a === 'controls') { this.game.ui.show('controls'); return; }
    if (a === 'credits') { this.game.ui.show('credits'); return; }
    if (a === 'advance-end') return this._advanceEnd();
    void k;
  }

  async boot() {
    const g = this.game;
    if (this._starting) return;
    this._starting = true;
    document.getElementById('scr-boot')?.classList.add('hidden');
    this._showLoad(true, 'Loading ' + TITLE, this._tip);
    try {
      await unlockAudio();
    } catch {}
    // Run the existing asset + menu boot, but stop it from showing the old main.
    const uiShow = g.ui.show;
    g.ui.show = (id) => { if (id === 'main' || id === 'setup') return; return uiShow.call(g.ui, id); };
    try {
      if (g.menu) {
        /* already booted */
      } else if (g._booting) {
        await new Promise((resolve) => {
          const t0 = performance.now();
          const tick = () => {
            if (g.menu || performance.now() - t0 > 120000) return resolve();
            requestAnimationFrame(tick);
          };
          tick();
        });
      } else {
        await g.boot();
      }
    } finally {
      g.ui.show = uiShow;
    }
    this._paintChrome();
    this.show('main');
    this._musicFor('main');
    this._showLoad(false);
    this._ensureHero();
    this._setMenuMode('showcase');
    requestAnimationFrame(() => this._setMenuMode('showcase'));
    setTimeout(() => { this._setMenuMode('showcase'); this._ensureHero(); }, 50);
    setTimeout(() => { this._setMenuMode('showcase'); this._ensureHero(); }, 250);
  }

  show(id, { push = false } = {}) {
    if (!id) return;
    if (push && this.screen && this.screen !== id) this._stack.push(this.screen);
    this.screen = id;
    this._hideLegacy();
    this._hideFeScreens();
    const el = document.getElementById('scr-' + id);
    if (el) el.classList.remove('hidden');
    document.getElementById('menus')?.classList.remove('hidden');
    this._setVignette(false);
    this._layoutShowcase(id);
    this._setSceneBg(id);
    this._setMenuMode(id === 'operators' || id === 'main' || id === 'missions' || id === 'rewards' || id === 'shop' ? 'showcase' : 'flat');
    if (id === 'main') this._paintMain();
    if (id === 'lobby') this._paintLobby();
    if (id === 'matchmaking') this._paintMatchmaking();
    if (id === 'matchstart') this._paintMatchStart();
    if (id === 'operators') this._paintOperators();
    if (id === 'gunsmith') this._paintGunsmith();
    if (id === 'missions') this._paintMissions();
    if (id === 'rewards') this._paintRewards();
    if (id === 'shop') this._paintShop();
    if (id === 'practice') this._paintPractice();
    if (id === 'slam') this._paintSlam();
    if (id === 'highlights') this._paintHighlights();
    if (id === 'postscore') this._paintScoreboard();
    if (id === 'progress') this._paintProgress();
    this._musicFor(id);
    requestAnimationFrame(() => this.nav.refresh());
  }

  back() {
    if (this.screen === 'matchmaking') return this.cancelQueue();
    if (this.screen === 'boot') return;
    if (['slam', 'highlights', 'postscore', 'progress'].includes(this.screen)) {
      return this._advanceEnd();
    }
    const prev = this._stack.pop() || 'main';
    this.show(prev);
  }

  activeEl() { return document.getElementById('scr-' + this.screen); }

  _hideFeScreens() {
    for (const s of document.querySelectorAll('#menus .fe-screen, #menus .screen')) {
      if (s.id === 'scr-pause' || s.id === 'scr-score') continue;
      s.classList.add('hidden');
    }
  }

  _hideLegacy() {
    for (const id of ['scr-setup', 'scr-opselect', 'scr-loadout', 'scr-end']) {
      document.getElementById(id)?.classList.add('hidden');
    }
  }

  _setVignette(on) {
    document.getElementById('vignette')?.classList.toggle('hidden', !on);
  }

  _setMenuMode(mode) {
    this._menuMode = mode;
    const menu = this.game.menu || window.__game?.menu;
    if (!menu) return;
    if (!menu.__feModeHook) {
      menu.__feModeHook = true;
      const orig = menu.setMode.bind(menu);
      menu.setMode = (m) => orig(this._menuMode || m);
    }
    menu.resume?.();
    menu.setMode(mode);
  }

  _layoutShowcase(id) {
    const hole = document.getElementById('op-showcase');
    if (!hole) return;
    hole.className = 'op-showcase fe-showcase';
    const show = (id === 'main' || id === 'operators' || id === 'missions' || id === 'rewards' || id === 'shop');
    hole.classList.toggle('hidden', !show);
    hole.classList.toggle('is-hero', id === 'main');
    hole.classList.toggle('is-detail', id === 'operators');
    hole.classList.toggle('is-wing', id === 'missions' || id === 'rewards' || id === 'shop');
    hole.classList.toggle('is-card', false);
    const layout = id === 'main' ? 'hero' : id === 'operators' ? 'detail' : 'wing';
    this.game.menu?.showcase?.setLayout(layout);
    if (show) this._ensureHero();
  }

  _setSceneBg(id) {
    const el = document.getElementById('fe-scene-bg');
    if (!el) return;
    const overlay = new Set(['lobby', 'matchmaking', 'matchstart', 'practice', 'slam', 'highlights', 'postscore', 'progress', 'settings']);
    const on = overlay.has(id);
    el.classList.toggle('hidden', !on);
    el.classList.toggle('sharp', id === 'matchstart' || id === 'slam');
    const img = el.querySelector('i');
    if (img) img.style.backgroundImage = on ? 'url(' + mapArtUrl(this.sel.map) + ')' : '';
  }

  _ensureHero() {
    const g = this.game;
    const side = this.sel.side;
    const id = this.sel.operator || g.settings.operator[side];
    const op = getOp(id, side);
    const lore = loreFor(op?.id) || {};
    if (op && g.menu?.showcase) g.menu.showcase.show(op.id, op.accent || lore.accent);
    if (op && hasPortrait(op.id)) loadBust(op.id);
  }

  _musicFor(id) {
    if (this.game.running && !this.game.inMenu) { stopMusic(); return; }
    const queue = id === 'lobby' || id === 'matchmaking' || id === 'matchstart' || id === 'practice';
    const silent = id === 'slam' || id === 'highlights' || id === 'postscore' || id === 'progress';
    if (silent) return; // stingers handle slam; beds stay stopped through the end flow
    playLoop(queue ? QUEUE_LOOP : MENU_LOOP);
  }

  _showLoad(on, title, tip) {
    const el = document.getElementById('loading');
    if (!el) return;
    el.classList.toggle('hidden', !on);
    const t = document.getElementById('load-title');
    if (t && title) t.textContent = title;
    const tipEl = document.getElementById('load-tip');
    if (tipEl) tipEl.textContent = tip || this._tip;
    if (on) {
      const fill = document.getElementById('load-fill');
      if (fill) fill.style.width = '8%';
    }
  }

  _toast(msg) { this.game.toast?.(msg); }

  _paintChrome() {
    const p = this.profile;
    for (const el of document.querySelectorAll('[data-bind=callsign]')) el.textContent = p.callsign;
    for (const el of document.querySelectorAll('[data-bind=level]')) el.textContent = String(p.level);
    for (const el of document.querySelectorAll('[data-bind=marks]')) el.textContent = fmt(p.marks);
    for (const el of document.querySelectorAll('[data-bind=chits]')) el.textContent = fmt(p.chits);
    const build = document.getElementById('credits-build');
    if (build) build.textContent = BUILD;
  }

  _paintMain() {
    this._paintChrome();
    const p = this.profile;
    const s = p.stats;
    setText('stat-matches', fmt(s.matches));
    setText('stat-rounds', fmt(s.roundsWon));
    setText('stat-winrate', winRate(p) + '%');
    setText('stat-mvp', fmt(s.mvp));
    const op = getOp(this.sel.operator, this.sel.side);
    setText('main-op-name', op?.name || 'OPERATOR');
    setText('main-op-level', 'LVL ' + p.level);
    const load = document.getElementById('main-op-load');
    if (load && op) {
      const lo = makeLoadout(op, this.game.settings.loadout[op.id] || {});
      const w = WEAPONS[lo.primary];
      load.textContent = (w?.name || lo.primary || '').toUpperCase();
    }
    this._syncTabs('play');
  }

  _syncTabs(active) {
    for (const b of document.querySelectorAll('.fe-tab')) {
      b.classList.toggle('on', b.dataset.v === active);
    }
    const missions = challengeState(this.profile);
    const unread = missions.some(c => !c.done);
    document.getElementById('tab-missions')?.classList.toggle('has-dot', unread);
  }

  _paintLobby() {
    this._paintChrome();
    const p = this.profile;
    const ch = challengeState(p);
    const left = document.getElementById('lobby-missions');
    if (left) {
      left.innerHTML = `
        <div class="fe-kicker">INDUCTION</div>
        <div class="fe-bar-label"><span>${INDUCTION.name}</span><b>${p.induction}/${INDUCTION.goal}</b></div>
        <div class="fe-bar"><i style="width:${(p.induction / INDUCTION.goal) * 100}%"></i></div>
        <div class="fe-kicker mt">DAILY CHALLENGES</div>
        ${ch.slice(0, 3).map(c => `
          <div class="fe-chal">
            <div class="fe-bar-label"><span>${esc(c.name)}</span><b>${c.progress}/${c.goal}</b></div>
            <div class="fe-bar"><i style="width:${(c.progress / c.goal) * 100}%"></i></div>
          </div>`).join('')}
      `;
    }
    const slots = document.getElementById('lobby-slots');
    if (slots) {
      const op = getOp(this.sel.operator, this.sel.side);
      const art = hasPortrait(op?.id) ? `<img src="${cardUrl(op.id)}" alt="">` : '';
      slots.innerHTML = `
        <div class="fe-player-card" data-nav>
          <div class="fe-player-art">${art}</div>
          <div class="fe-player-meta">
            <b>${esc(p.callsign)}</b>
            <span>LVL ${p.level} · ${esc(op?.name || '')}</span>
          </div>
        </div>
        ${FIRETEAM_BOTS.map(b => `
          <button class="fe-slot" data-fe="invite" data-nav aria-label="Invite ${esc(b.callsign)}">
            <span class="plus">+</span>
            <small>INVITE</small>
          </button>`).join('')}
      `;
    }
    const modes = document.getElementById('lobby-modes');
    if (modes) {
      modes.innerHTML = MODES.map(m => `
        <button class="fe-mode ${this.sel.mode === m.id ? 'on' : ''}" data-fe="set-mode" data-v="${m.id}" data-nav>
          <span class="lbl">${esc(m.label)}</span>
          <span class="sub">${esc(m.sub)}</span>
        </button>`).join('');
    }
    const maps = document.getElementById('lobby-map');
    if (maps) {
      const m = mapById(this.sel.map);
      maps.innerHTML = `
        <button class="fe-map-chip" data-fe="show" data-v="practice" data-nav>
          <i class="swatch" style="background:${m.accent}"></i>
          <span>${esc(m.name)}</span>
        </button>`;
    }
    const diffs = document.getElementById('lobby-diff');
    if (diffs) {
      diffs.innerHTML = ['recruit', 'regular', 'veteran', 'elite'].map(d => `
        <button class="chip ${this.sel.difficulty === d ? 'on' : ''}" data-fe="set-diff" data-v="${d}" data-nav>${d.toUpperCase()}</button>
      `).join('');
    }
    const sides = document.getElementById('lobby-side');
    if (sides) {
      sides.innerHTML = `
        <button class="chip ${this.sel.side === 'attack' ? 'on' : ''}" data-fe="set-side" data-v="attack" data-nav>ATTACK</button>
        <button class="chip ${this.sel.side === 'defend' ? 'on' : ''}" data-fe="set-side" data-v="defend" data-nav>DEFENSE</button>
      `;
    }
    const mode = modeById(this.sel.mode);
    setText('lobby-start-caption', mode.sub + ' · ' + mode.detail);
    this._syncTabs('play');
  }

  _paintMatchmaking() {
    setText('mm-timer', this._fmtQueue(this.queue.t));
    setText('mm-est', 'EST. WAIT  ' + this._fmtQueue(this.queue.est));
    const mode = modeById(this.sel.mode);
    const map = mapById(this.sel.map);
    setText('mm-detail', `${map.name} · ${mode.sub} · ${mode.detail}`);
  }

  _paintMatchStart() {
    const mode = modeById(this.sel.mode);
    const map = mapById(this.sel.map);
    const result = this._pendingLineup || this._lineupPreview();
    setText('ms-map', map.name);
    setText('ms-mode', mode.kind === 'practice' ? 'PRACTICE' : `${mode.sub} — ${mode.detail}`);
    setText('ms-score', '0 — 0');
    const card = document.querySelector('#scr-matchstart .ms-card');
    if (card) card.style.setProperty('--map-art', 'url(' + mapArtUrl(map.id) + ')');
    const atk = result.filter(r => r.team === 'attack');
    const def = result.filter(r => r.team === 'defend');
    const col = (list, cls) => list.map(r => `
      <div class="fe-line ${cls} ${r.you ? 'you' : ''}">
        ${opThumb(r.opId || r.op?.id, r.you ? 'Y' : (r.name || '?').slice(0, 1))}
        <span>${esc(r.name)}</span>
      </div>`).join('');
    const a = document.getElementById('ms-atk');
    const d = document.getElementById('ms-def');
    if (a) a.innerHTML = `<div class="fe-kicker atk slant">ATTACK</div>` + col(atk, 'atk');
    if (d) d.innerHTML = `<div class="fe-kicker def slant">DEFENSE</div>` + col(def, 'def');
  }

  _lineupPreview() {
    const side = this.sel.side;
    const opp = side === 'attack' ? 'defend' : 'attack';
    const my = getOp(this.sel.operator, side);
    const ours = [
      { name: this.profile.callsign, team: side, you: true, op: my, opId: my?.id },
      ...FIRETEAM_BOTS.map((b, i) => ({ name: b.callsign, team: side, you: false, op: listSide(side)[i % 4], opId: listSide(side)[i % 4]?.id })),
    ];
    const theirs = RIVAL_BOTS.map((b, i) => ({
      name: b.callsign, team: opp, you: false, op: listSide(opp)[i % 4], opId: listSide(opp)[i % 4]?.id,
    }));
    return [...ours, ...theirs];
  }

  _paintOperators() {
    this._syncTabs('operators');
    const side = this.sel.side;
    const list = listSide(side);
    const cur = this.sel.operator;
    const units = loreUnits();
    const atk = document.getElementById('ops-side-atk');
    const def = document.getElementById('ops-side-def');
    if (atk) { atk.classList.toggle('on', side === 'attack'); atk.textContent = (units.attack?.shortName || 'ASHLINE').toUpperCase(); }
    if (def) { def.classList.toggle('on', side === 'defend'); def.textContent = (units.defend?.shortName || 'HOLDFAST').toUpperCase(); }
    const grid = document.getElementById('fe-op-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="fe-op-head">UNLOCKED</div>
        <div class="fe-op-cards">
          ${list.map(o => card(o, true, o.id === cur)).join('')}
        </div>`;
    }
    this._paintOpDetail(getOp(cur, side) || list[0]);
    this._ensureHero();

    function card(o, unlocked, on) {
      const art = hasPortrait(o.id) ? `<img src="${cardUrl(o.id)}" alt="">` : '';
      return `<button class="fe-op-card ${on ? 'on' : ''} ${unlocked ? '' : 'locked'}" data-fe="pick-op" data-v="${o.id}" data-nav style="--op-accent:${o.accent || '#c67636'}">
        ${art}<b>${esc(o.name)}</b><small>${esc(o.role)}</small>
      </button>`;
    }
  }

  _paintOpDetail(op) {
    const lore = loreFor(op?.id) || {};
    const el = document.getElementById('fe-op-detail');
    if (!el || !op) return;
    const stars = '★'.repeat(lore.difficulty || 1) + '☆'.repeat(Math.max(0, 3 - (lore.difficulty || 1)));
    el.innerHTML = `
      <div class="fe-op-detail-scroll">
        <div class="fe-op-id"><b>${esc(op.name)}</b> <span>${esc(lore.realName || '')}</span></div>
        <div class="fe-role">${esc(op.role)}</div>
        <p class="fe-tagline">${esc(lore.tagline || op.bio || '')}</p>
        <div class="fe-bars">
          <div class="bar-row"><span>DIFFICULTY</span><i>${stars}</i></div>
          <div class="bar-row"><span>ARMOR</span>${pips(op.armor)}</div>
          <div class="bar-row"><span>SPEED</span>${pips(op.speed)}</div>
        </div>
        <div class="gadget"><b>${esc(op.gadget.name)}</b> · ×${op.gadget.count || 1}<p>${esc(op.gadget.blurb)}</p></div>
      </div>
      <button class="btn primary fe-loadout-btn" data-fe="show" data-v="gunsmith" data-nav>LOADOUT / GUNSMITH</button>
    `;
    function pips(n) {
      return `<i class="pips"><u style="width:${(n / 3) * 100}%"></u></i>`;
    }
  }

  _setSide(v) {
    this.sel.side = v === 'defend' ? 'defend' : 'attack';
    this.game.settings.side = this.sel.side;
    const cur = this.game.settings.operator[this.sel.side] || listSide(this.sel.side)[0].id;
    this.sel.operator = cur;
    saveSettings(this.game.settings);
    if (this.screen === 'operators') this._paintOperators();
    else if (this.screen === 'lobby') this._paintLobby();
    else this._paintMain();
    this._ensureHero();
    this.nav.refresh();
  }

  _pickOp(id) {
    const side = this.sel.side;
    this.sel.operator = id;
    this.game.pickOp(id);
    this.game.settings.operator[side] = id;
    saveSettings(this.game.settings);
    this._paintOperators();
    this.nav.refresh();
  }

  _paintGunsmith() {
    const side = this.sel.side;
    const op = getOp(this.sel.operator, side);
    if (!op) return;
    const lo = this.game.settings.loadout[op.id] = makeLoadout(op, this.game.settings.loadout[op.id] || {});
    this._gs = this._gs || {};
    this._gs.op = op.id;
    this._gs.slot = this._gs.slot || 'optic';
    // Seed slot picks from the existing loadout where we can.
    const picks = this._gs.picks = this._gs.picks || defaultPicks(lo);
    const w = WEAPONS[lo.primary];
    const body = document.getElementById('gunsmith-body');
    if (!body) return;
    const slot = GUNSMITH_SLOTS.find(s => s.id === this._gs.slot) || GUNSMITH_SLOTS[0];
    const opts = (GUNSMITH_OPTS[slot.id] || []).filter(o => slot.id !== 'optic' || !w || w.optics.includes(o.id) || o.id === 'iron');
    const stats = aggregate(picks);
    body.innerHTML = `
      <div class="gs-top">
        <b>${esc(op.name)}</b>
        <div class="chips">${op.primaries.map(id => `<button class="chip ${lo.primary === id ? 'on' : ''}" data-k="primary" data-v="${id}" data-nav>${esc((WEAPONS[id]||{}).name || id)}</button>`).join('')}</div>
        <div class="chips">${op.secondaries.map(id => `<button class="chip ${lo.secondary === id ? 'on' : ''}" data-k="secondary" data-v="${id}" data-nav>${esc((WEAPONS[id]||{}).name || id)}</button>`).join('')}</div>
      </div>
      <div class="gs-slots">
        ${GUNSMITH_SLOTS.map(s => `<button class="gs-slot ${this._gs.slot === s.id ? 'on' : ''}" data-fe="gun-slot" data-v="${s.id}" data-nav><small>${esc(s.name)}</small><b>${esc(labelOf(s.id, picks[s.id]))}</b></button>`).join('')}
      </div>
      <div class="gs-opts">
        <div class="fe-kicker">${esc(slot.name)} · ${esc(slot.hint)}</div>
        ${opts.map(o => `<button class="chip ${picks[slot.id] === o.id ? 'on' : ''}" data-fe="gun-opt" data-v="${o.id}" data-nav>${esc(o.name)}</button>`).join('')}
      </div>
      <div class="gs-skins">
        <div class="fe-kicker">SKINS</div>
        ${['Factory', 'Night Oil', 'Copper Wash', 'Field Grey'].map((n, i) => `<button class="chip ${((this._gs.skin||0)===i)?'on':''}" data-fe="gun-skin" data-v="${i}" data-nav>${n}</button>`).join('')}
      </div>
      <div class="gs-stats">
        ${statBar('Damage', stats.dmg)}
        ${statBar('Recoil control', stats.recoil)}
        ${statBar('ADS speed', stats.ads)}
        ${statBar('Mobility', stats.move)}
        ${statBar('Capacity', stats.cap)}
      </div>
    `;
    body.querySelectorAll('[data-k]').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const k = btn.dataset.k, v = btn.dataset.v;
        lo[k] = v;
        this.game.settings.loadout[op.id] = lo;
        saveSettings(this.game.settings);
        this._paintGunsmith();
      });
    });
    setText('gs-title', (w?.name || 'PRIMARY') + ' · GUNSMITH');

    function labelOf(slot, id) {
      return (GUNSMITH_OPTS[slot] || []).find(o => o.id === id)?.name || '—';
    }
    function defaultPicks(lo) {
      return {
        optic: lo.optic || 'red',
        muzzle: lo.attach?.suppressor ? 'suppressor' : 'flashhider',
        grip: lo.attach?.grip ? 'vert' : 'none',
        magazine: lo.attach?.magex ? 'magex' : 'std',
        siderail: lo.attach?.laser ? 'laser' : (lo.attach?.light ? 'light' : 'none'),
        internal: 'stock',
      };
    }
    function aggregate(picks) {
      const acc = { dmg: 2, recoil: 2, ads: 2, move: 2, cap: 2 };
      for (const slot of GUNSMITH_SLOTS) {
        const opt = (GUNSMITH_OPTS[slot.id] || []).find(o => o.id === picks[slot.id]);
        if (!opt) continue;
        for (const [k, v] of Object.entries(opt.stats || {})) {
          if (acc[k] == null) continue;
          acc[k] = Math.max(0, Math.min(5, acc[k] + v));
        }
      }
      return acc;
    }
    function statBar(name, n) {
      return `<div class="bar-row"><span>${name}</span><i class="pips"><u style="width:${(n / 5) * 100}%"></u></i></div>`;
    }
  }

  _gunSlot(v) { this._gs = this._gs || {}; this._gs.slot = v; this._paintGunsmith(); this.nav.refresh(); }
  _gunOpt(v) {
    const op = getOp(this.sel.operator, this.sel.side);
    const lo = this.game.settings.loadout[op.id] = makeLoadout(op, this.game.settings.loadout[op.id] || {});
    this._gs.picks[this._gs.slot] = v;
    // Map stub picks back onto the real loadout where it already exists.
    if (this._gs.slot === 'optic' && (WEAPONS[lo.primary]?.optics || []).includes(v)) lo.optic = v;
    if (this._gs.slot === 'muzzle') lo.attach.suppressor = v === 'suppressor';
    if (this._gs.slot === 'grip') lo.attach.grip = v !== 'none';
    if (this._gs.slot === 'magazine') lo.attach.magex = v === 'magex';
    if (this._gs.slot === 'siderail') { lo.attach.laser = v === 'laser'; lo.attach.light = v === 'light'; }
    saveSettings(this.game.settings);
    this._paintGunsmith();
    this.nav.refresh();
  }
  _gunSkin(v) { this._gs.skin = Number(v); this._paintGunsmith(); this.nav.refresh(); }

  _paintMissions() {
    this._syncTabs('missions');
    const p = this.profile;
    const ch = challengeState(p);
    const el = document.getElementById('missions-body');
    if (!el) return;
    el.innerHTML = `
      <div class="fe-panel-block">
        <div class="fe-kicker">INDUCTION</div>
        <div class="fe-bar-label"><span>${INDUCTION.name}</span><b>${p.induction}/${INDUCTION.goal}</b></div>
        <div class="fe-bar fat"><i style="width:${(p.induction / INDUCTION.goal) * 100}%"></i></div>
        <p class="fine">${esc(INDUCTION.hint)}</p>
      </div>
      <div class="fe-panel-block">
        <div class="fe-kicker">CHALLENGES</div>
        ${ch.map(c => `
          <div class="fe-chal ${c.done ? 'done' : ''}">
            <div class="fe-bar-label"><span>${esc(c.name)}</span><b>${c.progress}/${c.goal}</b></div>
            <div class="fe-bar"><i style="width:${(c.progress / c.goal) * 100}%"></i></div>
            <small>${esc(c.hint)} · ${c.reward} Marks</small>
          </div>`).join('')}
      </div>
    `;
  }

  _paintRewards() {
    this._syncTabs('free');
    const p = this.profile;
    const el = document.getElementById('rewards-body');
    if (!el) return;
    const tiers = [];
    for (let i = 1; i <= 10; i++) {
      const on = i <= p.passTier;
      const cur = i === p.passTier;
      tiers.push(`<div class="fe-tier ${on ? 'on' : ''} ${cur ? 'cur' : ''}"><b>${i}</b><small>${i % 5 === 0 ? 'Charm' : 'Marks'}</small></div>`);
    }
    el.innerHTML = `
      <div class="fe-kicker">${esc(FIELD_PASS.season)}</div>
      <h3>${esc(FIELD_PASS.name)} · TIER ${p.passTier}</h3>
      <div class="fe-bar-label"><span>Tier progress</span><b>${p.passXp}/${FIELD_PASS.xpPerTier}</b></div>
      <div class="fe-bar fat"><i style="width:${(p.passXp / FIELD_PASS.xpPerTier) * 100}%"></i></div>
      <div class="fe-tiers">${tiers.join('')}</div>
      <p class="fine">Free track only. No purchase is required to earn Marks and charms.</p>
    `;
  }

  _paintShop() {
    this._syncTabs('shop');
    const el = document.getElementById('shop-body');
    if (!el) return;
    const items = [
      { name: 'Copper Wash', kind: 'Weapon skin', cost: 8, cur: 'chits' },
      { name: 'Night Oil', kind: 'Weapon skin', cost: 6, cur: 'chits' },
      { name: 'Field Grey', kind: 'Uniform', cost: 1200, cur: 'marks' },
      { name: 'Warrant Charm', kind: 'Charm', cost: 400, cur: 'marks' },
      { name: 'Annex Patch', kind: 'Charm', cost: 400, cur: 'marks' },
      { name: 'Hearth Pin', kind: 'Charm', cost: 250, cur: 'marks' },
    ];
    el.innerHTML = items.map(it => `
      <div class="fe-shop-card" data-nav>
        <div class="swatch"></div>
        <b>${esc(it.name)}</b>
        <small>${esc(it.kind)}</small>
        <span class="cost">${fmt(it.cost)} ${it.cur === 'chits' ? 'Chits' : 'Marks'}</span>
      </div>`).join('');
  }

  _paintPractice() {
    const el = document.getElementById('practice-body');
    if (!el) return;
    const rangeOn = this.sel.practiceKind === 'range';
    el.innerHTML = `
      <button class="fe-prac-card ${rangeOn ? 'on' : ''}" data-fe="practice-kind" data-v="range" data-nav>
        <b>Shooting Range</b>
        <span>Targets, damage numbers, recoil practice. Coming online with the gameplay rebuild; the queue still opens a local session today.</span>
      </button>
      <div class="fe-kicker">EXPLORE A MAP</div>
      <div class="fe-prac-maps">
        ${MAPS.map(m => `
          <button class="fe-prac-card ${!rangeOn && this.sel.map === m.id ? 'on' : ''}" data-fe="set-map" data-v="${m.id}" data-nav>
            <i class="swatch" style="background:${m.accent}"></i>
            <b>${esc(m.name)}</b>
            <span>${esc(m.blurb)}</span>
            ${m.ready ? '' : '<small>BLOCKOUT — plays Halcyon Press until the map ships</small>'}
          </button>`).join('')}
      </div>
    `;
    // Choosing a map implies explore.
    if (!rangeOn) this.sel.practiceKind = 'explore';
  }

  _paintSlam() {
    const r = this.lastResult;
    const won = !!r?.won;
    const el = document.getElementById('slam-word');
    if (el) {
      el.textContent = won ? 'VICTORY' : 'DEFEAT';
      el.classList.toggle('win', won);
      el.classList.toggle('loss', !won);
    }
    const sub = document.getElementById('slam-sub');
    if (sub) sub.textContent = won ? 'MATCH WIN' : 'MATCH OVER';
    const sc = document.getElementById('slam-score');
    if (sc) sc.textContent = `${r?.scoreAtk ?? 0} — ${r?.scoreDef ?? 0}`;
    document.getElementById('scr-slam')?.classList.toggle('defeat', !won);
    document.getElementById('end-slash')?.classList.toggle('hidden', won);

  }

  _paintHighlights() {
    const r = this.lastResult;
    const won = !!r?.won;
    setText('hl-title', won ? 'MATCH WIN' : 'MATCH LOSS');
    const side = r?.side || this.sel.side;
    const winners = (r?.rows || []).filter(row => row.team === (r?.winner || side));
    const el = document.getElementById('hl-lineup');
    if (el) {
      el.innerHTML = winners.slice(0, 5).map(row => `
        <div class="fe-hl-op ${row.you ? 'you' : ''} ${row.id === r?.mvpId ? 'mvp' : ''}">
          ${opThumb(row.opId, (row.opName || row.name || '?').slice(0, 1), 'portrait')}
          <b>${esc(row.name)}</b>
          <small>${esc(row.opName || '')}</small>
          <button class="fe-thumb" data-fe="commend" data-nav aria-label="Commend ${esc(row.name)}">👍</button>
        </div>`).join('');
    }
  }

  _paintScoreboard() {
    const r = this.lastResult;
    const el = document.getElementById('postscore-body');
    if (!el || !r) return;
    const atk = (r.rows || []).filter(x => x.team === 'attack');
    const def = (r.rows || []).filter(x => x.team === 'defend');
    const table = (list, label, cls) => `
      <div class="fe-board-col ${cls}">
        <div class="fe-kicker ${cls}">${label}</div>
        <table>
          <thead><tr><th>Operator</th><th>K</th><th>A</th><th>D</th><th>Score</th></tr></thead>
          <tbody>
            ${list.map(row => `<tr class="${row.you ? 'you' : ''} ${row.id === r.mvpId ? 'mvp' : ''}">
              <td class="op">${opThumb(row.opId, (row.name || '?').slice(0, 1))}<span>${esc(row.name)}${row.you ? ' (you)' : ''}${row.id === r.mvpId ? ' · MVP' : ''}</span></td>
              <td>${row.k}</td><td>${row.a}</td><td>${row.d}</td><td>${row.score}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    el.innerHTML = table(atk, 'YOUR TEAM', r.side === 'attack' ? 'atk youside' : 'atk') +
      table(def, 'ENEMY TEAM', r.side === 'defend' ? 'def youside' : 'def');
    // Relabel correctly based on the player's side.
    el.innerHTML = table(
      r.side === 'attack' ? atk : def, 'YOUR TEAM', r.side === 'attack' ? 'atk' : 'def'
    ) + table(
      r.side === 'attack' ? def : atk, 'ENEMY TEAM', r.side === 'attack' ? 'def' : 'atk'
    );
    setText('ps-score', `${r.scoreAtk} — ${r.scoreDef}`);
    setText('ps-mvp', (r.rows || []).find(x => x.id === r.mvpId)?.name || '—');
  }

  _paintProgress() {
    const p = this.profile;
    const rw = this.lastRewards || { marks: 0, xp: 0 };
    const ch = challengeState(p);
    const el = document.getElementById('progress-body');
    if (!el) return;
    el.innerHTML = `
      <div class="fe-prog-grid">
        <div class="fe-panel-block">
          <div class="fe-kicker">ACCOUNT</div>
          <h3>LEVEL ${p.level}</h3>
          <div class="fe-bar-label"><span>XP</span><b>${p.xp}/${p.xpToNext}</b></div>
          <div class="fe-bar fat"><i style="width:${(p.xp / p.xpToNext) * 100}%"></i></div>
          <p class="fine">+${rw.xp || 0} XP this match</p>
        </div>
        <div class="fe-panel-block">
          <div class="fe-kicker">MATCH REWARDS</div>
          <h3>+${fmt(rw.marks || 0)} MARKS</h3>
          <p class="fine">Wallet ${fmt(p.marks)} Marks · ${fmt(p.chits)} Chits</p>
        </div>
        <div class="fe-panel-block">
          <div class="fe-kicker">${esc(FIELD_PASS.name)} · TIER ${p.passTier}</div>
          <div class="fe-bar-label"><span>Pass XP</span><b>${p.passXp}/${FIELD_PASS.xpPerTier}</b></div>
          <div class="fe-bar fat"><i style="width:${(p.passXp / FIELD_PASS.xpPerTier) * 100}%"></i></div>
        </div>
        <div class="fe-panel-block">
          <div class="fe-kicker">CHALLENGES</div>
          ${ch.map(c => `<div class="fe-bar-label"><span>${esc(c.name)}</span><b>${c.progress}/${c.goal}</b></div>
            <div class="fe-bar"><i style="width:${(c.progress / c.goal) * 100}%"></i></div>`).join('')}
        </div>
      </div>
    `;
  }

  _fmtQueue(t) {
    const s = Math.max(0, Math.floor(t));
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  beginQueue() {
    this.cancelQueue(true);
    this.queue.running = true;
    this.queue.t = 0;
    this.queue.est = this.test.instantQueues ? 1 : 8 + Math.floor(Math.random() * 6);
    this.show('matchmaking');
    this._musicFor('matchmaking');
    const step = this.test.instantQueues ? 50 : 250;
    const limit = this.test.instantQueues ? 0.4 : 2.2 + Math.random() * 1.2;
    const t0 = performance.now();
    this._mmTick = setInterval(() => {
      this.queue.t = (performance.now() - t0) / 1000;
      this._paintMatchmaking();
      if (this.queue.t >= limit) {
        clearInterval(this._mmTick);
        this._mmTick = null;
        if (this.test.autoAdvance !== false) this._openMatchCard();
      }
    }, step);
  }

  cancelQueue(silent) {
    if (this._mmTick) { clearInterval(this._mmTick); this._mmTick = null; }
    if (this._cardTick) { clearInterval(this._cardTick); this._cardTick = null; }
    this.queue.running = false;
    if (!silent && this.screen === 'matchmaking') this.show('lobby');
  }

  _openMatchCard() {
    this._pendingLineup = this._lineupPreview();
    this.show('matchstart');
    playStinger('stinger_round_start');
    const fill = document.getElementById('ms-fill');
    let p = 0;
    const dur = this.test.instantQueues ? 300 : 1400;
    const t0 = performance.now();
    this._cardTick = setInterval(async () => {
      p = Math.min(1, (performance.now() - t0) / dur);
      if (fill) fill.style.width = (p * 100) + '%';
      setText('ms-load', p < 1 ? 'Loading match…' : 'Ready');
      if (p >= 1) {
        clearInterval(this._cardTick);
        this._cardTick = null;
        if (this.test.autoAdvance !== false) await this._launch();
      }
    }, 50);
  }

  async _launch() {
    const mock = this.test.mockMatch;
    this._endOpen = false;
    try {
      if (mock) {
        const result = mockMatchResult({ ...this.sel, callsign: this.profile.callsign });
        this.beginMatchEnd(result);
        return;
      }
      this._showLoad(true, 'Loading ' + mapById(this.sel.map).name, this._tip);
      stopMusic();
      await startMatch(this.game, this.sel, {
        mock: false,
        onMatchEnd: (snap) => this.beginMatchEnd(snap),
        onQuit: (showMenu) => {
          if (showMenu === false) return;
          this.show('lobby');
          this._musicFor('lobby');
        },
      });
      this._showLoad(false);
      document.getElementById('menus')?.classList.add('hidden');
      document.getElementById('op-showcase')?.classList.add('hidden');
      this._menuMode = null;
      this._setVignette(true);
    } catch (e) {
      console.warn('startMatch', e);
      this._showLoad(false);
      this._toast('Could not start the match. Returning to lobby.');
      this.show('lobby');
    }
  }

  _liveResult() {
    const g = this.game;
    if (g?.round && g.player) {
      try { return matchSnapshot(g); } catch (e) { console.warn('matchSnapshot', e); }
    }
    const won = g.round?.winner === g.player?.team;
    return mockMatchResult({
      ...this.sel,
      callsign: this.profile.callsign,
      forceWin: won,
    });
  }

  beginMatchEnd(result) {
    let incoming = result;
    if (this.game?._matchEndSnapshot) {
      incoming = richerSnapshot(incoming, snapshotFromApi(this.game._matchEndSnapshot, this.game));
    }
    // Last chance: freeze live pawns before quit if we still don't have 10 rows.
    if (!isCompleteSnapshot(incoming) && this.game?.bots?.length) {
      incoming = matchSnapshot(this.game);
    }
    incoming = richerSnapshot(incoming, this.lastResult);
    const alreadyComplete = isCompleteSnapshot(this.lastResult);
    if (this.game.running) {
      try { this.game.quit(false); } catch {}
    }
    // Do not let a later call (ui.show('end') or the _endRound wrapper)
    // overwrite a complete snapshot or restart the slam after teardown.
    if (this._endOpen && alreadyComplete && !isStrictlyRicher(incoming, this.lastResult)) {
      return;
    }
    this.lastResult = incoming || result;
    this.lastRewards = applyMatchRewards(this.profile, this.lastResult);
    this._paintChrome();
    this._endStep = 0;
    this._endOpen = true;
    document.getElementById('menus')?.classList.remove('hidden');
    document.getElementById('hud')?.classList.add('hidden');
    document.getElementById('touch')?.classList.add('hidden');
    stopMusic();
    this.show('slam');
    playStinger(this.lastResult?.won ? 'stinger_win' : 'stinger_loss');
    if (this.test.autoAdvance === false) return;
    const wait = this.test.instantQueues ? 350 : 1600;
    this._endTimer && clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => this._advanceEnd(), wait);
  }

  _advanceEnd() {
    this._endTimer && clearTimeout(this._endTimer);
    const order = ['slam', 'highlights', 'postscore', 'progress'];
    const i = order.indexOf(this.screen);
    if (i < 0 || i === order.length - 1) {
      // Stay on progress; buttons take it from here. If we were mid-slam auto-advance, go next.
      if (i >= 0 && i < order.length - 1) this.show(order[i + 1]);
      return;
    }
    this.show(order[i + 1]);
    if (order[i + 1] !== 'progress' && this.test.autoAdvance !== false) {
      const wait = this.test.instantQueues ? 350 : 2200;
      this._endTimer = setTimeout(() => this._advanceEnd(), wait);
    }
  }

  /** Test / QA hooks. */
  setTestMode({ instantQueues = false, mockMatch = false, autoAdvance = true } = {}) {
    this.test.instantQueues = !!instantQueues;
    this.test.mockMatch = !!mockMatch;
    this.test.autoAdvance = autoAdvance !== false;
  }

  /** Step the queue / end-of-match flow. Used by tests and the Continue buttons. */
  debugAdvance() {
    if (this.screen === 'matchmaking') { this._openMatchCard(); return 'matchstart'; }
    if (this.screen === 'matchstart') { this._launch(); return 'launch'; }
    if (['slam', 'highlights', 'postscore'].includes(this.screen)) { this._advanceEnd(); return this.screen; }
    return this.screen;
  }
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}


export function attachFrontEnd(game) {
  const fe = new FrontEnd(game);
  game.frontend = fe;
  window.__FE = fe;
  return fe;
}
