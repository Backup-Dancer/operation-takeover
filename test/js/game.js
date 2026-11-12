import * as THREE from 'three';
import { BUILD, TITLE, PREP_TIME, ACTION_TIME, PLANT_TIME, DEFUSE_TIME, BOMB_TIME, INTERMISSION, REINFORCE_TIME, EYE } from './config.js?v=iv-4.1.2';
import { loadSettings, saveSettings } from './settings.js?v=iv-4.1.2';
import { Gfx } from './gfx.js?v=iv-4.1.2';
import { unlock as unlockAudio, sfx, playDispatch, loadDispatch, stopMusic, announce } from './audio.js?v=iv-4.1.2';
import { mulberry32 } from './math.js?v=iv-4.1.2';
import { attachMatchApi, normalizeMatchConfig, MatchHandle, lineupPayload, rosterPayload } from './match/api.js?v=iv-4.1.2';
import { resetMatchStats, collectStats, recordKill, recordDown, recordRevive, recordObjective, awardRoundWin, resetRoundCombat, addScore, ensureStat, freezeMatchEnd } from './match/stats.js?v=iv-4.1.2';
import { BLEED_TIME, REVIVE_TIME, REVIVE_HP, MAX_HP } from './match/combat.js?v=iv-4.1.2';
import { pickSafeAttackSpawn, inBuilding, isSpawnProtected, SPAWN_PROTECT_SEC, hasLOS } from './match/vision.js?v=iv-4.1.2';
import { Input } from './input.js?v=iv-4.1.2';
import { UI } from './ui.js?v=iv-4.1.2';
import { World } from './world.js?v=iv-4.1.2';
import { Nav } from './nav.js?v=iv-4.1.2';
import { getOp } from './operators.js?v=iv-4.1.2';
import { makeLoadout, instWeapon, UTIL, WEAPONS } from './weapons.js?v=iv-4.1.2';
import { createPlayer, updatePlayer, updateCamera, startRappel as doStartRappel, detachRappel as doDetach, setStance as doSetStance, buildVm, opticScreenPos as doOptic, colH, updateRappel as doUpdateRappel, clearAdsToggle } from './player.js?v=iv-4.1.2';
import { Gadgets } from './gadgets.js?v=iv-4.1.2';
import * as combat from './combat.js?v=iv-4.1.2';
import { spawnBots, updateBots, readyBots } from './bots.js?v=iv-4.1.2';
import { DroneSys } from './drone.js?v=iv-4.1.2';
import { addMark, resetMarks, updateMarks, aimPing, autoScan } from './marks.js?v=iv-4.1.2';
import { difficultyParams, normalizeDifficulty } from './difficulty.js?v=iv-4.1.2';
import { scorePopup, showWon, showEliminated, showMatchCard, hideMatchOverlays, updateCompass, updateSquad, setReinforceRing, setProgressRing, roomCallout, showScanning } from './banners.js?v=iv-4.1.2';
import { MAP, SITE_PAIRS, floorY } from './map.js?v=iv-4.1.2';
import { buildHuman, measure } from './characters.js?v=iv-4.1.2';
import { createFirstPersonViewmodel, createDefuserViewmodel, initModelLoaders, updateOperatorLod, preloadKnown, preloadWeapon, prefetchOtherWeapons, resetWeaponInstances } from './models.js?v=iv-4.1.2';
import { MenuScene } from './menu/MenuScene.js?v=iv-4.1.2';

export class Game {
  get charges(){ return this.gadgets.charges; }

  constructor() {
    this.settings = loadSettings();
    // Bind menu listeners before WebGL / input so a later throw cannot
    // leave TAP TO START or PLAY sitting dead on iOS.
    this.ui = new UI(this);
    try {
      this.gfx = new Gfx(document.getElementById('game'));
      this.camera = this.gfx.camera;
      this.input = new Input(this, this.settings);
      attachMatchApi(this);
      this.gadgets = new Gadgets(this);
      this.sys = this;
      this._combat = combat;
      this.running = false;
      this.ended = false;
      this.inMenu = true;
      this.time = 0;
      this.timeScale = 1;
      this.godMode = false;
      this.bots = [];
      this.round = null;
      this.player = createPlayer(this);
      this.applyCrosshair();
      this.gfx.setQuality(this.settings.quality);
      this.gfx.setupLights();
      this._bindPrompt();
    } catch (e) {
      console.error('Game init failed', e);
      if (window.__ivShowError) window.__ivShowError(e && (e.stack || e.message) || e);
    }
  }

  async boot() {
    if (this._booting) return;
    this._booting = true;
    try {
      if (this.ui) { this.ui.show('main'); this.inMenu = true; }
      unlockAudio().catch(() => {});
      this._checkVersion().catch(() => {});
      if (!this._assets && this.gfx) {
        this._showLoad(true, 'Loading assets');
        try {
          await this.gfx.loadAssets((m, p) => this._loadMsg(m, p * 0.4));
          this._assets = true;
          await initModelLoaders(this.gfx);
          await preloadKnown([]);
        } catch (e) {
          console.warn('asset load failed', e);
          if (window.__ivShowError) window.__ivShowError(e && (e.stack || e.message) || e);
        } finally {
          this._showLoad(false);
        }
      }
      await this._ensureMenu();
    } finally {
      this._booting = false;
    }
  }

  async _ensureMenu() {
    if (!this.gfx) return;
    if (!this.menu) {
      try { this.menu = new MenuScene(this); } catch (e) { console.warn('MenuScene', e); }
    }
    if (this.menu) { this.menu.resume(); this.menu.setMode('street'); }
    if (!this._looping) { this._looping = true; this._last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
  }

  async _checkVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j.build && j.build !== BUILD) {
        const u = new URL(location.href);
        if (u.searchParams.get('v') !== j.build) {
          u.searchParams.set('v', j.build);
          location.replace(u.toString());
          return;
        }
      }
    } catch {}
  }

  pickOp(id) {
    const side = this.settings.side;
    this.settings.operator[side] = id;
    saveSettings(this.settings);
  }

  async deploy() {
    return this.startMatch({
      mode: 'bomb-rush',
      side: this.settings.side,
      difficulty: this.settings.difficulty,
      bestOf: this.settings.bestOf,
      map: 'halcyon',
      operator: this.settings.operator?.[this.settings.side],
      skipOperatorPick: true,
    });
  }

  async start(cfg = {}) {
    this._showLoad(true, 'Building Halcyon Press');
    if (this.running) this.quit(false);
    if (!this._assets) {
      await this.gfx.loadAssets((m, p) => this._loadMsg(m, p * 0.35));
      this._assets = true;
    }
    await initModelLoaders(this.gfx);
    attachMatchApi(this);
    const config = cfg._fromMatchApi && this.match?.config
      ? this.match.config
      : normalizeMatchConfig(cfg, this.settings);
    if (!this.match || !cfg._fromMatchApi) this.match = new MatchHandle(this, config);
    this.cfg = { ...config };
    this._rng = mulberry32(config.seed);
    this.ended = false;
    this._matchEndSnapshot = null;
    this.timeScale = 1;
    this.godMode = !!cfg.godMode || !!config.godMode || this.godMode;
    // world
    if (this.world) this.world.dispose();
    this.world = new World(this.gfx);
    await this.world.build((msg, p) => this._loadMsg(msg, 0.4 + p * 0.5));
    this.nav = new Nav(this.world);
    this.world.nav = this.nav;
    await this.nav.ready;
    this.gadgets.reset();
    this.droneSys = new DroneSys(this);
    this.inDrone = false; this.inCams = false;

    const pair = this.cfg.sitePair
      ? SITE_PAIRS.find(p => p.id === this.cfg.sitePair) || SITE_PAIRS[0]
      : SITE_PAIRS[(this._rng() * SITE_PAIRS.length) | 0];
    this.round = {
      pair, siteIds: pair.sites, scoreAtk: 0, scoreDef: 0, need: Math.ceil((this.cfg.bestOf || 3) / 2),
      n: 0, phase: 'prep', t: this.cfg.prepTime || PREP_TIME, planted: false, plantPos: null, plantProgress: 0, defuseProgress: 0,
      winner: null, swapped: false,
    };

    const side = this.cfg.side || 'attack';
    const op = getOp(this.cfg.operator || this.cfg.atkOp || this.cfg.defOp || this.settings.operator[side], side);
    this.player = createPlayer(this);
    this.player.id = 'player';
    this.player.kind = 'player';
    this.player.team = side;
    this.player.op = op; this.player.opId = op.id;
    this.player.speed = op.speed; this.player.armor = op.armor;
    this.player.kills = 0; this.player.deaths = 0;
    const lo = makeLoadout(op, this.settings.loadout[op.id] || this.cfg.loadout || {});
    this.loadout = lo;
    this.weapon = instWeapon(lo.primary, lo);
    this.weaponSlot = 'primary';
    this.secWeapon = instWeapon(lo.secondary, lo);
    this.util = { ...(UTIL[lo.util] || UTIL.breach), left: (UTIL[lo.util] || UTIL.breach).count };
    this.sig = { ...op.gadget, left: op.gadget.count };
    this._spawnPlayer(side);
    buildVm(this);
    await preloadWeapon(this.weapon?.id).catch(() => {});
    if (this.secWeapon?.id && this.secWeapon.id !== this.weapon?.id) {
      await preloadWeapon(this.secWeapon.id).catch(() => {});
    }
    await this._tryAuthoredWeapon();
    /* iv-2.1 floor snap */
    {
      const p = this.player;
      const gy = this.world.groundAt(p.pos.x, p.pos.z, p.pos.y + 1.0);
      if (Number.isFinite(gy) && Math.abs(gy - p.pos.y) <= 0.5) p.pos.y = gy;
      this.camera.position.set(p.pos.x, p.pos.y + (p.eye || 1.5), p.pos.z);
    }
    this.applyCrosshair();

    this.bots.forEach(b => b.mesh && this.gfx.scene.remove(b.mesh));
    this.bots = spawnBots(this);
    await readyBots(this.bots);
    this.droneSys.spawnRound();
    resetMarks(this);
    loadDispatch().catch(() => {});

    this.hideViewmodel = false; this.viewMode = 'fp';
    this.running = true; this.inMenu = false;
    if (this.menu) this.menu.pause();
    this.ui.hide();
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('touch').classList.remove('hidden');
    this.input.applyLayout();
    this._showLoad(false);
    this._last = performance.now();
    if (!this._looping) { this._looping = true; requestAnimationFrame(t => this.loop(t)); }
    this.updateAmmo();
    resetMatchStats(this);
    this._setPhase('prep', this.cfg.prepTime || PREP_TIME);
    stopMusic();
    hideMatchOverlays();
    this.emitMatch?.('matchstart', {
      map: this.cfg.map, mode: this.cfg.mode, difficulty: this.cfg.difficulty,
      side, operator: this.player.opId, bestOf: this.cfg.bestOf, seed: this.cfg.seed,
      sites: this.round.siteIds, lineups: lineupPayload(this),
    });
    await this._maybePick();
    this._beginPrep(this.player.team);
    this.emitMatch?.('roundstart', this._roundPayload());
    if (!this.godMode && !this.cfg.skipMatchCard) showMatchCard(this);
    // Lazy-load the rest of the arsenal after the first frame so the
    // official 1K FP set stays off the critical path.
    const hold = [this.weapon?.id, this.secWeapon?.id];
    queueMicrotask(() => prefetchOtherWeapons(hold).catch(() => {}));
    return this;
  }

  _spawnPlayer(side) {
    const w = this.world;
    if (side === 'attack') {
      const s = pickSafeAttackSpawn(this, 0, this._rng || Math.random);
      this.player.pos.set(s.x, s.y || 0, s.z); this.player.yaw = s.yaw || 0;
    } else {
      const site = w.sites[this.round.pair.sites[0]];
      const roomY = floorY(site.plant.floor || site.floor || '1');
      const tries = [];
      for (let r = 0.9; r <= 2.6; r += 0.4) {
        for (let a = 0; a < 8; a++) {
          const ang = a * Math.PI / 4;
          tries.push([Math.cos(ang) * r, Math.sin(ang) * r]);
        }
      }
      tries.push([0, 0]);
      let sx = site.plant.x, sz = site.plant.z, sy = roomY, found = false;
      for (const [dx, dz] of tries) {
        const x = site.plant.x + dx, z = site.plant.z + dz;
        const y = w.groundAt(x, z, roomY + 0.8);
        if (Math.abs(y - roomY) > 0.22) continue;
        if (w.pointInSolid(x, y + 0.2, z, 0.22, 1.3)) continue;
        sx = x; sz = z; sy = y; found = true; break;
      }
      this.player.pos.set(sx, sy, sz); this.player.yaw = 0;
      if (found && w.pointInSolid(sx, sy + 0.2, sz, 0.2, 1.2)) {
        this.player.pos.x += 0.4;
      }
    }
  }

  quit(showMenu = true) {
    this.running = false;
    this.gadgets.reset();
    this.droneSys?.dispose?.();
    resetMarks(this);
    if (this.world) this.world.dispose();
    this._botGen = (this._botGen || 0) + 1;
    for (const b of this.bots) {
      b._dead = true;
      if (b.mesh?.parent) b.mesh.parent.remove(b.mesh);
    }
    // Sweep any leaked operator meshes from a late load after a previous quit.
    if (this.gfx?.scene) {
      for (const o of [...this.gfx.scene.children]) {
        if (o.name && o.name.indexOf('op-') === 0) this.gfx.scene.remove(o);
      }
    }
    this.bots = [];
    this.inDrone = false; this.inCams = false;
    this.hideViewmodel = false;
    this.viewMode = 'fp';
    if (this.vm) this.vm.visible = false;
    resetWeaponInstances();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('touch').classList.add('hidden');
    document.getElementById('drone-ov')?.classList.add('hidden');
    document.getElementById('cctv-ov')?.classList.add('hidden');
    if (showMenu) {
      this.inMenu = true;
      this.ui.show('main');
      this.menu?.resume();
      this.menu?.setMode('street');
    }
  }

  quitToMenu() { this.quit(true); }
  resume() { this.inMenu = false; this.ui.hide(); document.getElementById('hud').classList.remove('hidden'); document.getElementById('touch').classList.remove('hidden'); }
  closeScore() { this.inMenu = false; this.ui.hide(); }

  loop(t) {
    requestAnimationFrame(tt => this.loop(tt));
    const dt = Math.min(0.05, (t - (this._last || t)) / 1000);
    this._last = t;
    if (!this.running || this.inMenu) {
      if (document.hidden) return;
      this.ui?.pollOpsPad?.(dt);
      if (this.menu) this.menu.tick(dt);
      else this.gfx.render();
      return;
    }
    if (this._pauseSim) {
      this.gfx.tickAuto(dt);
      this.gfx.render();
      return;
    }
    // timeScale is a test/debug speedup (integer substeps, default 1).
    const steps = Math.min(16, Math.max(1, Math.round(this.timeScale || 1)));
    this.input.pollPad();
    for (let i = 0; i < steps; i++) {
      this.time += dt;
      this.tick(dt);
      this.gfx.tickAuto(dt);
    }
    this.gfx.render();
  }

  tick(dt) {
    const inp = this.input, p = this.player;
    if (this.leanHoldApplies()) p.leanT = inp.leanHold || p.leanT;
    if (inp.leanHold) p.leanT = inp.leanHold;

    if (inp.consume('pause')) { this.inMenu = true; this.ui.show('pause'); return; }
    if (inp.consume('score')) { this.inMenu = true; this.ui.show('score'); return; }

    if (!p.alive && !p.downed) {
      this._tickSpectate(dt);
      this._tickSim(dt);
      return;
    }

    if (this.droneSys.active || this.droneSys.camsOn) {
      if (this.vm) this.vm.visible = false;
      this._tickFeed(dt);
      this._tickSim(dt);
      return;
    }

    if (inp.consume('drone')) { if (p.team === 'attack' && !p.downed) this.enterDrone(); else this.enterCams(); }
    if (inp.consume('cams')) this.enterCams();

    updatePlayer(this, dt);
    combat.applyAimAssist(this, dt);
    updateCamera(this, dt);
    this.world.cull?.(this.camera);
    this._cullBots();
    if (this.gfx.quality === 'high') this.gfx.limitShadows?.(this.camera);

    if (inp.fire && p.alive && !p.downed) combat.fireWeapon(this);
    if (inp.consume('reload')) combat.beginReload(this);
    combat.finishReload(this);

    if (inp.consume('swap')) this.swapWeapon();
    if (inp.consume('gadget')) this.useGadget();
    if (inp.consume('gadget2')) this.useUtil();
    if (inp.consume('detonate')) this.gadgets.detonate('selected');
    if (inp.consume('ping')) this.ping();
    if (inp.consume('melee')) combat.melee(this);
    if (inp.consume('rappel')) this.tryRappelOrVault();
    if (inp.consume('interact')) this.activatePrompt();
    else if (inp.held.has('interact')) this.interact(dt, true);
    else if (this.player.planting) this._cancelPlant();

    this._updateInteractPrompt();
    this._tickSim(dt);
    // fire-on-aim optional
    if (this.settings.fireOnAim !== 'off' && p.alive) {
      const ok = this.settings.fireOnAim === 'always' || (this.settings.fireOnAim === 'hip' && p.ads < 0.4);
      if (ok && combat.aimAssistTarget(this) && !inp.fire) { /* dwell skipped in v1 if not already firing */ }
    }
  }

  leanHoldApplies() { return this.input.leanIsHold(); }

  setStance(st, opts) { return doSetStance(this, st, opts); }
  startRappel(spot) { return doStartRappel(this, spot); }
  detachRappel(reason, opts) { return doDetach(this, reason, opts); }
  updateRappel(dt) { return doUpdateRappel(this, dt); }
  updatePlayer(dt) { return updatePlayer(this, dt); }
  updateCamera(dt) { return updateCamera(this, dt); }
  opticScreenPos() { return doOptic(this); }
  buildVm() { return buildVm(this); }
  isHostile(t) { return combat.isHostile(this, t); }

  tryRappelOrVault() {
    const p = this.player, w = this.world;
    if (p.rappelling) {
      const win = w.alignedWindow(p.rappelling, 0.75);
      if (win) return this._enterWindow(win);
      // drop off at ground
      if (p.rappelling.y < 0.6) this.detachRappel('drop');
      return;
    }
    const spot = w.findRappelSpot(p.pos, p.yaw, 2.4);
    if (spot) { sfx.rappel(); return this.startRappel(spot); }
    // vault low obstacle
    return this._vault();
  }

  _enterWindow(win) {
    if (win.state === 'barricaded' || win.state === 'reinforced') {
      this.toast('Breach the window first');
      return false;
    }
    if (win.state === 'intact' || win.state === 'cracked') this.world.damageWindow(win, 99);
    const rp = this.player.rappelling;
    const inward = { x: win.x - win.nx * 1.15, z: win.z - win.nz * 1.15 };
    this.player.pos.set(inward.x, win.y, inward.z);
    const gnd = this.world.groundAt(inward.x, inward.z, win.y + 1.2);
    this.player.pos.y = gnd;
    this.world.resolve(this.player.pos, 0.32, colH(this.player));
    this.detachRappel('enter', { keepPos: true });
    this.toast('Entered');
    return true;
  }

  _vault() {
    const p = this.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const nx = p.pos.x + fx * 1.0, nz = p.pos.z + fz * 1.0;
    const g1 = this.world.groundAt(nx, nz, p.pos.y + 1);
    if (g1 > p.pos.y + 0.15 && g1 < p.pos.y + 0.9) {
      p.pos.x = nx; p.pos.z = nz; p.pos.y = g1;
      this.world.resolve(p.pos, 0.32, colH(p));
      return true;
    }
    return false;
  }

  interactTap() { return this.interact(0.2, false); }

  interact(dt, holding) {
    const p = this.player, w = this.world;
    // door
    const door = w.nearestDoor(p.pos, 1.5);
    if (door && Math.abs((p.pos.y || 0) - door.y) < 2.2) {
      if (!holding || dt) w.toggleDoor(door), sfx.door();
      return true;
    }
    // revive a downed teammate
    if (p.alive && !p.downed) {
      const downed = this._nearDownedTeammate();
      if (downed && !downed._revivedThisRound) {
        if (holding) {
          if (!this._revive || this._revive.who !== downed) this._revive = { who: downed, t: 0 };
          this._revive.t += dt || 0;
          this.toast(`Reviving ${(this._revive.t / REVIVE_TIME * 100)|0}%`);
          if (this._revive.t >= REVIVE_TIME) {
            downed.downed = false; downed.alive = true; downed.hp = REVIVE_HP;
            downed._revivedThisRound = true; downed.bleedAt = 0;
            recordRevive(this, downed, p);
            this.toast('Teammate up');
            this._revive = null;
          }
        }
        return true;
      }
      this._revive = null;
    }
    // plant / defuse
    if (this.round.phase === 'action' || this.round.planted) {
      const site = this._nearPlant();
      if (this.player.team === 'attack' && site && !this.round.planted) {
        if (holding) this._plant(dt, site);
        else this._cancelPlant();
        return true;
      }
      if (this.player.team === 'defend' && this.round.planted && this._nearDefuser()) {
        if (holding) this._defuse(dt);
        else this._cancelPlant();
        return true;
      }
    }
    this._cancelPlant();
    // reinforce in prep
    if (this.round.phase === 'prep' && p.team === 'defend') {
      const ch = w.chunks.find(c => !c.destroyed && !c.reinforced && Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < 1.6);
      if (ch && holding) {
        if (!this._reinf || this._reinf.ch !== ch) this._reinf = { ch, t: 0 };
        this._reinf.t += dt || 0;
        setReinforceRing(this._reinf.t / (REINFORCE_TIME || 4));
        if (this._reinf.t >= (REINFORCE_TIME || 4)) {
          w.reinforceChunk(ch);
          this.toast('Shutter set');
          scorePopup(this, 'reinforce');
          this._reinf = null;
          setReinforceRing(0);
        }
        return true;
      }
      this._reinf = null;
      setReinforceRing(0);
      const win = w.windows.find(wi => Math.hypot(wi.x - p.pos.x, wi.z - p.pos.z) < 1.6 && wi.state !== 'barricaded');
      if (win && holding) { w.barricadeWindow(win); this.toast('Barricade set'); scorePopup(this, 'barricade'); return true; }
    } else {
      this._reinf = null;
      setReinforceRing(0);
    }
    return false;
  }

  _nearPlant() {
    for (const id of this.round.pair.sites) {
      const s = this.world.sites[id];
      const y = this.world.groundAt(s.plant.x, s.plant.z, this.player.pos.y + 2);
      if (Math.hypot(s.plant.x - this.player.pos.x, s.plant.z - this.player.pos.z) < 1.4 && Math.abs(this.player.pos.y - y) < 1.2) return s;
    }
    return null;
  }
  _nearDefuser() {
    const p = this.round.plantPos; if (!p) return false;
    return Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) < 1.4;
  }
  _beginPlantPose(kind) {
    if (this._plantingKind === kind) return;
    this._plantingKind = kind;
    this.player.planting = true;
    this.player.adsToggle = false;
    this.player.sprint = false;
    if (this.input) this.input.ads = false;
    this.doSetStance ? null : null;
    try { doSetStance(this, 1); } catch (e) {}
    this.player.stanceT = 1;
    if (!this._weaponVmBackup) this._weaponVmBackup = this.vm;
    const vis = createDefuserViewmodel();
    this.gfx.setViewmodel(vis);
    this.vm = vis;
  }
  _cancelPlant() {
    if (!this.player?.planting && !this._plantingKind) {
      if (this.round) {
        // keep progress only if mid-hold was already cleared
      }
      return;
    }
    const was = this._plantingKind;
    this.player.planting = false;
    this._plantingKind = null;
    if (this.round) {
      if (was === 'plant') this.round.plantProgress = 0;
      if (was === 'defuse') this.round.defuseProgress = 0;
    }
    setProgressRing(0);
    if (this._weaponVmBackup) {
      this.gfx.setViewmodel(this._weaponVmBackup);
      this.vm = this._weaponVmBackup;
      this._weaponVmBackup = null;
    } else {
      this._tryAuthoredWeapon();
    }
  }
  _finishPlantPose() {
    this.player.planting = false;
    this._plantingKind = null;
    setProgressRing(0);
    if (this._weaponVmBackup) {
      this.gfx.setViewmodel(this._weaponVmBackup);
      this.vm = this._weaponVmBackup;
      this._weaponVmBackup = null;
    } else {
      this._tryAuthoredWeapon();
    }
  }
  _plant(dt, site) {
    const moving = Math.hypot(this.input?.moveX || 0, this.input?.moveY || 0) > 0.4;
    if (moving && (dt || 0) < 0.5) { this._cancelPlant(); return; }
    this._beginPlantPose('plant');
    this.round.plantProgress += dt;
    const need = this.cfg.plantTime || PLANT_TIME;
    const frac = Math.max(0, Math.min(1, this.round.plantProgress / need));
    setProgressRing(frac, 'PLANT');
    if (this.vm?.userData?.device) {
      this.vm.userData.device.rotation.z = Math.sin((this.time || 0) * 3) * 0.04;
    }
    if (this.round.plantProgress >= need) {
      this.round.planted = true;
      this.round.plantPos = { x: site.plant.x, y: this.player.pos.y, z: site.plant.z, site: site.id };
      this.round.t = this.cfg.bombTime || BOMB_TIME;
      this.round.plantProgress = 0;
      this._finishPlantPose();
      this.toast('Defuser planted');
      sfx.plant();
      announce('plant');
      recordObjective(this, this.player, 'plant');
      this.emitMatch?.('phase', this._phasePayload());
    }
  }
  _defuse(dt) {
    const moving = Math.hypot(this.input?.moveX || 0, this.input?.moveY || 0) > 0.4;
    if (moving && (dt || 0) < 0.5) { this._cancelPlant(); return; }
    this._beginPlantPose('defuse');
    this.round.defuseProgress += dt;
    const need = this.cfg.defuseTime || DEFUSE_TIME;
    const frac = Math.max(0, Math.min(1, this.round.defuseProgress / need));
    setProgressRing(frac, 'DEFUSE');
    if (this.round.defuseProgress >= need) {
      this._finishPlantPose();
      this._endRound('defend', 'defuse');
    }
  }

  useGadget() {
    const g = this.sig;
    if (!g || g.left <= 0) { this.toast('No signature gadget left'); return; }
    clearAdsToggle(this);
    this._gadgetBusy = true;
    // Placement itself is immediate; the busy flag is so fire can cancel back to ready in ≤0.2s.
    setTimeout(() => { this._gadgetBusy = false; }, 80);
    const kind = g.id === 'hearthlance' ? 'hearthlance'
      : g.id === 'nulldisc' ? 'nulldisc'
      : g.id === 'needleburst' ? 'needleburst'
      : g.id === 'staindart' ? 'staindart'
      : g.id;
    if (kind === 'staindart') { this.enterDrone(); return; }
    if (kind === 'afterstep') { this.toast('Footsteps projected'); g.left--; sfx.step(); return; }
    if (kind === 'blindwell') {
      this.gadgets.utility.push({ kind: 'blindwell', pos: this.player.pos.clone(), r: 4.5, live: true });
      g.left--; this.toast('Blindwell planted'); return;
    }
    if (kind === 'portcullis') { this.toast('Portcullis set'); g.left--; return; }
    if (kind === 'bramble') { this.toast('Bramble line set'); g.left--; return; }
    const ch = this.gadgets.tryPlace(kind);
    if (ch) g.left--;
  }
  useUtil() {
    const u = this.util;
    if (!u || u.left <= 0) return;
    clearAdsToggle(this);
    if (u.kind === 'explosive' || u.remote) {
      const ch = this.gadgets.tryPlace(u.id);
      if (ch) u.left--;
    } else {
      this.toast(u.name + ' used'); u.left--;
    }
  }

  jammedAt(pos) {
    return this.gadgets.utility.some(u => u.kind === 'blindwell' && u.live && pos.distanceTo(u.pos) < (u.r || 4));
  }

  inspectWeapon(dur = 1.6) {
    this.inspectDur = dur;
    this.inspectUntil = (this.time || 0) + dur;
  }

  swapWeapon() {
    this.swapT = this.player.stanceT >= 1.8 ? 0.9 : 0.45;
    if (this.weaponSlot === 'primary') {
      this._stash = this.weapon; this.weapon = this.secWeapon; this.weaponSlot = 'secondary';
    } else {
      this.weapon = this._stash || instWeapon(this.loadout.primary, this.loadout); this.weaponSlot = 'primary';
    }
    this.buildVm(); this.updateAmmo();
    this._tryAuthoredWeapon();
  }

  ping() {
    const aim = aimPing(this);
    const scan = !!aim.target;
    sfx.ping();
    addMark(this, {
      kind: scan ? 'scan' : 'ping',
      team: this.player.team,
      pos: aim.pos,
      target: aim.target,
      who: this.player,
    });
    if (scan) {
      this.toast(this.inCams || this.droneSys?.camsOn ? 'Hostiles marked on cam' : 'Hostiles marked by scout');
      scorePopup(this, 'marked');
      showScanning(true);
      clearTimeout(this._scanT);
      this._scanT = setTimeout(() => showScanning(false), 700);
    } else {
      this.toast('Ping');
    }
  }

  _beginPrep(side) {
    const s = side || this.player?.team;
    this.droneSys?._syncHud?.();
    if (s === 'attack') {
      this.toast('Prep phase — gather intel.');
      playDispatch();
      this.enterDrone();
    } else {
      this.toast('Reinforce, barricade, and place your gadgets.');
    }
  }

  _autoScanTick(source) {
    const now = this.time || 0;
    if (now - (this._autoScanAt || 0) < 0.35) return;
    this._autoScanAt = now;
    const hit = autoScan(this, source);
    if (!hit || hit === this._autoScanLast) return;
    this._autoScanLast = hit;
    this.toast(source === 'cam' ? 'Hostiles marked on cam' : 'Hostiles marked by scout');
    scorePopup(this, 'marked');
    showScanning(true);
    clearTimeout(this._scanT);
    this._scanT = setTimeout(() => showScanning(false), 700);
  }

  _tickFeed(dt) {
    const inp = this.input;
    if (this.droneSys.active) {
      if (inp.consume('hop') || inp.consume('rappel')) this.droneSys.hop();
      if (inp.consume('cycleback') || inp.consume('gadget')) this.droneSys.cycleDrone(-1);
      if (inp.consume('cycle') || inp.consume('gadget2')) this.droneSys.cycleDrone(1);
      if (inp.consume('ping')) this.ping();
      this._autoScanTick('scout');
      if (inp.consume('drone') || inp.consume('interact') || inp.consume('exitfeed')) this.exitDrone();
      else this.droneSys.update(dt);
    } else if (this.droneSys.camsOn) {
      if (inp.consume('cycleback') || inp.consume('gadget')) this.droneSys.cycle(-1);
      if (inp.consume('cycle') || inp.consume('gadget2')) this.droneSys.cycle(1);
      if (inp.consume('ping')) this.ping();
      this._autoScanTick('cam');
      if (inp.consume('cams') || inp.consume('interact') || inp.consume('exitfeed') || inp.consume('drone')) this.exitCams();
      else this.droneSys.update(dt);
    }
  }

  _tickSim(dt) {
    this.gadgets.update(dt);
    this.world.updateDoors(dt);
    this.world.updateFx?.(dt);
    this._tickBleed(dt);
    if (!this._freezeBots) updateBots(this, dt);
    this.droneSys?.updateBots?.(dt);
    updateMarks(this);
    const camPos = this.camera.position;
    const q = this.gfx.quality;
    for (const b of this.bots) if (b.visual) updateOperatorLod(b.visual, camPos, q);
    this._tickRound(dt);
    this._updateHud();
  }

  enterDrone() { this.inDrone = this.droneSys.enterDrone(); }
  exitDrone() { this.droneSys.exitDrone(); this.inDrone = false; }
  enterCams() { this.inCams = this.droneSys.enterCams(); }
  exitCams() { this.droneSys.exitCams(); this.inCams = false; }

  hurt(who, dmg, from, head, info) {
    if (!who) return;
    if (!who.alive && !who.downed) return;
    if (who === this.player && this.godMode) return;
    if (isSpawnProtected(this, who)) return;
    const already = info?.part != null;
    const mul = already ? 1 : (1 - (who.armor || 0) * 0.12);
    const fromBot = info?.who && info.who !== this.player && info.who.kind === 'operator';
    const dcfg = fromBot ? difficultyParams(this.cfg?.difficulty) : null;
    const dealt = dmg * mul * (dcfg ? dcfg.dmg : 1);
    if (who.downed) {
      this._finishPawn(who, info, head);
      return;
    }
    who.hp -= dealt;
    if (who === this.player) {
      const fl = document.getElementById('damage-flash');
      if (fl) { fl.style.opacity = 0.6; setTimeout(() => fl.style.opacity = 0, 120); }
      this.updateAmmo();
    }
    if (who.hp <= 0) {
      who.hp = 0;
      if (!who._revivedThisRound) {
        who.downed = true;
        who.alive = true;
        who.bleedAt = 0;
        who.sprint = false;
        who.adsToggle = false;
        if (who === this.player) {
          clearAdsToggle(this);
          this.toast('You are down');
          announce('down');
          document.getElementById('hud-downed')?.classList.remove('hidden');
          const flw = document.getElementById('flash-white');
          if (flw) { flw.style.opacity = 0.7; setTimeout(() => { flw.style.opacity = 0; }, 140); }
        }
        recordDown(this, who, info?.who);
        return;
      }
      this._finishPawn(who, info, head);
    }
  }

  _finishPawn(who, info, head) {
    if (!who || (!who.alive && !who.downed)) return;
    who.hp = 0; who.alive = false; who.downed = false;
    recordKill(this, who, info?.who, { head: !!(head || info?.part === 'head') });
    if (who === this.player) {
      clearAdsToggle(this);
      showEliminated(this, info?.who);
      document.getElementById('hud-downed')?.classList.add('hidden');
      const flw = document.getElementById('flash-white');
      if (flw) { flw.style.opacity = 0.85; setTimeout(() => { flw.style.opacity = 0; }, 140); }
    } else if (info?.who === this.player) {
      scorePopup(this, (head || info?.part === 'head') ? 'headshot' : 'elim');
    }
    this._checkElim();
  }

  _checkElim() {
    const pawns = [this.player, ...this.bots];
    const standing = (team) => pawns.filter(b => b.team === team && b.alive && !b.downed).length;
    const hanging = (team) => pawns.filter(b => b.team === team && b.downed).length;
    const atk = standing('attack'), def = standing('defend');
    // Downed operators can still be revived if a teammate is standing.
    if (atk === 0 && hanging('attack') === 0) this._endRound('defend', 'elim');
    else if (def === 0 && hanging('defend') === 0 && !this.round.planted) this._endRound('attack', 'elim');
    else if (def === 0 && hanging('defend') === 0 && this.round.planted) this._endRound('attack', 'elim');
  }

  _armSpawnProtect() {
    const until = (this.time || 0) + SPAWN_PROTECT_SEC;
    const arm = (pawn) => {
      if (!pawn || pawn.team !== 'attack') return;
      pawn.spawnProtectUntil = until;
    };
    arm(this.player);
    for (const b of this.bots || []) {
      arm(b);
      // Reaction delay must restart at ACTION — do not carry drone sight from prep.
      b._sawAt = 0;
      b._hasFired = false;
      b.aimT = 0;
    }
    if (this.player?.team === 'attack') this._ensureSafeAttackSpawn();
  }

  _ensureSafeAttackSpawn() {
    const p = this.player;
    if (!p?.pos) return;
    const defenders = (this.bots || []).filter(b => b && b.team === 'defend' && b.alive && b.pos);
    const exposed = defenders.some(d => hasLOS(
      this.world, d.pos.x, (d.pos.y || 0) + 1.45, d.pos.z,
      p.pos.x, (p.pos.y || 0) + 1.5, p.pos.z, 10,
    ));
    if (!exposed) return;
    const s = pickSafeAttackSpawn(this, 0, this._rng || Math.random);
    p.pos.set(s.x, s.y || 0, s.z);
    if (s.yaw != null) p.yaw = s.yaw;
  }

  _setPhase(ph, t) {
    this.round.phase = ph; this.round.t = t;
    const el = document.getElementById('hud-phase');
    if (el) el.textContent = ph.toUpperCase();
    if (ph === 'action') {
      this.round.actionAt = this.time || 0;
      this._armSpawnProtect();
    }
    if (ph !== 'prep') {
      this._prepCount = null;
      document.getElementById('hud-countdown')?.classList.remove('show');
    }
    this.emitMatch?.('phase', this._phasePayload());
  }

  _tickRound(dt) {
    this.round.t -= dt;
    if (this.round.phase === 'prep' && this.round.t <= 0) {
      this._setPhase('action', this.cfg.actionTime || ACTION_TIME);
      this.toast('Action phase');
      announce('action');
      this.droneSys?._syncHud?.();
    } else if (this.round.phase === 'prep' && this.round.t <= 5) {
      const n = Math.ceil(this.round.t);
      if (n !== this._prepCount && n > 0) {
        this._prepCount = n;
        const el = document.getElementById('hud-countdown');
        if (el) { el.textContent = String(n); el.classList.add('show'); }
        else this.toast(String(n));
      }
    } else if (this.round.phase === 'action' && this.round.t <= 0) {
      if (this.round.planted) this._endRound('attack', 'timeout');
      else this._endRound('defend', 'timeout');
    } else if (this.round.phase === 'intermission' && this.round.t <= 0) {
      this._nextRound();
    }
    const t = Math.max(0, this.round.t);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    document.getElementById('hud-timer').textContent = m + ':' + String(s).padStart(2, '0');
    document.getElementById('hud-score-atk').textContent = this.round.scoreAtk;
    document.getElementById('hud-score-def').textContent = this.round.scoreDef;
  }

  _endRound(winner, why) {
    if (this.round.phase === 'intermission' || this.round.phase === 'matchend' || this.ended) return;
    if (winner === 'attack') this.round.scoreAtk++; else this.round.scoreDef++;
    const reasonKey = why === 'timeout' && winner === 'attack' ? 'detonate' : why;
    const reason = why === 'elim' ? 'HOSTILES ELIMINATED'
      : why === 'defuse' ? 'DEFUSER DISABLED'
      : why === 'timeout' && winner === 'attack' ? 'DEFUSER DETONATED'
      : 'TIME EXPIRED';
    const mates = [this.player, ...this.bots].filter(o => o && o.team === winner);
    const clutch = this.player.team === winner && this.player.alive && !this.player.downed && mates.filter(o => o !== this.player && o.alive && !o.downed).length === 0;
    const flawless = mates.every(o => o.alive && !o.downed);
    awardRoundWin(this, winner, clutch);
    if (why === 'defuse') recordObjective(this, this.player.team === 'defend' ? this.player : (this.bots.find(b => b.team === 'defend' && b.alive) || this.player), 'defuse');
    showWon(this, reason, { clutch });
    announce(this.player.team === winner ? 'win' : 'lose');
    this.toast((winner === 'attack' ? 'Attack' : 'Defense') + ' wins the round (' + why + ')');
    const stats = collectStats(this);
    const score = { attack: this.round.scoreAtk, defend: this.round.scoreDef, need: this.round.need };
    this.emitMatch?.('roundend', {
      round: this.round.n, winner, reason: reasonKey, clutch, flawless,
      score, stats, highlights: stats.highlights,
    });
    if (this.round.scoreAtk >= this.round.need || this.round.scoreDef >= this.round.need) {
      this.round.winner = this.round.scoreAtk > this.round.scoreDef ? 'attack' : 'defend';
      this.ended = true;
      this.round.phase = 'matchend';
      // Freeze all 10 operators + K/A/D/score + MVP before the front end quits.
      const snap = freezeMatchEnd(this, {
        winner: this.round.winner,
        score,
        stats,
        side: this.player?.team,
        map: this.cfg?.map,
        mode: this.cfg?.mode,
      });
      this.emitMatch?.('matchend', snap);
      this.inMenu = true;
      this.ui.show('end');
      return;
    }
    this._setPhase('intermission', INTERMISSION);
  }

  async _nextRound() {
    this.round.n++;
    // Bomb Rush best of 3: sides swap at the start of every new round.
    this.round.swapped = true;
    this.player.team = this.player.team === 'attack' ? 'defend' : 'attack';
    this.cfg.side = this.player.team;
    const op = getOp(this.settings.operator?.[this.player.team] || this.cfg.operator, this.player.team);
    this.player.op = op; this.player.opId = op.id;
    this.player.speed = op.speed; this.player.armor = op.armor;
    this.toast('Sides swapped');
    this.round.planted = false; this.round.plantPos = null; this.round.plantProgress = 0; this.round.defuseProgress = 0;
    this.player.alive = true; this.player.hp = MAX_HP; this.player.rappelling = null;
    resetRoundCombat(this.player);
    document.getElementById('hud-downed')?.classList.add('hidden');
    this._spawnPlayer(this.player.team);
    await this._respawnBots();
    if (this.inDrone) this.exitDrone();
    if (this.inCams) this.exitCams();
    this.droneSys.spawnRound();
    resetMarks(this);
    this._setPhase('prep', this.cfg.prepTime || PREP_TIME);
    await this._maybePick();
    this._beginPrep(this.player.team);
    this.emitMatch?.('roundstart', this._roundPayload());
  }

  _bindPrompt() {
    const el = document.getElementById('hud-prompt');
    if (!el || el._ivBound) return;
    el._ivBound = true;
    const fire = (e) => {
      if (el.classList.contains('hidden')) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      const now = performance.now();
      if (now - (this._promptAct || 0) < 250) return;
      this._promptAct = now;
      this.activatePrompt();
    };
    el.addEventListener('pointerup', fire);
    el.addEventListener('click', fire);
  }

  /** Same action as the ACTION / interact button, plus rappel / vault / window. */
  activatePrompt() {
    const p = this.player, w = this.world;
    if (!p?.alive) return false;
    if (p.rappelling) return this.tryRappelOrVault() ?? true;
    const door = w.nearestDoor(p.pos, 1.5);
    if (door && Math.abs((p.pos.y || 0) - door.y) < 2.2) return this.interact(0.2, false);
    const spot = w.findRappelSpot(p.pos, p.yaw, 2.4);
    if (spot) return this.tryRappelOrVault();
    if (this._canVault()) return this._vault();
    return this.interact(0.2, false);
  }

  _canVault() {
    const p = this.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const nx = p.pos.x + fx * 1.0, nz = p.pos.z + fz * 1.0;
    const g1 = this.world.groundAt(nx, nz, p.pos.y + 1);
    return g1 > p.pos.y + 0.15 && g1 < p.pos.y + 0.9;
  }

  _updateInteractPrompt() {
    const el = document.getElementById('hud-prompt');
    const rap = document.getElementById('tb-rappel');
    const p = this.player, w = this.world;
    let msg = '';
    let action = '';
    if (p.rappelling) {
      const win = w.alignedWindow(p.rappelling, 0.75);
      if (win) {
        if (win.state === 'barricaded' || win.state === 'reinforced') { msg = 'BREACH WINDOW FIRST'; action = 'breach'; }
        else if (win.state === 'intact' || win.state === 'cracked') { msg = 'SMASH AND ENTER'; action = 'enter'; }
        else { msg = 'ENTER WINDOW'; action = 'enter'; }
      } else if (p.rappelling.y < 0.6) { msg = 'DROP'; action = 'drop'; }
      else { msg = 'RAPPEL — move freely, or drop at the ground'; action = 'rappel'; }
      rap?.classList.remove('hidden');
    } else {
      const spot = w.findRappelSpot(p.pos, p.yaw, 2.2);
      rap?.classList.toggle('hidden', !spot);
      if (spot) { msg = 'RAPPEL'; action = 'rappel'; }
      const door = w.nearestDoor(p.pos, 1.4);
      if (door && Math.abs((p.pos.y || 0) - door.y) < 2.2) {
        msg = door.state === 'open' ? 'CLOSE DOOR' : 'OPEN DOOR';
        action = 'door';
      }
      if (this._canVault() && action !== 'door') { msg = 'VAULT'; action = 'vault'; }
      const downed = this._nearDownedTeammate();
      if (downed && p.alive && !p.downed) { msg = 'HOLD TO REVIVE'; action = 'revive'; }
      const site = this._nearPlant();
      if (site && p.team === 'attack' && !this.round.planted && this.round.phase === 'action') { msg = 'HOLD TO PLANT'; action = 'plant'; }
      if (this.round.planted && p.team === 'defend' && this._nearDefuser()) { msg = 'HOLD TO DEFUSE'; action = 'defuse'; }
    }
    if (p.outOfBounds) { msg = 'Return to the operation area'; action = ''; }
    this.promptAction = action;
    const ads = (p.ads || 0) > 0.5;
    const act = document.getElementById('tb-interact');
    const touch = document.getElementById('touch');
    const touchOn = !!(touch && !touch.classList.contains('hidden') && !touch.classList.contains('pad-hidden') && !touch.classList.contains('feed-on'));
    const showAct = !!(msg && action && !ads && touchOn);
    if (act) {
      const lbl = act.querySelector('.tlbl');
      const text = msg || 'ACTION';
      if (lbl) lbl.textContent = text;
      else act.setAttribute('aria-label', text);
      act.classList.toggle('hidden', !showAct);
    }
    // Touch uses tb-interact; keep the centre prompt for gamepad / overlap-free fallback
    // only when the on-screen ACTION button is not shown.
    if (msg && el && !showAct && !ads) {
      const glyph = this.input?.interactGlyph?.() || '';
      el.textContent = msg + glyph;
      el.classList.remove('hidden');
    } else {
      el?.classList.add('hidden');
    }
  }

  _updateHud() {
    document.getElementById('hp-fill').style.width = Math.max(0, this.player.hp) + '%';
    document.getElementById('hp-n').textContent = Math.max(0, this.player.hp)|0;
    const icon = document.getElementById('hud-op-icon');
    if (icon) {
      const id = this.player.opId || this.player.op?.id || '';
      if (id && icon.dataset.op !== id) {
        icon.src = `assets/ui/operators/${id}_bust.webp`;
        icon.alt = id;
        icon.dataset.op = id;
      }
    }
    const obj = document.getElementById('hud-obj');
    let objText = '';
    if (this.round.planted) objText = this.player.team === 'defend' ? 'Defuse the defuser.' : 'Hold the site. Defend the defuser.';
    else if (this.round.phase === 'prep') objText = this.player.team === 'attack' ? 'Prep — drone and choose an entry.' : 'Prep — reinforce, barricade, set gadgets.';
    else objText = this.player.team === 'attack' ? 'Plant the defuser at a site, or eliminate the defense.' : 'Stop the plant. Hold the sites.';
    if (obj && obj.dataset.text !== objText) {
      const first = obj.dataset.text == null;
      obj.dataset.text = objText;
      if (first) { obj.textContent = objText; obj.style.opacity = '1'; }
      else {
        obj.style.opacity = '0';
        clearTimeout(this._objFade);
        this._objFade = setTimeout(() => {
          obj.textContent = objText;
          obj.style.opacity = '1';
        }, 160);
      }
    }
    const ch = document.getElementById('crosshair');
    if (ch) ch.classList.toggle('hidden', this.player.ads > 0.55 || this.inDrone || this.inCams || this.player.downed || !this.player.alive);
    document.getElementById('hud-downed')?.classList.toggle('hidden', !this.player.downed);
    if (!this.player.planting && !this._reinf) setProgressRing(0);
    const cd = document.getElementById('hud-countdown');
    if (cd && (this.round.phase !== 'prep' || this.round.t > 5)) cd.classList.remove('show');
    const viewPos = (this.inDrone || this.droneSys?.active) && this.droneSys?.drone?.pos
      ? this.droneSys.drone.pos
      : ((this.inCams || this.droneSys?.camsOn) && this.droneSys?._orderedCams?.()[this.droneSys.camI])
        || this.player.pos;
    const room = document.getElementById('hud-room');
    if (room) room.textContent = roomCallout(this.world, viewPos);
    const yaw = (this.inDrone || this.droneSys?.active) && this.droneSys?.drone
      ? this.droneSys.drone.yaw
      : this.player.yaw;
    updateCompass(yaw);
    updateSquad(this);
    this.droneSys?._syncHud?.();
  }

  updateAmmo() {
    const w = this.weapon;
    document.getElementById('ammo-clip').textContent = w?.clip ?? 0;
    document.getElementById('ammo-res').textContent = '/ ' + (w?.reserve ?? 0);
    document.getElementById('ammo-wpn').textContent = (w?.name || '').toUpperCase();
    document.getElementById('hp-fill').style.width = Math.max(0, this.player.hp) + '%';
  }

  applyCrosshair() {
    const s = this.settings.crosshair;
    const el = document.getElementById('crosshair');
    if (!el) return;
    el.className = 'ch-' + (s.style || 'cross');
    el.style.setProperty('--ch-color', s.color || '#ffffff');
    el.style.setProperty('--ch-size', (s.size || 18) + 'px');
    el.style.setProperty('--ch-thick', (s.thick || 2) + 'px');
    el.style.setProperty('--ch-gap', (s.gap || 5) + 'px');
    el.style.setProperty('--ch-outline', (s.outline || 2) + 'px');
    el.style.setProperty('--ch-opacity', s.opacity ?? 0.95);
    el.style.color = s.color;
  }

  toast(msg) {
    this._msg = msg;
    const el = document.getElementById('hud-toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), 1600);
  }

  _showLoad(on, title) {
    const el = document.getElementById('loading');
    el.classList.toggle('hidden', !on);
    if (title) document.getElementById('load-title').textContent = title;
    if (!on) document.getElementById('load-fill').style.width = '100%';
  }
  _loadMsg(msg, p) {
    document.getElementById('load-msg').textContent = msg;
    document.getElementById('load-fill').style.width = Math.round((p || 0) * 100) + '%';
  }

  _cullBots() {
    const b = this.world?.constructor ? null : null;
    const bounds = (this.world && (globalThis.BOUNDS)) || null;
    const box = this.world?.bounds || null;
    // Use map building AABB: hide operators well inside when the camera is outside.
    const B = { x0: -11, x1: 11, z0: -9, z1: 11 };
    const c = this.camera.position;
    const outside = c.x < B.x0 - 1.2 || c.x > B.x1 + 1.2 || c.z < B.z0 - 1.2 || c.z > B.z1 + 1.2;
    for (const bot of this.bots || []) {
      if (!bot.mesh) continue;
      if (!outside) { bot.mesh.visible = true; continue; }
      const p = bot.pos || bot.mesh.position;
      const inside = p.x > B.x0 + 0.8 && p.x < B.x1 - 0.8 && p.z > B.z0 + 0.8 && p.z < B.z1 - 0.8;
      const dx = p.x - c.x, dz = p.z - c.z;
      bot.mesh.visible = !inside && Math.hypot(dx, dz) < 8;
    }
  }

  spawnBurst(pos) { /* particle stub */ }
  spawnDecal() {}


  async _tryAuthoredWeapon() {
    try {
      const vis = await createFirstPersonViewmodel(this.weapon || {});
      if (!vis) return;
      this.gfx.setViewmodel(vis);
      this.vm = vis;
    } catch (e) { console.warn('authored vm failed', e); }
  }

  _roundPayload() {
    const r = this.round || {};
    return {
      round: r.n || 0,
      phase: r.phase,
      side: this.player?.team,
      t: r.t,
      score: { attack: r.scoreAtk || 0, defend: r.scoreDef || 0, need: r.need || 2 },
      sites: r.siteIds,
      swapped: !!r.swapped,
    };
  }

  _phasePayload() {
    const r = this.round || {};
    return {
      round: r.n || 0,
      phase: r.phase,
      t: r.t,
      planted: !!r.planted,
      plantSite: r.plantPos?.site || null,
      score: { attack: r.scoreAtk || 0, defend: r.scoreDef || 0, need: r.need || 2 },
    };
  }

  async _maybePick() {
    const cfg = this.cfg || {};
    if (cfg.skipOperatorPick !== false) return;
    const side = this.player?.team || cfg.side;
    this._awaitingPick = true;
    this.emitMatch?.('operatorpick', {
      round: this.round?.n || 0, side, timeout: cfg.pickTimeout || 8,
      roster: rosterPayload(this, side), current: this.player?.opId,
    });
    const id = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(this.player?.opId), (cfg.pickTimeout || 8) * 1000);
      this._resolvePick = (picked) => { clearTimeout(t); resolve(picked || this.player?.opId); };
    });
    this._awaitingPick = false;
    this._resolvePick = null;
    if (id && id !== this.player.opId) {
      const op = getOp(id, side);
      this.player.op = op; this.player.opId = op.id;
      this.player.speed = op.speed; this.player.armor = op.armor;
    }
  }

  async _respawnBots() {
    this._botGen = (this._botGen || 0) + 1;
    for (const b of this.bots || []) {
      b._dead = true;
      if (b.mesh?.parent) b.mesh.parent.remove(b.mesh);
    }
    this.bots = spawnBots(this);
    await readyBots(this.bots);
    for (const b of this.bots) { resetRoundCombat(b); ensureStat(b, { player: this.player }); }
  }

  _nearDownedTeammate() {
    const p = this.player;
    let best = null, bd = 1.6;
    const list = [this.player, ...this.bots];
    for (const b of list) {
      if (!b.downed || b === p || b.team !== p.team) continue;
      const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (d < bd && Math.abs((b.pos.y || 0) - (p.pos.y || 0)) < 1.2) { bd = d; best = b; }
    }
    return best;
  }

  _tickBleed(dt) {
    for (const p of [this.player, ...this.bots]) {
      if (!p?.downed) continue;
      p.bleedAt = (p.bleedAt || 0) + dt;
      const solo = ![this.player, ...this.bots].some(o => o !== p && o.team === p.team && o.alive && !o.downed);
      const limit = solo ? Math.min(BLEED_TIME, 6) : BLEED_TIME;
      if (p.bleedAt >= limit) this._finishPawn(p, {}, false);
    }
  }

  _tickSpectate(dt) {
    const inp = this.input;
    const mates = this.bots.filter(b => b.team === this.player.team && b.alive);
    if (inp.consume('cycle') || inp.consume('drone') || inp.consume('swap')) {
      this._specI = ((this._specI || 0) + 1) % Math.max(1, mates.length);
    }
    if (inp.consume('cams')) this.enterCams();
    const who = mates[this._specI || 0];
    if (!who) return;
    const cam = this.gfx.camera;
    cam.position.set(who.pos.x, who.pos.y + 1.55, who.pos.z);
    cam.lookAt(
      who.pos.x + Math.sin(who.yaw || 0),
      who.pos.y + 1.45,
      who.pos.z + Math.cos(who.yaw || 0),
    );
    if (this.vm) this.vm.visible = false;
    this.hideViewmodel = true;
  }

  showHitMarker(kind) {
    const el = document.getElementById('hit-marker');
    if (!el) return;
    el.classList.toggle('head', kind === 'head');
    el.classList.remove('hidden');
    el.classList.add('show');
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => el.classList.remove('show'), 120);
  }

  // test helpers
  inspectLoad() {
    const p = this.player, w = this.world;
    const gy = w.groundAt(p.pos.x, p.pos.z, p.pos.y + 2);
    const groups = this.gfx.scene.children.filter(c => c.name === 'world').length;
    return {
      ok: this.running, layout: w.layoutId, boxes: w.boxes.length,
      py: p.pos.y, gy, floorDelta: Math.abs(p.pos.y - gy),
      solid: !!w.pointInSolid(p.pos.x, p.pos.y + 0.2, p.pos.z, 0.2, 1.2),
      worldGroups: groups,
      mem: this.gfx.info(),
      droneGaps: (w.droneGaps || []).length,
      cams: (w.secCams || []).length,
      difficulty: this.cfg?.difficulty,
    };
  }
}

export { BUILD, TITLE, measure, buildHuman, EYE };
